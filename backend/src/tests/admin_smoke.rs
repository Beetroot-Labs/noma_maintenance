// H — Admin endpoints smoke tests.
// These are read-mostly. We assert: tenant scoping, the post-migration shape of the shift
// detail payload (no `accepted_at`), the role gate on user creation (admin only), the
// duplicate-email message, that flipping `is_active=FALSE` invalidates a session at the
// `require_session_user` layer, that the cross-tenant 403 holds for the maintenance detail
// endpoint, and that invite candidates only include active non-viewers in the same tenant.
//
// Notes on contracts found in the source (vs. the test plan):
//   * `create_admin_user` requires `require_admin` (not `require_lead_or_admin`). Test seeds an
//     ADMIN user and verifies a TECHNICIAN gets 403. Duplicate email returns 409 with the
//     Hungarian message "Az e-mail cím már használatban van."
//   * `update_admin_user` does not expose `is_active` in the request body. We exercise H4 by
//     flipping `is_active=FALSE` directly via SQL — the actual contract under test is the
//     `is_active = TRUE` clause in `require_session_user`, not the admin endpoint.
//   * `list_shift_invite_candidates` does NOT exclude the caller. The test documents the
//     actual behavior — the caller IS in the candidate list when active and not a viewer.

use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// H1 — `GET /admin/shifts` returns shifts for the caller's tenant only; counts exclude
// DECLINED participants.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h1_admin_shifts_filters_by_tenant_and_excludes_declined(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let _lead_b = seed_user(&pool, tb.id, "LEAD_TECHNICIAN").await;
    let other_a = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let declined_a = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let building_a = seed_building(&pool, ta.id).await;
    let building_b = seed_building(&pool, tb.id).await;

    let shift_a = seed_shift(&pool, ta.id, building_a.id, lead_a.id).await;
    add_participant(&pool, ta.id, shift_a.id, other_a.id, "CACHE_READY").await;
    add_participant(&pool, ta.id, shift_a.id, declined_a.id, "DECLINED").await;
    let _shift_b = seed_shift(&pool, tb.id, building_b.id, _lead_b.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/admin/shifts", &lead_a.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    let live = json["live"].as_array().unwrap();
    assert_eq!(live.len(), 1, "tenant A's caller must only see tenant A's shifts");
    assert_eq!(live[0]["shift_id"], shift_a.id.to_string());
    // 2 non-DECLINED (lead, other_a) — declined_a not counted.
    assert_eq!(live[0]["participants_count"], 2);
}

// H2 — `GET /admin/shifts/{id}` payload does NOT include `accepted_at` on participants.
// This is a regression test for the `remove-accepted-participant-state` branch.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h2_admin_shift_detail_omits_accepted_at(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/admin/shifts/{}", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    let participants = json["participants"].as_array().unwrap();
    assert!(!participants.is_empty());
    for p in participants {
        let obj = p.as_object().unwrap();
        assert!(
            !obj.contains_key("accepted_at"),
            "participant payload must not contain `accepted_at` after migration: {p:?}"
        );
    }
}

// H3a — non-admin caller cannot create users (LEAD_TECHNICIAN gets 403).
#[sqlx::test(migrator = "MIGRATOR")]
async fn h3a_non_admin_cannot_create_user(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            "/admin/users",
            &lead.session_token,
            None,
            Some(json!({
                "full_name": "New User",
                "email": "h3a@example.com",
                "role": "TECHNICIAN"
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// H3b — admin caller; duplicate email within tenant → 409 with the Hungarian message.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h3b_admin_duplicate_email_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let admin = seed_user(&pool, tenant.id, "ADMIN").await;
    let existing = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let existing_email: String =
        sqlx::query_scalar("SELECT email::text FROM users WHERE id = $1")
            .bind(existing.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "POST",
            "/admin/users",
            &admin.session_token,
            None,
            Some(json!({
                "full_name": "Doppelganger",
                "email": existing_email,
                "role": "TECHNICIAN"
            })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "Az e-mail cím már használatban van.");
}

// H4 — flipping `is_active=FALSE` invalidates the session: the next `/auth/me` returns 401.
// The admin endpoint doesn't expose this field, so we flip it via SQL — the contract under
// test is the `is_active = TRUE` clause in `require_session_user`.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h4_deactivating_user_invalidates_session(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = call(
        &router,
        make_req("GET", "/auth/me", &user.session_token, None, None),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "deactivating the user must immediately invalidate their session"
    );
}

// H5 — `GET /admin/maintenances/{id}` returns 403 for a cross-tenant maintenance id.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h5_cross_tenant_maintenance_returns_403(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let lead_b = seed_user(&pool, tb.id, "LEAD_TECHNICIAN").await;
    let building_b = seed_building(&pool, tb.id).await;
    let device_b = seed_device(&pool, tb.id, building_b.id).await;
    let shift_b = seed_shift(&pool, tb.id, building_b.id, lead_b.id).await;
    let work_id = seed_maintenance_work(&pool, tb.id, shift_b.id, device_b.id, lead_b.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/admin/maintenances/{}", work_id),
            &lead_a.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "maintenance not found for current tenant");
}

// H6 — `GET /users/invite-candidates` includes active non-viewers in the same tenant only.
// Documents the actual behavior: the caller is NOT excluded; only role==VIEWER and
// `is_active=FALSE` are filtered.
#[sqlx::test(migrator = "MIGRATOR")]
async fn h6_invite_candidates_excludes_inactive_and_viewers(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let active_tech = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let viewer = seed_user(&pool, ta.id, "VIEWER").await;
    let inactive = seed_user(&pool, ta.id, "TECHNICIAN").await;
    let other_tenant = seed_user(&pool, tb.id, "TECHNICIAN").await;

    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(inactive.id)
        .execute(&pool)
        .await
        .unwrap();

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/users/invite-candidates", &lead.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: Value = serde_json::from_slice(&body).unwrap();
    let ids: Vec<String> = json
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_str().unwrap().to_string())
        .collect();

    assert!(ids.contains(&active_tech.id.to_string()));
    assert!(
        ids.contains(&lead.id.to_string()),
        "actual contract: caller IS included in invite candidates"
    );
    assert!(!ids.contains(&viewer.id.to_string()), "VIEWER role must be filtered out");
    assert!(!ids.contains(&inactive.id.to_string()), "is_active=FALSE must be filtered out");
    assert!(
        !ids.contains(&other_tenant.id.to_string()),
        "other-tenant users must be filtered out"
    );
}
