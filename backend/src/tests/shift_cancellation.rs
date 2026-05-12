// E9 — POST /shifts/{id}/cancel.
// Note: the current handler implements "cancel" as a hard DELETE of the shift (and its
// maintenance_works), not as a CANCELLED status transition. Tests assert the actual contract.

use axum::http::StatusCode;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// E9.1 — Lead cancels an IN_PROGRESS shift → 204; the shift row is gone.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e9_1_lead_cancels_in_progress_shift_deletes_it(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert!(
        shift_status(&pool, shift.id).await.is_none(),
        "shift row should be deleted"
    );
}

// E9.2 — Lead cancels an INVITING shift → 204; row deleted (INVITING is not frozen).
#[sqlx::test(migrator = "MIGRATOR")]
async fn e9_2_lead_cancels_inviting_shift_deletes_it(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(shift_status(&pool, shift.id).await.is_none());
}

// E9.3 — Cancel on a COMMITTED shift → 409; the shift remains COMMITTED.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e9_3_cancel_on_committed_returns_409(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "COMMITTED").await;

    let router = build_router(pool.clone());

    let (status, body) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "shift is already closed and cannot be cancelled");

    assert_eq!(shift_status(&pool, shift.id).await.unwrap(), "COMMITTED");
}

// E9.4 — A non-lead caller (even another lead in the same tenant) → 403; shift unchanged.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e9_4_non_lead_cancel_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool.clone());
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift.id),
            &other.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(shift_status(&pool, shift.id).await.is_some());
}

// E9.5 — After a successful cancel, subsequent calls against the same shift_id → 403
// ("shift not found"), since the row is gone.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e9_5_post_cancel_subsequent_ops_return_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool.clone());

    // Cancel the shift first.
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/cancel", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Subsequent close-request — shift is gone, handler returns 403.
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/close-request", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Subsequent invite — same.
    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/participants", shift.id),
            &lead.session_token,
            None,
            Some(serde_json::json!({ "user_id": invitee.id })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
