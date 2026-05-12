use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// B1: Cross-tenant GETs return 403, never 200 or 404.
#[sqlx::test(migrator = "MIGRATOR")]
async fn b1_cross_tenant_gets_return_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let user_b = seed_user(&pool, tb.id, "LEAD_TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;
    let shift_b = seed_shift(&pool, tb.id, building_b.id, user_b.id).await;
    let device_b = seed_device(&pool, tb.id, building_b.id).await;

    let router = build_router(pool);

    for path in [
        format!("/shifts/{}/waiting-room", shift_b.id),
        format!("/shifts/{}/maintenance-summary", shift_b.id),
        format!("/labeling/buildings/{}/cache", building_b.id),
        format!("/admin/shifts/{}", shift_b.id),
        format!("/admin/devices/{}", device_b.id),
    ] {
        let (status, _) = call(&router, make_req("GET", &path, &user_a.session_token, None, None))
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "expected 403 for GET {path}");
    }
}

// B2: Cross-tenant mutations return 403 and leave the target entity unmodified.
#[sqlx::test(migrator = "MIGRATOR")]
async fn b2_cross_tenant_mutations_return_403_and_write_nothing(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let user_b = seed_user(&pool, tb.id, "LEAD_TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;
    let shift_b = seed_shift(&pool, tb.id, building_b.id, user_b.id).await;

    let router = build_router(pool.clone());

    // POST /shifts with a building from tenant B — user A should get 403
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &user_a.session_token,
            None,
            Some(json!({ "building_id": building_b.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "create shift with cross-tenant building");

    // No shift should have been created in tenant A
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM shifts WHERE tenant_id = $1")
        .bind(ta.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "no shift should exist in tenant A after cross-tenant attempt");

    // POST /shifts/{id}/join-ready on shift from tenant B
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/join-ready", shift_b.id),
            &user_a.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "join-ready on cross-tenant shift");

    // POST /shifts/{id}/close-request on shift from tenant B
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/close-request", shift_b.id),
            &user_a.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "close-request on cross-tenant shift");

    // POST /shifts/{id}/cancel on shift from tenant B
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift_b.id),
            &user_a.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "cancel on cross-tenant shift");

    // Shift in tenant B must remain IN_PROGRESS — none of the above should have mutated it
    let shift_status: String =
        sqlx::query_scalar("SELECT status::text FROM shifts WHERE id = $1")
            .bind(shift_b.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(shift_status, "IN_PROGRESS", "shift_b should be unmodified");
}

// B3: Building UUID from tenant A is 403 when used by a user from tenant B.
#[sqlx::test(migrator = "MIGRATOR")]
async fn b3_building_id_scoped_to_tenant(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let user_b = seed_user(&pool, tb.id, "LEAD_TECHNICIAN").await;
    let building_a = seed_building(&pool, ta.id).await;
    let building_b = seed_building(&pool, tb.id).await;

    let router = build_router(pool);

    // user_a with their own building succeeds
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &user_a.session_token,
            None,
            Some(json!({ "building_id": building_a.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "user_a with own building should succeed");

    // user_b with tenant A's building is forbidden
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &user_b.session_token,
            None,
            Some(json!({ "building_id": building_a.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "user_b using tenant A building should be 403");

    // user_a with tenant B's building is also forbidden
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &user_a.session_token,
            None,
            Some(json!({ "building_id": building_b.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "user_a using tenant B building should be 403");
}

// B4: Same X-Mutation-Id used by two tenants against the same endpoint — both calls succeed.
// Idempotency keys are scoped per tenant; tenant B's key must not collide with tenant A's.
#[sqlx::test(migrator = "MIGRATOR")]
async fn b4_same_mutation_id_across_tenants_both_succeed(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let user_a = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let user_b = seed_user(&pool, tb.id, "TECHNICIAN").await;
    let building_a = seed_building(&pool, ta.id).await;
    let building_b = seed_building(&pool, tb.id).await;
    let device_a = seed_device(&pool, ta.id, building_a.id).await;
    let device_b = seed_device(&pool, tb.id, building_b.id).await;

    let router = build_router(pool);

    let shared_mid = Uuid::new_v4().to_string();

    let (status_a, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device_a.id),
            &user_a.session_token,
            Some(&shared_mid),
            Some(json!({ "code": "BARCODE-TA-001" })),
        ),
    )
    .await;

    let (status_b, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/labeling/devices/{}/barcode", device_b.id),
            &user_b.session_token,
            Some(&shared_mid),
            Some(json!({ "code": "BARCODE-TB-001" })),
        ),
    )
    .await;

    assert!(status_a.is_success(), "tenant A barcode assign should succeed, got {status_a}");
    assert!(
        status_b.is_success(),
        "tenant B barcode assign with same mutation ID should succeed, got {status_b}"
    );
}
