// E10 — PUT /shifts/{id}/signature-image
//
// Storage trait seam unblocks the success path (E10.1). Pre-storage branches still covered:
// 503 when storage is None.

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn put_signature_req(
    shift_id: Uuid,
    token: &str,
    content_type: &str,
    body: Bytes,
) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(format!("/api/shifts/{shift_id}/signature-image"))
        .header("Cookie", format!("noma_session={token}"))
        .header("Content-Type", content_type)
        .body(Body::from(body))
        .unwrap()
}

// E10.1 — Happy path: PNG body uploaded via the storage seam, response carries the canonical
// object name, MemStorage records exactly one put with image/png.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e10_1_upload_signature_happy_path(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift_in_state(
        &pool,
        tenant.id,
        building.id,
        lead.id,
        "READY_TO_COMMIT",
    )
    .await;

    let (router, mem) = build_router_with_mem_storage(pool);
    let bytes = Bytes::from_static(b"\x89PNG\r\n\x1a\nfake-png-bytes");

    let (status, body) = call(
        &router,
        put_signature_req(shift.id, &lead.session_token, "image/png", bytes.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let expected_object_name = format!(
        "shift-signatures/tenants/{}/shifts/{}/signature",
        tenant.id, shift.id
    );
    let resp: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(resp["signature_image_url"], expected_object_name);

    assert_eq!(mem.put_count(), 1);
    let stored = mem.get(&expected_object_name).expect("object stored");
    assert_eq!(stored.0, bytes.to_vec());
    assert_eq!(stored.1, "image/png");
}

// E10.4 — Storage not configured → 503 before any other check fires.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e10_4_storage_not_configured_returns_503(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        put_signature_req(
            Uuid::new_v4(),
            &lead.session_token,
            "image/png",
            Bytes::from_static(b"\x89PNG"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}
