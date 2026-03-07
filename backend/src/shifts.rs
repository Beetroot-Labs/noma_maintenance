use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::{require_lead_or_admin, require_session_user};
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Serialize, sqlx::FromRow)]
pub struct InviteCandidate {
    id: uuid::Uuid,
    full_name: String,
    email: String,
    role: String,
}

#[derive(Deserialize)]
pub struct CreateShiftRequest {
    building_id: uuid::Uuid,
}

#[derive(Deserialize)]
pub struct AddShiftParticipantRequest {
    user_id: uuid::Uuid,
}

#[derive(Serialize)]
pub struct CreateShiftResponse {
    shift_id: uuid::Uuid,
}

#[derive(sqlx::FromRow)]
struct ShiftWaitingRoomCore {
    id: uuid::Uuid,
    status: String,
    building_id: uuid::Uuid,
    building_name: String,
    building_address: String,
    lead_user_id: uuid::Uuid,
    lead_user_name: String,
    lead_user_phone: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ShiftParticipantView {
    user_id: uuid::Uuid,
    full_name: String,
    email: String,
    phone_number: Option<String>,
    status: String,
    invited_at: DateTime<Utc>,
    accepted_at: Option<DateTime<Utc>>,
    cache_ready_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
pub struct ShiftWaitingRoomResponse {
    id: uuid::Uuid,
    status: String,
    building_id: uuid::Uuid,
    building_name: String,
    building_address: String,
    lead_user_id: uuid::Uuid,
    lead_user_name: String,
    lead_user_phone: Option<String>,
    my_participant_status: String,
    participants: Vec<ShiftParticipantView>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct CurrentShiftSummary {
    id: uuid::Uuid,
    status: String,
    building_name: String,
    lead_user_name: String,
    lead_user_phone: Option<String>,
    my_participant_status: String,
}

#[derive(Serialize)]
pub struct CurrentShiftResponse {
    shift: Option<CurrentShiftSummary>,
}

pub async fn list_shift_invite_candidates(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    let users = sqlx::query_as::<_, InviteCandidate>(
        r#"
        SELECT id, full_name, email::text AS email, role::text AS role
        FROM users
        WHERE tenant_id = $1
          AND is_active = TRUE
          AND role <> 'VIEWER'
        ORDER BY full_name, email
        "#,
    )
    .bind(user.tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(users))
}

pub async fn get_current_shift_state(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let shift = sqlx::query_as::<_, CurrentShiftSummary>(
        r#"
        SELECT
            s.id,
            s.status::text AS status,
            b.name AS building_name,
            lu.full_name AS lead_user_name,
            lu.phone_number AS lead_user_phone,
            sp.status::text AS my_participant_status
        FROM shift_participants sp
        JOIN shifts s
          ON s.tenant_id = sp.tenant_id
         AND s.id = sp.shift_id
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users lu
          ON lu.tenant_id = s.tenant_id
         AND lu.id = s.lead_user_id
        WHERE sp.tenant_id = $1
          AND sp.user_id = $2
          AND s.status IN ('INVITING', 'READY_TO_START', 'IN_PROGRESS')
        ORDER BY
          CASE WHEN s.status = 'IN_PROGRESS' THEN 0 ELSE 1 END,
          s.created_at DESC
        LIMIT 1
        "#,
    )
    .bind(user.tenant_id)
    .bind(user.id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(CurrentShiftResponse { shift }))
}

pub async fn create_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateShiftRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    let building_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM buildings
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(payload.building_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if building_exists.is_none() {
        return Err(ApiError::forbidden("building not found for current tenant"));
    }

    let shift_id: uuid::Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO shifts (tenant_id, building_id, lead_user_id, status)
        VALUES ($1, $2, $3, 'INVITING')
        RETURNING id
        "#,
    )
    .bind(user.tenant_id)
    .bind(payload.building_id)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        INSERT INTO shift_participants (
            tenant_id,
            shift_id,
            user_id,
            status,
            accepted_at,
            cache_ready_at
        )
        VALUES ($1, $2, $3, 'ACCEPTED', NOW(), NULL)
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    refresh_shift_ready_state_tx(&mut tx, user.tenant_id, shift_id).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(Json(CreateShiftResponse { shift_id }))
}

pub async fn accept_shift_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let updated = sqlx::query(
        r#"
        UPDATE shift_participants
        SET
            status = CASE
                WHEN status = 'INVITED' THEN 'ACCEPTED'::shift_participant_status
                ELSE status
            END,
            accepted_at = CASE
                WHEN accepted_at IS NULL AND status = 'INVITED' THEN NOW()
                ELSE accepted_at
            END
        WHERE tenant_id = $1
          AND shift_id = $2
          AND user_id = $3
          AND status IN ('INVITED', 'ACCEPTED', 'CACHE_READY')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() == 0 {
        return Err(ApiError::forbidden("shift invitation not found for current user"));
    }

    refresh_shift_ready_state_tx(&mut tx, user.tenant_id, shift_id).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_shift_participant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
    Json(payload): Json<AddShiftParticipantRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let lead_user_id: Option<uuid::Uuid> = sqlx::query_scalar(
        r#"
        SELECT lead_user_id
        FROM shifts
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('INVITING', 'READY_TO_START')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(lead_user_id) = lead_user_id else {
        return Err(ApiError::forbidden("shift not found or cannot be modified"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "only the shift lead can add participants",
        ));
    }

    let candidate_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM users
        WHERE tenant_id = $1
          AND id = $2
          AND is_active = TRUE
          AND role <> 'VIEWER'
        "#,
    )
    .bind(user.tenant_id)
    .bind(payload.user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if candidate_exists.is_none() {
        return Err(ApiError::bad_request("selected user is not eligible"));
    }

    sqlx::query(
        r#"
        INSERT INTO shift_participants (
            tenant_id,
            shift_id,
            user_id,
            status,
            invited_at
        )
        VALUES ($1, $2, $3, 'INVITED', NOW())
        ON CONFLICT (shift_id, user_id) DO NOTHING
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(payload.user_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    refresh_shift_ready_state_tx(&mut tx, user.tenant_id, shift_id).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_shift_participant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((shift_id, participant_user_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let lead_user_id: Option<uuid::Uuid> = sqlx::query_scalar(
        r#"
        SELECT lead_user_id
        FROM shifts
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('INVITING', 'READY_TO_START')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(lead_user_id) = lead_user_id else {
        return Err(ApiError::forbidden("shift not found or cannot be modified"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "only the shift lead can remove participants",
        ));
    }

    if participant_user_id == lead_user_id {
        return Err(ApiError::bad_request("shift lead cannot be removed"));
    }

    sqlx::query(
        r#"
        DELETE FROM shift_participants
        WHERE tenant_id = $1
          AND shift_id = $2
          AND user_id = $3
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(participant_user_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    refresh_shift_ready_state_tx(&mut tx, user.tenant_id, shift_id).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn mark_shift_cache_ready(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let updated = sqlx::query(
        r#"
        UPDATE shift_participants
        SET
            status = 'CACHE_READY',
            accepted_at = COALESCE(accepted_at, NOW()),
            cache_ready_at = COALESCE(cache_ready_at, NOW())
        WHERE tenant_id = $1
          AND shift_id = $2
          AND user_id = $3
          AND status IN ('ACCEPTED', 'CACHE_READY')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() == 0 {
        return Err(ApiError::conflict(
            "participant must accept invitation before cache-ready acknowledgement",
        ));
    }

    refresh_shift_ready_state_tx(&mut tx, user.tenant_id, shift_id).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_shift_waiting_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let shift = sqlx::query_as::<_, ShiftWaitingRoomCore>(
        r#"
        SELECT
            s.id,
            s.status::text AS status,
            s.building_id,
            b.name AS building_name,
            b.address AS building_address,
            s.lead_user_id,
            lu.full_name AS lead_user_name,
            lu.phone_number AS lead_user_phone
        FROM shifts s
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users lu
          ON lu.tenant_id = s.tenant_id
         AND lu.id = s.lead_user_id
        WHERE s.tenant_id = $1
          AND s.id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("shift not found for current tenant"))?;

    let my_status: Option<String> = sqlx::query_scalar(
        r#"
        SELECT status::text
        FROM shift_participants
        WHERE tenant_id = $1
          AND shift_id = $2
          AND user_id = $3
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    let my_participant_status =
        my_status.ok_or_else(|| ApiError::forbidden("current user is not a shift participant"))?;

    let participants = sqlx::query_as::<_, ShiftParticipantView>(
        r#"
        SELECT
            sp.user_id,
            u.full_name,
            u.email::text AS email,
            u.phone_number,
            sp.status::text AS status,
            sp.invited_at,
            sp.accepted_at,
            sp.cache_ready_at
        FROM shift_participants sp
        JOIN users u
          ON u.tenant_id = sp.tenant_id
         AND u.id = sp.user_id
        WHERE sp.tenant_id = $1
          AND sp.shift_id = $2
        ORDER BY u.full_name
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(ShiftWaitingRoomResponse {
        id: shift.id,
        status: shift.status,
        building_id: shift.building_id,
        building_name: shift.building_name,
        building_address: shift.building_address,
        lead_user_id: shift.lead_user_id,
        lead_user_name: shift.lead_user_name,
        lead_user_phone: shift.lead_user_phone,
        my_participant_status,
        participants,
    }))
}

pub async fn start_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let lead_user_id: Option<uuid::Uuid> = sqlx::query_scalar(
        r#"
        SELECT lead_user_id
        FROM shifts
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('INVITING', 'READY_TO_START')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(lead_user_id) = lead_user_id else {
        return Err(ApiError::forbidden("shift not found or cannot be started"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden("only the shift lead can start the shift"));
    }

    let not_ready_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM shift_participants
        WHERE tenant_id = $1
          AND shift_id = $2
          AND status <> 'CACHE_READY'
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if not_ready_count > 0 {
        return Err(ApiError::conflict(
            "all participants must be CACHE_READY before starting the shift",
        ));
    }

    sqlx::query(
        r#"
        UPDATE shifts
        SET status = 'IN_PROGRESS',
            started_at = COALESCE(started_at, NOW())
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('INVITING', 'READY_TO_START')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn cancel_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let shift_row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        r#"
        SELECT lead_user_id, status::text AS status
        FROM shifts
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some((lead_user_id, status)) = shift_row else {
        return Err(ApiError::forbidden("shift not found or cannot be cancelled"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden("shift not found or cannot be cancelled"));
    }

    if matches!(status.as_str(), "CANCELLED" | "COMMITTED") {
        return Err(ApiError::conflict("shift is already closed and cannot be cancelled"));
    }

    sqlx::query(
        r#"
        DELETE FROM maintenance_works
        WHERE tenant_id = $1
          AND shift_id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let deleted_shift = sqlx::query(
        r#"
        DELETE FROM shifts
        WHERE tenant_id = $1
          AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if deleted_shift.rows_affected() == 0 {
        return Err(ApiError::forbidden("shift not found or cannot be cancelled"));
    }

    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
}

async fn refresh_shift_ready_state_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
) -> Result<(), ApiError> {
    let waiting_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM shift_participants
        WHERE tenant_id = $1
          AND shift_id = $2
          AND status IN ('INVITED', 'ACCEPTED')
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    let next_status = if waiting_count == 0 {
        "READY_TO_START"
    } else {
        "INVITING"
    };

    sqlx::query(
        r#"
        UPDATE shifts
        SET status = $3::shift_status
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('INVITING', 'READY_TO_START')
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .bind(next_status)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(())
}
