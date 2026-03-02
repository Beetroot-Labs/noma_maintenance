use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::http::{HeaderValue, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use simple_logger::SimpleLogger;
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| "debug".to_string());
    SimpleLogger::new()
        .with_level(log::LevelFilter::from_str(&log_level).unwrap_or(log::LevelFilter::Debug))
        .init()
        .expect("failed to initialize logger");
    log::info!("Starting server...");

    let env_file_path = std::env::var("ENV_FILE").unwrap_or_else(|_| ".env".to_string());
    log::info!("Loading environment variables from {}", env_file_path);
    dotenvy::from_filename(env_file_path).ok();
    log::info!("Environment variables loaded");

    let static_dir =
        std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/apps/main/dist".to_string());
    let static_root = PathBuf::from(&static_dir);
    let assets_root = static_root.join("assets");
    let index_file = static_root.join("index.html");
    log::info!("Serving frontend from {}", static_root.display());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let database_url = std::env::var("DATABASE_URL").unwrap_or_default();
    let db_pool = if database_url.is_empty() {
        log::warn!("DATABASE_URL is missing; hvac endpoint will be unavailable");
        None
    } else {
        match PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await
        {
            Ok(pool) => Some(pool),
            Err(err) => {
                log::error!("Failed to connect to database: {}", err);
                None
            }
        }
    };

    let google_client_ids = load_google_client_ids();
    let google_hosted_domain = std::env::var("GOOGLE_HOSTED_DOMAIN").ok();
    let session_cookie_name =
        std::env::var("SESSION_COOKIE_NAME").unwrap_or_else(|_| "noma_session".to_string());
    let session_days = std::env::var("SESSION_DURATION_DAYS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(30);
    let cookie_secure = std::env::var("COOKIE_SECURE")
        .ok()
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let app_state = AppState {
        client: reqwest::Client::new(),
        db_pool,
        auth: (!google_client_ids.is_empty()).then_some(AuthConfig {
            google_client_ids,
            google_hosted_domain,
            session_cookie_name,
            session_duration: Duration::days(session_days),
            cookie_secure,
        }),
    };

    let api = Router::new()
        .route("/health-check", get(|| async { "OK" }))
        .route("/auth/google", post(google_login))
        .route("/auth/me", get(get_current_user))
        .route("/auth/logout", post(logout))
        .route("/labeling/buildings", get(list_labeling_buildings))
        .route(
            "/labeling/buildings/{building_id}/cache",
            get(get_labeling_building_cache),
        )
        .with_state(app_state);

    let assets_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeDir::new(assets_root).append_index_html_on_directories(false));

    let index_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(ServeFile::new(index_file));

    let static_root_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        ))
        .service(
            ServeDir::new(static_root)
                .append_index_html_on_directories(false)
                .fallback(index_service),
        );

    let app = Router::new()
        .nest("/api", api)
        .nest_service("/assets", assets_service)
        .fallback_service(static_root_service)
        .layer(cors);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = SocketAddr::from(([0, 0, 0, 0], port.parse::<u16>().unwrap_or(3000)));
    log::info!("Listening on {}", addr);
    let listener = TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

#[derive(Clone)]
struct AppState {
    client: reqwest::Client,
    db_pool: Option<PgPool>,
    auth: Option<AuthConfig>,
}

#[derive(Clone)]
struct AuthConfig {
    google_client_ids: Vec<String>,
    google_hosted_domain: Option<String>,
    session_cookie_name: String,
    session_duration: Duration,
    cookie_secure: bool,
}

#[derive(Deserialize)]
struct GoogleLoginRequest {
    credential: String,
}

#[derive(Serialize)]
struct UserResponse {
    id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    full_name: String,
    email: String,
}

#[derive(Serialize)]
struct AuthResponse {
    user: UserResponse,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

#[derive(sqlx::FromRow)]
struct DbUser {
    id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    full_name: String,
    email: String,
    is_active: bool,
}

#[derive(sqlx::FromRow)]
struct SessionUser {
    id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    full_name: String,
    email: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct BuildingSummary {
    id: uuid::Uuid,
    name: String,
    address: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct CachedLocation {
    id: uuid::Uuid,
    building_id: uuid::Uuid,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CachedDevice {
    id: uuid::Uuid,
    location_id: Option<uuid::Uuid>,
    kind: String,
    additional_info: Option<String>,
    brand: Option<String>,
    model: Option<String>,
    device_photo_url: Option<String>,
}

#[derive(Serialize)]
struct BuildingCacheResponse {
    building: BuildingSummary,
    locations: Vec<CachedLocation>,
    devices: Vec<CachedDevice>,
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

async fn google_login(
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

    if let Some(required_domain) = &auth.google_hosted_domain {
        if claims.hd.as_deref() != Some(required_domain.as_str()) {
            return Err(ApiError::forbidden(
                "google account is not in the allowed hosted domain",
            ));
        }
    }

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let google_user = sqlx::query_as::<_, DbUser>(
        r#"
        SELECT u.id, u.tenant_id, u.full_name, u.email::text AS email, u.is_active
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
            SELECT id, tenant_id, full_name, email::text AS email, is_active
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
        },
    });

    Ok(([(header::SET_COOKIE, cookie)], response))
}

async fn get_current_user(
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
    let token = extract_session_token(&headers, &auth.session_cookie_name)
        .ok_or_else(|| ApiError::unauthorized("missing session cookie"))?;
    let token_hash = hash_session_token(&token);

    let user = sqlx::query_as::<_, SessionUser>(
        r#"
        SELECT u.id, u.tenant_id, u.full_name, u.email::text AS email
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
    .ok_or_else(|| ApiError::unauthorized("invalid session"))?;

    Ok(Json(AuthResponse {
        user: UserResponse {
            id: user.id,
            tenant_id: user.tenant_id,
            full_name: user.full_name,
            email: user.email,
        },
    }))
}

async fn logout(
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
        StatusCode::NO_CONTENT,
    ))
}

async fn list_labeling_buildings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let buildings = sqlx::query_as::<_, BuildingSummary>(
        r#"
        SELECT id, name, address
        FROM buildings
        WHERE tenant_id = $1
        ORDER BY name
        "#,
    )
    .bind(user.tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(buildings))
}

async fn get_labeling_building_cache(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(building_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let building = sqlx::query_as::<_, BuildingSummary>(
        r#"
        SELECT id, name, address
        FROM buildings
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("building not found for current tenant"))?;

    let locations = sqlx::query_as::<_, CachedLocation>(
        r#"
        SELECT id, building_id, floor, wing, room, location_description
        FROM site_locations
        WHERE tenant_id = $1 AND building_id = $2
        ORDER BY floor NULLS FIRST, wing NULLS FIRST, room NULLS FIRST, created_at
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    let devices = sqlx::query_as::<_, CachedDevice>(
        r#"
        SELECT
            d.id,
            d.location_id,
            d.kind::text AS kind,
            d.additional_info,
            d.brand,
            d.model,
            d.device_photo_url
        FROM devices d
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        WHERE d.tenant_id = $1 AND sl.building_id = $2
        ORDER BY d.kind, d.brand NULLS FIRST, d.model NULLS FIRST, d.created_at
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(BuildingCacheResponse {
        building,
        locations,
        devices,
    }))
}

async fn verify_google_id_token(
    state: &AppState,
    id_token: &str,
) -> Result<GoogleClaims, ApiError> {
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
    if let Some(alg) = &jwk.alg {
        if alg != "RS256" {
            return Err(ApiError::unauthorized(
                "unexpected google signing key algorithm",
            ));
        }
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
            log::warn!("Google token validation failed: {}", err);
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

async fn require_session_user(
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
        SELECT u.id, u.tenant_id, u.full_name, u.email::text AS email
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
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn service_unavailable(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }

    fn internal(error: impl std::fmt::Display) -> Self {
        log::error!("{}", error);
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "internal server error".to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(ErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}

fn load_google_client_ids() -> Vec<String> {
    let mut client_ids = Vec::new();

    for value in [
        std::env::var("GOOGLE_CLIENT_IDS").ok(),
        std::env::var("GOOGLE_CLIENT_ID").ok(),
        std::env::var("MAIN_GOOGLE_CLIENT_ID").ok(),
        std::env::var("LABELING_GOOGLE_CLIENT_ID").ok(),
    ]
    .into_iter()
    .flatten()
    {
        for client_id in value.split(',').map(str::trim).filter(|value| !value.is_empty()) {
            if !client_ids.iter().any(|existing| existing == client_id) {
                client_ids.push(client_id.to_string());
            }
        }
    }

    client_ids
}
