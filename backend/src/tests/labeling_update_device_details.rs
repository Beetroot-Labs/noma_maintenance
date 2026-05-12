// G7 — PATCH /labeling/devices/{id}/details

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn details_body() -> Value {
    json!({
        "floor": "5",
        "wing": "B",
        "room": "501",
        "kind": "FAN_COIL",
        "brand": "BrandCo",
        "model": "Model-X",
        "serialNumber": "SN-1",
        "additionalInfo": "near the window",
        "isMaintainable": true
    })
}

// G7.1 — updates device fields and the linked location's floor/wing/room/description.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g7_1_updates_device_and_location(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "PATCH",
            &format!("/labeling/devices/{}/details", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(details_body()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT brand, model, serial_number FROM devices WHERE id = $1",
    )
    .bind(device.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0.as_deref(), Some("BrandCo"));
    assert_eq!(row.1.as_deref(), Some("Model-X"));
    assert_eq!(row.2.as_deref(), Some("SN-1"));

    let loc: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT floor, wing, room FROM site_locations WHERE id = $1",
    )
    .bind(device.location_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(loc.0.as_deref(), Some("5"));
    assert_eq!(loc.1.as_deref(), Some("B"));
    assert_eq!(loc.2.as_deref(), Some("501"));
}

// G7.2 — empty kind → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g7_2_empty_kind_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let mut body = details_body();
    body["kind"] = json!("   ");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "PATCH",
            &format!("/labeling/devices/{}/details", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(body),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "device kind is required");
}

// G7.3 — duplicate sourceDeviceCode within the tenant → 409 with the dedicated error message.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g7_3_duplicate_source_device_code_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device_a = seed_device(&pool, tenant.id, building.id).await;
    let device_b = seed_device(&pool, tenant.id, building.id).await;

    sqlx::query("UPDATE devices SET source_device_code = 'CODE-1' WHERE id = $1")
        .bind(device_a.id)
        .execute(&pool)
        .await
        .unwrap();

    let mut body = details_body();
    body["sourceDeviceCode"] = json!("CODE-1");

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "PATCH",
            &format!("/labeling/devices/{}/details", device_b.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(body),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        json["error"],
        "source device code is already used by another device"
    );
}

// G7.4 — `isMaintainable` omitted → existing value preserved (the SQL is `COALESCE($9, is_maintainable)`).
#[sqlx::test(migrator = "MIGRATOR")]
async fn g7_4_is_maintainable_omitted_preserves_existing(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    sqlx::query("UPDATE devices SET is_maintainable = FALSE WHERE id = $1")
        .bind(device.id)
        .execute(&pool)
        .await
        .unwrap();

    let mut body = details_body();
    body.as_object_mut().unwrap().remove("isMaintainable");

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "PATCH",
            &format!("/labeling/devices/{}/details", device.id),
            &user.session_token,
            Some(&Uuid::new_v4().to_string()),
            Some(body),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let is_maintainable: bool =
        sqlx::query_scalar("SELECT is_maintainable FROM devices WHERE id = $1")
            .bind(device.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!is_maintainable, "omitted isMaintainable must preserve the existing FALSE");
}
