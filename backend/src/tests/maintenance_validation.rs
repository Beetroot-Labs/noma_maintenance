// F1 — POST /maintenance/works/{work_id}/sync — request validation rules.
// Each rule produces a 400 with a specific error message. Validation runs *before* the
// shift/device authorisation checks, so the test seed can stay minimal: a valid session, a
// fresh mutation_id, and a body that violates exactly one rule.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn base_body() -> Value {
    json!({
        "shift_id": Uuid::new_v4(),
        "device_id": Uuid::new_v4(),
        "status": "IN_PROGRESS",
        "started_at": "2026-01-01T00:00:00Z"
    })
}

async fn post_sync(
    pool: &PgPool,
    user: &SeededUser,
    body: Value,
) -> (StatusCode, axum::body::Bytes) {
    let router = build_router(pool.clone());
    let mid = Uuid::new_v4().to_string();
    call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{}/sync", Uuid::new_v4()),
            &user.session_token,
            Some(&mid),
            Some(body),
        ),
    )
    .await
}

fn assert_400_with(body: &axum::body::Bytes, expected_message: &str) {
    let json: Value = serde_json::from_slice(body).unwrap();
    assert_eq!(
        json["error"], expected_message,
        "got error message: {}",
        json["error"]
    );
}

// F1.1 — invalid status string → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_1_invalid_status_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["status"] = json!("FOO_BAR");
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "invalid maintenance work status");
}

// F1.2 — invalid kind → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_2_invalid_kind_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["kind"] = json!("MIDNIGHT");
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "invalid maintenance kind");
}

// F1.3 — unknown follow-up reason → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_3_unknown_followup_reason_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["followup_service_required"] = json!(true);
    body["followup_service_reasons"] = json!(["GREMLINS"]);
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "invalid follow-up service reason");
}

// F1.4 — follow-up required but reasons array empty → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_4_followup_required_with_empty_reasons_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["followup_service_required"] = json!(true);
    body["followup_service_reasons"] = json!([]);
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "at least one follow-up service reason is required");
}

// F1.5 — follow-up not required but reasons present → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_5_followup_not_required_with_reasons_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["followup_service_required"] = json!(false);
    body["followup_service_reasons"] = json!(["CLEANING"]);
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "follow-up reasons require follow-up service to be enabled");
}

// F1.6 — OTHER reason without other-text → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_6_other_reason_without_text_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["followup_service_required"] = json!(true);
    body["followup_service_reasons"] = json!(["OTHER"]);
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "other follow-up service reason text is required");
}

// F1.7 — other-text present without OTHER in reasons → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_7_other_text_without_other_reason_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["followup_service_required"] = json!(true);
    body["followup_service_reasons"] = json!(["CLEANING"]);
    body["followup_service_reason_other"] = json!("a stray note");
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(
        &body,
        "other follow-up service reason text is only allowed with OTHER",
    );
}

// F1.8 — kind=SERVICE without an issue number → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_8_service_kind_without_issue_number_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["kind"] = json!("SERVICE");
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "issue number is required for service maintenance");
}

// F1.9 — kind=SERVICE with whitespace-only issue_number → 400 (whitespace is normalised to
// None, so this lands on the same "issue number required" branch as F1.8).
#[sqlx::test(migrator = "MIGRATOR")]
async fn f1_9_service_kind_with_whitespace_issue_number_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let mut body = base_body();
    body["kind"] = json!("SERVICE");
    body["issue_number"] = json!("   ");
    let (status, body) = post_sync(&pool, &user, body).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_400_with(&body, "issue number is required for service maintenance");
}
