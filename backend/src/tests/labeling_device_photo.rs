// G5 — /labeling/devices/{id}/photo (PUT/DELETE/GET)
//
// Coverage here is intentionally partial. The success paths (G5.1 round-trip, G5.2 DELETE
// then GET) call `cloud_storage::Object::create`/`Object::delete`/`Object::download` directly
// against GCS, so they would either fail in CI or hit real network. A proper Storage trait
// abstraction is the right fix; until that lands we cover only the branches that return
// *before* those calls:
//   * PUT 503 when state.storage is None
//   * PUT 400 for body / content-type validation
//   * DELETE 204 when there is no photo (the handler short-circuits before Object::delete)

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn put_photo_req(
    device_id: Uuid,
    token: &str,
    mid: &str,
    content_type: &str,
    body: Bytes,
) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(format!("/api/labeling/devices/{device_id}/photo"))
        .header("Cookie", format!("noma_session={token}"))
        .header("X-Mutation-Id", mid)
        .header("Content-Type", content_type)
        .body(Body::from(body))
        .unwrap()
}

// G5 503 — PUT with storage=None short-circuits with 503.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_storage_unavailable_put_returns_503(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::from_static(b"\xFF\xD8\xFF"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

// G5.4 — PUT with body > 15 MiB → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_4_too_large_body_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);
    let oversized = Bytes::from(vec![0u8; 15 * 1024 * 1024 + 1]);
    let (status, body) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            oversized,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "photo is too large");
}

// G5.5 — PUT with `application/json` → 400 from the image-content-type validator.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_5_non_image_content_type_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);
    let (status, body) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "application/json",
            Bytes::from_static(b"{}"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "unsupported photo content type");
}

// G5.3 — DELETE on a device that has no photo → 204 (handler returns before any GCS call).
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_3_delete_without_photo_returns_204(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .header("X-Mutation-Id", Uuid::new_v4().to_string())
        .body(Body::empty())
        .unwrap();
    let (status, _) = call(&router, req).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

// G5 empty body — PUT with empty body → 400 (the body-required branch, before any GCS call).
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_empty_body_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);
    let (status, body) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::new(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "photo body is required");
}
