use axum::Json;
use axum::response::{IntoResponse, Response};
use chrono::Utc;
use cloud_storage::{DownloadOptions, Object};
use serde::Serialize;

pub const TYPST_TEMPLATE_PREFIX: &str = "typst-templates";
pub const TYPST_TEMPLATE_ASSET_PREFIX: &str = "typst-templates/assets";

#[derive(Serialize)]
pub struct DownloadUrlResponse {
    pub download_url: String,
}

pub fn download_url_response(download_url: String) -> Response {
    Json(DownloadUrlResponse { download_url }).into_response()
}

pub fn typst_template_object_name(file_name: &str) -> String {
    format!("{TYPST_TEMPLATE_PREFIX}/{}", file_name.trim_start_matches('/'))
}

pub fn typst_template_asset_object_name(file_name: &str) -> String {
    format!("{TYPST_TEMPLATE_ASSET_PREFIX}/{}", file_name.trim_start_matches('/'))
}

pub fn signed_download_url(
    bucket: &str,
    object_name: &str,
    duration_secs: u32,
    attachment_filename: Option<&str>,
) -> anyhow::Result<String> {
    let object = signable_object(bucket, object_name);
    match attachment_filename {
        Some(filename) => {
            let content_disposition = percent_encode_query_value(&format!(
                "attachment; filename=\"{filename}\""
            ));

            object
                .download_url_with(
                    duration_secs,
                    DownloadOptions::new().content_disposition(&content_disposition),
                )
                .map_err(Into::into)
        }
        None => object.download_url(duration_secs).map_err(Into::into),
    }
}

pub fn signed_upload_url(
    bucket: &str,
    object_name: &str,
    duration_secs: u32,
) -> anyhow::Result<String> {
    signable_object(bucket, object_name)
        .upload_url(duration_secs)
        .map_err(Into::into)
}

fn signable_object(bucket: &str, object_name: &str) -> Object {
    let now = Utc::now();
    Object {
        kind: "storage#object".to_string(),
        id: format!("{bucket}/{object_name}"),
        self_link: String::new(),
        name: object_name.to_string(),
        bucket: bucket.to_string(),
        generation: 0,
        metageneration: 0,
        content_type: None,
        time_created: now,
        updated: now,
        time_deleted: None,
        temporary_hold: None,
        event_based_hold: None,
        retention_expiration_time: None,
        storage_class: "STANDARD".to_string(),
        time_storage_class_updated: now,
        size: 0,
        md5_hash: None,
        media_link: String::new(),
        content_encoding: None,
        content_disposition: None,
        content_language: None,
        cache_control: None,
        metadata: None,
        acl: None,
        owner: None,
        crc32c: String::new(),
        component_count: None,
        etag: String::new(),
        customer_encryption: None,
        kms_key_name: None,
    }
}

fn percent_encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }

    encoded
}
