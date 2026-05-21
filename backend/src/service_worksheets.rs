use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::Response;
use cloud_storage::Object;
use serde::Serialize;
use serde_json::json;
use sqlx::{Postgres, Transaction};
use std::io::{Cursor, Write};

use crate::auth::{require_lead_or_admin, require_session_user};
use crate::gcs::{
    download_url_response, signed_download_url, signed_upload_url, typst_template_asset_object_name,
    typst_template_object_name,
};
use crate::error::ApiError;
use crate::state::{AppState, StorageConfig};
use crate::storage::shift_service_worksheets_object_name;
use crate::typst_render::{RenderUriAsset, RenderUriRequest, RenderUriResponse, TypstRenderClient};

const SERVICE_WORKSHEET_TEMPLATE_FILENAME: &str = "service_worksheet.typ";
const SERVICE_WORKSHEET_LOGO_FILENAME: &str = "Noma_logo_color_text_vertical.png";
const SERVICE_WORKSHEET_LOGO_BUNDLE_PATH: &str = "logo.png";
const SERVICE_WORKSHEET_REFERENT_SIGNATURE_BUNDLE_PATH: &str = "referent_signature.png";
const PDF_SIGN_URL_TTL_SECS: u32 = 600;

#[derive(sqlx::FromRow)]
struct ServiceWorksheetShiftCore {
    shift_id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    service_worksheets_url: Option<String>,
    report_generated_at: String,
    shift_start_date: String,
    building_address: String,
    report_client: Option<String>,
    report_client_role: Option<String>,
    referent_signature_image_url: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ServiceWorksheetWorkRow {
    maintenance_id: uuid::Uuid,
    report_id: String,
    service_date: String,
    service_date_code: String,
    issue_number: String,
    device_code: String,
    device_barcode: String,
    room: String,
    device_type: String,
    device_brand: Option<String>,
    device_model: Option<String>,
    maintainer: String,
    note: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ServiceWorksheetPhotoRow {
    photo_id: uuid::Uuid,
    photo_url: String,
    capture_note: Option<String>,
}

#[derive(Serialize, Clone)]
struct ServiceWorksheetPhotoArg {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    caption: Option<String>,
}

struct ServiceWorksheetPhotoAsset {
    path: String,
    url: String,
    caption: Option<String>,
}

struct ServiceWorksheetSnapshot {
    core: ServiceWorksheetShiftCore,
    works: Vec<ServiceWorksheetWorkRow>,
}

fn map_filename_char(ch: char) -> Option<char> {
    match ch {
        'a'..='z' | 'A'..='Z' | '0'..='9' => Some(ch),
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => Some('a'),
        'Á' | 'À' | 'Â' | 'Ä' | 'Ã' | 'Å' | 'Ā' => Some('A'),
        'é' | 'è' | 'ê' | 'ë' | 'ē' => Some('e'),
        'É' | 'È' | 'Ê' | 'Ë' | 'Ē' => Some('E'),
        'í' | 'ì' | 'î' | 'ï' => Some('i'),
        'Í' | 'Ì' | 'Î' | 'Ï' => Some('I'),
        'ó' | 'ò' | 'ô' | 'ö' | 'ő' | 'ø' => Some('o'),
        'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Ő' | 'Ø' => Some('O'),
        'ú' | 'ù' | 'û' | 'ü' | 'ű' => Some('u'),
        'Ú' | 'Ù' | 'Û' | 'Ü' | 'Ű' => Some('U'),
        'ç' => Some('c'),
        'Ç' => Some('C'),
        'ñ' => Some('n'),
        'Ñ' => Some('N'),
        _ => None,
    }
}

fn sanitize_filename_component(value: &str) -> String {
    let mut output = String::new();
    let mut pending_separator = false;

    for ch in value.trim().chars() {
        if let Some(mapped) = map_filename_char(ch) {
            if pending_separator && !output.is_empty() {
                output.push('-');
            }
            output.push(mapped);
            pending_separator = false;
        } else if !output.is_empty() {
            pending_separator = true;
        }
    }

    output.trim_matches('-').to_string()
}

fn service_worksheet_filename(
    building_address: &str,
    service_date_code: &str,
    maintenance_id: uuid::Uuid,
) -> String {
    let building_address = sanitize_filename_component(building_address);
    let building_address = if building_address.is_empty() {
        "ismeretlen-helyszin".to_string()
    } else {
        building_address
    };

    let service_date_code = if service_date_code.trim().is_empty() {
        "00000000".to_string()
    } else {
        service_date_code.trim().to_string()
    };

    let maintenance_id_short = maintenance_id
        .to_string()
        .replace('-', "")
        .chars()
        .take(8)
        .collect::<String>();

    format!(
        "NoMa_szerviz_munkalap_{building_address}_{service_date_code}_{maintenance_id_short}.pdf"
    )
}

fn service_worksheet_archive_filename(
    building_address: &str,
    shift_start_date: &str,
    shift_id: uuid::Uuid,
) -> String {
    let building_address = sanitize_filename_component(building_address);
    let building_address = if building_address.is_empty() {
        "ismeretlen-helyszin".to_string()
    } else {
        building_address
    };

    let shift_start_date = if shift_start_date.trim().is_empty() {
        "00000000".to_string()
    } else {
        shift_start_date.trim().to_string()
    };

    let shift_id_short = shift_id
        .to_string()
        .replace('-', "")
        .chars()
        .take(8)
        .collect::<String>();

    format!(
        "NoMa_szerviz_munkalapok_{building_address}_{shift_start_date}_{shift_id_short}.zip"
    )
}

fn service_photo_caption(
    work: &ServiceWorksheetWorkRow,
    capture_note: Option<&str>,
) -> Option<String> {
    let note = capture_note
        .map(str::trim)
        .filter(|value| !value.is_empty());

    Some(match note {
        Some(note) => format!("{} · {}", work.device_code, note),
        None => work.device_code.clone(),
    })
}

fn service_photo_file_name(photo_id: uuid::Uuid, content_type: Option<&str>) -> String {
    let extension = match content_type.map(str::trim) {
        Some("image/jpeg") => "jpg",
        Some("image/png") => "png",
        Some("image/webp") => "webp",
        Some("image/heic") => "heic",
        Some("image/heif") => "heif",
        _ => "jpg",
    };

    format!("service-photo-{photo_id}.{extension}")
}

async fn download_existing_archive(
    storage: &StorageConfig,
    snapshot: &ServiceWorksheetSnapshot,
    object_name: &str,
) -> Result<Response, ApiError> {
    let filename = service_worksheet_archive_filename(
        &snapshot.core.building_address,
        &snapshot.core.shift_start_date,
        snapshot.core.shift_id,
    );
    let download_url = signed_download_url(
        &storage.bucket,
        object_name,
        PDF_SIGN_URL_TTL_SECS,
        Some(&filename),
    )
    .map_err(ApiError::internal)?;

    Ok(download_url_response(download_url))
}

fn build_service_worksheet_inputs(
    core: &ServiceWorksheetShiftCore,
    work: &ServiceWorksheetWorkRow,
    photos: &[ServiceWorksheetPhotoAsset],
    referent_signature_path: Option<&str>,
) -> serde_json::Value {
    let brand_model = match (
        work.device_brand
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty()),
        work.device_model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty()),
    ) {
        (Some(brand), Some(model)) => format!("{brand} / {model}"),
        (Some(brand), None) => brand.to_string(),
        (None, Some(model)) => model.to_string(),
        (None, None) => String::new(),
    };

    let photo_args: Vec<ServiceWorksheetPhotoArg> = photos
        .iter()
        .map(|photo| ServiceWorksheetPhotoArg {
            path: photo.path.clone(),
            caption: photo.caption.clone(),
        })
        .collect();
    let photo_args_alias = photo_args.clone();

    let mut value = json!({
        "report_id": work.report_id.clone(),
        "report_generated_at": core.report_generated_at.clone(),
        "service_date": work.service_date.clone(),
        "device_code": work.device_code.clone(),
        "device_barcode": work.device_barcode.clone(),
        "issue_number": work.issue_number.clone(),
        "building_address": core.building_address.clone(),
        "building_code": "-",
        "room": work.room.clone(),
        "device_type": work.device_type.clone(),
        "device_brand": work.device_brand.clone().unwrap_or_default(),
        "device_model": work.device_model.clone().unwrap_or_default(),
        "brand_model": brand_model,
        "maintainer": work.maintainer.clone(),
        "note": work.note.clone().unwrap_or_else(|| "-".to_string()),
        "referent_name": core.report_client.clone().unwrap_or_default(),
        "referent_role": core.report_client_role.clone().unwrap_or_default(),
        "logo_path": SERVICE_WORKSHEET_LOGO_BUNDLE_PATH,
        "args": {
            "photos": photo_args,
            "images": photo_args_alias,
        },
    });

    if let Some(referent_signature_path) = referent_signature_path {
        value["referent_signature_path"] = serde_json::Value::String(referent_signature_path.to_string());
    }

    value
}

fn build_service_worksheet_render_uri_request(
    storage: &StorageConfig,
    core: &ServiceWorksheetShiftCore,
    work: &ServiceWorksheetWorkRow,
    photos: &[ServiceWorksheetPhotoAsset],
    output_object_name: &str,
    referent_signature_object_name: Option<&str>,
) -> Result<RenderUriRequest, ApiError> {
    let template_object_name = typst_template_object_name(SERVICE_WORKSHEET_TEMPLATE_FILENAME);
    let template_url = signed_download_url(
        &storage.bucket,
        &template_object_name,
        PDF_SIGN_URL_TTL_SECS,
        None,
    )
    .map_err(ApiError::internal)?;
    let output_url = signed_upload_url(&storage.bucket, output_object_name, PDF_SIGN_URL_TTL_SECS)
        .map_err(ApiError::internal)?;
    let logo_object_name = typst_template_asset_object_name(SERVICE_WORKSHEET_LOGO_FILENAME);
    let logo_url = signed_download_url(
        &storage.bucket,
        &logo_object_name,
        PDF_SIGN_URL_TTL_SECS,
        None,
    )
    .map_err(ApiError::internal)?;

    let mut assets = vec![RenderUriAsset {
        path: SERVICE_WORKSHEET_LOGO_BUNDLE_PATH.to_string(),
        url: logo_url,
    }];

    let referent_signature_path = if let Some(signature_object_name) = referent_signature_object_name
    {
        let url = signed_download_url(
            &storage.bucket,
            signature_object_name,
            PDF_SIGN_URL_TTL_SECS,
            None,
        )
        .map_err(ApiError::internal)?;
        assets.push(RenderUriAsset {
            path: SERVICE_WORKSHEET_REFERENT_SIGNATURE_BUNDLE_PATH.to_string(),
            url,
        });
        Some(SERVICE_WORKSHEET_REFERENT_SIGNATURE_BUNDLE_PATH)
    } else {
        None
    };

    assets.extend(photos.iter().map(|photo| RenderUriAsset {
        path: photo.path.clone(),
        url: photo.url.clone(),
    }));

    Ok(RenderUriRequest {
        template: template_url,
        template_path: Some(SERVICE_WORKSHEET_TEMPLATE_FILENAME.to_string()),
        inputs: Some(build_service_worksheet_inputs(
            core,
            work,
            photos,
            referent_signature_path,
        )),
        assets,
        output: output_url,
    })
}

async fn render_service_pdf(
    renderer: &TypstRenderClient,
    storage: &StorageConfig,
    core: &ServiceWorksheetShiftCore,
    work: &ServiceWorksheetWorkRow,
    photos: &[ServiceWorksheetPhotoAsset],
    output_object_name: &str,
    referent_signature_object_name: Option<&str>,
) -> Result<RenderUriResponse, ApiError> {
    let request = build_service_worksheet_render_uri_request(
        storage,
        core,
        work,
        photos,
        output_object_name,
        referent_signature_object_name,
    )?;
    renderer.render_uri(request).await.map_err(ApiError::internal)
}

fn build_zip(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, ApiError> {
    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (filename, bytes) in entries {
        zip.start_file(filename, options)
            .map_err(ApiError::internal)?;
        zip.write_all(bytes).map_err(ApiError::internal)?;
    }

    let cursor = zip.finish().map_err(ApiError::internal)?;
    Ok(cursor.into_inner())
}

async fn load_service_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
) -> Result<ServiceWorksheetSnapshot, ApiError> {
    let core = sqlx::query_as::<_, ServiceWorksheetShiftCore>(
        r#"
        SELECT
            s.id AS shift_id,
            s.tenant_id,
            s.service_worksheets_url,
            to_char(timezone('Europe/Budapest', clock_timestamp()), 'YYYY.MM.DD. HH24:MI') AS report_generated_at,
            to_char(timezone('Europe/Budapest', COALESCE(s.started_at, s.created_at)), 'YYYYMMDD') AS shift_start_date,
            b.address AS building_address,
            ss.reference_person_name AS report_client,
            ss.reference_person_role AS report_client_role,
            ss.signature_image_url AS referent_signature_image_url
        FROM shifts s
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        LEFT JOIN shift_signatures ss
          ON ss.tenant_id = s.tenant_id
         AND ss.shift_id = s.id
        WHERE s.tenant_id = $1
          AND s.id = $2
        FOR UPDATE OF s
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("shift not found for current tenant"))?;

    let works = sqlx::query_as::<_, ServiceWorksheetWorkRow>(
        r#"
        SELECT
            mw.id AS maintenance_id,
            mw.id::text AS report_id,
            to_char(timezone('Europe/Budapest', mw.started_at), 'YYYY.MM.DD.') AS service_date,
            to_char(timezone('Europe/Budapest', mw.started_at), 'YYYYMMDD') AS service_date_code,
            COALESCE(NULLIF(BTRIM(mw.issue_number), ''), '-') AS issue_number,
            COALESCE(
                NULLIF(BTRIM(d.source_device_code), ''),
                '-'
            ) AS device_code,
            COALESCE(
                NULLIF(BTRIM(bc.code), ''),
                '-'
            ) AS device_barcode,
            COALESCE(
                NULLIF(
                    CONCAT_WS(', ',
                        NULLIF(BTRIM(l.floor), ''),
                        NULLIF(BTRIM(l.wing), ''),
                        NULLIF(BTRIM(l.room), ''),
                        CASE
                            WHEN NULLIF(BTRIM(l.location_description), '') IS NULL THEN NULL
                            WHEN NULLIF(BTRIM(l.room), '') IS NULL THEN NULLIF(BTRIM(l.location_description), '')
                            WHEN BTRIM(l.location_description) = BTRIM(l.room) THEN NULL
                            ELSE BTRIM(l.location_description)
                        END
                    ),
                    ''
                ),
                '-'
            ) AS room,
            CASE d.kind::text
                WHEN 'WINDOW_AIR_CONDITIONER' THEN 'Ablakklíma'
                WHEN 'FAN_COIL' THEN 'Komfort Fan-Coil'
                WHEN 'COMFORT_FAN_COIL' THEN 'Komfort Fan-Coil'
                WHEN 'AIR_CURTAIN' THEN 'Légfüggöny'
                WHEN 'FAN_COIL_UNIT' THEN 'Fan-coil'
                WHEN 'SPLIT_UNIT' THEN 'Komfort Split'
                WHEN 'SPLIT_INDOOR_UNIT' THEN 'Split beltéri'
                WHEN 'SERVER_ROOM_SPLIT_INDOOR_UNIT' THEN 'Szerver Split'
                WHEN 'INDOOR_UNIT' THEN 'Beltéri egység'
                WHEN 'AIR_HANDLING_UNIT' THEN 'Légkezelő'
                WHEN 'CONDENSER' THEN 'Kondenzátor'
                WHEN 'FAN' THEN 'Ventilátor'
                WHEN 'AIR_HANDLER_UNIT' THEN 'Légkezelő'
                WHEN 'VRV_INDOOR_UNIT' THEN 'VRV beltéri'
                WHEN 'VRV_OUTDOOR_UNIT' THEN 'VRV kültéri'
                WHEN 'VRF_OUTDOOR_UNIT' THEN 'VRV kültéri'
                WHEN 'LIQUID_CHILLER' THEN 'Folyadékhűtő'
                WHEN 'CHILLER' THEN 'Folyadékhűtő'
                ELSE d.kind::text
            END AS device_type,
            d.brand AS device_brand,
            d.model AS device_model,
            mu.full_name AS maintainer,
            NULLIF(BTRIM(mw.note), '') AS note
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
        JOIN users mu
          ON mu.tenant_id = mw.tenant_id
         AND mu.id = mw.maintainer_user_id
        WHERE mw.tenant_id = $1
          AND mw.shift_id = $2
          AND mw.kind = 'SERVICE'
        ORDER BY mw.started_at ASC, mw.id ASC
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(ServiceWorksheetSnapshot { core, works })
}

async fn load_service_work_photos(
    storage: &StorageConfig,
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: uuid::Uuid,
    work: &ServiceWorksheetWorkRow,
) -> Result<Vec<ServiceWorksheetPhotoAsset>, ApiError> {
    let photos = sqlx::query_as::<_, ServiceWorksheetPhotoRow>(
        r#"
        SELECT
            mp.id AS photo_id,
            mp.photo_url,
            NULLIF(BTRIM(mp.capture_note), '') AS capture_note
        FROM maintenance_photos mp
        WHERE mp.tenant_id = $1
          AND mp.maintenance_work_id = $2
        ORDER BY mp.created_at ASC, mp.id ASC
        "#,
    )
    .bind(tenant_id)
    .bind(work.maintenance_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    let mut assets = Vec::with_capacity(photos.len());

    for photo in photos {
        let metadata = match Object::read(&storage.bucket, &photo.photo_url).await {
            Ok(metadata) => metadata,
            Err(err) => {
                log::warn!(
                    "Failed to read service photo {} for work {}: {}",
                    photo.photo_id,
                    work.maintenance_id,
                    err
                );
                continue;
            }
        };

        let mime_type = metadata
            .content_type
            .unwrap_or_else(|| "image/jpeg".to_string());
        let path = service_photo_file_name(photo.photo_id, Some(mime_type.as_str()));
        let url = signed_download_url(&storage.bucket, &photo.photo_url, PDF_SIGN_URL_TTL_SECS, None)
            .map_err(ApiError::internal)?;

        assets.push(ServiceWorksheetPhotoAsset {
            path,
            url,
            caption: service_photo_caption(work, photo.capture_note.as_deref()),
        });
    }

    Ok(assets)
}

async fn generate_service_archive(
    renderer: &TypstRenderClient,
    storage: &StorageConfig,
    tx: &mut Transaction<'_, Postgres>,
    snapshot: &ServiceWorksheetSnapshot,
) -> Result<Vec<u8>, ApiError> {
    let mut pdf_entries = Vec::with_capacity(snapshot.works.len());

    for work in &snapshot.works {
        let photos = load_service_work_photos(storage, tx, snapshot.core.tenant_id, work).await?;
        let filename = service_worksheet_filename(
            &snapshot.core.building_address,
            &work.service_date_code,
            work.maintenance_id,
        );
        let temp_object_name = format!(
            "{}/tenants/{}/shifts/{}/service-worksheets/{}",
            storage.shift_service_worksheets_prefix,
            snapshot.core.tenant_id,
            snapshot.core.shift_id,
            filename,
        );
        let render_result = render_service_pdf(
            renderer,
            storage,
            &snapshot.core,
            work,
            &photos,
            &temp_object_name,
            snapshot
                .core
                .referent_signature_image_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .await?;
        log::info!(
            "Service worksheet rendered for work {} in {} ms ({} bytes, upload {} ms)",
            work.maintenance_id,
            render_result.compile_ms,
            render_result.bytes,
            render_result.upload_ms,
        );

        let pdf_bytes = Object::download(&storage.bucket, &temp_object_name)
            .await
            .map_err(ApiError::internal)?;
        let _ = Object::delete(&storage.bucket, &temp_object_name).await;
        pdf_entries.push((
            filename,
            pdf_bytes,
        ));
    }

    build_zip(&pdf_entries)
}

async fn store_service_archive(
    tx: &mut Transaction<'_, Postgres>,
    storage: &StorageConfig,
    snapshot: &ServiceWorksheetSnapshot,
    zip_bytes: &[u8],
) -> Result<String, ApiError> {
    let object_name = shift_service_worksheets_object_name(
        storage,
        snapshot.core.tenant_id,
        snapshot.core.shift_id,
    );

    Object::create(
        &storage.bucket,
        zip_bytes.to_vec(),
        &object_name,
        "application/zip",
    )
    .await
    .map_err(ApiError::internal)?;

    let updated = sqlx::query(
        r#"
        UPDATE shifts
        SET service_worksheets_url = $3
        WHERE tenant_id = $1
          AND id = $2
          AND service_worksheets_url IS NULL
        "#,
    )
    .bind(snapshot.core.tenant_id)
    .bind(snapshot.core.shift_id)
    .bind(&object_name)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() != 1 {
        return Err(ApiError::conflict(
            "service worksheet archive could not be stored for the shift",
        ));
    }

    Ok(object_name)
}

pub async fn get_admin_shift_service_worksheets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(shift_id): Path<uuid::Uuid>,
) -> Result<Response, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let storage = state
        .storage
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("worksheet storage is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    log::info!(
        "Service worksheet download requested for shift {} by user {}",
        shift_id,
        user.id
    );

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    let snapshot = load_service_snapshot(&mut tx, user.tenant_id, shift_id).await?;

    if let Some(service_worksheets_url) = snapshot.core.service_worksheets_url.as_deref() {
        log::info!(
            "Serving stored service worksheet archive for shift {} from {}",
            shift_id,
            service_worksheets_url
        );
        tx.commit().await.map_err(ApiError::internal)?;
        return download_existing_archive(storage, &snapshot, service_worksheets_url).await;
    }

    if snapshot.works.is_empty() {
        let _ = tx.rollback().await;
        return Err(ApiError::conflict(
            "service worksheets can only be generated when the shift contains service works",
        ));
    }

    let renderer = state.typst_renderer.as_ref().ok_or_else(|| {
        ApiError::service_unavailable("worksheet render service is not configured")
    })?;

    log::info!(
        "Generating service worksheet archive for shift {}",
        shift_id
    );
    let zip_bytes = match generate_service_archive(renderer, storage, &mut tx, &snapshot).await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = tx.rollback().await;
            return Err(err);
        }
    };

    log::info!(
        "Uploading service worksheet archive for shift {} to GCS",
        shift_id
    );
    let object_name = store_service_archive(&mut tx, storage, &snapshot, &zip_bytes).await?;
    log::info!("Service worksheet archive stored for shift {}", shift_id);

    tx.commit().await.map_err(ApiError::internal)?;

    let filename = service_worksheet_archive_filename(
        &snapshot.core.building_address,
        &snapshot.core.shift_start_date,
        snapshot.core.shift_id,
    );
    let download_url = signed_download_url(
        &storage.bucket,
        &object_name,
        PDF_SIGN_URL_TTL_SECS,
        Some(&filename),
    )
    .map_err(ApiError::internal)?;

    Ok(download_url_response(download_url))
}

#[cfg(test)]
mod tests {
    use super::{service_worksheet_archive_filename, service_worksheet_filename};

    #[test]
    fn formats_service_worksheet_filename() {
        let filename = service_worksheet_filename(
            "Budapest, Alkotmány u. 5.",
            "20260514",
            uuid::Uuid::parse_str("53fc165b-faaa-423b-8b33-fd456497e8cf").expect("valid uuid"),
        );

        assert_eq!(
            filename,
            "NoMa_szerviz_munkalap_Budapest-Alkotmany-u-5_20260514_53fc165b.pdf"
        );
    }

    #[test]
    fn formats_service_worksheet_archive_filename() {
        let filename = service_worksheet_archive_filename(
            "Budapest, Alkotmány u. 5.",
            "20260514",
            uuid::Uuid::parse_str("017a3d19-45cd-4269-819a-974d4f3b5c22").expect("valid uuid"),
        );

        assert_eq!(
            filename,
            "NoMa_szerviz_munkalapok_Budapest-Alkotmany-u-5_20260514_017a3d19.zip"
        );
    }
}
