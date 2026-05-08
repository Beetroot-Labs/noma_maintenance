// G5 — /labeling/devices/{id}/photo (PUT/DELETE/GET)
//
// Success paths (G5.1 round-trip, G5.2 DELETE-then-GET) drive the storage seam via
// MemStorage. Pre-storage branches still covered: PUT 503 when storage is None, PUT 400
// for body/content-type validation, DELETE 204 when there is no photo.

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use sqlx::PgPool;
use tower::ServiceExt;
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

// G5.1 — PUT then GET round-trips the bytes and content type via the storage seam.
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_1_put_then_get_round_trips_bytes(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);
    let bytes = Bytes::from_static(b"\xFF\xD8\xFFimage-bytes");

    let (put_status, _) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/png",
            bytes.clone(),
        ),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);

    let get_req = Request::builder()
        .method("GET")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(get_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .expect("content-type header")
        .to_str()
        .unwrap()
        .to_string();
    let got = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(content_type, "image/png");
    assert_eq!(got, bytes);
}

// G5.2 — DELETE clears device_photo_url; subsequent GET returns 403 ("not found for tenant").
#[sqlx::test(migrator = "MIGRATOR")]
async fn g5_2_delete_then_get_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;

    let router = build_router_with_fake_storage(pool);

    let (put_status, _) = call(
        &router,
        put_photo_req(
            device.id,
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::from_static(b"\xFF\xD8\xFFbytes"),
        ),
    )
    .await;
    assert_eq!(put_status, StatusCode::OK);

    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .header("X-Mutation-Id", Uuid::new_v4().to_string())
        .body(Body::empty())
        .unwrap();
    let (del_status, _) = call(&router, del_req).await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let get_req = Request::builder()
        .method("GET")
        .uri(format!("/api/labeling/devices/{}/photo", device.id))
        .header("Cookie", format!("noma_session={}", user.session_token))
        .body(Body::empty())
        .unwrap();
    let (get_status, _) = call(&router, get_req).await;
    assert_eq!(get_status, StatusCode::FORBIDDEN);
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
