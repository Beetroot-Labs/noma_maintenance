use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cloud_storage::Object;
use serde::{Deserialize, Serialize};

use crate::auth::require_session_user;
use crate::error::ApiError;
use crate::state::AppState;
use crate::storage::{device_photo_api_path, device_photo_object_name, image_content_type};
use crate::sync::{
    get_processed_mutation_response, get_processed_mutation_response_tx, require_mutation_id,
    save_processed_mutation_response, save_processed_mutation_response_tx,
};

#[derive(Deserialize)]
pub struct AssignBarcodeRequest {
    code: String,
}

#[derive(Deserialize)]
pub struct UpdateDeviceDetailsRequest {
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    #[serde(rename = "locationDescription")]
    location_description: Option<String>,
    kind: String,
    brand: Option<String>,
    model: Option<String>,
    #[serde(rename = "serialNumber")]
    serial_number: Option<String>,
    #[serde(rename = "sourceDeviceCode")]
    source_device_code: Option<String>,
    #[serde(rename = "additionalInfo")]
    additional_info: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct BuildingSummary {
    id: uuid::Uuid,
    name: String,
    address: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct CachedLocation {
    id: uuid::Uuid,
    building_id: uuid::Uuid,
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    location_description: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct CachedDevice {
    id: uuid::Uuid,
    location_id: Option<uuid::Uuid>,
    code: Option<String>,
    kind: String,
    additional_info: Option<String>,
    brand: Option<String>,
    model: Option<String>,
    serial_number: Option<String>,
    source_device_code: Option<String>,
    device_photo_url: Option<String>,
}

#[derive(Serialize)]
struct BuildingCacheResponse {
    building: BuildingSummary,
    locations: Vec<CachedLocation>,
    devices: Vec<CachedDevice>,
}

#[derive(Serialize)]
struct BarcodeAssignmentResponse {
    device_id: uuid::Uuid,
    code: String,
}

#[derive(Serialize)]
struct DevicePhotoResponse {
    device_id: uuid::Uuid,
    photo_url: String,
}

#[derive(Serialize)]
struct DeviceDetailsUpdateResponse {
    device_id: uuid::Uuid,
}

pub async fn list_labeling_buildings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let buildings = sqlx::query_as::<_, BuildingSummary>(
        r#"
        SELECT id, name, address
        FROM buildings
        WHERE tenant_id = $1
        ORDER BY name
        "#,
    )
    .bind(user.tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(buildings))
}

pub async fn get_labeling_building_cache(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(building_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    let building = sqlx::query_as::<_, BuildingSummary>(
        r#"
        SELECT id, name, address
        FROM buildings
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("building not found for current tenant"))?;

    let locations = sqlx::query_as::<_, CachedLocation>(
        r#"
        SELECT id, building_id, floor, wing, room, location_description
        FROM site_locations
        WHERE tenant_id = $1 AND building_id = $2
        ORDER BY floor NULLS FIRST, wing NULLS FIRST, room NULLS FIRST, created_at
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    let devices = sqlx::query_as::<_, CachedDevice>(
        r#"
        SELECT
            d.id,
            d.location_id,
            b.code,
            d.kind::text AS kind,
            d.additional_info,
            d.brand,
            d.model,
            d.serial_number,
            d.source_device_code,
            CASE
                WHEN d.device_photo_url IS NULL THEN NULL
                ELSE CONCAT('/api/labeling/devices/', d.id::text, '/photo')
            END AS device_photo_url
        FROM devices d
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        LEFT JOIN barcodes b
          ON b.tenant_id = d.tenant_id
         AND b.device_id = d.id
         AND b.deactivated_at IS NULL
        WHERE d.tenant_id = $1 AND sl.building_id = $2
        ORDER BY d.kind, d.brand NULLS FIRST, d.model NULLS FIRST, d.created_at
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok(Json(BuildingCacheResponse {
        building,
        locations,
        devices,
    }))
}

pub async fn upload_labeling_device_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<uuid::Uuid>,
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
    let endpoint_key = format!("LABELING_DEVICE_PHOTO_UPSERT:{device_id}");

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

    let object_name = device_photo_object_name(storage, user.tenant_id, device_id);

    let device_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM devices
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    if device_exists.is_none() {
        return Err(ApiError::forbidden("device not found for current tenant"));
    }

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
        UPDATE devices
        SET device_photo_url = $3
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .bind(&object_name)
    .execute(pool)
    .await
    .map_err(ApiError::internal)?;

    let payload = serde_json::json!(DevicePhotoResponse {
        device_id,
        photo_url: device_photo_api_path(device_id),
    });

    save_processed_mutation_response(
        pool,
        user.tenant_id,
        &endpoint_key,
        &mutation_id,
        StatusCode::OK,
        Some(payload.clone()),
    )
    .await?;

    Ok((StatusCode::OK, Json(payload)).into_response())
}

pub async fn get_labeling_device_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<uuid::Uuid>,
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

    let object_name = sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT device_photo_url
        FROM devices
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .flatten()
    .ok_or_else(|| ApiError::forbidden("device photo not found for current tenant"))?;

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

pub async fn delete_labeling_device_photo(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<uuid::Uuid>,
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
    let endpoint_key = format!("LABELING_DEVICE_PHOTO_DELETE:{device_id}");

    if let Some(replayed) =
        get_processed_mutation_response(pool, user.tenant_id, &endpoint_key, &mutation_id).await?
    {
        return Ok(replayed);
    }

    let object_name = sqlx::query_scalar::<_, Option<String>>(
        r#"
        SELECT device_photo_url
        FROM devices
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    let Some(object_name) = object_name.flatten() else {
        save_processed_mutation_response(
            pool,
            user.tenant_id,
            &endpoint_key,
            &mutation_id,
            StatusCode::NO_CONTENT,
            None,
        )
        .await?;
        return Ok(StatusCode::NO_CONTENT.into_response());
    };

    Object::delete(&storage.bucket, &object_name)
        .await
        .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        UPDATE devices
        SET device_photo_url = NULL
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .execute(pool)
    .await
    .map_err(ApiError::internal)?;

    save_processed_mutation_response(
        pool,
        user.tenant_id,
        &endpoint_key,
        &mutation_id,
        StatusCode::NO_CONTENT,
        None,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn update_labeling_device_details(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<uuid::Uuid>,
    Json(payload): Json<UpdateDeviceDetailsRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mutation_id = require_mutation_id(&headers)?;
    let endpoint_key = format!("LABELING_DEVICE_DETAILS_UPDATE:{device_id}");
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    if let Some(replayed) =
        get_processed_mutation_response_tx(&mut tx, user.tenant_id, &endpoint_key, &mutation_id)
            .await?
    {
        return Ok(replayed);
    }

    let kind = payload.kind.trim();
    if kind.is_empty() {
        return Err(ApiError::bad_request("device kind is required"));
    }

    let location_id: Option<Option<uuid::Uuid>> = sqlx::query_scalar(
        r#"
        SELECT location_id
        FROM devices
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(location_id) = location_id else {
        return Err(ApiError::forbidden("device not found for current tenant"));
    };

    let update_device_result = sqlx::query(
        r#"
        UPDATE devices
        SET
            kind = $3::device_kind,
            brand = $4,
            model = $5,
            serial_number = $6,
            source_device_code = $7,
            additional_info = $8
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .bind(kind)
    .bind(normalize_optional_text(payload.brand))
    .bind(normalize_optional_text(payload.model))
    .bind(normalize_optional_text(payload.serial_number))
    .bind(normalize_optional_text(payload.source_device_code))
    .bind(normalize_optional_text(payload.additional_info))
    .execute(&mut *tx)
    .await;

    if let Err(err) = update_device_result {
        return Err(map_device_details_update_error(err));
    }

    if let Some(location_id) = location_id {
        sqlx::query(
            r#"
            UPDATE site_locations
            SET
                floor = $3,
                wing = $4,
                room = $5,
                location_description = $6
            WHERE tenant_id = $1 AND id = $2
            "#,
        )
        .bind(user.tenant_id)
        .bind(location_id)
        .bind(normalize_optional_text(payload.floor))
        .bind(normalize_optional_text(payload.wing))
        .bind(normalize_optional_text(payload.room))
        .bind(normalize_optional_text(payload.location_description))
        .execute(&mut *tx)
        .await
        .map_err(ApiError::internal)?;
    }

    let response_payload = serde_json::json!(DeviceDetailsUpdateResponse { device_id });
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

pub async fn assign_labeling_device_barcode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<uuid::Uuid>,
    Json(payload): Json<AssignBarcodeRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mutation_id = require_mutation_id(&headers)?;
    let endpoint_key = format!("LABELING_DEVICE_BARCODE_ASSIGN:{device_id}");

    let code = payload.code.trim();
    if code.is_empty() {
        return Err(ApiError::bad_request("barcode is required"));
    }

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    if let Some(replayed) = get_processed_mutation_response_tx(
        &mut tx,
        user.tenant_id,
        &endpoint_key,
        &mutation_id,
    )
    .await?
    {
        return Ok(replayed);
    }

    let device_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM devices
        WHERE tenant_id = $1 AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if device_exists.is_none() {
        return Err(ApiError::forbidden("device not found for current tenant"));
    }

    let existing_code_owner: Option<Option<uuid::Uuid>> = sqlx::query_scalar(
        r#"
        SELECT device_id
        FROM barcodes
        WHERE tenant_id = $1
          AND code = $2
          AND deactivated_at IS NULL
        "#,
    )
    .bind(user.tenant_id)
    .bind(code)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    if let Some(Some(existing_device_id)) = existing_code_owner
        && existing_device_id != device_id
    {
        return Err(ApiError::conflict(
            "barcode is already assigned to another device",
        ));
    }

    sqlx::query(
        r#"
        UPDATE barcodes
        SET deactivated_at = NOW()
        WHERE tenant_id = $1
          AND device_id = $2
          AND deactivated_at IS NULL
          AND code <> $3
        "#,
    )
    .bind(user.tenant_id)
    .bind(device_id)
    .bind(code)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        INSERT INTO barcodes (tenant_id, code, device_id, deactivated_at, created_by)
        VALUES ($1, $2, $3, NULL, $4)
        ON CONFLICT (tenant_id, code) DO UPDATE
        SET device_id = EXCLUDED.device_id,
            deactivated_at = NULL
        "#,
    )
    .bind(user.tenant_id)
    .bind(code)
    .bind(device_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let response_payload = serde_json::json!(BarcodeAssignmentResponse {
        device_id,
        code: code.to_string(),
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

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_string())
        .and_then(|candidate| if candidate.is_empty() { None } else { Some(candidate) })
}

fn map_device_details_update_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_error) = &err {
        let message = db_error.message().to_ascii_lowercase();
        if message.contains("invalid input value for enum device_kind") {
            return ApiError::bad_request("invalid device kind");
        }
        if message.contains("duplicate key value") && message.contains("source_device_code") {
            return ApiError::conflict("source device code is already used by another device");
        }
    }

    ApiError::internal(err)
}
