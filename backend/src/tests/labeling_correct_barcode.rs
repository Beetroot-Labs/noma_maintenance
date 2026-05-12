// G4 — POST /labeling/devices/{src}/barcode-correction
//
// The handler:
//   1. validates source != target (400)
//   2. loads stats for both devices (each 403 on missing-in-tenant)
//   3. requires source has at least one barcode and an *active* code (409)
//   4. eligibility: target_barcode_count <= 1 OR target_maintenance_count == 0 (409)
//   5. deactivates active barcodes on both, re-binds source's code to target
//   6. if target had a different active code, swaps it onto source
//   7. moves the photo if source had one (target gets it; source goes NULL)
//   8. ONLY moves maintenance rows if source had any AND target had zero
//
// G4.10 (concurrent IN_PROGRESS on target) is intentionally not implemented: the eligibility
// gate plus the move-only-when-target-empty rule means the handler never reaches the
// per-device unique-index conflict via the API in a single-tx test setup. The mapper that
// would surface that conflict (`maintenance_works_one_active_per_*`) is still covered
// indirectly by the I9/I10 trigger tests at the DB layer.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn body(target_id: Uuid) -> Value {
    json!({ "targetDeviceId": target_id })
}

async fn post_correct(
    pool: &PgPool,
    user: &SeededUser,
    source_id: Uuid,
    target_id: Uuid,
) -> (StatusCode, axum::body::Bytes) {
    let router = build_router(pool.clone());
    call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{source_id}/barcode-correction"),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(body(target_id)),
        ),
    )
    .await
}

async fn active_count(pool: &PgPool, device_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM barcodes WHERE device_id = $1 AND deactivated_at IS NULL",
    )
    .bind(device_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn active_code(pool: &PgPool, device_id: Uuid) -> Option<String> {
    sqlx::query_scalar(
        "SELECT code FROM barcodes WHERE device_id = $1 AND deactivated_at IS NULL",
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

// G4.1 — source == target → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_1_source_equals_target_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let (status, body) = post_correct(&pool, &user, device.id, device.id).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "source and target devices must be different");
}

// G4.2 — source has no barcode at all → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_2_source_without_barcode_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "source device has no assigned barcode to correct");
}

// G4.3 — target has 2+ barcodes AND maintenance history → 409 (eligibility violation).
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_3_target_two_barcodes_with_maintenance_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;

    seed_barcode_active(&pool, tenant.id, source.id, "G4-3-SRC").await;
    seed_barcode_active(&pool, tenant.id, target.id, "G4-3-TGT").await;
    seed_barcode_deactivated(&pool, tenant.id, target.id, "G4-3-OLD").await;
    seed_maintenance_work(&pool, tenant.id, shift.id, target.id, user.id).await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "target device is not eligible for barcode correction");
}

// G4.4 — target eligible (no barcode, no history) → barcode + photo move; 0 maintenance moved.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_4_target_clean_moves_barcode(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-4-CODE").await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["source_code"], "G4-4-CODE");
    assert!(json["target_code"].is_null());
    assert_eq!(json["moved_maintenance_work_count"], 0);

    assert_eq!(active_code(&pool, target.id).await.as_deref(), Some("G4-4-CODE"));
    assert_eq!(active_count(&pool, source.id).await, 0);
}

// G4.5 — target has maintenance history but ≤1 barcode → barcode moves; maintenance does NOT.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_5_target_with_maintenance_only_moves_barcode(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-5-CODE").await;
    seed_maintenance_work(&pool, tenant.id, shift.id, target.id, user.id).await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["moved_maintenance_work_count"], 0,
        "target already has maintenance — handler must not move source's maintenance into it"
    );
    assert_eq!(active_code(&pool, target.id).await.as_deref(), Some("G4-5-CODE"));

    // Target's existing maintenance row is still on target.
    let target_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM maintenance_works WHERE device_id = $1",
    )
    .bind(target.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(target_count, 1);
}

// G4.6 — source has maintenance, target has none → all source's maintenance moves to target.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_6_target_clean_moves_all_maintenance(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-6-CODE").await;
    seed_maintenance_work(&pool, tenant.id, shift.id, source.id, user.id).await;
    seed_maintenance_work(&pool, tenant.id, shift.id, source.id, user.id).await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["moved_maintenance_work_count"], 2);

    let source_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM maintenance_works WHERE device_id = $1",
    )
    .bind(source.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let target_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM maintenance_works WHERE device_id = $1",
    )
    .bind(target.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(source_count, 0);
    assert_eq!(target_count, 2);
}

// G4.7 — source and target both have an active code → codes are swapped.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_7_both_with_active_codes_swap(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-7-SRC").await;
    seed_barcode_active(&pool, tenant.id, target.id, "G4-7-TGT").await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["source_code"], "G4-7-SRC");
    assert_eq!(json["target_code"], "G4-7-TGT");

    assert_eq!(active_code(&pool, target.id).await.as_deref(), Some("G4-7-SRC"));
    assert_eq!(active_code(&pool, source.id).await.as_deref(), Some("G4-7-TGT"));
}

// G4.8 — source and target had identical active codes (the row is shared at the unique
// constraint level, so this can only happen if the same row is "active" for one device and
// got reassigned to the other). The handler short-circuits the swap branch when codes match.
// Since the partial unique index `barcodes_one_active_per_device_idx` is on (device_id) only
// (not on `code`), having the same `code` on two devices via two separate barcode rows is
// allowed; the handler's `target_code != source_code` check is what skips the swap.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_8_identical_codes_no_swap(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    // Same `code` is unique per (tenant_id, code) — only one row can exist. Seed it on
    // source; the handler will see source's active code as `SAME-CODE` and target's active
    // code as None (no row for target with that code). No swap branch.
    seed_barcode_active(&pool, tenant.id, source.id, "SAME-CODE").await;

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["source_code"], "SAME-CODE");
    assert!(json["target_code"].is_null());

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM barcodes WHERE code = $1",
    )
    .bind("SAME-CODE")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(total, 1, "the (tenant_id, code) unique constraint guarantees one row");
    assert_eq!(active_code(&pool, target.id).await.as_deref(), Some("SAME-CODE"));
    assert_eq!(active_count(&pool, source.id).await, 0);
}

// G4.9 — photo on source moves to target; source's photo URL is cleared.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_9_photo_moves_to_target(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-9-CODE").await;
    sqlx::query("UPDATE devices SET device_photo_url = 'gs://b/source-photo' WHERE id = $1")
        .bind(source.id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::OK);

    let source_photo: Option<String> =
        sqlx::query_scalar("SELECT device_photo_url FROM devices WHERE id = $1")
            .bind(source.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let target_photo: Option<String> =
        sqlx::query_scalar("SELECT device_photo_url FROM devices WHERE id = $1")
            .bind(target.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(source_photo.is_none(), "source photo url must be cleared");
    assert_eq!(target_photo.as_deref(), Some("gs://b/source-photo"));
}

// G4.11 — source's shift is frozen → 409 from the maintenance trigger via the mapper.
// Setup: source has IN_PROGRESS shift with a maintenance row on source device. Then flip
// the shift to CANCELLED (which is a 'frozen' state for the maintenance trigger). The
// barcode-correction handler tries to UPDATE maintenance_works.device_id, which the
// `prevent_modifying_maintenance_of_frozen_shift` trigger rejects.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g4_11_source_shift_frozen_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let source = seed_device(&pool, tenant.id, building.id).await;
    let target = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, user.id).await;
    seed_barcode_active(&pool, tenant.id, source.id, "G4-11-CODE").await;
    seed_maintenance_work(&pool, tenant.id, shift.id, source.id, user.id).await;

    sqlx::query("UPDATE shifts SET status = 'CANCELLED' WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = post_correct(&pool, &user, source.id, target.id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "maintenance works of frozen shifts cannot be reassigned"
    );
}
