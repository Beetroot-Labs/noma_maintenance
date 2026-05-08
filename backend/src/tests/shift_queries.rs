// E11 — GET /shifts/current.
// E12 — GET /shifts/{id}/waiting-room.

use axum::http::StatusCode;
use sqlx::PgPool;

use super::helpers::*;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!();

// E11.1 — Caller has no participant rows at all → response is `{ "shift": null }`.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_1_no_active_shift_returns_null(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let user = seed_user(&pool, tenant.id, "TECHNICIAN").await;

    let router = build_router(pool);

    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &user.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["shift"].is_null());
}

// E11.2 — INVITED on an INVITING shift → returned.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_2_invited_on_inviting_shift_is_returned(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "INVITING").await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "INVITED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &invitee.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["shift"]["id"], shift.id.to_string());
    assert_eq!(json["shift"]["status"], "INVITING");
    assert_eq!(json["shift"]["my_participant_status"], "INVITED");
}

// E11.3 — CACHE_READY on IN_PROGRESS shift → returned.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_3_cache_ready_on_in_progress_is_returned(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &lead.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["shift"]["id"], shift.id.to_string());
    assert_eq!(json["shift"]["status"], "IN_PROGRESS");
    assert_eq!(json["shift"]["my_participant_status"], "CACHE_READY");
}

// E11.4 — CLOSE_CONFIRMED participant on CLOSE_REQUESTED shift, NOT the lead → filtered out.
// Behaviour comes from the WHERE clause in get_current_shift_state: the shift is excluded for
// confirmed non-leads so they don't keep "seeing" a shift they've already finished with.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_4_close_confirmed_non_lead_is_filtered_out(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let participant = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift =
        seed_shift_in_state(&pool, tenant.id, building.id, lead.id, "CLOSE_REQUESTED").await;
    add_participant(&pool, tenant.id, shift.id, participant.id, "CLOSE_CONFIRMED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &participant.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        json["shift"].is_null(),
        "non-lead CLOSE_CONFIRMED on CLOSE_REQUESTED shift must be filtered"
    );
}

// E11.5 — Same scenario but the caller IS the lead → returned. The lead keeps visibility so
// they can drive the close.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_5_close_confirmed_lead_is_returned(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;

    let shift_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO shifts (id, tenant_id, building_id, lead_user_id, status, started_at, close_requested_at) \
         VALUES ($1, $2, $3, $4, 'CLOSE_REQUESTED', NOW(), NOW())",
    )
    .bind(shift_id)
    .bind(tenant.id)
    .bind(building.id)
    .bind(lead.id)
    .execute(&pool)
    .await
    .unwrap();
    add_participant(&pool, tenant.id, shift_id, lead.id, "CLOSE_CONFIRMED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &lead.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["shift"]["id"], shift_id.to_string());
    assert_eq!(json["shift"]["my_participant_status"], "CLOSE_CONFIRMED");
}

// E11.6 — DECLINED participant → never returned.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e11_6_declined_participant_is_never_returned(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let invitee = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, invitee.id, "DECLINED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req("GET", "/shifts/current", &invitee.session_token, None, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(json["shift"].is_null());
}

// E12.1 — Participant gets the waiting-room payload with shift core + roster.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e12_1_participant_gets_roster(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let other = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, other.id, "INVITED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/shifts/{}/waiting-room", shift.id),
            &lead.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["id"], shift.id.to_string());
    assert_eq!(json["my_participant_status"], "CACHE_READY");
    let participants = json["participants"].as_array().unwrap();
    assert_eq!(participants.len(), 2, "lead + invited participant");
    let user_ids: Vec<String> = participants
        .iter()
        .map(|p| p["user_id"].as_str().unwrap().to_string())
        .collect();
    assert!(user_ids.contains(&lead.id.to_string()));
    assert!(user_ids.contains(&other.id.to_string()));
}

// E12.2 — Caller is in the same tenant but is not a participant of this shift → 403.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e12_2_non_participant_returns_403(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let outsider = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/shifts/{}/waiting-room", shift.id),
            &outsider.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"], "current user is not a shift participant");
}

// E12.3 — A DECLINED caller currently still gets the roster (handler does not filter on
// participant status). This documents the known bug from the test plan; flip when fixed.
#[sqlx::test(migrator = "MIGRATOR")]
async fn e12_3_declined_caller_still_gets_roster_known_bug(pool: PgPool) {
    let tenant = seed_tenant(&pool).await;
    let lead = seed_user(&pool, tenant.id, "LEAD_TECHNICIAN").await;
    let declined = seed_user(&pool, tenant.id, "TECHNICIAN").await;
    let building = seed_building(&pool, tenant.id).await;
    let shift = seed_shift(&pool, tenant.id, building.id, lead.id).await;
    add_participant(&pool, tenant.id, shift.id, declined.id, "DECLINED").await;

    let router = build_router(pool);
    let (status, body) = call(
        &router,
        make_req(
            "GET",
            &format!("/shifts/{}/waiting-room", shift.id),
            &declined.session_token,
            None,
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["my_participant_status"], "DECLINED");
}
