use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use cloud_storage::Object;
use serde::{Deserialize, Serialize};

use crate::auth::require_session_user;
use crate::error::ApiError;
use crate::state::AppState;
use crate::storage::{image_content_type, maintenance_photo_object_name};
use crate::sync::{
    get_processed_mutation_response, get_processed_mutation_response_tx, require_mutation_id,
    save_processed_mutation_response, save_processed_mutation_response_tx,
};

#[derive(Deserialize)]
pub struct SyncMaintenanceWorkRequest {
    shift_id: uuid::Uuid,
    device_id: uuid::Uuid,
    status: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    aborted_at: Option<DateTime<Utc>>,
    malfunction_description: Option<String>,
    followup_service_required: Option<bool>,
    followup_service_reasons: Option<Vec<String>>,
    followup_service_reason_other: Option<String>,
    note: Option<String>,
}

#[derive(Serialize)]
pub struct SyncMaintenanceWorkResponse {
    id: uuid::Uuid,
    status: String,
}

#[derive(Deserialize)]
pub struct UploadMaintenancePhotoQuery {
    capture_note: Option<String>,
    captured_at: Option<DateTime<Utc>>,
    photo_type: Option<String>,
}

#[derive(Serialize)]
pub struct UploadMaintenancePhotoResponse {
    id: uuid::Uuid,
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_work_status(status: &str) -> Result<&'static str, ApiError> {
    match status.trim().to_uppercase().as_str() {
        "IN_PROGRESS" => Ok("IN_PROGRESS"),
        "FINISHED" => Ok("FINISHED"),
        "ABORTED" => Ok("ABORTED"),
        _ => Err(ApiError::bad_request("invalid maintenance work status")),
    }
}

fn normalize_followup_reasons(reasons: Option<Vec<String>>) -> Result<Vec<String>, ApiError> {
    let mut normalized = Vec::new();

    for reason in reasons.unwrap_or_default() {
        let normalized_reason = match reason.trim().to_uppercase().as_str() {
            "MAIN_COMPONENT_REPLACEMENT" => "MAIN_COMPONENT_REPLACEMENT",
            "CLEANING" => "CLEANING",
            "DAMAGED" => "DAMAGED",
            "OTHER" => "OTHER",
            "FAULT_DIAGNOSIS_REQUIRED" => "FAULT_DIAGNOSIS_REQUIRED",
            "PERFORMANCE_DEGRADATION" => "PERFORMANCE_DEGRADATION",
            "ABNORMAL_ODOR" => "ABNORMAL_ODOR",
            "REFRIGERANT_LOW_OR_LEAK" => "REFRIGERANT_LOW_OR_LEAK",
            _ => return Err(ApiError::bad_request("invalid follow-up service reason")),
        };

        if !normalized
            .iter()
            .any(|existing| existing == normalized_reason)
        {
            normalized.push(normalized_reason.to_string());
        }
    }

    Ok(normalized)
}

fn normalize_photo_type(photo_type: Option<String>) -> Result<&'static str, ApiError> {
    match photo_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_uppercase)
        .as_deref()
    {
        Some("MALFUNCTION") => Ok("MALFUNCTION"),
        Some("MAINTENANCE") | None => Ok("MAINTENANCE"),
        _ => Err(ApiError::bad_request("invalid maintenance photo type")),
    }
}

async fn ensure_shift_sync_allowed_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
    user_id: uuid::Uuid,
) -> Result<(), ApiError> {
    let shift_status: Option<String> = sqlx::query_scalar(
        r#"
        SELECT s.status::text
        FROM shifts s
        JOIN shift_participants sp
          ON sp.tenant_id = s.tenant_id
         AND sp.shift_id = s.id
         AND sp.user_id = $3
        WHERE s.tenant_id = $1
          AND s.id = $2
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(status) = shift_status else {
        return Err(ApiError::forbidden(
            "current user is not a participant of this shift",
        ));
    };

    if !matches!(
        status.as_str(),
        "IN_PROGRESS" | "CLOSE_REQUESTED" | "READY_TO_COMMIT"
    ) {
        return Err(ApiError::forbidden(
            "maintenance sync is only allowed while shift is active",
        ));
    }

    Ok(())
}

pub async fn sync_maintenance_work(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(work_id): Path<uuid::Uuid>,
    Json(payload): Json<SyncMaintenanceWorkRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mutation_id = require_mutation_id(&headers)?;
    let endpoint_key = format!("MAINTENANCE_WORK_SYNC:{work_id}");
    let normalized_status = normalize_work_status(&payload.status)?;
    let malfunction_description = normalize_optional_text(payload.malfunction_description);
    let followup_service_required = payload.followup_service_required.unwrap_or(false);
    let followup_service_reasons = normalize_followup_reasons(payload.followup_service_reasons)?;
    let followup_service_reason_other =
        normalize_optional_text(payload.followup_service_reason_other);
    let note = normalize_optional_text(payload.note);

    if followup_service_required && followup_service_reasons.is_empty() {
        return Err(ApiError::bad_request(
            "at least one follow-up service reason is required",
        ));
    }

    if !followup_service_required && !followup_service_reasons.is_empty() {
        return Err(ApiError::bad_request(
            "follow-up reasons require follow-up service to be enabled",
        ));
    }

    let has_other_reason = followup_service_reasons
        .iter()
        .any(|reason| reason == "OTHER");
    if has_other_reason && followup_service_reason_other.is_none() {
        return Err(ApiError::bad_request(
            "other follow-up service reason text is required",
        ));
    }

    if !has_other_reason && followup_service_reason_other.is_some() {
        return Err(ApiError::bad_request(
            "other follow-up service reason text is only allowed with OTHER",
        ));
    }

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    if let Some(replayed) =
        get_processed_mutation_response_tx(&mut tx, user.tenant_id, &endpoint_key, &mutation_id)
            .await?
    {
        tx.commit().await.map_err(ApiError::internal)?;
        return Ok(replayed);
    }

    ensure_shift_sync_allowed_tx(&mut tx, user.tenant_id, payload.shift_id, user.id).await?;

    let device_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM devices
        WHERE tenant_id = $1
          AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(payload.device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if device_exists.is_none() {
        return Err(ApiError::forbidden("device not found for current tenant"));
    }

    let upsert_result = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        INSERT INTO maintenance_works (
            id,
            tenant_id,
            shift_id,
            device_id,
            maintainer_user_id,
            status,
            started_at,
            finished_at,
            aborted_at,
            malfunction_description,
            followup_service_required,
            followup_service_reasons,
            followup_service_reason_other,
            note
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6::maintenance_work_status,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12::maintenance_followup_reason[],
            $13,
            $14
        )
        ON CONFLICT (id) DO UPDATE
        SET
            shift_id = EXCLUDED.shift_id,
            device_id = EXCLUDED.device_id,
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            finished_at = EXCLUDED.finished_at,
            aborted_at = EXCLUDED.aborted_at,
            malfunction_description = EXCLUDED.malfunction_description,
            followup_service_required = EXCLUDED.followup_service_required,
            followup_service_reasons = EXCLUDED.followup_service_reasons,
            followup_service_reason_other = EXCLUDED.followup_service_reason_other,
            note = EXCLUDED.note
        WHERE maintenance_works.tenant_id = EXCLUDED.tenant_id
          AND maintenance_works.maintainer_user_id = EXCLUDED.maintainer_user_id
        RETURNING id
        "#,
    )
    .bind(work_id)
    .bind(user.tenant_id)
    .bind(payload.shift_id)
    .bind(payload.device_id)
    .bind(user.id)
    .bind(normalized_status)
    .bind(payload.started_at)
    .bind(payload.finished_at)
    .bind(payload.aborted_at)
    .bind(malfunction_description)
    .bind(followup_service_required)
    .bind(followup_service_reasons)
    .bind(followup_service_reason_other)
    .bind(note)
    .fetch_optional(&mut *tx)
    .await;

    let persisted_id = match upsert_result {
        Ok(Some(id)) => id,
        Ok(None) => {
            return Err(ApiError::forbidden(
                "maintenance work belongs to another tenant or maintainer",
            ));
        }
        Err(error) => {
            if let sqlx::Error::Database(db_error) = &error
                && db_error
                    .constraint()
                    .is_some_and(|name| name.starts_with("maintenance_works_one_active_per_"))
            {
                return Err(ApiError::conflict(
                    "maintenance work conflicts with another active maintenance",
                ));
            }
            return Err(ApiError::internal(error));
        }
    };

    let response_payload = serde_json::json!(SyncMaintenanceWorkResponse {
        id: persisted_id,
        status: normalized_status.to_string(),
    });

    save_processed_mutation_response_tx(
        &mut tx,
        user.tenant_id,
        &endpoint_key,
        &mutation_id,
        StatusCode::OK,
        Some(response_payload.clone()),
    )
    .await?;

    tx.commit().await.map_err(ApiError::internal)?;
    Ok((StatusCode::OK, Json(response_payload)).into_response())
}

pub async fn upload_maintenance_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((work_id, photo_id)): Path<(uuid::Uuid, uuid::Uuid)>,
    Query(query): Query<UploadMaintenancePhotoQuery>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let storage = state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("device photo storage is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mutation_id = require_mutation_id(&headers)?;
    let endpoint_key = format!("MAINTENANCE_PHOTO_UPSERT:{work_id}:{photo_id}");

    if let Some(replayed) =
        get_processed_mutation_response(pool, user.tenant_id, &endpoint_key, &mutation_id).await?
    {
        return Ok(replayed);
    }

    if body.is_empty() {
        return Err(ApiError::bad_request("photo body is required"));
    }
    if body.len() > 15 * 1024 * 1024 {
        return Err(ApiError::bad_request("photo is too large"));
    }

    let content_type = image_content_type(
        headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
    )?;
    let photo_type = normalize_photo_type(query.photo_type)?;
    let capture_note = normalize_optional_text(query.capture_note);

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let work: Option<(uuid::Uuid,)> = sqlx::query_as(
        r#"
        SELECT shift_id
        FROM maintenance_works
        WHERE tenant_id = $1
          AND id = $2
          AND maintainer_user_id = $3
        "#,
    )
    .bind(user.tenant_id)
    .bind(work_id)
    .bind(user.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some((shift_id,)) = work else {
        return Err(ApiError::forbidden(
            "maintenance work not found for current user",
        ));
    };

    ensure_shift_sync_allowed_tx(&mut tx, user.tenant_id, shift_id, user.id).await?;

    let object_name = maintenance_photo_object_name(storage, user.tenant_id, work_id, photo_id);
    Object::create(
        &storage.bucket,
        body.to_vec(),
        &object_name,
        content_type.as_ref(),
    )
    .await
    .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        INSERT INTO maintenance_photos (
            id,
            tenant_id,
            maintenance_work_id,
            photo_type,
            photo_url,
            capture_note,
            created_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4::maintenance_photo_type,
            $5,
            $6,
            COALESCE($7, NOW())
        )
        ON CONFLICT (id) DO UPDATE
        SET
            maintenance_work_id = EXCLUDED.maintenance_work_id,
            photo_type = EXCLUDED.photo_type,
            photo_url = EXCLUDED.photo_url,
            capture_note = EXCLUDED.capture_note
        WHERE maintenance_photos.tenant_id = EXCLUDED.tenant_id
        "#,
    )
    .bind(photo_id)
    .bind(user.tenant_id)
    .bind(work_id)
    .bind(photo_type)
    .bind(&object_name)
    .bind(capture_note)
    .bind(query.captured_at)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    tx.commit().await.map_err(ApiError::internal)?;

    let response_payload = serde_json::json!(UploadMaintenancePhotoResponse { id: photo_id });
    save_processed_mutation_response(
        pool,
        user.tenant_id,
        &endpoint_key,
        &mutation_id,
        StatusCode::OK,
        Some(response_payload.clone()),
    )
    .await?;

    Ok((StatusCode::OK, Json(response_payload)).into_response())
}
