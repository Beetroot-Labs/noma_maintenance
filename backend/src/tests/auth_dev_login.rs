// /auth/dev-login — e2e test auth bypass.
//
// The route is gated by AuthConfig.dev_login_enabled (env: ENABLE_DEV_LOGIN). When the
// flag is off the route returns 404 indistinguishably from any unknown path. When the
// flag is on it issues a real session cookie for the user matching `email`.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn dev_login_req(email: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(format!("/api/auth/dev-login?email={email}"))
        .body(Body::empty())
        .unwrap()
}

// Flag disabled — 404 (and no cookie issued).
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_returns_404_when_flag_disabled(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let email: String = sqlx::query_scalar("SELECT email::text FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, _) = call(&router, dev_login_req(&email)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// Flag enabled, valid email — 204 with a Set-Cookie header that names a fresh session row.
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_issues_session_when_enabled(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let email: String = sqlx::query_scalar("SELECT email::text FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let sessions_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let router = build_router_with_dev_login(pool.clone());
    let response = tower::ServiceExt::oneshot(router, dev_login_req(&email))
        .await
        .unwrap();
    let status = response.status();
    let cookie_header = response
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        cookie_header.starts_with("noma_session="),
        "expected noma_session cookie, got: {cookie_header}"
    );

    let sessions_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = $1")
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(sessions_after, sessions_before + 1);
}

// Flag enabled, missing email param — 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_missing_email_returns_400(pool: PgPool) {
    let router = build_router_with_dev_login(pool);
    let req = Request::builder()
        .method("GET")
        .uri("/api/auth/dev-login")
        .body(Body::empty())
        .unwrap();
    let (status, _) = call(&router, req).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// Flag enabled, unknown email — 404.
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_unknown_email_returns_404(pool: PgPool) {
    let router = build_router_with_dev_login(pool);
    let (status, _) = call(&router, dev_login_req("nobody@nowhere.test")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// Flag enabled, inactive user — 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_inactive_user_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();
    let email: String = sqlx::query_scalar("SELECT email::text FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let router = build_router_with_dev_login(pool);
    let (status, _) = call(&router, dev_login_req(&email)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// Cookie issued by dev-login is accepted by /auth/me as a valid session.
#[sqlx::test(migrator = "MIGRATOR")]
async fn dev_login_cookie_works_against_auth_me(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "ADMIN").await;
    let email: String = sqlx::query_scalar("SELECT email::text FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let router = build_router_with_dev_login(pool);
    let response = tower::ServiceExt::oneshot(router.clone(), dev_login_req(&email))
        .await
        .unwrap();
    let cookie_header = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let session_pair = cookie_header
        .split(';')
        .next()
        .unwrap()
        .trim()
        .to_string();

    let me_req = Request::builder()
        .method("GET")
        .uri("/api/auth/me")
        .header("Cookie", &session_pair)
        .body(Body::empty())
        .unwrap();
    let (status, body) = call(&router, me_req).await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["user"]["id"], user.id.to_string());
    assert_eq!(json["user"]["role"], "ADMIN");
}
