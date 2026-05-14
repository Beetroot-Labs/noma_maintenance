use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use cloud_storage::Object;
use reqwest::multipart::{Form, Part};
use serde::Serialize;
use sqlx::{Postgres, Transaction};
use std::io::{Cursor, Write};

use crate::auth::{require_lead_or_admin, require_session_user};
use crate::error::ApiError;
use crate::state::{AppState, StorageConfig};
use crate::storage::shift_service_worksheets_object_name;
use crate::typst_render::TypstRenderClient;

const SERVICE_TEMPLATE: &str = include_str!("../../worksheet_templates/SzervizMunkalap.typ");
const SERVICE_TEMPLATE_FILENAME: &str = "SzervizMunkalap.typ";
const SERVICE_LOGO: &[u8] = include_bytes!("../../frontend/apps/main/public/Noma_logo_color_text_vertical.png");
const SERVICE_LOGO_FILENAME: &str = "Noma_logo_color_text_vertical.png";

#[derive(sqlx::FromRow)]
struct ServiceWorksheetShiftCore {
    shift_id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    service_worksheets_url: Option<String>,
    report_generated_at: String,
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
    issue_number: String,
    device_code: String,
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
    field_name: String,
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
    caption: Option<String>,
}

struct ServiceWorksheetSnapshot {
    core: ServiceWorksheetShiftCore,
    works: Vec<ServiceWorksheetWorkRow>,
}

fn zip_filename_for_work(work: &ServiceWorksheetWorkRow) -> String {
    format!("szerviz_munkalap_{}.pdf", work.maintenance_id)
}

fn service_photo_caption(work: &ServiceWorksheetWorkRow, capture_note: Option<&str>) -> Option<String> {
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

fn zip_attachment_response(shift_id: uuid::Uuid, zip_bytes: Vec<u8>) -> Response {
    let filename = format!("szerviz-munkalapok-{shift_id}.zip");
    let content_disposition = format!("attachment; filename=\"{filename}\"");

    (
        [
            (header::CONTENT_TYPE, "application/zip"),
            (header::CONTENT_DISPOSITION, content_disposition.as_str()),
        ],
        zip_bytes,
    )
        .into_response()
}

async fn download_existing_archive(
    storage: &StorageConfig,
    shift_id: uuid::Uuid,
    object_name: &str,
) -> Result<Response, ApiError> {
    let zip_bytes = Object::download(&storage.bucket, object_name)
        .await
        .map_err(ApiError::internal)?;

    Ok(zip_attachment_response(shift_id, zip_bytes))
}

fn render_service_form(
    core: &ServiceWorksheetShiftCore,
    work: &ServiceWorksheetWorkRow,
    photos: &[ServiceWorksheetPhotoAsset],
    referent_signature_bytes: Option<&[u8]>,
) -> Result<Form, ApiError> {
    let brand_model = match (
        work.device_brand.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()),
        work.device_model.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()),
    ) {
        (Some(brand), Some(model)) => format!("{brand} / {model}"),
        (Some(brand), None) => brand.to_string(),
        (None, Some(model)) => model.to_string(),
        (None, None) => String::new(),
    };

    let mut form = Form::new()
        .part(
            "template",
            Part::bytes(SERVICE_TEMPLATE.as_bytes().to_vec())
                .file_name(SERVICE_TEMPLATE_FILENAME)
                .mime_str("application/vnd.typst")
                .map_err(ApiError::internal)?,
        )
        .text("report_id", work.report_id.clone())
        .text("report_generated_at", core.report_generated_at.clone())
        .text("service_date", work.service_date.clone())
        .text("device_code", work.device_code.clone())
        .text("issue_number", work.issue_number.clone())
        .text("building_address", core.building_address.clone())
        .text("building_code", "-")
        .text("room", work.room.clone())
        .text("device_type", work.device_type.clone())
        .text("device_brand", work.device_brand.clone().unwrap_or_default())
        .text("device_model", work.device_model.clone().unwrap_or_default())
        .text("brand_model", brand_model)
        .text("maintainer", work.maintainer.clone())
        .text("note", work.note.clone().unwrap_or_else(|| "-".to_string()))
        .text("referent_name", core.report_client.clone().unwrap_or_default())
        .text(
            "referent_role",
            core.report_client_role.clone().unwrap_or_default(),
        )
        .part(
            "logo_path",
            Part::bytes(SERVICE_LOGO.to_vec())
                .file_name(SERVICE_LOGO_FILENAME)
                .mime_str("image/png")
                .map_err(ApiError::internal)?,
        );

    if !photos.is_empty() {
        let photo_args: Vec<ServiceWorksheetPhotoArg> = photos
            .iter()
            .map(|photo| ServiceWorksheetPhotoArg {
                path: photo.field_name.clone(),
                caption: photo.caption.clone(),
            })
            .collect();
        let photo_args_alias = photo_args.clone();

        form = form.text(
            "args",
            serde_json::json!({
                "photos": photo_args,
                "images": photo_args_alias,
            })
            .to_string(),
        );

        for photo in photos {
            form = form.part(
                photo.field_name.clone(),
                Part::bytes(photo.bytes.clone())
                    .file_name(photo.file_name.clone())
                    .mime_str(&photo.mime_type)
                    .map_err(ApiError::internal)?,
            );
        }
    }

    if let Some(referent_signature_bytes) = referent_signature_bytes {
        form = form.part(
            "referent_signature_path",
            Part::bytes(referent_signature_bytes.to_vec())
                .file_name("referent_signature.png")
                .mime_str("image/png")
                .map_err(ApiError::internal)?,
        );
    }

    Ok(form)
}

async fn render_service_pdf(
    renderer: &TypstRenderClient,
    core: &ServiceWorksheetShiftCore,
    work: &ServiceWorksheetWorkRow,
    photos: &[ServiceWorksheetPhotoAsset],
    referent_signature_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, ApiError> {
    let form = render_service_form(core, work, photos, referent_signature_bytes)?;
    renderer.render_typst(form).await.map_err(ApiError::internal)
}

fn build_zip(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, ApiError> {
    let cursor = Cursor::new(Vec::<u8>::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

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
            COALESCE(NULLIF(BTRIM(mw.issue_number), ''), '-') AS issue_number,
            COALESCE(
                NULLIF(BTRIM(d.source_device_code), ''),
                '-'
            ) AS device_code,
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

        let bytes = match Object::download(&storage.bucket, &photo.photo_url).await {
            Ok(bytes) => bytes,
            Err(err) => {
                log::warn!(
                    "Failed to download service photo {} for work {}: {}",
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
        let field_name = format!("service_photo_{}", photo.photo_id);

        assets.push(ServiceWorksheetPhotoAsset {
            field_name,
            file_name: service_photo_file_name(photo.photo_id, Some(mime_type.as_str())),
            mime_type,
            bytes,
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
    let referent_signature_bytes = if let Some(signature_object_name) = snapshot
        .core
        .referent_signature_image_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match Object::download(&storage.bucket, signature_object_name).await {
            Ok(bytes) => Some(bytes),
            Err(err) => {
                log::warn!(
                    "Failed to download referent signature {} for service worksheets: {}",
                    signature_object_name,
                    err
                );
                None
            }
        }
    } else {
        None
    };

    let mut pdf_entries = Vec::with_capacity(snapshot.works.len());

    for work in &snapshot.works {
        let photos = load_service_work_photos(storage, tx, snapshot.core.tenant_id, work).await?;
        let pdf_bytes = render_service_pdf(
            renderer,
            &snapshot.core,
            work,
            &photos,
            referent_signature_bytes.as_deref(),
        )
        .await?;
        pdf_entries.push((zip_filename_for_work(work), pdf_bytes));
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
        return download_existing_archive(storage, shift_id, service_worksheets_url).await;
    }

    if snapshot.works.is_empty() {
        let _ = tx.rollback().await;
        return Err(ApiError::conflict(
            "service worksheets can only be generated when the shift contains service works",
        ));
    }

    let renderer = state
        .typst_renderer
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("worksheet render service is not configured"))?;

    log::info!("Generating service worksheet archive for shift {}", shift_id);
    let zip_bytes = match generate_service_archive(renderer, storage, &mut tx, &snapshot).await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = tx.rollback().await;
            return Err(err);
        }
    };

    log::info!("Uploading service worksheet archive for shift {} to GCS", shift_id);
    let _ = store_service_archive(&mut tx, storage, &snapshot, &zip_bytes).await?;
    log::info!("Service worksheet archive stored for shift {}", shift_id);

    tx.commit().await.map_err(ApiError::internal)?;

    Ok(zip_attachment_response(shift_id, zip_bytes))
}
