use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use cloud_storage::Object;
use serde::{Deserialize, Serialize};

use crate::auth::{require_admin, require_lead_or_admin, require_session_user};
use crate::error::ApiError;
use crate::state::AppState;
use crate::storage::{image_content_type, shift_signature_object_name};

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

#[derive(Deserialize)]
pub struct CommitShiftRequest {
    reference_person_name: String,
    reference_person_role: String,
    signature_strokes: Vec<Vec<SignaturePoint>>,
    signature_image_url: String,
}

#[derive(Deserialize, Serialize)]
pub struct SignaturePoint {
    x: f64,
    y: f64,
}

#[derive(Serialize)]
pub struct UploadShiftSignatureResponse {
    signature_image_url: String,
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
    building_id: uuid::Uuid,
    building_name: String,
    lead_user_name: String,
    lead_user_phone: Option<String>,
    my_participant_status: String,
}

#[derive(Serialize)]
pub struct CurrentShiftResponse {
    shift: Option<CurrentShiftSummary>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminLiveShiftRow {
    shift_id: uuid::Uuid,
    status: String,
    building_name: String,
    lead_user_name: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    closed_at: Option<DateTime<Utc>>,
    participants_ready_count: i64,
    participants_invited_count: i64,
    participants_count: i64,
    malfunctioning_count: i64,
    maintenances_synced: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminPastShiftRow {
    shift_id: uuid::Uuid,
    status: String,
    date: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    building_name: String,
    lead_user_name: String,
    participants_count: i64,
    malfunctioning_count: i64,
    maintenances_count: i64,
    avg_maintenance_minutes: Option<f64>,
    report_ready: bool,
}

#[derive(Serialize)]
pub struct AdminShiftListResponse {
    live: Vec<AdminLiveShiftRow>,
    past: Vec<AdminPastShiftRow>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminShiftParticipantRow {
    user_id: uuid::Uuid,
    full_name: String,
    role: String,
    status: String,
    invited_at: DateTime<Utc>,
    accepted_at: Option<DateTime<Utc>>,
    cache_ready_at: Option<DateTime<Utc>>,
    close_confirmed_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminShiftMaintenanceRow {
    maintenance_id: uuid::Uuid,
    barcode: Option<String>,
    kind: String,
    brand: Option<String>,
    model: Option<String>,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
    maintainer_user_name: String,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    followup_service_required: bool,
    has_notes: bool,
}

#[derive(Serialize)]
pub struct AdminShiftDetailResponse {
    shift_id: uuid::Uuid,
    status: String,
    building_name: String,
    building_address: String,
    shift_lead_name: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    closed_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    avg_maintenance_pace_minutes: Option<f64>,
    participants_count: i64,
    total_maintenances: i64,
    total_followup_service: i64,
    report_url: Option<String>,
    report_ready: bool,
    participants: Vec<AdminShiftParticipantRow>,
    maintenances: Vec<AdminShiftMaintenanceRow>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminMaintenancePhotoRow {
    photo_id: uuid::Uuid,
    photo_type: String,
    photo_url: String,
    capture_note: Option<String>,
    captured_at: DateTime<Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct AdminMaintenanceDetailCore {
    maintenance_id: uuid::Uuid,
    shift_id: uuid::Uuid,
    maintenance_status: String,
    barcode: Option<String>,
    kind: String,
    brand: Option<String>,
    model: Option<String>,
    serial_number: Option<String>,
    source_device_code: Option<String>,
    maintainer_user_name: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    aborted_at: Option<DateTime<Utc>>,
    malfunction_description: Option<String>,
    followup_service_required: bool,
    followup_service_reasons: Vec<String>,
    followup_service_reason_other: Option<String>,
    note: Option<String>,
    building_name: String,
    building_address: String,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
}

#[derive(Serialize)]
pub struct AdminMaintenanceDetailResponse {
    maintenance_id: uuid::Uuid,
    shift_id: uuid::Uuid,
    maintenance_status: String,
    barcode: Option<String>,
    kind: String,
    brand: Option<String>,
    model: Option<String>,
    serial_number: Option<String>,
    source_device_code: Option<String>,
    maintainer_user_name: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    aborted_at: Option<DateTime<Utc>>,
    malfunction_description: Option<String>,
    followup_service_required: bool,
    followup_service_reasons: Vec<String>,
    followup_service_reason_other: Option<String>,
    note: Option<String>,
    building_name: String,
    building_address: String,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
    photos: Vec<AdminMaintenancePhotoRow>,
}

#[derive(sqlx::FromRow)]
struct AdminShiftDetailCore {
    shift_id: uuid::Uuid,
    status: String,
    building_name: String,
    building_address: String,
    shift_lead_name: String,
    created_at: DateTime<Utc>,
    started_at: Option<DateTime<Utc>>,
    closed_at: Option<DateTime<Utc>>,
    finished_at: Option<DateTime<Utc>>,
    avg_maintenance_pace_minutes: Option<f64>,
    participants_count: i64,
    total_maintenances: i64,
    total_followup_service: i64,
    report_url: Option<String>,
    report_ready: bool,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ShiftMaintenanceSummaryRow {
    maintenance_id: uuid::Uuid,
    maintainer_user_name: String,
    maintenance_status: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    aborted_at: Option<DateTime<Utc>>,
    malfunction_description: Option<String>,
    note: Option<String>,
    device_id: uuid::Uuid,
    device_code: Option<String>,
    device_kind: String,
    device_additional_info: Option<String>,
    device_brand: Option<String>,
    device_model: Option<String>,
    device_serial_number: Option<String>,
    source_device_code: Option<String>,
    building_name: String,
    building_address: String,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
}

#[derive(Serialize)]
pub struct ShiftMaintenanceSummaryResponse {
    shift_id: uuid::Uuid,
    shift_status: String,
    building_name: String,
    lead_user_id: uuid::Uuid,
    lead_user_name: String,
    maintenances: Vec<ShiftMaintenanceSummaryRow>,
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

pub async fn list_admin_shifts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_admin(&user)?;

    let live = sqlx::query_as::<_, AdminLiveShiftRow>(
        r#"
        SELECT
            s.id AS shift_id,
            s.status::text AS status,
            b.name AS building_name,
            lu.full_name AS lead_user_name,
            s.created_at,
            s.started_at,
            s.close_requested_at AS closed_at,
            (
                SELECT COUNT(*)::bigint
                FROM shift_participants sp
                WHERE sp.tenant_id = s.tenant_id
                  AND sp.shift_id = s.id
                  AND sp.status IN ('CACHE_READY', 'CLOSE_CONFIRMED')
            ) AS participants_ready_count,
            (
                SELECT COUNT(*)::bigint
                FROM shift_participants sp
                WHERE sp.tenant_id = s.tenant_id
                  AND sp.shift_id = s.id
            ) AS participants_invited_count,
            (
                SELECT COUNT(*)::bigint
                FROM shift_participants sp
                WHERE sp.tenant_id = s.tenant_id
                  AND sp.shift_id = s.id
                  AND sp.status <> 'DECLINED'
            ) AS participants_count,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND mw.malfunction_description IS NOT NULL
            ) AS malfunctioning_count,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
            ) AS maintenances_synced
        FROM shifts s
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users lu
          ON lu.tenant_id = s.tenant_id
         AND lu.id = s.lead_user_id
        WHERE s.tenant_id = $1
          AND s.status IN ('INVITING', 'READY_TO_START', 'IN_PROGRESS', 'CLOSE_REQUESTED', 'READY_TO_COMMIT')
        ORDER BY COALESCE(s.started_at, s.created_at) DESC, s.created_at DESC, s.id DESC
        "#,
    )
    .bind(user.tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    let past = sqlx::query_as::<_, AdminPastShiftRow>(
        r#"
        SELECT
            s.id AS shift_id,
            s.status::text AS status,
            COALESCE(s.started_at, s.created_at) AS date,
            s.started_at,
            COALESCE(s.committed_at, s.close_requested_at) AS finished_at,
            b.name AS building_name,
            lu.full_name AS lead_user_name,
            (
                SELECT COUNT(*)::bigint
                FROM shift_participants sp
                WHERE sp.tenant_id = s.tenant_id
                  AND sp.shift_id = s.id
                  AND sp.status <> 'DECLINED'
            ) AS participants_count,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND mw.malfunction_description IS NOT NULL
            ) AS malfunctioning_count,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
            ) AS maintenances_count,
            (
                SELECT ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(mw.finished_at, mw.aborted_at) - mw.started_at)) / 60.0)::numeric, 1)::double precision
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND COALESCE(mw.finished_at, mw.aborted_at) IS NOT NULL
            ) AS avg_maintenance_minutes,
            (s.report_url IS NOT NULL) AS report_ready
        FROM shifts s
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users lu
          ON lu.tenant_id = s.tenant_id
         AND lu.id = s.lead_user_id
        WHERE s.tenant_id = $1
          AND s.status IN ('COMMITTED', 'CANCELLED')
        ORDER BY COALESCE(s.started_at, s.created_at) DESC, s.id DESC
        "#,
    )
    .bind(user.tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(AdminShiftListResponse { live, past }))
}

pub async fn get_admin_shift_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_admin(&user)?;

    let detail = sqlx::query_as::<_, AdminShiftDetailCore>(
        r#"
        SELECT
            s.id AS shift_id,
            s.status::text AS status,
            b.name AS building_name,
            b.address AS building_address,
            lu.full_name AS shift_lead_name,
            s.created_at,
            s.started_at,
            s.close_requested_at AS closed_at,
            s.committed_at AS finished_at,
            (
                SELECT ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(mw.finished_at, mw.aborted_at) - mw.started_at)) / 60.0)::numeric, 1)::double precision
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND COALESCE(mw.finished_at, mw.aborted_at) IS NOT NULL
            ) AS avg_maintenance_pace_minutes,
            (
                SELECT COUNT(*)::bigint
                FROM shift_participants sp
                WHERE sp.tenant_id = s.tenant_id
                  AND sp.shift_id = s.id
                  AND sp.status <> 'DECLINED'
            ) AS participants_count,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
            ) AS total_maintenances,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND mw.followup_service_required = TRUE
            ) AS total_followup_service,
            s.report_url,
            (s.report_url IS NOT NULL) AS report_ready
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
    .map_err(ApiError::internal)?;

    let Some(detail) = detail else {
        return Err(ApiError::forbidden("shift not found for current tenant"));
    };

    let participants = sqlx::query_as::<_, AdminShiftParticipantRow>(
        r#"
        SELECT
            sp.user_id,
            u.full_name,
            u.role::text AS role,
            sp.status::text AS status,
            sp.invited_at,
            sp.accepted_at,
            sp.cache_ready_at,
            sp.close_confirmed_at
        FROM shift_participants sp
        JOIN users u
          ON u.tenant_id = sp.tenant_id
         AND u.id = sp.user_id
        WHERE sp.tenant_id = $1
          AND sp.shift_id = $2
        ORDER BY
            CASE WHEN sp.user_id = (
                SELECT lead_user_id
                FROM shifts
                WHERE tenant_id = $1 AND id = $2
            ) THEN 0 ELSE 1 END,
            u.full_name ASC,
            sp.user_id ASC
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    let maintenances = sqlx::query_as::<_, AdminShiftMaintenanceRow>(
        r#"
        SELECT
            mw.id AS maintenance_id,
            bc.code AS barcode,
            d.kind::text AS kind,
            d.brand,
            d.model,
            l.floor,
            l.wing,
            l.room,
            l.location_description,
            mu.full_name AS maintainer_user_name,
            mw.started_at,
            COALESCE(mw.finished_at, mw.aborted_at) AS ended_at,
            mw.followup_service_required,
            (mw.note IS NOT NULL AND NULLIF(BTRIM(mw.note), '') IS NOT NULL) AS has_notes
        FROM maintenance_works mw
        JOIN devices d
          ON d.tenant_id = mw.tenant_id
         AND d.id = mw.device_id
        LEFT JOIN site_locations l
          ON l.tenant_id = d.tenant_id
         AND l.id = d.location_id
        LEFT JOIN barcodes bc
          ON bc.tenant_id = d.tenant_id
         AND bc.device_id = d.id
         AND bc.deactivated_at IS NULL
        JOIN users mu
          ON mu.tenant_id = mw.tenant_id
         AND mu.id = mw.maintainer_user_id
        WHERE mw.tenant_id = $1
          AND mw.shift_id = $2
        ORDER BY mw.started_at ASC, mw.id ASC
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(AdminShiftDetailResponse {
        shift_id: detail.shift_id,
        status: detail.status,
        building_name: detail.building_name,
        building_address: detail.building_address,
        shift_lead_name: detail.shift_lead_name,
        created_at: detail.created_at,
        started_at: detail.started_at,
        closed_at: detail.closed_at,
        finished_at: detail.finished_at,
        avg_maintenance_pace_minutes: detail.avg_maintenance_pace_minutes,
        participants_count: detail.participants_count,
        total_maintenances: detail.total_maintenances,
        total_followup_service: detail.total_followup_service,
        report_url: detail.report_url,
        report_ready: detail.report_ready,
        participants,
        maintenances,
    }))
}

pub async fn get_admin_maintenance_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((shift_id, maintenance_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_admin(&user)?;

    let detail = sqlx::query_as::<_, AdminMaintenanceDetailCore>(
        r#"
        SELECT
            mw.id AS maintenance_id,
            mw.shift_id,
            mw.status::text AS maintenance_status,
            bc.code AS barcode,
            d.kind::text AS kind,
            d.brand,
            d.model,
            d.serial_number,
            d.source_device_code,
            mu.full_name AS maintainer_user_name,
            mw.started_at,
            mw.finished_at,
            mw.aborted_at,
            mw.malfunction_description,
            mw.followup_service_required,
            ARRAY(SELECT UNNEST(mw.followup_service_reasons)::text) AS followup_service_reasons,
            mw.followup_service_reason_other,
            mw.note,
            b.name AS building_name,
            b.address AS building_address,
            l.floor,
            l.wing,
            l.room,
            l.location_description
        FROM maintenance_works mw
        JOIN shifts s
          ON s.tenant_id = mw.tenant_id
         AND s.id = mw.shift_id
        JOIN devices d
          ON d.tenant_id = mw.tenant_id
         AND d.id = mw.device_id
        LEFT JOIN site_locations l
          ON l.tenant_id = d.tenant_id
         AND l.id = d.location_id
        LEFT JOIN barcodes bc
          ON bc.tenant_id = d.tenant_id
         AND bc.device_id = d.id
         AND bc.deactivated_at IS NULL
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users mu
          ON mu.tenant_id = mw.tenant_id
         AND mu.id = mw.maintainer_user_id
        WHERE mw.tenant_id = $1
          AND mw.shift_id = $2
          AND mw.id = $3
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(maintenance_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("maintenance not found for current tenant"))?;

    let photos = sqlx::query_as::<_, AdminMaintenancePhotoRow>(
        r#"
        SELECT
            mp.id AS photo_id,
            mp.photo_type::text AS photo_type,
            FORMAT(
                '/api/admin/shifts/%s/maintenances/%s/photos/%s',
                $2::text,
                $3::text,
                mp.id::text
            ) AS photo_url,
            mp.capture_note,
            mp.created_at AS captured_at
        FROM maintenance_photos mp
        WHERE mp.tenant_id = $1
          AND mp.maintenance_work_id = $3
        ORDER BY mp.created_at ASC, mp.id ASC
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(maintenance_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(AdminMaintenanceDetailResponse {
        maintenance_id: detail.maintenance_id,
        shift_id: detail.shift_id,
        maintenance_status: detail.maintenance_status,
        barcode: detail.barcode,
        kind: detail.kind,
        brand: detail.brand,
        model: detail.model,
        serial_number: detail.serial_number,
        source_device_code: detail.source_device_code,
        maintainer_user_name: detail.maintainer_user_name,
        started_at: detail.started_at,
        finished_at: detail.finished_at,
        aborted_at: detail.aborted_at,
        malfunction_description: detail.malfunction_description,
        followup_service_required: detail.followup_service_required,
        followup_service_reasons: detail.followup_service_reasons,
        followup_service_reason_other: detail.followup_service_reason_other,
        note: detail.note,
        building_name: detail.building_name,
        building_address: detail.building_address,
        floor: detail.floor,
        wing: detail.wing,
        room: detail.room,
        location_description: detail.location_description,
        photos,
    }))
}

pub async fn get_admin_maintenance_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((shift_id, maintenance_id, photo_id)): Path<(uuid::Uuid, uuid::Uuid, uuid::Uuid)>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let storage = state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("device photo storage is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_admin(&user)?;

    let object_name = sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT mp.photo_url
        FROM maintenance_photos mp
        JOIN maintenance_works mw
          ON mw.tenant_id = mp.tenant_id
         AND mw.id = mp.maintenance_work_id
        WHERE mp.tenant_id = $1
          AND mw.shift_id = $2
          AND mw.id = $3
          AND mp.id = $4
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(maintenance_id)
    .bind(photo_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .flatten()
    .ok_or_else(|| ApiError::forbidden("maintenance photo not found for current tenant"))?;

    let metadata = Object::read(&storage.bucket, &object_name)
        .await
        .map_err(ApiError::internal)?;
    let bytes = Object::download(&storage.bucket, &object_name)
        .await
        .map_err(ApiError::internal)?;
    let content_type = metadata
        .content_type
        .unwrap_or_else(|| "application/octet-stream".to_string());

    Ok(([(header::CONTENT_TYPE, content_type)], bytes))
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
            s.building_id,
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
          AND s.status IN ('INVITING', 'READY_TO_START', 'IN_PROGRESS', 'CLOSE_REQUESTED', 'READY_TO_COMMIT')
        ORDER BY
          CASE
            WHEN s.status IN ('IN_PROGRESS', 'CLOSE_REQUESTED', 'READY_TO_COMMIT') THEN 0
            ELSE 1
          END,
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

pub async fn get_shift_maintenance_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let shift_core = sqlx::query_as::<_, (String, String, uuid::Uuid, String)>(
        r#"
        SELECT
            s.status::text AS status,
            b.name AS building_name,
            s.lead_user_id,
            lu.full_name AS lead_user_name
        FROM shifts s
        JOIN shift_participants sp
          ON sp.tenant_id = s.tenant_id
         AND sp.shift_id = s.id
         AND sp.user_id = $3
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
    .bind(user.id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    let Some((shift_status, building_name, lead_user_id, lead_user_name)) = shift_core else {
        return Err(ApiError::forbidden("shift not found for current user"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "only the shift lead can view the maintenance summary",
        ));
    }

    let maintenances = sqlx::query_as::<_, ShiftMaintenanceSummaryRow>(
        r#"
        SELECT
            mw.id AS maintenance_id,
            mu.full_name AS maintainer_user_name,
            mw.status::text AS maintenance_status,
            mw.started_at,
            mw.finished_at,
            mw.aborted_at,
            mw.malfunction_description,
            mw.note,
            d.id AS device_id,
            bc.code AS device_code,
            d.kind::text AS device_kind,
            d.additional_info AS device_additional_info,
            d.brand AS device_brand,
            d.model AS device_model,
            d.serial_number AS device_serial_number,
            d.source_device_code,
            b.name AS building_name,
            b.address AS building_address,
            l.floor,
            l.wing,
            l.room,
            l.location_description
        FROM maintenance_works mw
        JOIN shifts s
          ON s.tenant_id = mw.tenant_id
         AND s.id = mw.shift_id
        JOIN devices d
          ON d.tenant_id = mw.tenant_id
         AND d.id = mw.device_id
        LEFT JOIN site_locations l
          ON l.tenant_id = d.tenant_id
         AND l.id = d.location_id
        LEFT JOIN barcodes bc
          ON bc.tenant_id = d.tenant_id
         AND bc.device_id = d.id
         AND bc.deactivated_at IS NULL
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users mu
          ON mu.tenant_id = mw.tenant_id
         AND mu.id = mw.maintainer_user_id
        WHERE mw.tenant_id = $1
          AND mw.shift_id = $2
        ORDER BY mw.started_at ASC, mw.id ASC
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(ShiftMaintenanceSummaryResponse {
        shift_id,
        shift_status,
        building_name,
        lead_user_id,
        lead_user_name,
        maintenances,
    }))
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

pub async fn upload_shift_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let storage = state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("signature storage is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    if body.is_empty() {
        return Err(ApiError::bad_request("signature image body is required"));
    }
    if body.len() > 5 * 1024 * 1024 {
        return Err(ApiError::bad_request("signature image is too large"));
    }

    let content_type = image_content_type(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
    )?;

    if content_type.as_ref() != "image/png" {
        return Err(ApiError::bad_request("signature image must be a PNG"));
    }

    let shift_row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        r#"
        SELECT lead_user_id, status::text AS status
        FROM shifts
        WHERE tenant_id = $1
          AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    let Some((lead_user_id, status)) = shift_row else {
        return Err(ApiError::forbidden("shift not found for current tenant"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "only the shift lead can upload the signature",
        ));
    }

    if status != "READY_TO_COMMIT" {
        return Err(ApiError::conflict(
            "signature upload is only allowed while shift is ready to commit",
        ));
    }

    let object_name = shift_signature_object_name(storage, user.tenant_id, shift_id);
    Object::create(
        &storage.bucket,
        body.to_vec(),
        &object_name,
        content_type.as_ref(),
    )
    .await
    .map_err(ApiError::internal)?;

    Ok((
        StatusCode::OK,
        Json(UploadShiftSignatureResponse {
            signature_image_url: object_name,
        }),
    )
        .into_response())
}

pub async fn commit_shift(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
    Json(payload): Json<CommitShiftRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let reference_person_name = payload.reference_person_name.trim();
    if reference_person_name.is_empty() {
        return Err(ApiError::bad_request("reference person name is required"));
    }

    let reference_person_role = payload.reference_person_role.trim();
    if reference_person_role.is_empty() {
        return Err(ApiError::bad_request("reference person role is required"));
    }

    let signature_image_url = payload.signature_image_url.trim();
    if signature_image_url.is_empty() {
        return Err(ApiError::bad_request("signature image is required"));
    }

    let has_signature = payload
        .signature_strokes
        .iter()
        .flatten()
        .any(|point| point.x.is_finite() && point.y.is_finite());
    if !has_signature {
        return Err(ApiError::bad_request("signature is required"));
    }

    let signature_json =
        serde_json::to_string(&payload.signature_strokes).map_err(ApiError::internal)?;

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
        return Err(ApiError::forbidden("shift not found for current tenant"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "only the shift lead can commit the shift",
        ));
    }

    if status != "READY_TO_COMMIT" {
        return Err(ApiError::conflict(
            "shift can only be committed after all close confirmations are complete",
        ));
    }

    sqlx::query(
        r#"
        INSERT INTO shift_signatures (
            shift_id,
            tenant_id,
            reference_person_name,
            reference_person_role,
            signature_json,
            signature_image_url
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (shift_id) DO UPDATE
        SET reference_person_name = EXCLUDED.reference_person_name,
            reference_person_role = EXCLUDED.reference_person_role,
            signature_json = EXCLUDED.signature_json,
            signature_image_url = EXCLUDED.signature_image_url
        "#,
    )
    .bind(shift_id)
    .bind(user.tenant_id)
    .bind(reference_person_name)
    .bind(reference_person_role)
    .bind(signature_json)
    .bind(signature_image_url)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let updated = sqlx::query(
        r#"
        UPDATE shifts
        SET status = 'COMMITTED',
            committed_at = COALESCE(committed_at, NOW())
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'READY_TO_COMMIT'
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() == 0 {
        return Err(ApiError::conflict("shift could not be committed"));
    }

    tx.commit().await.map_err(ApiError::internal)?;

    Ok(StatusCode::NO_CONTENT)
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
        return Err(ApiError::forbidden(
            "shift invitation not found for current user",
        ));
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
        return Err(ApiError::forbidden(
            "only the shift lead can start the shift",
        ));
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

pub async fn request_shift_close(
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
        return Err(ApiError::forbidden("shift not found or cannot be closed"));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden("only the shift lead can request close"));
    }

    if status != "IN_PROGRESS" {
        return Err(ApiError::conflict(
            "shift close can only be requested while shift is in progress",
        ));
    }

    sqlx::query(
        r#"
        UPDATE shifts
        SET status = 'CLOSE_REQUESTED',
            close_requested_at = COALESCE(close_requested_at, NOW())
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'IN_PROGRESS'
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

pub async fn confirm_shift_close(
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

    let shift_status: Option<String> = sqlx::query_scalar(
        r#"
        SELECT status::text
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

    let Some(shift_status) = shift_status else {
        return Err(ApiError::forbidden("shift not found for current tenant"));
    };

    if !matches!(shift_status.as_str(), "CLOSE_REQUESTED" | "READY_TO_COMMIT") {
        return Err(ApiError::conflict(
            "shift close confirmation is only allowed after close request",
        ));
    }

    let open_work_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM maintenance_works
        WHERE tenant_id = $1
          AND shift_id = $2
          AND maintainer_user_id = $3
          AND status = 'IN_PROGRESS'
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if open_work_count > 0 {
        return Err(ApiError::conflict(
            "all ongoing maintenance must be finished before close confirmation",
        ));
    }

    let updated = sqlx::query(
        r#"
        UPDATE shift_participants
        SET status = 'CLOSE_CONFIRMED',
            close_confirmed_at = COALESCE(close_confirmed_at, NOW())
        WHERE tenant_id = $1
          AND shift_id = $2
          AND user_id = $3
          AND status IN ('CACHE_READY', 'CLOSE_CONFIRMED')
        "#,
    )
    .bind(user.tenant_id)
    .bind(shift_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() == 0 {
        return Err(ApiError::forbidden(
            "shift participant not eligible for close confirmation",
        ));
    }

    refresh_shift_close_state_tx(&mut tx, user.tenant_id, shift_id).await?;
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
        return Err(ApiError::forbidden(
            "shift not found or cannot be cancelled",
        ));
    };

    if lead_user_id != user.id {
        return Err(ApiError::forbidden(
            "shift not found or cannot be cancelled",
        ));
    }

    if matches!(status.as_str(), "CANCELLED" | "COMMITTED") {
        return Err(ApiError::conflict(
            "shift is already closed and cannot be cancelled",
        ));
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
        return Err(ApiError::forbidden(
            "shift not found or cannot be cancelled",
        ));
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

async fn refresh_shift_close_state_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
) -> Result<(), ApiError> {
    let remaining_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM shift_participants
        WHERE tenant_id = $1
          AND shift_id = $2
          AND status <> 'DECLINED'
          AND status <> 'CLOSE_CONFIRMED'
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    let next_status = if remaining_count == 0 {
        "READY_TO_COMMIT"
    } else {
        "CLOSE_REQUESTED"
    };

    sqlx::query(
        r#"
        UPDATE shifts
        SET status = $3::shift_status
        WHERE tenant_id = $1
          AND id = $2
          AND status IN ('CLOSE_REQUESTED', 'READY_TO_COMMIT')
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
