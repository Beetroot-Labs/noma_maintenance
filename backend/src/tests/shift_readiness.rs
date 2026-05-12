// E4 — POST /shifts/{id}/join-ready (participant marks themselves cache-ready).
// E5 — POST /shifts/{id}/decline (participant declines an invitation).

use axum::http::StatusCode;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// E4.1 — INVITED caller → 204; participant moves to CACHE_READY with cache_ready_at set.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e4_1_invited_join_ready_transitions_to_cache_ready(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "INVITED").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/join-ready", shift.id),
            &invitee.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let row: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT status::text, cache_ready_at FROM shift_participants \
         WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(invitee.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "CACHE_READY");
    assert!(row.1.is_some());
}

// E4.2 — CACHE_READY caller → 204; cache_ready_at preserved (not bumped).
#[sqlx::test(migrator = "MIGRATOR")]
async fn e4_2_cache_ready_join_ready_is_idempotent(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let original: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT cache_ready_at FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(lead.id)
    .fetch_one(&pool)
    .await
    .unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/join-ready", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let after: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT cache_ready_at FROM shift_participants WHERE shift_id = $1 AND user_id = $2",
    )
    .bind(shift.id)
    .bind(lead.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, original, "cache_ready_at should not be bumped on a no-op call");
}

// E4.3 — DECLINED caller → 403; status unchanged.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e4_3_declined_join_ready_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "DECLINED").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/join-ready", shift.id),
            &invitee.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let s = participant_status(&pool, shift.id, invitee.id).await.unwrap();
    assert_eq!(s, "DECLINED", "declined participant must not be promoted to CACHE_READY");
}

// E4.4 — Caller is not a participant of the shift at all → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e4_4_non_participant_join_ready_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let outsider = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/join-ready", shift.id),
            &outsider.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// E4.5 — When the last INVITED participant goes CACHE_READY, an INVITING shift moves to
// READY_TO_START.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e4_5_last_invited_join_ready_transitions_shift_to_ready_to_start(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    // Manually craft an INVITING shift where the lead is already CACHE_READY (so the only
    // INVITED row is the invitee).
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
            "POST",
            &format!("/shifts/{shift_id}/join-ready"),
            &invitee.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(shift_status(&pool, shift_id).await.unwrap(), "READY_TO_START");
}

// E5.1 — INVITED caller declines → 204; status flips to DECLINED.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e5_1_invited_decline_transitions_to_declined(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "INVITED").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/decline", shift.id),
            &invitee.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(
        participant_status(&pool, shift.id, invitee.id).await.unwrap(),
        "DECLINED"
    );
}

// E5.2 — CACHE_READY caller cannot decline → 403; status unchanged.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e5_2_cache_ready_decline_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let participant = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, participant.id, "CACHE_READY").await;

    let router = build_router(pool.clone());

    let (status, _) = call(
        &router,
        make_req(
            "POST",
            &format!("/shifts/{}/decline", shift.id),
            &participant.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    assert_eq!(
        participant_status(&pool, shift.id, participant.id).await.unwrap(),
        "CACHE_READY",
        "decline must not silently flip a CACHE_READY participant"
    );
}

// E5.3 — A decline from the last INVITED participant moves an INVITING shift to READY_TO_START
// (refresh_shift_ready_state_tx counts only INVITED rows; DECLINED no longer blocks the gate).
#[sqlx::test(migrator = "MIGRATOR")]
async fn e5_3_decline_transitions_shift_to_ready_to_start(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

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
            "POST",
            &format!("/shifts/{shift_id}/decline"),
            &invitee.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    assert_eq!(shift_status(&pool, shift_id).await.unwrap(), "READY_TO_START");
}
