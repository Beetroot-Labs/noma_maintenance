// E1 — POST /api/shifts (lead creates a shift).
// Contract: lead-or-admin only, building must exist in caller's tenant. On success the shift is
// inserted as IN_PROGRESS and the caller is added as a CACHE_READY participant.

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::Duration;
use serde_json::json;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use super::helpers::*;
use crate::state::{AppState, AuthConfig, ShiftEventHub};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// E1.1 — Happy path: shift is IN_PROGRESS and lead is inserted as CACHE_READY participant.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e1_1_creates_in_progress_shift_with_lead_as_cache_ready(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let router = build_router(pool.clone());

    let (status, body) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &lead.session_token,
            None,
            Some(json!({ "building_id": building.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let shift_id: Uuid = resp["shift_id"].as_str().unwrap().parse().unwrap();

    let row: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT status::text, started_at FROM shifts WHERE id = $1",
    )
    .bind(shift_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "IN_PROGRESS");
    assert!(row.1.is_some(), "started_at must be populated");

    let participant: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT status::text, cache_ready_at FROM shift_participants \
         WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift_id)
    .bind(lead.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(participant.0, "CACHE_READY");
    assert!(participant.1.is_some(), "cache_ready_at must be set on lead participant");
}

// E1.2 — Building belongs to another tenant: 403, no shift inserted.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e1_2_cross_tenant_building_returns_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &lead_a.session_token,
            None,
            Some(json!({ "building_id": building_b.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shifts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "no shift should be created on cross-tenant attempt");
}

// E1.3 — Technician role is blocked by require_lead_or_admin (covered in C1, here we assert
// no shift was inserted to make the contract specific to E1).
#[sqlx::test(migrator = "MIGRATOR")]
async fn e1_3_technician_role_returns_403_and_writes_nothing(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let technician = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &technician.session_token,
            None,
            Some(json!({ "building_id": building.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shifts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

// E1.4 — Building UUID is well-formed but doesn't exist anywhere → 403 (not 404; the contract
// is "not found for current tenant", which is indistinguishable from cross-tenant).
#[sqlx::test(migrator = "MIGRATOR")]
async fn e1_4_unknown_building_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;

    let router = build_router(pool);

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &lead.session_token,
            None,
            Some(json!({ "building_id": Uuid::new_v4() })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// E1.5 — When the AppState has no DB pool, every shift endpoint short-circuits to 503.
// Authentication runs against the DB, so without a pool we expect 503 *before* any 401 check.
#[tokio::test]
async fn e1_5_no_db_pool_returns_503() {
    let state = AppState {
        client: reqwest::Client::new(),
        db_pool: None,
        storage: None,
        auth: Some(AuthConfig {
            google_client_ids: vec!["test-client-id".to_string()],
            google_hosted_domain: None,
            session_cookie_name: "noma_session".to_string(),
            session_duration: Duration::days(30),
            cookie_secure: false,
            dev_login_enabled: false,
        }),
        shift_events: ShiftEventHub::default(),
    };
    let router = Router::new().nest("/api", crate::build_api_router(state));

    let req = Request::builder()
        .method("POST")
        .uri("/api/shifts")
        .header("Cookie", "noma_session=anything")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "building_id": Uuid::new_v4() }).to_string()))
        .unwrap();
    let response = router.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
