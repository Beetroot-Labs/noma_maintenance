// F3 — POST /maintenance/works/{id}/sync — persistence and invariants.
// Asserts that:
//   * the upsert flow inserts on first call and updates on second by the same maintainer
//   * different maintainers cannot reuse the same work_id (the partial WHERE in the upsert
//     blocks it as a 403)
//   * the partial unique indexes "one active per user" and "one active per device" surface
//     as 409s through the handler
//   * a FINISHED status frees the slot for the next IN_PROGRESS
//   * the FINISHED-without-finished_at CHECK violation reaches the client as a 500 (the
//     handler does not currently translate it)

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
) -> (StatusCode, axum::body::Bytes) {
    let router = build_router(pool.clone());
    let mid = Uuid::new_v4().to_string();
    call(
        &router,
        make_req(
            "POST",
            &format!("/maintenance/works/{work_id}/sync"),
            &user.session_token,
            Some(&mid),
            Some(body),
        ),
    )
    .await
}

// F3.1 — First call inserts a row with all fields populated.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_1_first_call_inserts_row(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_id = Uuid::new_v4();

    let mut payload = body(shift.id, device.id);
    payload["note"] = json!("first run");
    let (status, _) = post_sync(&pool, &lead, work_id, payload).await;
    assert_eq!(status, StatusCode::OK);

    let row: (String, Option<String>, Uuid) = sqlx::query_as(
        "SELECT status::text, note, maintainer_user_id FROM maintenance_works WHERE id = $1",
    )
    .bind(work_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "IN_PROGRESS");
    assert_eq!(row.1.as_deref(), Some("first run"));
    assert_eq!(row.2, lead.id);
}

// F3.2 — Same maintainer reusing the same work_id updates fields (e.g., status, note).
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_2_same_maintainer_same_work_id_updates_fields(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_id = Uuid::new_v4();

    let mut payload = body(shift.id, device.id);
    payload["note"] = json!("first");
    let (status, _) = post_sync(&pool, &lead, work_id, payload).await;
    assert_eq!(status, StatusCode::OK);

    let mut payload = body(shift.id, device.id);
    payload["status"] = json!("FINISHED");
    payload["finished_at"] = json!("2026-01-01T01:00:00Z");
    payload["note"] = json!("after finish");
    let (status, _) = post_sync(&pool, &lead, work_id, payload).await;
    assert_eq!(status, StatusCode::OK);

    let row: (String, Option<String>) = sqlx::query_as(
        "SELECT status::text, note FROM maintenance_works WHERE id = $1",
    )
    .bind(work_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "FINISHED");
    assert_eq!(row.1.as_deref(), Some("after finish"));
}

// F3.3 — A different maintainer reusing an existing work_id → 403, no field is overwritten.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_3_different_maintainer_same_work_id_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, other.id, "CACHE_READY").await;
    let work_id = Uuid::new_v4();

    let mut payload = body(shift.id, device.id);
    payload["note"] = json!("lead's note");
    let (status, _) = post_sync(&pool, &lead, work_id, payload).await;
    assert_eq!(status, StatusCode::OK);

    let mut hijack = body(shift.id, device.id);
    hijack["note"] = json!("intruder");
    let (status, body) = post_sync(&pool, &other, work_id, hijack).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "maintenance work belongs to another tenant or maintainer"
    );

    let stored: (Uuid, Option<String>) = sqlx::query_as(
        "SELECT maintainer_user_id, note FROM maintenance_works WHERE id = $1",
    )
    .bind(work_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.0, lead.id);
    assert_eq!(stored.1.as_deref(), Some("lead's note"));
}

// F3.4 — A second IN_PROGRESS work for the same maintainer (different work_id) → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_4_two_in_progress_for_same_user_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device_a = seed_device(&pool, tenant.id, building.id).await;
    let device_b = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let (status, _) = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device_a.id)).await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) =
        post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device_b.id)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "maintenance work conflicts with another active maintenance"
    );
}

// F3.5 — A second IN_PROGRESS work on the same device by a different maintainer → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_5_two_in_progress_for_same_device_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, other.id, "CACHE_READY").await;

    let (status, _) = post_sync(&pool, &lead, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = post_sync(&pool, &other, Uuid::new_v4(), body(shift.id, device.id)).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

// F3.6 — status=FINISHED without finished_at → CHECK constraint fires; surfaces as 500. The
// handler does not currently map this branch (it only translates the unique-index conflicts).
// This test documents that behaviour so changing it is an explicit decision.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_6_finished_without_finished_at_returns_500(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let mut payload = body(shift.id, device.id);
    payload["status"] = json!("FINISHED");
    // finished_at intentionally omitted
    let (status, _) = post_sync(&pool, &lead, Uuid::new_v4(), payload).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

// F3.7 — FINISHED clears the per-user partial index slot, so a fresh IN_PROGRESS works.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f3_7_finishing_first_work_unlocks_next_in_progress(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device_a = seed_device(&pool, tenant.id, building.id).await;
    let device_b = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_a = Uuid::new_v4();
    let work_b = Uuid::new_v4();

    let (status, _) = post_sync(&pool, &lead, work_a, body(shift.id, device_a.id)).await;
    assert_eq!(status, StatusCode::OK);

    let mut finish = body(shift.id, device_a.id);
    finish["status"] = json!("FINISHED");
    finish["finished_at"] = json!("2026-01-01T01:00:00Z");
    let (status, _) = post_sync(&pool, &lead, work_a, finish).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = post_sync(&pool, &lead, work_b, body(shift.id, device_b.id)).await;
    assert_eq!(status, StatusCode::OK, "next IN_PROGRESS must be allowed once first is finished");
}
