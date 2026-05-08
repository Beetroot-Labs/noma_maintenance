// F4 — PUT /maintenance/works/{work_id}/photos/{photo_id}
//
// Success-path tests (F4.1, F4.7, F4.8) drive the storage seam via MemStorage so we can
// assert what was stored without hitting GCS. Pre-storage branches still covered: 503 when
// state.storage is None, 400 for body/content-type validation, 403 when the work isn't
// owned by the caller, 403 when the parent shift is frozen.

use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

fn put_photo_req(
    work_id: Uuid,
    photo_id: Uuid,
    token: &str,
    mid: &str,
    content_type: &str,
    body: Bytes,
) -> Request<Body> {
    Request::builder()
        .method("PUT")
        .uri(format!("/api/maintenance/works/{work_id}/photos/{photo_id}"))
        .header("Cookie", format!("noma_session={token}"))
        .header("X-Mutation-Id", mid)
        .header("Content-Type", content_type)
        .body(Body::from(body))
        .unwrap()
}

// F4 503 — storage not configured: every request short-circuits with 503 before any other
// check runs.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_storage_not_configured_returns_503(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    // build_router (no storage) → expects 503 before any session/body work runs.
    let router = build_router(pool);

    let (status, _) = call(
        &router,
        put_photo_req(
            Uuid::new_v4(),
            Uuid::new_v4(),
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::from_static(b"\xFF\xD8\xFF"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

// F4.2 — empty body → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_2_empty_body_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router_with_fake_storage(pool);

    let (status, body) = call(
        &router,
        put_photo_req(
            Uuid::new_v4(),
            Uuid::new_v4(),
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::new(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "photo body is required");
}

// F4.3 — body larger than 15 MiB → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_3_too_large_body_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router_with_fake_storage(pool);

    let oversized = Bytes::from(vec![0u8; 15 * 1024 * 1024 + 1]);
    let (status, body) = call(
        &router,
        put_photo_req(
            Uuid::new_v4(),
            Uuid::new_v4(),
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            oversized,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "photo is too large");
}

// F4.4 — unknown content type → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_4_unknown_content_type_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router_with_fake_storage(pool);

    let (status, body) = call(
        &router,
        put_photo_req(
            Uuid::new_v4(),
            Uuid::new_v4(),
            &user.session_token,
            &Uuid::new_v4().to_string(),
            "application/json",
            Bytes::from_static(b"not really json"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "unsupported photo content type");
}

// F4.5 — caller is not the maintainer of this work (or the work doesn't exist) → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_5_work_not_owned_by_caller_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, other.id, "CACHE_READY").await;

    let work_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO maintenance_works (id, tenant_id, shift_id, device_id, maintainer_user_id) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(work_id)
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(lead.id) // owned by lead
    .execute(&pool)
    .await
    .unwrap();

    let router = build_router_with_fake_storage(pool);

    // `other` tries to upload a photo to the lead's work
    let (status, body) = call(
        &router,
        put_photo_req(
            work_id,
            Uuid::new_v4(),
            &other.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::from_static(b"\xFF\xD8\xFF"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "maintenance work not found for current user");
}

// F4.1 — Happy path: bytes upload, row inserted with the canonical GCS object name as
// photo_url, default photo_type=MAINTENANCE, MemStorage records exactly one put.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_1_happy_path_uploads_and_persists(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_id = seed_maintenance_work(&pool, tenant.id, shift.id, device.id, lead.id).await;

    let (router, mem) = build_router_with_mem_storage(pool.clone());
    let photo_id = Uuid::new_v4();
    let bytes = Bytes::from_static(b"\xFF\xD8\xFFphoto-bytes");

    let (status, body) = call(
        &router,
        put_photo_req(
            work_id,
            photo_id,
            &lead.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            bytes.clone(),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(resp["id"], photo_id.to_string());

    let expected_object_name = format!(
        "device-photos/tenants/{}/maintenance-works/{work_id}/photos/{photo_id}",
        tenant.id
    );
    let row: (String, String) = sqlx::query_as(
        "SELECT photo_url, photo_type::text FROM maintenance_photos WHERE id = $1",
    )
    .bind(photo_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, expected_object_name);
    assert_eq!(row.1, "MAINTENANCE");

    assert_eq!(mem.put_count(), 1);
    let stored = mem.get(&expected_object_name).expect("object stored");
    assert_eq!(stored.0, bytes.to_vec());
    assert_eq!(stored.1, "image/jpeg");
}

// F4.7 — `photo_type=MALFUNCTION` query param is normalized and stored as MALFUNCTION.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_7_photo_type_malfunction_via_query(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_id = seed_maintenance_work(&pool, tenant.id, shift.id, device.id, lead.id).await;

    let router = build_router_with_fake_storage(pool.clone());
    let photo_id = Uuid::new_v4();
    let req = Request::builder()
        .method("PUT")
        .uri(format!(
            "/api/maintenance/works/{work_id}/photos/{photo_id}?photo_type=MALFUNCTION"
        ))
        .header("Cookie", format!("noma_session={}", lead.session_token))
        .header("X-Mutation-Id", Uuid::new_v4().to_string())
        .header("Content-Type", "image/jpeg")
        .body(Body::from(Bytes::from_static(b"\xFF\xD8\xFFx")))
        .unwrap();
    let (status, _) = call(&router, req).await;
    assert_eq!(status, StatusCode::OK);

    let photo_type: String =
        sqlx::query_scalar("SELECT photo_type::text FROM maintenance_photos WHERE id = $1")
            .bind(photo_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(photo_type, "MALFUNCTION");
}

// F4.8 — Replay with the same mutation_id returns the cached response without re-uploading.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_8_replay_returns_cached_response_without_second_upload(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    let work_id = seed_maintenance_work(&pool, tenant.id, shift.id, device.id, lead.id).await;

    let (router, mem) = build_router_with_mem_storage(pool.clone());
    let photo_id = Uuid::new_v4();
    let mid = Uuid::new_v4().to_string();
    let bytes = Bytes::from_static(b"\xFF\xD8\xFFphoto");

    let (s1, b1) = call(
        &router,
        put_photo_req(
            work_id,
            photo_id,
            &lead.session_token,
            &mid,
            "image/jpeg",
            bytes.clone(),
        ),
    )
    .await;
    assert_eq!(s1, StatusCode::OK);

    let (s2, b2) = call(
        &router,
        put_photo_req(
            work_id,
            photo_id,
            &lead.session_token,
            &mid,
            "image/jpeg",
            bytes,
        ),
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(b1, b2, "replay must return identical body");
    assert_eq!(mem.put_count(), 1, "replay must not re-upload");
}

// F4.6 — parent shift is frozen (here: COMMITTED) → 403 from the handler's
// "only allowed while shift is active" gate, before any upload is attempted.
// We seed the work on a live IN_PROGRESS shift, then transition the shift to COMMITTED.
#[sqlx::test(migrator = "MIGRATOR")]
async fn f4_6_frozen_shift_parent_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let device = seed_device(&pool, tenant.id, building.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let work_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO maintenance_works \
         (id, tenant_id, shift_id, device_id, maintainer_user_id, status, finished_at) \
         VALUES ($1, $2, $3, $4, $5, 'FINISHED', NOW())",
    )
    .bind(work_id)
    .bind(tenant.id)
    .bind(shift.id)
    .bind(device.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE shifts SET status = 'COMMITTED', committed_at = NOW() WHERE id = $1")
        .bind(shift.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router_with_fake_storage(pool);

    let (status, _) = call(
        &router,
        put_photo_req(
            work_id,
            Uuid::new_v4(),
            &lead.session_token,
            &Uuid::new_v4().to_string(),
            "image/jpeg",
            Bytes::from_static(b"\xFF\xD8\xFF"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
