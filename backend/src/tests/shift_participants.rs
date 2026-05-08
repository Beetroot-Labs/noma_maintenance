// E2 — POST /shifts/{id}/participants (lead invites a tenant user).
// E3 — DELETE /shifts/{id}/participants/{user_id} (lead removes a participant).

use axum::http::StatusCode;
use serde_json::json;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// E2.1 — Lead invites a tenant user → 204; row is INVITED with invited_at populated.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e2_1_lead_invites_user_happy_path(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift.id),
            &lead.session_token,
            None,
            Some(json!({ "user_id": invitee.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let row: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT status::text, invited_at FROM shift_participants \
         WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(invitee.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "INVITED");
    assert!(row.1.is_some(), "invited_at should be populated");
}

// E2.2 — A non-lead participant trying to invite → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e2_2_non_lead_invite_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other_lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift.id),
            &other_lead.session_token,
            None,
            Some(json!({ "user_id": invitee.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// E2.3 — Inviting a user from another tenant → 400 ("not eligible"). The tenant scope check is
// done on the candidate, so cross-tenant ID surfaces as "not eligible", not as 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e2_3_cross_tenant_user_returns_400_not_eligible(pool: PgPool) {
    let ta = seed_tenant(&pool).await;
    let tb = seed_tenant(&pool).await;
    let lead_a = seed_user(&pool, ta.id, "LEAD_TECHNICIAN").await;
    let user_b = seed_user(&pool, tb.id, "TECHNICIAN").await;
    let building_a = seed_building(&pool, ta.id).await;
    let shift_a = seed_shift(&pool, ta.id, building_a.id, lead_a.id).await;

    let router = build_router(pool);

    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift_a.id),
            &lead_a.session_token,
            None,
            Some(json!({ "user_id": user_b.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "selected user is not eligible");
}

// E2.4 — Re-inviting a previously DECLINED user resets the row to INVITED with a fresh
// invited_at and clears later timestamps.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e2_4_reinvite_declined_user_resets_to_invited(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    add_participant(&pool, tenant.id, shift.id, invitee.id, "DECLINED").await;
    let original_invited_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT invited_at FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(invitee.id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Step the clock so a new NOW() is observably greater
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift.id),
            &lead.session_token,
            None,
            Some(json!({ "user_id": invitee.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let row: (String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as(
            "SELECT status::text, invited_at, cache_ready_at \
             FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
        )
        .bind(shift.id)
        .bind(invitee.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.0, "INVITED");
    assert!(row.1 > original_invited_at, "invited_at should be bumped");
    assert!(row.2.is_none(), "cache_ready_at should be cleared on re-invite");
}

// E2.5 — Inviting an inactive user surfaces as "not eligible" (400). The eligibility filter is
// the same table check used for cross-tenant: is_active = TRUE AND role <> 'VIEWER'.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e2_5_inactive_user_returns_400_not_eligible(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let inactive = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    sqlx::query("UPDATE users SET is_active = FALSE WHERE id = $1")
        .bind(inactive.id)
        .execute(&pool)
        .await
        .unwrap();
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift.id),
            &lead.session_token,
            None,
            Some(json!({ "user_id": inactive.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// E3.1 — Lead removes a participant from an INVITING shift → 204; the row is gone.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e3_1_lead_removes_participant_happy_path(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "INVITED").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "DELETE",
            &format!("/shifts/{}/participants/{}", shift.id, invitee.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert!(
        participant_status(&pool, shift.id, invitee.id).await.is_none(),
        "participant row should be deleted"
    );
}

// E3.2 — Non-lead caller → 403; row stays.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e3_2_non_lead_remove_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "INVITED").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "DELETE",
            &format!("/shifts/{}/participants/{}", shift.id, invitee.id),
            &other.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        participant_status(&pool, shift.id, invitee.id).await.is_some(),
        "participant should still be present"
    );
}

// E3.3 — Trying to remove the lead themselves → 400.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e3_3_remove_lead_returns_400(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;

    let router = build_router(pool);

    let (status, body) = call(
        &router,
        make_req(
            "DELETE",
            &format!("/shifts/{}/participants/{}", shift.id, lead.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "shift lead cannot be removed");
}

// E3.4 — Removing the last INVITED participant moves the shift INVITING → READY_TO_START.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e3_4_remove_last_invited_transitions_to_ready_to_start(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    // Lead joined as CACHE_READY (so the only INVITED row is the invitee).
    let shift_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, building_id, lead_user_id, status) \
         VALUES ($1, $2, $3, $4, 'INVITING')",
    )
    .bind(shift_id)
    .bind(tenant.id)
    .bind(building.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();
    add_participant(&pool, tenant.id, shift_id, lead.id, "CACHE_READY").await;
    add_participant(&pool, tenant.id, shift_id, invitee.id, "INVITED").await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "DELETE",
            &format!("/shifts/{shift_id}/participants/{}", invitee.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let final_status = shift_status(&pool, shift_id).await.unwrap();
    assert_eq!(final_status, "READY_TO_START");
}
