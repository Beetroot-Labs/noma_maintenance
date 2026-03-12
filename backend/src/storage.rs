use std::borrow::Cow;

use crate::error::ApiError;
use crate::state::StorageConfig;

pub fn image_content_type(header_value: Option<&str>) -> Result<Cow<'static, str>, ApiError> {
    match header_value.map(str::trim) {
        Some("image/jpeg") => Ok(Cow::Borrowed("image/jpeg")),
        Some("image/png") => Ok(Cow::Borrowed("image/png")),
        Some("image/webp") => Ok(Cow::Borrowed("image/webp")),
        Some("image/heic") => Ok(Cow::Borrowed("image/heic")),
        Some("image/heif") => Ok(Cow::Borrowed("image/heif")),
        Some(other) if other.starts_with("image/") => Ok(Cow::Owned(other.to_string())),
        _ => Err(ApiError::bad_request("unsupported photo content type")),
    }
}

pub fn device_photo_object_name(
    storage: &StorageConfig,
    tenant_id: uuid::Uuid,
    device_id: uuid::Uuid,
) -> String {
    format!(
        "{}/tenants/{}/devices/{}/photo",
        storage.device_photo_prefix, tenant_id, device_id
    )
}

pub fn device_photo_api_path(device_id: uuid::Uuid) -> String {
    format!("/api/labeling/devices/{device_id}/photo")
}

pub fn maintenance_photo_object_name(
    storage: &StorageConfig,
    tenant_id: uuid::Uuid,
    maintenance_work_id: uuid::Uuid,
    photo_id: uuid::Uuid,
) -> String {
    format!(
        "{}/tenants/{}/maintenance-works/{}/photos/{}",
        storage.device_photo_prefix, tenant_id, maintenance_work_id, photo_id
    )
}

pub fn shift_signature_object_name(
    storage: &StorageConfig,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
) -> String {
    format!(
        "{}/tenants/{}/shifts/{}/signature",
        storage.shift_signature_prefix, tenant_id, shift_id
    )
}
