// G3 — POST /labeling/devices/{id}/barcode

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

async fn count_active_for(pool: &PgPool, device_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM barcodes WHERE device_id = $1 AND deactivated_at IS NULL",
    )
    .bind(device_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn count_total_for(pool: &PgPool, device_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*)::bigint FROM barcodes WHERE device_id = $1")
        .bind(device_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

// G3.1 — first barcode for a device → inserted as the active one.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g3_1_first_barcode_inserted(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(json!({ "code": "G3-1-CODE" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(count_active_for(&pool, device.id).await, 1);
}

// G3.2 — replace existing barcode → previous active one is deactivated, new one is active.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g3_2_replace_deactivates_previous(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, device.id, "G3-2-OLD").await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(json!({ "code": "G3-2-NEW" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(count_active_for(&pool, device.id).await, 1);

    let active_code: Option<String> = sqlx::query_scalar(
        "SELECT code FROM barcodes WHERE device_id = $1 AND deactivated_at IS NULL",
    )
    .bind(device.id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(active_code.as_deref(), Some("G3-2-NEW"));

    let deactivated: bool = sqlx::query_scalar(
        "SELECT deactivated_at IS NOT NULL FROM barcodes WHERE code = $1 AND device_id = $2",
    )
    .bind("G3-2-OLD")
    .bind(device.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(deactivated, "old code must have a deactivated_at after replacement");
}

// G3.3 — same code re-assigned to the same device → no-op (no extra row, still one active).
#[sqlx::test(migrator = "MIGRATOR")]
async fn g3_3_same_code_same_device_is_noop(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, device.id, "G3-3-CODE").await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(json!({ "code": "G3-3-CODE" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        count_total_for(&pool, device.id).await,
        1,
        "re-assigning the same code must not create a new row"
    );
    assert_eq!(count_active_for(&pool, device.id).await, 1);
}

// G3.4 — code already assigned to another device → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g3_4_code_on_another_device_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device_a = seed_device(&pool, tenant.id, building.id).await;
    let device_b = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, device_a.id, "G3-4-CODE").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device_b.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(json!({ "code": "G3-4-CODE" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "barcode has already been used and cannot be reassigned"
    );
}

// G3.5 — empty / whitespace code → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g3_5_empty_code_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(json!({ "code": "   " })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "barcode is required");
}
