use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::response::{IntoResponse, Response};
use cloud_storage::Object;
use reqwest::multipart::{Form, Part};
use sqlx::{Postgres, Transaction};

use crate::auth::{require_lead_or_admin, require_session_user};
use crate::error::ApiError;
use crate::state::{AppState, StorageConfig};
use crate::storage::shift_report_object_name;
use crate::typst_render::TypstRenderClient;

const MUNKALAP_TEMPLATE: &str = include_str!("../../worksheet_templates/Munkalap.typ");
const MUNKALAP_LOGO: &[u8] =
    include_bytes!("../../frontend/apps/main/public/Noma_logo_color_text_vertical.png");
const MUNKALAP_TEMPLATE_FILENAME: &str = "Munkalap.typ";
const MUNKALAP_ROWS_FILENAME: &str = "munkalap_rows.csv";
const MUNKALAP_WORKERS_FILENAME: &str = "munkalap_workers.csv";
const MUNKALAP_LOGO_FILENAME: &str = "Noma_logo_color_text_vertical.png";
const MUNKALAP_CLIENT_SIGNATURE_FILENAME: &str = "signature_client.png";

#[derive(sqlx::FromRow)]
struct ShiftReportCoreRow {
    shift_id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    status: String,
    report_generated_at: String,
    report_location: String,
    report_period: String,
    shift_start_date: String,
    report_lead: String,
    report_client: Option<String>,
    report_client_role: Option<String>,
    client_signature_image_url: Option<String>,
    works_total: i64,
    flagged_total: i64,
    report_url: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ShiftReportRow {
    tipus: String,
    device_code: String,
    misc: String,
    karb: String,
    feltart_hiba: String,
    megjegyzes: String,
}

#[derive(sqlx::FromRow)]
struct ShiftReportWorkerRow {
    name: String,
}

struct ShiftReportSnapshot {
    core: ShiftReportCoreRow,
    rows: Vec<ShiftReportRow>,
    workers: Vec<ShiftReportWorkerRow>,
}

fn csv_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        if ch == '"' {
            escaped.push('"');
        }
        escaped.push(ch);
    }
    escaped.push('"');
    escaped
}

fn csv_record(values: &[&str]) -> String {
    values
        .iter()
        .map(|value| csv_escape(value))
        .collect::<Vec<_>>()
        .join(",")
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

fn shift_report_filename(
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
        shift_start_date.to_string()
    };

    let shift_id_short = shift_id
        .to_string()
        .replace('-', "")
        .chars()
        .take(8)
        .collect::<String>();

    format!("NoMa_karb_{building_address}_{shift_start_date}_{shift_id_short}.pdf")
}

fn shift_report_attachment_filename(snapshot: &ShiftReportSnapshot) -> String {
    shift_report_filename(
        &snapshot.core.report_location,
        &snapshot.core.shift_start_date,
        snapshot.core.shift_id,
    )
}

fn render_rows_csv(rows: &[ShiftReportRow]) -> String {
    let mut csv = String::from("tipus,device_code,misc,karb,feltart_hiba,megjegyzes\n");

    for row in rows {
        csv.push_str(&csv_record(&[
            &row.tipus,
            &row.device_code,
            &row.misc,
            &row.karb,
            &row.feltart_hiba,
            &row.megjegyzes,
        ]));
        csv.push('\n');
    }

    csv
}

fn render_workers_csv(workers: &[ShiftReportWorkerRow]) -> String {
    let mut csv = String::from("name\n");

    for worker in workers {
        csv.push_str(&csv_record(&[worker.name.as_str()]));
        csv.push('\n');
    }

    csv
}

async fn download_client_signature_bytes(
    storage: &StorageConfig,
    signature_object_name: Option<&str>,
) -> Option<Vec<u8>> {
    let Some(signature_object_name) = signature_object_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return None;
    };

    match Object::download(&storage.bucket, signature_object_name).await {
        Ok(bytes) => Some(bytes),
        Err(err) => {
            log::warn!(
                "Failed to download client signature {} for worksheet: {}",
                signature_object_name,
                err
            );
            None
        }
    }
}

fn build_shift_report_form(
    snapshot: &ShiftReportSnapshot,
    client_signature_bytes: Option<&[u8]>,
) -> Result<Form, ApiError> {
    let mut form = Form::new()
        .part(
            "template",
            Part::bytes(MUNKALAP_TEMPLATE.as_bytes().to_vec())
                .file_name(MUNKALAP_TEMPLATE_FILENAME)
                .mime_str("application/vnd.typst")
                .map_err(ApiError::internal)?,
        )
        .text("report_id", snapshot.core.shift_id.to_string())
        .text(
            "report_generated_at",
            snapshot.core.report_generated_at.clone(),
        )
        .text("report_location", snapshot.core.report_location.clone())
        .text("report_period", snapshot.core.report_period.clone())
        .text("report_lead", snapshot.core.report_lead.clone())
        .text(
            "report_client",
            snapshot.core.report_client.clone().unwrap_or_default(),
        )
        .text(
            "report_client_role",
            snapshot.core.report_client_role.clone().unwrap_or_default(),
        )
        .text("works_total", format!("{} db", snapshot.core.works_total))
        .text(
            "flagged_total",
            format!("{} db", snapshot.core.flagged_total),
        )
        .part(
            "rows_csv",
            Part::bytes(render_rows_csv(&snapshot.rows).into_bytes())
                .file_name(MUNKALAP_ROWS_FILENAME)
                .mime_str("text/csv")
                .map_err(ApiError::internal)?,
        )
        .part(
            "workers_csv",
            Part::bytes(render_workers_csv(&snapshot.workers).into_bytes())
                .file_name(MUNKALAP_WORKERS_FILENAME)
                .mime_str("text/csv")
                .map_err(ApiError::internal)?,
        )
        .part(
            "logo_path",
            Part::bytes(MUNKALAP_LOGO.to_vec())
                .file_name(MUNKALAP_LOGO_FILENAME)
                .mime_str("image/png")
                .map_err(ApiError::internal)?,
        );

    if let Some(client_signature_bytes) = client_signature_bytes {
        form = form.part(
            "client_signature_path",
            Part::bytes(client_signature_bytes.to_vec())
                .file_name(MUNKALAP_CLIENT_SIGNATURE_FILENAME)
                .mime_str("image/png")
                .map_err(ApiError::internal)?,
        );
    }

    Ok(form)
}

async fn load_shift_report_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: uuid::Uuid,
    shift_id: uuid::Uuid,
) -> Result<ShiftReportSnapshot, ApiError> {
    let core = sqlx::query_as::<_, ShiftReportCoreRow>(
        r#"
        SELECT
            s.id AS shift_id,
            s.tenant_id,
            s.status::text AS status,
            to_char(timezone('Europe/Budapest', clock_timestamp()), 'YYYY.MM.DD. HH24:MI') AS report_generated_at,
            b.address AS report_location,
            to_char(timezone('Europe/Budapest', COALESCE(s.started_at, s.created_at)), 'YYYY.MM.DD.') AS report_period,
            to_char(timezone('Europe/Budapest', COALESCE(s.started_at, s.created_at)), 'YYYYMMDD') AS shift_start_date,
            lu.full_name AS report_lead,
            ss.reference_person_name AS report_client,
            ss.reference_person_role AS report_client_role,
            ss.signature_image_url AS client_signature_image_url,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND mw.kind = 'ROUTINE'
            ) AS works_total,
            (
                SELECT COUNT(*)::bigint
                FROM maintenance_works mw
                WHERE mw.tenant_id = s.tenant_id
                  AND mw.shift_id = s.id
                  AND mw.kind = 'ROUTINE'
                  AND mw.followup_service_required = TRUE
            ) AS flagged_total,
            s.report_url
        FROM shifts s
        JOIN buildings b
          ON b.tenant_id = s.tenant_id
         AND b.id = s.building_id
        JOIN users lu
          ON lu.tenant_id = s.tenant_id
         AND lu.id = s.lead_user_id
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

    let rows = sqlx::query_as::<_, ShiftReportRow>(
        r#"
        SELECT
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
            END AS tipus,
            COALESCE(d.source_device_code, '') AS device_code,
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
            ) AS misc,
            'CHECK' AS karb,
            CASE
                WHEN mw.followup_service_required THEN COALESCE(NULLIF(fr.reasons_hu, ''), 'egyéb')
                ELSE '-'
            END AS feltart_hiba,
            CASE
                WHEN fr.has_other AND normalized.other_clean IS NOT NULL THEN
                    CASE
                        WHEN normalized.note_clean IS NULL THEN normalized.other_clean
                        WHEN POSITION(LOWER(normalized.other_clean) IN LOWER(normalized.note_clean)) > 0 THEN normalized.note_clean
                        ELSE normalized.note_clean || '; ' || normalized.other_clean
                    END
                ELSE COALESCE(normalized.note_clean, '-')
            END AS megjegyzes
        FROM maintenance_works mw
        JOIN devices d
          ON d.tenant_id = mw.tenant_id
         AND d.id = mw.device_id
        LEFT JOIN site_locations l
          ON l.tenant_id = d.tenant_id
         AND l.id = d.location_id
        LEFT JOIN LATERAL (
            SELECT
                STRING_AGG(
                    CASE reason.reason_txt
                        WHEN 'MAIN_COMPONENT_REPLACEMENT' THEN 'főalkatrész csere'
                        WHEN 'CLEANING' THEN 'tisztítás'
                        WHEN 'DAMAGED' THEN 'sérült'
                        WHEN 'OTHER' THEN 'egyéb'
                        WHEN 'FAULT_DIAGNOSIS_REQUIRED' THEN 'hibafeltárás'
                        WHEN 'PERFORMANCE_DEGRADATION' THEN 'teljesítménycsökkenés'
                        WHEN 'ABNORMAL_ODOR' THEN 'rendellenes szag'
                        WHEN 'REFRIGERANT_LOW_OR_LEAK' THEN 'hűtőközeg alacsony/szivárgás'
                        ELSE LOWER(reason.reason_txt)
                    END,
                    ', ' ORDER BY reason.ord
                ) AS reasons_hu,
                BOOL_OR(reason.reason_txt = 'OTHER') AS has_other
            FROM UNNEST(mw.followup_service_reasons::text[]) WITH ORDINALITY AS reason(reason_txt, ord)
        ) fr ON TRUE
        CROSS JOIN LATERAL (
            SELECT
                NULLIF(BTRIM(mw.note), '') AS note_clean,
                NULLIF(BTRIM(mw.followup_service_reason_other), '') AS other_clean
        ) normalized
        WHERE mw.tenant_id = $1
          AND mw.shift_id = $2
          AND mw.kind = 'ROUTINE'
        ORDER BY mw.started_at ASC, mw.id ASC
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    let workers = sqlx::query_as::<_, ShiftReportWorkerRow>(
        r#"
        WITH shift_workers AS (
            SELECT u.full_name AS name
            FROM shifts s
            JOIN users u
              ON u.tenant_id = s.tenant_id
             AND u.id = s.lead_user_id
            WHERE s.tenant_id = $1
              AND s.id = $2

            UNION

            SELECT u.full_name AS name
            FROM shift_participants sp
            JOIN users u
              ON u.tenant_id = sp.tenant_id
             AND u.id = sp.user_id
            WHERE sp.tenant_id = $1
              AND sp.shift_id = $2
              AND sp.status IN ('ACCEPTED', 'CACHE_READY', 'CLOSE_CONFIRMED')
        )
        SELECT name
        FROM shift_workers
        ORDER BY name
        "#,
    )
    .bind(tenant_id)
    .bind(shift_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(ShiftReportSnapshot {
        core,
        rows,
        workers,
    })
}

async fn generate_shift_report_pdf(
    renderer: &TypstRenderClient,
    storage: &StorageConfig,
    snapshot: &ShiftReportSnapshot,
) -> Result<Vec<u8>, ApiError> {
    let client_signature_bytes = download_client_signature_bytes(
        storage,
        snapshot.core.client_signature_image_url.as_deref(),
    )
    .await;

    let form = build_shift_report_form(snapshot, client_signature_bytes.as_deref())?;

    renderer
        .render_typst(form)
        .await
        .map_err(ApiError::internal)
}

async fn upload_shift_report_pdf(
    tx: &mut Transaction<'_, Postgres>,
    storage: &StorageConfig,
    snapshot: &ShiftReportSnapshot,
    pdf_bytes: &[u8],
) -> Result<String, ApiError> {
    let filename = shift_report_attachment_filename(snapshot);
    let object_name = shift_report_object_name(
        storage,
        snapshot.core.tenant_id,
        snapshot.core.shift_id,
        &filename,
    );

    Object::create(
        &storage.bucket,
        pdf_bytes.to_vec(),
        &object_name,
        "application/pdf",
    )
    .await
    .map_err(ApiError::internal)?;

    let updated = sqlx::query(
        r#"
        UPDATE shifts
        SET report_url = $3
        WHERE tenant_id = $1
          AND id = $2
          AND report_url IS NULL
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
            "worksheet could not be stored for the shift",
        ));
    }

    Ok(object_name)
}

fn pdf_attachment_response(snapshot: &ShiftReportSnapshot, pdf_bytes: Vec<u8>) -> Response {
    let filename = shift_report_attachment_filename(snapshot);
    let content_disposition = format!("attachment; filename=\"{filename}\"");

    (
        [
            (header::CONTENT_TYPE, "application/pdf"),
            (header::CONTENT_DISPOSITION, content_disposition.as_str()),
        ],
        pdf_bytes,
    )
        .into_response()
}

async fn download_existing_report(
    storage: &StorageConfig,
    snapshot: &ShiftReportSnapshot,
    object_name: &str,
) -> Result<Response, ApiError> {
    let pdf_bytes = Object::download(&storage.bucket, object_name)
        .await
        .map_err(ApiError::internal)?;

    Ok(pdf_attachment_response(snapshot, pdf_bytes))
}

pub async fn get_admin_shift_report(
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
        "Worksheet download requested for shift {} by user {}",
        shift_id,
        user.id
    );

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    let snapshot = load_shift_report_snapshot(&mut tx, user.tenant_id, shift_id).await?;

    if let Some(report_url) = snapshot.core.report_url.as_deref() {
        log::info!(
            "Serving stored worksheet for shift {} from {}",
            shift_id,
            report_url
        );
        tx.commit().await.map_err(ApiError::internal)?;
        return download_existing_report(storage, &snapshot, report_url).await;
    }

    if snapshot.core.status != "COMMITTED" {
        let _ = tx.rollback().await;
        return Err(ApiError::conflict(
            "worksheet can only be generated for committed shifts",
        ));
    }

    let renderer = state.typst_renderer.as_ref().ok_or_else(|| {
        log::error!(
            "Worksheet render service is not configured; cannot generate shift report for shift {}",
            shift_id
        );
        ApiError::service_unavailable("worksheet render service is not configured")
    })?;

    log::info!("Generating worksheet for shift {}", shift_id);

    let pdf_bytes = match generate_shift_report_pdf(renderer, storage, &snapshot).await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = tx.rollback().await;
            return Err(err);
        }
    };

    log::info!("Uploading worksheet for shift {} to GCS", shift_id);
    let _ = upload_shift_report_pdf(&mut tx, storage, &snapshot, &pdf_bytes).await?;

    log::info!("Worksheet stored for shift {}", shift_id);

    tx.commit().await.map_err(ApiError::internal)?;

    Ok(pdf_attachment_response(&snapshot, pdf_bytes))
}

#[cfg(test)]
mod tests {
    use super::shift_report_filename;

    #[test]
    fn formats_the_requested_report_filename() {
        let filename = shift_report_filename(
            "Budapest, Kossuth tér 2-4.",
            "20260412",
            uuid::Uuid::parse_str("dfcc66ea-0000-0000-0000-000000000000").expect("valid uuid"),
        );

        assert_eq!(
            filename,
            "NoMa_karb_Budapest-Kossuth-ter-2-4_20260412_dfcc66ea.pdf"
        );
    }
}
