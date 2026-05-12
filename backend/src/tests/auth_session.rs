// A2 + A3 — session and logout endpoints.
//
// A1 (`/auth/google` end-to-end JWKS verification) is intentionally not covered here. A
// proper test requires a fake JWKS server signing tokens with a known RSA key — fixture
// work that hasn't landed yet. When it does, A1.1–A1.10 fall in here.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::Value;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// A2.1 — valid session → 200 with the user payload.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a2_1_valid_session_returns_user(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["user"]["id"], user.id.to_string());
    assert_eq!(json["user"]["tenant_id"], tenant.id.to_string());
    assert_eq!(json["user"]["role"], "TECHNICIAN");
}

// A2.2 — no cookie → 401 ("missing session cookie").
#[sqlx::test(migrator = "MIGRATOR")]
async fn a2_2_no_cookie_returns_401(pool: PgPool) {
    let router = build_router(pool);
    let req = Request::builder()
        .method("GET")
        .uri("/api/auth/me")
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&router, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "missing session cookie");
}

// A2.3 — revoked session → 401.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a2_3_revoked_session_returns_401(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// A2.4 — expired session → 401.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a2_4_expired_session_returns_401(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    sqlx::query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// A2.5 — is_active flipped to false mid-session → 401. (Same contract as H4, repeated here
// because A2 is the canonical place for it.)
#[sqlx::test(migrator = "MIGRATOR")]
async fn a2_5_inactive_user_returns_401(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// A3.1 — logout with valid cookie → 204; the session row's `revoked_at` is set; response
// carries an expired cookie.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a3_1_logout_with_cookie_revokes_session(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router(pool.clone());
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/logout")
        .header("Cookie", format!("noma_session={}", user.session_token))
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot_via_test(req).await;
    let status = response.status();
    let cookie_header = response
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        cookie_header.contains("Max-Age=0"),
        "logout should set an expired cookie, got: {cookie_header}"
    );

    let revoked: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NOT NULL FROM sessions WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(revoked, Some(true));
}

// A3.2 — logout without a cookie still returns 204 with an expired cookie attached.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a3_2_logout_without_cookie_returns_204(pool: PgPool) {
    let router = build_router(pool);
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/logout")
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot_via_test(req).await;
    let status = response.status();
    let cookie_header = response
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(cookie_header.contains("Max-Age=0"));
}

// A3.3 — logout when the session is already revoked → still 204; revocation is idempotent
// (the SQL `UPDATE ... WHERE revoked_at IS NULL` is a no-op).
#[sqlx::test(migrator = "MIGRATOR")]
async fn a3_3_logout_already_revoked_returns_204(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    sqlx::query("UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();
    let original_revoked_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT revoked_at FROM sessions WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map(|opt: Option<_>| opt.unwrap())
    .unwrap();

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req("POST", "/auth/logout", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let revoked_at_after: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT revoked_at FROM sessions WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_one(&pool)
    .await
    .map(|opt: Option<_>| opt.unwrap())
    .unwrap();
    assert_eq!(
        revoked_at_after, original_revoked_at,
        "second logout must not bump the revoked_at timestamp"
    );
}

// A3.4 — after logout, /auth/me with the same cookie returns 401.
#[sqlx::test(migrator = "MIGRATOR")]
async fn a3_4_after_logout_auth_me_returns_401(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router(pool);
    let (logout_status, _) = call(
        &router,
        make_req("POST", "/auth/logout", &user.session_token, None, None),
    )
    .await;
    assert_eq!(logout_status, StatusCode::NO_CONTENT);

    let (me_status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(me_status, StatusCode::UNAUTHORIZED);
}

// Tower extension trait — only used here to read response headers (the regular `call`
// helper drops the response after extracting status + body).
use axum::Router;
use axum::body::Bytes;
use axum::response::Response;
use tower::ServiceExt;
trait OneshotForTest {
    async fn oneshot_via_test(self, req: Request<Body>) -> Response<Body>;
}
impl OneshotForTest for Router {
    async fn oneshot_via_test(self, req: Request<Body>) -> Response<Body> {
        let response = self.oneshot(req).await.unwrap();
        let (parts, body) = response.into_parts();
        let bytes: Bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        Response::from_parts(parts, Body::from(bytes))
    }
}
