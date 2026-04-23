use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use cloud_storage::Object;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
pub struct CorrectBarcodeRequest {
    #[serde(rename = "targetDeviceId")]
    target_device_id: uuid::Uuid,
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
    #[serde(rename = "isMaintainable")]
    is_maintainable: Option<bool>,
}

#[derive(Deserialize)]
pub struct CreateDeviceLocationRequest {
    floor: Option<String>,
    wing: Option<String>,
    room: Option<String>,
    #[serde(rename = "locationDescription")]
    location_description: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateDeviceRequest {
    #[serde(rename = "buildingId")]
    building_id: uuid::Uuid,
    #[serde(rename = "existingLocationId")]
    existing_location_id: Option<uuid::Uuid>,
    location: Option<CreateDeviceLocationRequest>,
    kind: String,
    brand: Option<String>,
    model: Option<String>,
    #[serde(rename = "serialNumber")]
    serial_number: Option<String>,
    #[serde(rename = "sourceDeviceCode")]
    source_device_code: Option<String>,
    #[serde(rename = "additionalInfo")]
    additional_info: Option<String>,
    barcode: Option<String>,
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

#[derive(sqlx::FromRow)]
struct CachedDeviceRow {
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
    original_kind: Option<String>,
    is_maintainable: bool,
    barcode_count: i64,
    maintenance_work_count: i64,
}

#[derive(Serialize)]
struct CachedBarcodeHistoryEntry {
    code: String,
    created_at: String,
    deactivated_at: Option<String>,
    created_by: Option<String>,
}

#[derive(sqlx::FromRow)]
struct CachedBarcodeHistoryRow {
    device_id: uuid::Uuid,
    code: String,
    created_at: String,
    deactivated_at: Option<String>,
    created_by: Option<String>,
}

#[derive(sqlx::FromRow)]
struct DeviceCorrectionStats {
    barcode_count: i64,
    maintenance_work_count: i64,
    device_photo_url: Option<String>,
}

#[derive(Serialize)]
struct CachedDevice {
    id: uuid::Uuid,
    location_id: Option<uuid::Uuid>,
    code: Option<String>,
    barcode_count: i64,
    maintenance_work_count: i64,
    kind: String,
    additional_info: Option<String>,
    brand: Option<String>,
    model: Option<String>,
    serial_number: Option<String>,
    source_device_code: Option<String>,
    device_photo_url: Option<String>,
    original_kind: Option<String>,
    is_maintainable: bool,
    barcode_history: Vec<CachedBarcodeHistoryEntry>,
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
struct BarcodeCorrectionResponse {
    source_device_id: uuid::Uuid,
    target_device_id: uuid::Uuid,
    source_code: String,
    target_code: Option<String>,
    moved_maintenance_work_count: i64,
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

#[derive(Serialize)]
struct CreateDeviceResponse {
    device_id: uuid::Uuid,
    location_id: uuid::Uuid,
}

#[derive(Serialize)]
struct CreateLocationResponse {
    location_id: uuid::Uuid,
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

    let device_rows = sqlx::query_as::<_, CachedDeviceRow>(
        r#"
        SELECT
            d.id,
            d.location_id,
            b.code,
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM barcodes all_b
                    WHERE all_b.tenant_id = d.tenant_id
                      AND all_b.device_id = d.id
                ),
                0
            ) AS barcode_count,
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM maintenance_works mw
                    WHERE mw.tenant_id = d.tenant_id
                      AND mw.device_id = d.id
                ),
                0
            ) AS maintenance_work_count,
            d.kind::text AS kind,
            d.additional_info,
            d.brand,
            d.model,
            d.serial_number,
            d.source_device_code,
            CASE
                WHEN d.device_photo_url IS NULL THEN NULL
                ELSE CONCAT('/api/labeling/devices/', d.id::text, '/photo')
            END AS device_photo_url,
            d.original_kind,
            d.is_maintainable
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

    let barcode_history_rows = sqlx::query_as::<_, CachedBarcodeHistoryRow>(
        r#"
        SELECT
            b.device_id,
            b.code,
            b.created_at::text AS created_at,
            b.deactivated_at::text AS deactivated_at,
            creator.full_name AS created_by
        FROM barcodes b
        JOIN devices d
          ON d.tenant_id = b.tenant_id
         AND d.id = b.device_id
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        LEFT JOIN users creator
          ON creator.tenant_id = b.tenant_id
         AND creator.id = b.created_by
        WHERE b.tenant_id = $1
          AND sl.building_id = $2
        ORDER BY b.device_id, b.created_at DESC, b.id DESC
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)?;

    let mut barcode_history_by_device: HashMap<uuid::Uuid, Vec<CachedBarcodeHistoryEntry>> =
        HashMap::new();
    for barcode_history in barcode_history_rows {
        barcode_history_by_device
            .entry(barcode_history.device_id)
            .or_default()
            .push(CachedBarcodeHistoryEntry {
                code: barcode_history.code,
                created_at: barcode_history.created_at,
                deactivated_at: barcode_history.deactivated_at,
                created_by: barcode_history.created_by,
            });
    }

    let devices = device_rows
        .into_iter()
        .map(|device| CachedDevice {
            id: device.id,
            location_id: device.location_id,
            code: device.code,
            barcode_count: device.barcode_count,
            maintenance_work_count: device.maintenance_work_count,
            kind: device.kind,
            additional_info: device.additional_info,
            brand: device.brand,
            model: device.model,
            serial_number: device.serial_number,
            source_device_code: device.source_device_code,
            device_photo_url: device.device_photo_url,
            original_kind: device.original_kind,
            is_maintainable: device.is_maintainable,
            barcode_history: barcode_history_by_device
                .remove(&device.id)
                .unwrap_or_default(),
        })
        .collect();

    Ok(Json(BuildingCacheResponse {
        building,
        locations,
        devices,
    }))
}

pub async fn create_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateDeviceRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    let building_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM buildings
        WHERE tenant_id = $1
          AND id = $2
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

    let kind = payload.kind.trim();
    if kind.is_empty() {
        return Err(ApiError::bad_request("device kind is required"));
    }

    if payload.existing_location_id.is_some() && payload.location.is_some() {
        return Err(ApiError::bad_request(
            "choose either an existing location or a new location payload",
        ));
    }

    let location_id = if let Some(existing_location_id) = payload.existing_location_id {
        let location_exists: Option<bool> = sqlx::query_scalar(
            r#"
            SELECT TRUE
            FROM site_locations
            WHERE tenant_id = $1
              AND id = $2
              AND building_id = $3
            "#,
        )
        .bind(user.tenant_id)
        .bind(existing_location_id)
        .bind(payload.building_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::internal)?;

        if location_exists.is_none() {
            return Err(ApiError::bad_request(
                "selected location does not belong to the selected building",
            ));
        }

        existing_location_id
    } else if let Some(location) = payload.location {
        if !has_any_location_value(&location) {
            return Err(ApiError::bad_request("location details are required"));
        }

        sqlx::query_scalar(
            r#"
            INSERT INTO site_locations (
                tenant_id,
                building_id,
                floor,
                wing,
                room,
                location_description,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
            "#,
        )
        .bind(user.tenant_id)
        .bind(payload.building_id)
        .bind(normalize_optional_text(location.floor))
        .bind(normalize_optional_text(location.wing))
        .bind(normalize_optional_text(location.room))
        .bind(normalize_optional_text(location.location_description))
        .bind(user.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(ApiError::internal)?
    } else {
        return Err(ApiError::bad_request("location is required"));
    };

    let device_insert = sqlx::query_scalar(
        r#"
        INSERT INTO devices (
            tenant_id,
            location_id,
            kind,
            brand,
            model,
            serial_number,
            source_device_code,
            additional_info,
            created_by
        )
        VALUES ($1, $2, $3::device_kind, $4, $5, $6, $7, $8, $9)
        RETURNING id
        "#,
    )
    .bind(user.tenant_id)
    .bind(location_id)
    .bind(kind)
    .bind(normalize_optional_text(payload.brand))
    .bind(normalize_optional_text(payload.model))
    .bind(normalize_optional_text(payload.serial_number))
    .bind(normalize_optional_text(payload.source_device_code))
    .bind(normalize_optional_text(payload.additional_info))
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await;

    let device_id: uuid::Uuid = device_insert.map_err(map_device_details_update_error)?;

    let barcode = normalize_optional_text(payload.barcode);
    if let Some(barcode) = barcode {
        let existing_code_owner: Option<Option<uuid::Uuid>> = sqlx::query_scalar(
            r#"
            SELECT device_id
            FROM barcodes
            WHERE tenant_id = $1
              AND code = $2
            "#,
        )
        .bind(user.tenant_id)
        .bind(&barcode)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::internal)?;

        if let Some(Some(existing_device_id)) = existing_code_owner
            && existing_device_id != device_id
        {
            return Err(ApiError::conflict(
                "barcode has already been used and cannot be reassigned",
            ));
        }

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
        .bind(barcode)
        .bind(device_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::internal)?;
    }

    tx.commit().await.map_err(ApiError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateDeviceResponse {
            device_id,
            location_id,
        }),
    ))
}

pub async fn create_labeling_location(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(building_id): Path<uuid::Uuid>,
    Json(payload): Json<CreateDeviceLocationRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;

    if !has_any_location_value(&payload) {
        return Err(ApiError::bad_request("location details are required"));
    }

    let building_exists: Option<bool> = sqlx::query_scalar(
        r#"
        SELECT TRUE
        FROM buildings
        WHERE tenant_id = $1
          AND id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    if building_exists.is_none() {
        return Err(ApiError::forbidden("building not found for current tenant"));
    }

    let location_id: uuid::Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO site_locations (
            tenant_id,
            building_id,
            floor,
            wing,
            room,
            location_description,
            created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(user.tenant_id)
    .bind(building_id)
    .bind(normalize_optional_text(payload.floor))
    .bind(normalize_optional_text(payload.wing))
    .bind(normalize_optional_text(payload.room))
    .bind(normalize_optional_text(payload.location_description))
    .bind(user.id)
    .fetch_one(pool)
    .await
    .map_err(ApiError::internal)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateLocationResponse { location_id }),
    ))
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
            additional_info = $8,
            is_maintainable = COALESCE($9, is_maintainable)
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
    .bind(payload.is_maintainable)
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
    if let Some(replayed) =
        get_processed_mutation_response_tx(&mut tx, user.tenant_id, &endpoint_key, &mutation_id)
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
            "barcode has already been used and cannot be reassigned",
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

pub async fn correct_labeling_device_barcode(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(source_device_id): Path<uuid::Uuid>,
    Json(payload): Json<CorrectBarcodeRequest>,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    let mutation_id = require_mutation_id(&headers)?;
    let target_device_id = payload.target_device_id;

    if source_device_id == target_device_id {
        return Err(ApiError::bad_request(
            "source and target devices must be different",
        ));
    }

    let endpoint_key =
        format!("LABELING_DEVICE_BARCODE_CORRECTION:{source_device_id}:{target_device_id}");
    let mut tx = pool.begin().await.map_err(ApiError::internal)?;

    if let Some(replayed) =
        get_processed_mutation_response_tx(&mut tx, user.tenant_id, &endpoint_key, &mutation_id)
            .await?
    {
        return Ok(replayed);
    }

    let source_stats: Option<DeviceCorrectionStats> = sqlx::query_as(
        r#"
        SELECT
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM barcodes b
                    WHERE b.tenant_id = d.tenant_id
                      AND b.device_id = d.id
                ),
                0
            ) AS barcode_count,
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM maintenance_works mw
                    WHERE mw.tenant_id = d.tenant_id
                      AND mw.device_id = d.id
                ),
                0
            ) AS maintenance_work_count,
            d.device_photo_url
        FROM devices d
        WHERE d.tenant_id = $1
          AND d.id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(source_device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let target_stats: Option<DeviceCorrectionStats> = sqlx::query_as(
        r#"
        SELECT
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM barcodes b
                    WHERE b.tenant_id = d.tenant_id
                      AND b.device_id = d.id
                ),
                0
            ) AS barcode_count,
            COALESCE(
                (
                    SELECT COUNT(*)
                    FROM maintenance_works mw
                    WHERE mw.tenant_id = d.tenant_id
                      AND mw.device_id = d.id
                ),
                0
            ) AS maintenance_work_count,
            d.device_photo_url
        FROM devices d
        WHERE d.tenant_id = $1
          AND d.id = $2
        "#,
    )
    .bind(user.tenant_id)
    .bind(target_device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(source_stats) = source_stats else {
        return Err(ApiError::forbidden(
            "source device not found for current tenant",
        ));
    };

    let Some(target_stats) = target_stats else {
        return Err(ApiError::forbidden(
            "target device not found for current tenant",
        ));
    };

    if source_stats.barcode_count < 1 {
        return Err(ApiError::conflict(
            "source device has no assigned barcode to correct",
        ));
    }

    if !(target_stats.barcode_count == 0
        || target_stats.barcode_count == 1
        || target_stats.maintenance_work_count == 0)
    {
        return Err(ApiError::conflict(
            "target device is not eligible for barcode correction",
        ));
    }

    let source_active_code: Option<String> = sqlx::query_scalar(
        r#"
        SELECT code
        FROM barcodes
        WHERE tenant_id = $1
          AND device_id = $2
          AND deactivated_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(user.tenant_id)
    .bind(source_device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    let Some(source_code) = source_active_code else {
        return Err(ApiError::conflict(
            "source device has no active barcode to correct",
        ));
    };

    let target_active_code: Option<String> = sqlx::query_scalar(
        r#"
        SELECT code
        FROM barcodes
        WHERE tenant_id = $1
          AND device_id = $2
          AND deactivated_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        "#,
    )
    .bind(user.tenant_id)
    .bind(target_device_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    sqlx::query(
        r#"
        UPDATE barcodes
        SET deactivated_at = NOW()
        WHERE tenant_id = $1
          AND deactivated_at IS NULL
          AND (device_id = $2 OR device_id = $3)
        "#,
    )
    .bind(user.tenant_id)
    .bind(source_device_id)
    .bind(target_device_id)
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
    .bind(&source_code)
    .bind(target_device_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await
    .map_err(map_barcode_correction_error)?;

    if let Some(target_code) = &target_active_code
        && target_code != &source_code
    {
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
        .bind(target_code)
        .bind(source_device_id)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        .map_err(map_barcode_correction_error)?;
    }

    if let Some(source_photo_url) = &source_stats.device_photo_url {
        sqlx::query(
            r#"
            UPDATE devices
            SET device_photo_url = CASE
                WHEN id = $2 THEN NULL
                WHEN id = $3 THEN $4
                ELSE device_photo_url
            END
            WHERE tenant_id = $1
              AND id IN ($2, $3)
            "#,
        )
        .bind(user.tenant_id)
        .bind(source_device_id)
        .bind(target_device_id)
        .bind(source_photo_url)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::internal)?;
    }

    let moved_maintenance_work_count: i64 =
        if source_stats.maintenance_work_count > 0 && target_stats.maintenance_work_count == 0 {
            let moved = sqlx::query(
                r#"
                UPDATE maintenance_works
                SET device_id = $3
                WHERE tenant_id = $1
                  AND device_id = $2
                "#,
            )
            .bind(user.tenant_id)
            .bind(source_device_id)
            .bind(target_device_id)
            .execute(&mut *tx)
            .await
            .map_err(map_barcode_correction_error)?;

            moved.rows_affected() as i64
        } else {
            0
        };

    let response_payload = serde_json::json!(BarcodeCorrectionResponse {
        source_device_id,
        target_device_id,
        source_code,
        target_code: target_active_code,
        moved_maintenance_work_count,
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
        .and_then(|candidate| {
            if candidate.is_empty() {
                None
            } else {
                Some(candidate)
            }
        })
}

fn has_any_location_value(location: &CreateDeviceLocationRequest) -> bool {
    [
        location.floor.as_deref(),
        location.wing.as_deref(),
        location.room.as_deref(),
        location.location_description.as_deref(),
    ]
    .into_iter()
    .flatten()
    .any(|value| !value.trim().is_empty())
}

fn map_barcode_correction_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db_error) = &err {
        if db_error
            .constraint()
            .is_some_and(|name| name.starts_with("maintenance_works_one_active_per_"))
        {
            return ApiError::conflict(
                "maintenance works could not be reassigned because of an active maintenance conflict",
            );
        }

        let message = db_error.message().to_ascii_lowercase();
        if message.contains("frozen shift") {
            return ApiError::conflict("maintenance works of frozen shifts cannot be reassigned");
        }
    }

    ApiError::internal(err)
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
