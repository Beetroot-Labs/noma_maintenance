use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, header};
use axum::response::IntoResponse;
use chrono::{DateTime, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;
use crate::state::{AppState, AuthConfig};

#[derive(Deserialize)]
pub struct GoogleLoginRequest {
    pub credential: String,
}

#[derive(Serialize)]
pub struct UserResponse {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub full_name: String,
    pub email: String,
    pub role: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub user: UserResponse,
}

#[derive(sqlx::FromRow)]
struct DbUser {
    id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    full_name: String,
    email: String,
    role: String,
    is_active: bool,
}

#[derive(sqlx::FromRow)]
pub struct SessionUser {
    pub id: uuid::Uuid,
    pub tenant_id: uuid::Uuid,
    pub full_name: String,
    pub email: String,
    pub role: String,
}

#[derive(Deserialize)]
struct GoogleJwks {
    keys: Vec<GoogleJwk>,
}

#[derive(Deserialize)]
struct GoogleJwk {
    kid: String,
    n: String,
    e: String,
    alg: Option<String>,
    kty: String,
    #[serde(rename = "use")]
    use_: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct GoogleClaims {
    #[serde(rename = "iss")]
    _iss: String,
    #[serde(rename = "aud")]
    _aud: String,
    #[serde(rename = "exp")]
    _exp: usize,
    #[serde(rename = "iat")]
    _iat: usize,
    sub: String,
    email: Option<String>,
    email_verified: Option<bool>,
    hd: Option<String>,
    #[serde(rename = "name")]
    _name: Option<String>,
}

pub async fn google_login(
    State(state): State<AppState>,
    Json(payload): Json<GoogleLoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let auth = state
        .auth
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("google auth is not configured"))?;

    let claims = verify_google_id_token(&state, &payload.credential).await?;
    let email = claims
        .email
        .clone()
        .ok_or_else(|| ApiError::unauthorized("google token did not contain an email address"))?;
    let email_verified = claims.email_verified.unwrap_or(false);
    if !email_verified {
        return Err(ApiError::unauthorized(
            "google account email is not verified",
        ));
    }

    if let Some(required_domain) = &auth.google_hosted_domain
        && claims.hd.as_deref() != Some(required_domain.as_str())
    {
        return Err(ApiError::forbidden(
            "google account is not in the allowed hosted domain",
        ));
    }

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let google_user = sqlx::query_as::<_, DbUser>(
        r#"
        SELECT u.id, u.tenant_id, u.full_name, u.email::text AS email, u.role::text AS role, u.is_active
        FROM auth_identities ai
        JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'GOOGLE' AND ai.provider_subject = $1
        "#,
    )
    .bind(&claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let user = if let Some(user) = google_user {
        user
    } else {
        let user = sqlx::query_as::<_, DbUser>(
            r#"
            SELECT id, tenant_id, full_name, email::text AS email, role::text AS role, is_active
            FROM users
            WHERE email = $1
            "#,
        )
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::forbidden("no user with this email exists"))?;

        let existing_google_subject: Option<String> = sqlx::query_scalar(
            r#"
            SELECT provider_subject
            FROM auth_identities
            WHERE user_id = $1 AND provider = 'GOOGLE'
            "#,
        )
        .bind(user.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::internal)?;

        if let Some(existing_subject) = existing_google_subject {
            if existing_subject != claims.sub {
                return Err(ApiError::forbidden(
                    "this user is already linked to a different Google account",
                ));
            }
        } else {
            sqlx::query(
                r#"
                INSERT INTO auth_identities (user_id, provider, provider_subject, last_used_at)
                VALUES ($1, 'GOOGLE', $2, NOW())
                "#,
            )
            .bind(user.id)
            .bind(&claims.sub)
            .execute(&mut *tx)
            .await
            .map_err(ApiError::internal)?;
        }

        user
    };

    if !user.is_active {
        return Err(ApiError::forbidden("user account is inactive"));
    }

    sqlx::query(
        r#"
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        UPDATE auth_identities
        SET last_used_at = NOW()
        WHERE user_id = $1 AND provider = 'GOOGLE' AND provider_subject = $2
        "#,
    )
    .bind(user.id)
    .bind(&claims.sub)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let session = create_session(&mut tx, auth, user.id).await?;

    tx.commit().await.map_err(ApiError::internal)?;

    let cookie = build_session_cookie(auth, &session.token, session.expires_at);
    let response = Json(AuthResponse {
        user: UserResponse {
            id: user.id,
            tenant_id: user.tenant_id,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
        },
    });

    Ok(([(header::SET_COOKIE, cookie)], response))
}

pub async fn get_current_user(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let user = require_session_user(&state, &headers).await?;
    Ok(Json(AuthResponse {
        user: UserResponse {
            id: user.id,
            tenant_id: user.tenant_id,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
        },
    }))
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let auth = state
        .auth
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("google auth is not configured"))?;

    if let Some(token) = extract_session_token(&headers, &auth.session_cookie_name) {
        let token_hash = hash_session_token(&token);
        sqlx::query(
            r#"
            UPDATE sessions
            SET revoked_at = NOW()
            WHERE session_token_hash = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(token_hash)
        .execute(pool)
        .await
        .map_err(ApiError::internal)?;
    }

    let expired_cookie = format!(
        "{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
        auth.session_cookie_name,
        if auth.cookie_secure { "; Secure" } else { "" }
    );

    Ok((
        [(header::SET_COOKIE, expired_cookie)],
        axum::http::StatusCode::NO_CONTENT,
    ))
}

pub async fn require_session_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<SessionUser, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let auth = state
        .auth
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("google auth is not configured"))?;
    let token = extract_session_token(headers, &auth.session_cookie_name)
        .ok_or_else(|| ApiError::unauthorized("missing session cookie"))?;
    let token_hash = hash_session_token(&token);

    sqlx::query_as::<_, SessionUser>(
        r#"
        SELECT u.id, u.tenant_id, u.full_name, u.email::text AS email, u.role::text AS role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND u.is_active = TRUE
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::unauthorized("invalid session"))
}

pub fn require_lead_or_admin(user: &SessionUser) -> Result<(), ApiError> {
    if user.role == "ADMIN" || user.role == "LEAD_TECHNICIAN" {
        return Ok(());
    }
    Err(ApiError::forbidden(
        "only admins or lead technicians can perform this action",
    ))
}

async fn verify_google_id_token(state: &AppState, id_token: &str) -> Result<GoogleClaims, ApiError> {
    let auth = state
        .auth
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("google auth is not configured"))?;
    let header = decode_header(id_token).map_err(|_| ApiError::unauthorized("invalid id token"))?;
    let kid = header
        .kid
        .ok_or_else(|| ApiError::unauthorized("missing key id in id token"))?;
    if header.alg != Algorithm::RS256 {
        return Err(ApiError::unauthorized("unexpected google token algorithm"));
    }

    let jwks = state
        .client
        .get("https://www.googleapis.com/oauth2/v3/certs")
        .send()
        .await
        .map_err(ApiError::internal)?
        .error_for_status()
        .map_err(ApiError::internal)?
        .json::<GoogleJwks>()
        .await
        .map_err(ApiError::internal)?;

    let jwk = jwks
        .keys
        .into_iter()
        .find(|key| key.kid == kid)
        .ok_or_else(|| ApiError::unauthorized("no matching google signing key found"))?;

    if jwk.kty != "RSA" || jwk.use_.as_deref() != Some("sig") {
        return Err(ApiError::unauthorized("unexpected google signing key"));
    }
    if let Some(alg) = &jwk.alg
        && alg != "RS256"
    {
        return Err(ApiError::unauthorized(
            "unexpected google signing key algorithm",
        ));
    }

    let decoding_key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
        .map_err(|_| ApiError::unauthorized("failed to decode google signing key"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(
        &auth
            .google_client_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
    );
    validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);

    let token_data =
        decode::<GoogleClaims>(id_token, &decoding_key, &validation).map_err(|err| {
            log::warn!("Google token validation failed: {err}");
            ApiError::unauthorized("google id token verification failed")
        })?;

    Ok(token_data.claims)
}

struct CreatedSession {
    token: String,
    expires_at: DateTime<Utc>,
}

async fn create_session(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    auth: &AuthConfig,
    user_id: uuid::Uuid,
) -> Result<CreatedSession, ApiError> {
    let token = uuid::Uuid::new_v4().to_string();
    let token_hash = hash_session_token(&token);
    let expires_at = Utc::now() + auth.session_duration;

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, session_token_hash, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(token_hash)
    .bind(expires_at)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(CreatedSession { token, expires_at })
}

fn build_session_cookie(auth: &AuthConfig, token: &str, expires_at: DateTime<Utc>) -> String {
    let mut cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Expires={}; Max-Age={}",
        auth.session_cookie_name,
        token,
        expires_at.format("%a, %d %b %Y %H:%M:%S GMT"),
        auth.session_duration.num_seconds(),
    );
    if auth.cookie_secure {
        cookie.push_str("; Secure");
    }
    cookie
}

fn extract_session_token(headers: &HeaderMap, cookie_name: &str) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie_header.split(';').find_map(|pair| {
        let mut parts = pair.trim().splitn(2, '=');
        let name = parts.next()?;
        let value = parts.next()?;
        if name == cookie_name {
            Some(value.to_string())
        } else {
            None
        }
    })
}

fn hash_session_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}
