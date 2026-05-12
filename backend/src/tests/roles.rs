use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// C1: Technician is blocked by require_lead_or_admin gates.
// C2: The same calls succeed for LEAD_TECHNICIAN and ADMIN.
#[sqlx::test(migrator = "MIGRATOR")]
async fn c1_technician_blocked_by_lead_or_admin_gate(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let technician = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);

    // POST /shifts — requires lead or admin
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &technician.session_token,
            None,
            Some(json!({ "building_id": building.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "technician POST /shifts");

    // GET /admin/users — requires lead or admin
    let (status, _) = call(
        &router,
        make_req("GET", "/admin/users", &technician.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "technician GET /admin/users");

    // GET /shifts/pending — requires lead or admin
    let (status, _) = call(
        &router,
        make_req("GET", "/shifts/pending", &technician.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "technician GET /shifts/pending");

    // GET /shifts/{id}/maintenance-summary — requires lead or admin
    let (status, _) = call(
        &router,
        make_req(
            "GET",
            &format!("/shifts/{}/maintenance-summary", shift.id),
            &technician.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "technician GET /shifts/{{id}}/maintenance-summary"
    );
}

// C2: LEAD_TECHNICIAN passes the lead_or_admin gate on every endpoint above.
#[sqlx::test(migrator = "MIGRATOR")]
async fn c2_lead_technician_passes_lead_or_admin_gate(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);

    // POST /shifts — 200 means the gate passed (role check is not the blocker)
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &lead.session_token,
            None,
            Some(json!({ "building_id": building.id })),
        ),
    )
    .await;
    assert_ne!(status, StatusCode::FORBIDDEN, "lead should pass POST /shifts gate");

    // GET /admin/users — 200 OK
    let (status, _) = call(
        &router,
        make_req("GET", "/admin/users", &lead.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "lead GET /admin/users");

    // GET /shifts/pending — 200 OK
    let (status, _) = call(
        &router,
        make_req("GET", "/shifts/pending", &lead.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "lead GET /shifts/pending");

    // GET /shifts/{id}/maintenance-summary — not 403
    let (status, _) = call(
        &router,
        make_req(
            "GET",
            &format!("/shifts/{}/maintenance-summary", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_ne!(
        status,
        StatusCode::FORBIDDEN,
        "lead should pass /shifts/{{id}}/maintenance-summary gate"
    );
}

// C3: ADMIN passes the lead_or_admin gate identically.
#[sqlx::test(migrator = "MIGRATOR")]
async fn c3_admin_passes_lead_or_admin_gate(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let admin = seed_user(&pool, tenant.id, "ADMIN").await;
    let building = seed_building(&pool, tenant.id).await;

    let router = build_router(pool);

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/shifts",
            &admin.session_token,
            None,
            Some(json!({ "building_id": building.id })),
        ),
    )
    .await;
    assert_ne!(status, StatusCode::FORBIDDEN, "admin should pass POST /shifts gate");

    let (status, _) = call(
        &router,
        make_req("GET", "/admin/users", &admin.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "admin GET /admin/users");
}

// C4: Technician is blocked by require_admin gate (POST /admin/users, PATCH /admin/users/{id}).
#[sqlx::test(migrator = "MIGRATOR")]
async fn c4_technician_blocked_by_admin_only_gate(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let technician = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;

    let router = build_router(pool);

    // POST /admin/users — requires admin
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/admin/users",
            &technician.session_token,
            None,
            Some(json!({ "full_name": "New User", "email": "new@test.local", "role": "TECHNICIAN" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "technician POST /admin/users");

    // LEAD_TECHNICIAN is also blocked from the admin-only gate
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/admin/users",
            &lead.session_token,
            None,
            Some(json!({ "full_name": "New User", "email": "new2@test.local", "role": "TECHNICIAN" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "lead POST /admin/users (admin-only gate)");
}

// C5: ADMIN passes the admin-only gate.
#[sqlx::test(migrator = "MIGRATOR")]
async fn c5_admin_passes_admin_only_gate(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let admin = seed_user(&pool, tenant.id, "ADMIN").await;

    let router = build_router(pool);

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/admin/users",
            &admin.session_token,
            None,
            Some(json!({
                "full_name": "New User",
                "email": "new@test.local",
                "role": "TECHNICIAN"
            })),
        ),
    )
    .await;
    // 201 or 200 — gate passed, not 403
    assert_ne!(status, StatusCode::FORBIDDEN, "admin should pass POST /admin/users gate");
}

// C6: Unauthenticated requests (no session cookie) return 401 on any protected endpoint.
#[sqlx::test(migrator = "MIGRATOR")]
async fn c6_missing_session_returns_401(pool: PgPool) {
    let router = build_router(pool);

    let fake_token = Uuid::new_v4().to_string();

    for path in [
        "/shifts/current",
        "/shifts/pending",
        "/admin/users",
        "/labeling/buildings",
    ] {
        let (status, _) = call(
            &router,
            make_req("GET", path, &fake_token, None, None),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "invalid session should be 401 for GET {path}");
    }
}
