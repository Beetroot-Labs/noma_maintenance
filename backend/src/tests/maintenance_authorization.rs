// F2 — POST /maintenance/works/{id}/sync — authorisation and shift-state matrix.
// The handler requires the caller to be a participant of the target shift, and the shift
// itself must be in IN_PROGRESS, CLOSE_REQUESTED, or READY_TO_COMMIT. Cross-tenant device
// references are rejected at the device-existence check.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn body(shift_id: Uuid, device_id: Uuid) -> Value {
    json!({
        "shift_id": shift_id,
        "device_id": device_id,
        "status": "IN_PROGRESS",
        "started_at": "2026-01-01T00:00:00Z"
    })
}

async fn post_sync(
    pool: &PgPool,
    user: &SeededUser,
    work_id: Uuid,
    body: Value,
) -> StatusCode {
    let router = build_router(pool.clone());
    let mid = Uuid::new_v4().to_string();
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(body),
        ),
    )
    .await;
    status
}

// F2.1 — Caller is a tenant user but not a participant of this shift → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_1_non_participant_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let outsider = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let status = post_sync(&pool, &outsider, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// F2.2 — Shift in INVITING → 403 ("only allowed while shift is active").
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_2_inviting_shift_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// F2.3 — IN_PROGRESS shift → allowed (200 from sync handler).
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_3_in_progress_shift_is_allowed(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::OK);
}

// F2.4 — CLOSE_REQUESTED shift → allowed.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_4_close_requested_shift_is_allowed(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "CLOSE_REQUESTED").await;

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::OK);
}

// F2.5 — READY_TO_COMMIT shift → allowed.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_5_ready_to_commit_shift_is_allowed(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "READY_TO_COMMIT").await;

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::OK);
}

// F2.6 — COMMITTED shift → 403. The handler check ("only while active") fires before any
// trigger has a chance to.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_6_committed_shift_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "COMMITTED").await;

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// F2.7 — CANCELLED shift → 403 (handler check). Set up by transitioning IN_PROGRESS →
// CANCELLED, since seed_shift_in_state cannot insert participants once a shift is CANCELLED.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_7_cancelled_shift_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    sqlx::query("UPDATE shifts SET status = 'CANCELLED' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let status = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// F2.8 — Device from another tenant → 403 ("device not found for current tenant").
#[sqlx::test(migrator = "MIGRATOR")]
async fn f2_8_cross_tenant_device_returns_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let building_a = seed_building(&pool, ta.id).await;
    let building_b = seed_building(&pool, tb.id).await;
    let shift_a = seed_shift(&pool, ta.id, building_a.id, lead_a.id).await;
    let device_b = seed_device(&pool, tb.id, building_b.id).await;

    let status = post_sync(&pool, &lead_a, Uuid::new_v4(), body(shift_a.id, device_b.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
