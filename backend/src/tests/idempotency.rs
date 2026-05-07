use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// Minimal body for an IN_PROGRESS maintenance work.
fn work_body(shift_id: Uuid, device_id: Uuid) -> serde_json::Value {
    json!({
        "shift_id": shift_id,
        "device_id": device_id,
        "status": "IN_PROGRESS",
        "started_at": "2026-01-01T00:00:00Z"
    })
}

// D1: Missing X-Mutation-Id header returns 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d1_missing_mutation_id_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();

    let router = build_router(pool);

    // No X-Mutation-Id header
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            None,
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "missing X-Mutation-Id header");
}

// D2: Whitespace-only X-Mutation-Id returns 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d2_whitespace_mutation_id_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();

    let router = build_router(pool);

    let (status, body) = call(
        &router,
        make_req_raw_mid(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            "   ",
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "missing X-Mutation-Id header");
}

// D3: X-Mutation-Id longer than 128 characters returns 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d3_too_long_mutation_id_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();

    let router = build_router(pool);

    let long_id = "x".repeat(129);
    let (status, body) = call(
        &router,
        make_req_raw_mid(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            &long_id,
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "X-Mutation-Id is too long");
}

// D4: Replaying the same X-Mutation-Id returns a byte-for-byte identical response.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d4_replay_returns_identical_response(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();
    let mid = Uuid::new_v4().to_string();

    let router = build_router(pool);

    let (status1, body1) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;
    assert_eq!(status1, StatusCode::OK);

    let (status2, body2) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert_eq!(status2, status1, "replay status must match");
    assert_eq!(body2, body1, "replay body must be byte-for-byte identical");
}

// D5: Replay does not re-execute the handler — DB state is unchanged by the second call.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d5_replay_does_not_rerun_side_effects(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();
    let mid = Uuid::new_v4().to_string();

    let router = build_router(pool.clone());

    // First call — no note
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Second call — same mutation_id, different note that would update the row if handler ran
    let body_with_note = {
        let mut b = work_body(shift.id, device.id);
        b["note"] = json!("should not appear");
        b
    };
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(body_with_note),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // DB note must still be null — the second call was served from cache
    let note: Option<String> =
        sqlx::query_scalar("SELECT note FROM maintenance_works WHERE id = $1")
            .bind(work_id)
            .fetch_optional(&pool)
            .await
            .unwrap()
            .flatten();
    assert!(note.is_none(), "note should not have been written by the replayed request");
}

// D6: Same X-Mutation-Id used against two *different* endpoints — both succeed independently.
// Idempotency keys are scoped per (tenant, endpoint_key), not globally per mutation_id.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d6_same_mutation_id_different_endpoints_both_succeed(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();

    let router = build_router(pool);

    let shared_mid = Uuid::new_v4().to_string();

    // First endpoint: assign a barcode
    let (status_barcode, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device.id),
            &user.session_token,
            Some(&shared_mid),
            Some(json!({ "code": "D6TESTCODE001" })),
        ),
    )
    .await;

    // Second endpoint: sync a maintenance work — same mutation_id, different endpoint_key
    let (status_work, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&shared_mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert!(
        status_barcode.is_success(),
        "barcode assign should succeed, got {status_barcode}"
    );
    assert!(
        status_work.is_success(),
        "maintenance sync with same mutation_id should succeed, got {status_work}"
    );
}

// D7: Replay after the underlying entity has changed still returns the cached original response.
// Idempotency beats freshness — the contract is a stable response, not a live query.
#[sqlx::test(migrator = "MIGRATOR")]
async fn d7_replay_returns_cached_response_after_entity_changed(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let work_id = Uuid::new_v4();
    let mid = Uuid::new_v4().to_string();

    let router = build_router(pool.clone());

    // First call — creates the work as IN_PROGRESS
    let (status1, body1) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;
    assert_eq!(status1, StatusCode::OK);
    let original: serde_json::Value = serde_json::from_slice(&body1).unwrap();
    assert_eq!(original["status"], "IN_PROGRESS");

    // Externally update the row to ABORTED (bypassing the handler)
    sqlx::query(
        "UPDATE maintenance_works SET status = 'ABORTED', aborted_at = NOW() WHERE id = $1",
    )
    .bind(work_id)
    .execute(&pool)
    .await
    .unwrap();

    // Replay — must return the original cached response, not the current DB state
    let (status2, body2) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(work_body(shift.id, device.id)),
        ),
    )
    .await;

    assert_eq!(status2, StatusCode::OK);
    let replayed: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(
        replayed["status"], "IN_PROGRESS",
        "cached response should reflect original IN_PROGRESS, not the externally set ABORTED"
    );
}
