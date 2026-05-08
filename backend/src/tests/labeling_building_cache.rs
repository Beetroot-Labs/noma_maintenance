// G1 — GET /labeling/buildings/{id}/cache
// Asserts the building/locations/devices shape, that barcode_history is attached even for
// devices with no active barcode, that device_photo_url is rewritten to an `/api/...` path
// when one is stored, and that cross-tenant calls return 403.

use axum::http::StatusCode;
use serde_json::Value;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// G1.1 — building in tenant returns the {building, locations, devices} shape with full
// barcode_history attached to each device.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g1_1_returns_building_locations_devices(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, device.id, "G1-CODE-A").await;
    seed_barcode_deactivated(&pool, tenant.id, device.id, "G1-CODE-OLD").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/labeling/buildings/{}/cache", building.id),
            &user.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["building"]["id"], building.id.to_string());
    assert!(json["locations"].is_array());
    assert!(json["devices"].is_array());

    let devices = json["devices"].as_array().unwrap();
    assert_eq!(devices.len(), 1);
    let dev = &devices[0];
    assert_eq!(dev["id"], device.id.to_string());
    assert_eq!(dev["code"], "G1-CODE-A");

    let history = dev["barcode_history"].as_array().unwrap();
    assert_eq!(history.len(), 2, "active + deactivated must both appear in history");
    let codes: Vec<&str> = history
        .iter()
        .map(|entry| entry["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"G1-CODE-A"));
    assert!(codes.contains(&"G1-CODE-OLD"));
}

// G1.2 — device with no active barcode → code is null but history still present.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g1_2_device_with_no_active_barcode_has_null_code(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_deactivated(&pool, tenant.id, device.id, "G1-2-OLD").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/labeling/buildings/{}/cache", building.id),
            &user.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();

    let dev = &json["devices"][0];
    assert_eq!(dev["id"], device.id.to_string());
    assert!(dev["code"].is_null(), "no active barcode → code should be null");
    let history = dev["barcode_history"].as_array().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["code"], "G1-2-OLD");
    assert!(!history[0]["deactivated_at"].is_null());
}

// G1.3 — device with photo → derived `device_photo_url` is the `/api/labeling/devices/{id}/photo`
// path, regardless of where the actual GCS object lives.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g1_3_device_with_photo_returns_api_path(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    sqlx::query("UPDATE devices SET device_photo_url = 'gs://anywhere/photo' WHERE id = $1")
        .bind(device.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/labeling/buildings/{}/cache", building.id),
            &user.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    let url = json["devices"][0]["device_photo_url"].as_str().unwrap();
    assert_eq!(url, format!("/api/labeling/devices/{}/photo", device.id));
}

// G1.4 — building in another tenant → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g1_4_other_tenant_building_returns_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/labeling/buildings/{}/cache", building_b.id),
            &user_a.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "building not found for current tenant");
}
