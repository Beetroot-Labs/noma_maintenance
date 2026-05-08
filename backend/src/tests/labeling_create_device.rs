// G2 — POST /labeling/devices

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn happy_body(building_id: Uuid, location_id: Uuid) -> Value {
    json!({
        "buildingId": building_id,
        "existingLocationId": location_id,
        "kind": "FAN_COIL",
        "brand": "BrandCo",
        "model": "M-1",
        "serialNumber": "SN-1",
    })
}

// G2.1 — happy path with `existingLocationId` → 201; both IDs returned.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_1_happy_path_existing_location_returns_201(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            "/labeling/devices",
            &user.session_token,
            None,
            Some(happy_body(building.id, location.id)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert!(!json["device_id"].as_str().unwrap().is_empty());
    assert_eq!(json["location_id"], location.id.to_string());
}

// G2.2 — happy path with new `location` payload → 201; new location row inserted.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_2_new_location_inserts_row(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let body = json!({
        "buildingId": building.id,
        "location": { "floor": "3", "wing": "C", "room": "302" },
        "kind": "FAN_COIL",
    });

    let router = build_router(pool.clone());
    let (status, response_body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let json: Value = serde_json::from_slice(&response_body).unwrap();
    let location_id_str = json["location_id"].as_str().unwrap();
    let location_id: Uuid = location_id_str.parse().unwrap();

    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT floor, wing, room FROM site_locations WHERE id = $1",
    )
    .bind(location_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0.as_deref(), Some("3"));
    assert_eq!(row.1.as_deref(), Some("C"));
    assert_eq!(row.2.as_deref(), Some("302"));
}

// G2.3 — both `existingLocationId` and `location` → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_3_both_location_modes_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let body = json!({
        "buildingId": building.id,
        "existingLocationId": location.id,
        "location": { "floor": "1" },
        "kind": "FAN_COIL",
    });

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "choose either an existing location or a new location payload"
    );
}

// G2.4 — neither location mode supplied → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_4_no_location_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let body = json!({ "buildingId": building.id, "kind": "FAN_COIL" });

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "location is required");
}

// G2.5 — empty `location` object → 400 with the location-details message.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_5_empty_location_object_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let body = json!({
        "buildingId": building.id,
        "location": { "floor": "  ", "wing": null, "room": "", "locationDescription": "" },
        "kind": "FAN_COIL",
    });

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "location details are required");
}

// G2.6 — existing location belongs to another building → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_6_existing_location_in_another_building_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building_a = seed_building(&pool, tenant.id).await;
    let building_b = seed_building(&pool, tenant.id).await;
    let location_b = seed_location(&pool, tenant.id, building_b.id).await;

    let body = json!({
        "buildingId": building_a.id,
        "existingLocationId": location_b.id,
        "kind": "FAN_COIL",
    });

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "selected location does not belong to the selected building"
    );
}

// G2.7 — empty `kind` → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_7_empty_kind_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["kind"] = json!("   ");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "device kind is required");
}

// G2.8 — invalid `kind` (not in enum) → 400 from the device_kind enum mapper.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_8_unknown_kind_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["kind"] = json!("MIDNIGHT_KIND");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "invalid device kind");
}

// G2.9 — duplicate `sourceDeviceCode` for the tenant → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_9_duplicate_source_device_code_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let existing_device = seed_device(&pool, tenant.id, building.id).await;
    sqlx::query("UPDATE devices SET source_device_code = 'DUP-CODE' WHERE id = $1")
        .bind(existing_device.id)
        .execute(&pool)
        .await
        .unwrap();
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["sourceDeviceCode"] = json!("DUP-CODE");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "source device code is already used by another device"
    );
}

// G2.10 — optional `barcode` already in active use by another device → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_10_barcode_already_used_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let existing = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_active(&pool, tenant.id, existing.id, "BARCODE-IN-USE").await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["barcode"] = json!("BARCODE-IN-USE");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "barcode has already been used and cannot be reassigned"
    );
}

// G2.11 — optional `barcode` not previously used → row created on the new device.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_11_fresh_barcode_creates_row(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["barcode"] = json!("FRESH-BARCODE");

    let router = build_router(pool.clone());
    let (status, response_body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let json: Value = serde_json::from_slice(&response_body).unwrap();
    let device_id: Uuid = json["device_id"].as_str().unwrap().parse().unwrap();

    let active_code: Option<String> = sqlx::query_scalar(
        "SELECT code FROM barcodes WHERE device_id = $1 AND deactivated_at IS NULL",
    )
    .bind(device_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(active_code.as_deref(), Some("FRESH-BARCODE"));
}

// G2.12 — the plan's "previously deactivated for *this* device → reactivated" cannot
// happen at device-creation time, since the device row is brand new — no barcode could
// already point at it. The handler treats *any* existing barcode row (active or
// deactivated) on another device as a conflict (labeling.rs:538). This test documents the
// actual behavior: a deactivated barcode on a different device → 409.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g2_12_deactivated_barcode_on_other_device_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let prior = seed_device(&pool, tenant.id, building.id).await;
    seed_barcode_deactivated(&pool, tenant.id, prior.id, "DEACT-ELSEWHERE").await;
    let location = seed_location(&pool, tenant.id, building.id).await;

    let mut body = happy_body(building.id, location.id);
    body["barcode"] = json!("DEACT-ELSEWHERE");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("POST", "/labeling/devices", &user.session_token, None, Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "barcode has already been used and cannot be reassigned"
    );
}
