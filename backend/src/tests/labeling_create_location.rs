// G6 — POST /labeling/buildings/{id}/locations

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// G6.1 — happy path → 201 with the new location id.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g6_1_happy_path_returns_201(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let router = build_router(pool.clone());
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/buildings/{}/locations", building.id),
            &user.session_token,
            None,
            Some(json!({ "floor": "2", "wing": "A", "room": "201" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let json: Value = serde_json::from_slice(&body).unwrap();
    let location_id_str = json["location_id"].as_str().unwrap();
    let location_id: Uuid = location_id_str.parse().unwrap();

    // Confirm the row exists in this building/tenant.
    let exists: Option<bool> = sqlx::query_scalar(
        "SELECT TRUE FROM site_locations WHERE id = $1 AND building_id = $2 AND tenant_id = $3",
    )
    .bind(location_id)
    .bind(building.id)
    .bind(tenant.id)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(exists, Some(true));
}

// G6.2 — every location field is empty/whitespace → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g6_2_all_empty_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/buildings/{}/locations", building.id),
            &user.session_token,
            None,
            Some(json!({ "floor": "  ", "wing": "", "room": null, "locationDescription": "" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "location details are required");
}

// G6.3 — building from another tenant → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g6_3_other_tenant_building_returns_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/buildings/{}/locations", building_b.id),
            &user_a.session_token,
            None,
            Some(json!({ "floor": "1" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
