use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use cloud_storage::Object;
use reqwest::multipart::{Form, Part};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use std::str::FromStr;

use crate::auth::{require_lead_or_admin, require_session_user};
use crate::error::ApiError;
use crate::state::{AppState, StorageConfig};
use crate::storage::proposal_object_name;
use crate::typst_render::TypstRenderClient;

const PROPOSAL_TEMPLATE: &str = include_str!("../../worksheet_templates/Ajanlat.typ");
const PROPOSAL_LOGO: &[u8] = include_bytes!("../../frontend/apps/main/public/Noma_logo_color_text_vertical.png");
const PROPOSAL_TEMPLATE_FILENAME: &str = "Ajanlat.typ";
const PROPOSAL_LOGO_FILENAME: &str = "Noma_logo_color_text_vertical.png";

#[derive(Deserialize)]
pub struct CreateAdminProposalRequest {
    device_id: uuid::Uuid,
    note: String,
    lines: Vec<CreateAdminProposalLineRequest>,
}

#[derive(Deserialize)]
pub struct CreateAdminProposalLineRequest {
    item: String,
    quantity: String,
    uom: String,
    net_unit_price: String,
}

#[derive(Serialize, sqlx::FromRow)]
struct AdminProposalListRow {
    proposal_id: uuid::Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    created_by_name: Option<String>,
    device_id: uuid::Uuid,
    device_barcode: Option<String>,
    device_source_device_code: Option<String>,
    device_kind: String,
    device_original_kind: Option<String>,
    device_brand: Option<String>,
    device_model: Option<String>,
    building_name: String,
    building_address: String,
    location_description: Option<String>,
    wing: Option<String>,
    floor: Option<String>,
    room: Option<String>,
    net_price: Decimal,
    currency: String,
    line_count: i64,
    url: Option<String>,
}

#[derive(Serialize, sqlx::FromRow)]
struct AdminProposalDetailRow {
    proposal_id: uuid::Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    created_by_name: Option<String>,
    created_by_email: Option<String>,
    device_id: uuid::Uuid,
    device_barcode: Option<String>,
    device_source_device_code: Option<String>,
    device_kind: String,
    device_original_kind: Option<String>,
    device_brand: Option<String>,
    device_model: Option<String>,
    building_name: String,
    building_address: String,
    location_description: Option<String>,
    wing: Option<String>,
    floor: Option<String>,
    room: Option<String>,
    net_price: Decimal,
    currency: String,
    url: Option<String>,
    line_count: i64,
}

#[derive(Serialize, sqlx::FromRow)]
struct AdminProposalLineDbRow {
    proposal_line_id: uuid::Uuid,
    position: i32,
    item: String,
    quantity: Decimal,
    uom: String,
    net_unit_price: Decimal,
}

#[derive(Serialize)]
pub struct AdminProposalLineRow {
    proposal_line_id: uuid::Uuid,
    position: i32,
    item: String,
    quantity: String,
    uom: String,
    net_unit_price: String,
    line_total: String,
}

#[derive(Serialize)]
pub struct AdminProposalListResponseRow {
    proposal_id: uuid::Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    created_by_name: Option<String>,
    device_id: uuid::Uuid,
    device_barcode: Option<String>,
    device_source_device_code: Option<String>,
    device_kind: String,
    device_original_kind: Option<String>,
    device_brand: Option<String>,
    device_model: Option<String>,
    building_name: String,
    building_address: String,
    location_description: Option<String>,
    wing: Option<String>,
    floor: Option<String>,
    room: Option<String>,
    net_price: String,
    currency: String,
    line_count: i64,
    url: Option<String>,
}

#[derive(Serialize)]
pub struct AdminProposalDetailResponse {
    proposal_id: uuid::Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
    created_by_name: Option<String>,
    created_by_email: Option<String>,
    device_id: uuid::Uuid,
    device_barcode: Option<String>,
    device_source_device_code: Option<String>,
    device_kind: String,
    device_original_kind: Option<String>,
    device_brand: Option<String>,
    device_model: Option<String>,
    building_name: String,
    building_address: String,
    location_description: Option<String>,
    wing: Option<String>,
    floor: Option<String>,
    room: Option<String>,
    net_price: String,
    currency: String,
    url: Option<String>,
    line_count: i64,
    lines: Vec<AdminProposalLineRow>,
}

#[derive(sqlx::FromRow)]
struct ProposalPdfCoreRow {
    proposal_id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    url: Option<String>,
    proposal_generated_at: String,
    proposal_created_date_display: String,
    proposal_created_date: String,
    created_by_name: Option<String>,
    device_source_device_code: Option<String>,
    device_kind: String,
    device_brand: Option<String>,
    device_model: Option<String>,
    building_address: String,
    location_description: Option<String>,
    wing: Option<String>,
    floor: Option<String>,
    room: Option<String>,
    net_price: Decimal,
    proposal_note: String,
}

#[derive(sqlx::FromRow)]
struct ProposalPdfLineRow {
    position: i32,
    item: String,
    quantity: Decimal,
    uom: String,
    net_unit_price: Decimal,
}

struct ProposalPdfSnapshot {
    core: ProposalPdfCoreRow,
    lines: Vec<ProposalPdfLineRow>,
}

#[derive(Serialize)]
struct ProposalRenderLine {
    position: i32,
    item: String,
    quantity: String,
    uom: String,
    net_unit_price: String,
    line_total: String,
}

fn decimal_to_string(value: Decimal) -> String {
    value.to_string()
}

fn normalize_text(value: &str) -> String {
    value.trim().replace(',', ".")
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

fn proposal_filename(building_address: &str, proposal_created_date: &str, proposal_id: uuid::Uuid) -> String {
    let building_address = sanitize_filename_component(building_address);
    let building_address = if building_address.is_empty() {
        "ismeretlen-helyszin".to_string()
    } else {
        building_address
    };

    let proposal_created_date = if proposal_created_date.trim().is_empty() {
        "00000000".to_string()
    } else {
        proposal_created_date.to_string()
    };

    let proposal_id_short = proposal_id
        .to_string()
        .replace('-', "")
        .chars()
        .take(8)
        .collect::<String>();

    format!("NoMa_ajanlat_{building_address}_{proposal_created_date}_{proposal_id_short}.pdf")
}

fn proposal_device_kind_label(kind: &str) -> String {
    match kind {
        "WINDOW_AIR_CONDITIONER" => "Ablakklíma".to_string(),
        "FAN_COIL" | "COMFORT_FAN_COIL" => "Komfort Fan-Coil".to_string(),
        "AIR_CURTAIN" => "Légfüggöny".to_string(),
        "FAN_COIL_UNIT" => "Fan-coil".to_string(),
        "SPLIT_UNIT" => "Komfort Split".to_string(),
        "SPLIT_INDOOR_UNIT" => "Split beltéri".to_string(),
        "SERVER_ROOM_SPLIT_INDOOR_UNIT" => "Szerver Split".to_string(),
        "INDOOR_UNIT" => "Beltéri egység".to_string(),
        "AIR_HANDLING_UNIT" => "Légkezelő".to_string(),
        "CONDENSER" => "Kondenzátor".to_string(),
        "FAN" => "Ventilátor".to_string(),
        "AIR_HANDLER_UNIT" => "Légkezelő".to_string(),
        "VRV_INDOOR_UNIT" => "VRV beltéri".to_string(),
        "VRV_OUTDOOR_UNIT" => "VRV kültéri".to_string(),
        "VRF_OUTDOOR_UNIT" => "VRV kültéri".to_string(),
        "LIQUID_CHILLER" | "CHILLER" => "Folyadékhűtő".to_string(),
        other => other.to_string(),
    }
}

fn proposal_brand_model(brand: Option<&str>, model: Option<&str>) -> String {
    match (
        brand.map(str::trim).filter(|value| !value.is_empty()),
        model.map(str::trim).filter(|value| !value.is_empty()),
    ) {
        (Some(brand), Some(model)) => format!("{brand} / {model}"),
        (Some(brand), None) => brand.to_string(),
        (None, Some(model)) => model.to_string(),
        (None, None) => "-".to_string(),
    }
}

fn proposal_identifier(source_device_code: Option<&str>) -> String {
    source_device_code
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("-")
        .to_string()
}

fn proposal_location(
    floor: Option<&str>,
    wing: Option<&str>,
    room: Option<&str>,
    location_description: Option<&str>,
) -> String {
    let parts = [
        floor.map(str::trim).filter(|value| !value.is_empty()),
        wing.map(str::trim).filter(|value| !value.is_empty()),
        room.map(str::trim).filter(|value| !value.is_empty()),
        location_description
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    if parts.is_empty() {
        "-".to_string()
    } else {
        parts.join(" / ")
    }
}

fn proposal_attachment_response(snapshot: &ProposalPdfSnapshot, pdf_bytes: Vec<u8>) -> Response {
    let filename = proposal_pdf_attachment_filename(snapshot);
    let content_disposition = format!("attachment; filename=\"{filename}\"");

    ([
        (header::CONTENT_TYPE, "application/pdf"),
        (header::CONTENT_DISPOSITION, content_disposition.as_str()),
    ], pdf_bytes)
        .into_response()
}

fn build_proposal_form(snapshot: &ProposalPdfSnapshot) -> Result<Form, ApiError> {
    let lines: Vec<ProposalRenderLine> = snapshot
        .lines
        .iter()
        .map(|line| {
            let line_total = line.quantity * line.net_unit_price;
            ProposalRenderLine {
                position: line.position,
                item: line.item.clone(),
                quantity: decimal_to_string(line.quantity),
                uom: line.uom.clone(),
                net_unit_price: decimal_to_string(line.net_unit_price),
                line_total: decimal_to_string(line_total),
            }
        })
        .collect();

    let device_type = proposal_device_kind_label(&snapshot.core.device_kind);
    let brand_model = proposal_brand_model(
        snapshot.core.device_brand.as_deref(),
        snapshot.core.device_model.as_deref(),
    );
    let device_name = if brand_model == "-" {
        device_type.clone()
    } else {
        format!("{device_type} · {brand_model}")
    };

    let total_display = format!("{} Ft", decimal_to_string(snapshot.core.net_price));

    let args = serde_json::json!({
        "lines": lines,
    })
    .to_string();

    Ok(Form::new()
        .part(
            "template",
            Part::bytes(PROPOSAL_TEMPLATE.as_bytes().to_vec())
                .file_name(PROPOSAL_TEMPLATE_FILENAME)
                .mime_str("application/vnd.typst")
                .map_err(ApiError::internal)?,
        )
        .text("proposal_id", snapshot.core.proposal_id.to_string())
        .text("proposal_generated_at", snapshot.core.proposal_generated_at.clone())
        .text("proposal_created_at", snapshot.core.proposal_created_date_display.clone())
        .text("proposal_created_by", snapshot.core.created_by_name.clone().unwrap_or_else(|| "-".to_string()))
        .text("proposal_building_address", snapshot.core.building_address.clone())
        .text("proposal_device_name", device_name)
        .text("proposal_device_type", device_type)
        .text("proposal_device_brand_model", brand_model)
        .text("proposal_device_identifier", proposal_identifier(snapshot.core.device_source_device_code.as_deref()))
        .text(
            "proposal_device_location",
            proposal_location(
                snapshot.core.floor.as_deref(),
                snapshot.core.wing.as_deref(),
                snapshot.core.room.as_deref(),
                snapshot.core.location_description.as_deref(),
            ),
        )
        .text("proposal_net_price", total_display)
        .text("proposal_note", snapshot.core.proposal_note.clone())
        .text("args", args)
        .part(
            "logo_path",
            Part::bytes(PROPOSAL_LOGO.to_vec())
                .file_name(PROPOSAL_LOGO_FILENAME)
                .mime_str("image/png")
                .map_err(ApiError::internal)?,
        ))
}

async fn generate_proposal_pdf(
    renderer: &TypstRenderClient,
    snapshot: &ProposalPdfSnapshot,
) -> Result<Vec<u8>, ApiError> {
    let form = build_proposal_form(snapshot)?;
    renderer.render_typst(form).await.map_err(ApiError::internal)
}

async fn store_proposal_pdf(
    tx: &mut Transaction<'_, Postgres>,
    storage: &StorageConfig,
    snapshot: &ProposalPdfSnapshot,
    pdf_bytes: &[u8],
) -> Result<String, ApiError> {
    let filename = proposal_filename(
        &snapshot.core.building_address,
        &snapshot.core.proposal_created_date,
        snapshot.core.proposal_id,
    );
    let object_name = proposal_object_name(
        storage,
        snapshot.core.tenant_id,
        snapshot.core.proposal_id,
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
        UPDATE proposals
        SET url = $3
        WHERE tenant_id = $1
          AND id = $2
          AND url IS NULL
        "#,
    )
    .bind(snapshot.core.tenant_id)
    .bind(snapshot.core.proposal_id)
    .bind(&object_name)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    if updated.rows_affected() != 1 {
        return Err(ApiError::conflict(
            "proposal PDF could not be stored for the current proposal",
        ));
    }

    Ok(object_name)
}

async fn download_existing_pdf(
    storage: &StorageConfig,
    snapshot: &ProposalPdfSnapshot,
    object_name: &str,
) -> Result<Response, ApiError> {
    let pdf_bytes = Object::download(&storage.bucket, object_name)
        .await
        .map_err(ApiError::internal)?;

    Ok(proposal_attachment_response(snapshot, pdf_bytes))
}

async fn load_admin_proposal_list_row(
    pool: &sqlx::PgPool,
    tenant_id: uuid::Uuid,
) -> Result<Vec<AdminProposalListRow>, ApiError> {
    sqlx::query_as::<_, AdminProposalListRow>(
        r#"
        SELECT
            p.id AS proposal_id,
            p.created_at,
            cu.full_name AS created_by_name,
            d.id AS device_id,
            bc.code AS device_barcode,
            NULLIF(BTRIM(d.source_device_code), '') AS device_source_device_code,
            d.kind::text AS device_kind,
            d.original_kind AS device_original_kind,
            d.brand AS device_brand,
            d.model AS device_model,
            b.name AS building_name,
            b.address AS building_address,
            sl.location_description,
            sl.wing,
            sl.floor,
            sl.room,
            p.net_price,
            p.currency,
            COALESCE(
                (
                    SELECT COUNT(*)::bigint
                    FROM proposal_lines pl
                    WHERE pl.tenant_id = p.tenant_id
                      AND pl.proposal_id = p.id
                ),
                0
            ) AS line_count,
            p.url
        FROM proposals p
        JOIN devices d
          ON d.tenant_id = p.tenant_id
         AND d.id = p.device_id
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        JOIN buildings b
          ON b.tenant_id = sl.tenant_id
         AND b.id = sl.building_id
        LEFT JOIN barcodes bc
          ON bc.tenant_id = d.tenant_id
         AND bc.device_id = d.id
         AND bc.deactivated_at IS NULL
        LEFT JOIN users cu
          ON cu.tenant_id = p.tenant_id
         AND cu.id = p.created_by
        WHERE p.tenant_id = $1
        ORDER BY p.created_at DESC, p.id DESC
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)
}

async fn load_admin_proposal_detail_row(
    pool: &sqlx::PgPool,
    tenant_id: uuid::Uuid,
    proposal_id: uuid::Uuid,
) -> Result<AdminProposalDetailRow, ApiError> {
    sqlx::query_as::<_, AdminProposalDetailRow>(
        r#"
        SELECT
            p.id AS proposal_id,
            p.created_at,
            cu.full_name AS created_by_name,
            cu.email::text AS created_by_email,
            d.id AS device_id,
            bc.code AS device_barcode,
            NULLIF(BTRIM(d.source_device_code), '') AS device_source_device_code,
            d.kind::text AS device_kind,
            d.original_kind AS device_original_kind,
            d.brand AS device_brand,
            d.model AS device_model,
            b.name AS building_name,
            b.address AS building_address,
            sl.location_description,
            sl.wing,
            sl.floor,
            sl.room,
            p.net_price,
            p.currency,
            p.url,
            COALESCE(
                (
                    SELECT COUNT(*)::bigint
                    FROM proposal_lines pl
                    WHERE pl.tenant_id = p.tenant_id
                      AND pl.proposal_id = p.id
                ),
                0
            ) AS line_count
        FROM proposals p
        JOIN devices d
          ON d.tenant_id = p.tenant_id
         AND d.id = p.device_id
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        JOIN buildings b
          ON b.tenant_id = sl.tenant_id
         AND b.id = sl.building_id
        LEFT JOIN barcodes bc
          ON bc.tenant_id = d.tenant_id
         AND bc.device_id = d.id
         AND bc.deactivated_at IS NULL
        LEFT JOIN users cu
          ON cu.tenant_id = p.tenant_id
         AND cu.id = p.created_by
        WHERE p.tenant_id = $1
          AND p.id = $2
        "#,
    )
    .bind(tenant_id)
    .bind(proposal_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("Az ajánlat nem található a jelenlegi tenanthez."))
}

async fn load_admin_proposal_lines(
    pool: &sqlx::PgPool,
    tenant_id: uuid::Uuid,
    proposal_id: uuid::Uuid,
) -> Result<Vec<AdminProposalLineDbRow>, ApiError> {
    sqlx::query_as::<_, AdminProposalLineDbRow>(
        r#"
        SELECT
            pl.id AS proposal_line_id,
            pl.position,
            pl.item,
            pl.quantity,
            pl.uom,
            pl.net_unit_price
        FROM proposal_lines pl
        WHERE pl.tenant_id = $1
          AND pl.proposal_id = $2
        ORDER BY pl.position ASC, pl.id ASC
        "#,
    )
    .bind(tenant_id)
    .bind(proposal_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::internal)
}

async fn load_proposal_pdf_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    tenant_id: uuid::Uuid,
    proposal_id: uuid::Uuid,
) -> Result<ProposalPdfSnapshot, ApiError> {
    let core = sqlx::query_as::<_, ProposalPdfCoreRow>(
        r#"
        SELECT
            p.id AS proposal_id,
            p.tenant_id,
            p.url,
            to_char(timezone('Europe/Budapest', clock_timestamp()), 'YYYY.MM.DD. HH24:MI') AS proposal_generated_at,
            to_char(timezone('Europe/Budapest', p.created_at), 'YYYY.MM.DD.') AS proposal_created_date_display,
            to_char(timezone('Europe/Budapest', p.created_at), 'YYYYMMDD') AS proposal_created_date,
            cu.full_name AS created_by_name,
            NULLIF(BTRIM(d.source_device_code), '') AS device_source_device_code,
            d.kind::text AS device_kind,
            d.brand AS device_brand,
            d.model AS device_model,
            b.address AS building_address,
            sl.location_description,
            sl.wing,
            sl.floor,
            sl.room,
            p.net_price,
            COALESCE(NULLIF(BTRIM(p.note), ''), '') AS proposal_note
        FROM proposals p
        JOIN devices d
          ON d.tenant_id = p.tenant_id
         AND d.id = p.device_id
        JOIN site_locations sl
          ON sl.tenant_id = d.tenant_id
         AND sl.id = d.location_id
        JOIN buildings b
          ON b.tenant_id = sl.tenant_id
         AND b.id = sl.building_id
        LEFT JOIN users cu
          ON cu.tenant_id = p.tenant_id
          AND cu.id = p.created_by
        WHERE p.tenant_id = $1
          AND p.id = $2
        FOR UPDATE OF p
        "#,
    )
    .bind(tenant_id)
    .bind(proposal_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::internal)?
    .ok_or_else(|| ApiError::forbidden("Az ajánlat nem található a jelenlegi tenanthez."))?;

    let lines = sqlx::query_as::<_, ProposalPdfLineRow>(
        r#"
        SELECT
            pl.position,
            pl.item,
            pl.quantity,
            pl.uom,
            pl.net_unit_price
        FROM proposal_lines pl
        WHERE pl.tenant_id = $1
          AND pl.proposal_id = $2
        ORDER BY pl.position ASC, pl.id ASC
        "#,
    )
    .bind(tenant_id)
    .bind(proposal_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(ApiError::internal)?;

    Ok(ProposalPdfSnapshot { core, lines })
}

fn proposal_pdf_attachment_filename(snapshot: &ProposalPdfSnapshot) -> String {
    proposal_filename(
        &snapshot.core.building_address,
        &snapshot.core.proposal_created_date,
        snapshot.core.proposal_id,
    )
}

fn response_line_from_db(line: AdminProposalLineDbRow) -> AdminProposalLineRow {
    let line_total = line.quantity * line.net_unit_price;

    AdminProposalLineRow {
        proposal_line_id: line.proposal_line_id,
        position: line.position,
        item: line.item,
        quantity: decimal_to_string(line.quantity),
        uom: line.uom,
        net_unit_price: decimal_to_string(line.net_unit_price),
        line_total: decimal_to_string(line_total),
    }
}

fn response_list_row(row: AdminProposalListRow) -> AdminProposalListResponseRow {
    AdminProposalListResponseRow {
        proposal_id: row.proposal_id,
        created_at: row.created_at,
        created_by_name: row.created_by_name,
        device_id: row.device_id,
        device_barcode: row.device_barcode,
        device_source_device_code: row.device_source_device_code,
        device_kind: row.device_kind,
        device_original_kind: row.device_original_kind,
        device_brand: row.device_brand,
        device_model: row.device_model,
        building_name: row.building_name,
        building_address: row.building_address,
        location_description: row.location_description,
        wing: row.wing,
        floor: row.floor,
        room: row.room,
        net_price: decimal_to_string(row.net_price),
        currency: row.currency,
        line_count: row.line_count,
        url: row.url,
    }
}

fn response_detail_row(row: AdminProposalDetailRow, lines: Vec<AdminProposalLineRow>) -> AdminProposalDetailResponse {
    AdminProposalDetailResponse {
        proposal_id: row.proposal_id,
        created_at: row.created_at,
        created_by_name: row.created_by_name,
        created_by_email: row.created_by_email,
        device_id: row.device_id,
        device_barcode: row.device_barcode,
        device_source_device_code: row.device_source_device_code,
        device_kind: row.device_kind,
        device_original_kind: row.device_original_kind,
        device_brand: row.device_brand,
        device_model: row.device_model,
        building_name: row.building_name,
        building_address: row.building_address,
        location_description: row.location_description,
        wing: row.wing,
        floor: row.floor,
        room: row.room,
        net_price: decimal_to_string(row.net_price),
        currency: row.currency,
        url: row.url,
        line_count: row.line_count,
        lines,
    }
}

fn validate_decimal_field(label: &str, raw_value: &str, allow_zero: bool) -> Result<Decimal, ApiError> {
    let normalized = normalize_text(raw_value);
    if normalized.is_empty() {
        return Err(ApiError::bad_request(match label {
            "quantity" => "A mennyiség megadása kötelező.",
            "net unit price" => "A nettó egységár megadása kötelező.",
            _ => "Érvénytelen érték.",
        }));
    }

    let value = Decimal::from_str(&normalized)
        .map_err(|_| ApiError::bad_request(match label {
            "quantity" => "Érvénytelen mennyiség.",
            "net unit price" => "Érvénytelen nettó egységár.",
            _ => "Érvénytelen érték.",
        }))?;

    if allow_zero {
        if value < Decimal::ZERO {
            return Err(ApiError::bad_request(match label {
                "net unit price" => "A nettó egységár nem lehet negatív.",
                _ => "Az érték nem lehet negatív.",
            }));
        }
    } else if value <= Decimal::ZERO {
        return Err(ApiError::bad_request(match label {
            "quantity" => "A mennyiségnek nagyobbnak kell lennie nullánál.",
            _ => "Az értéknek nagyobbnak kell lennie nullánál.",
        }));
    }

    Ok(value)
}

fn validate_line_request(line: &CreateAdminProposalLineRequest) -> Result<(String, Decimal, String, Decimal), ApiError> {
    let item = line.item.trim();
    if item.is_empty() {
        return Err(ApiError::bad_request("A tétel megadása kötelező."));
    }

    let uom = line.uom.trim();
    if uom.is_empty() {
        return Err(ApiError::bad_request("Az egység megadása kötelező."));
    }

    let quantity = validate_decimal_field("quantity", &line.quantity, false)?;
    let net_unit_price = validate_decimal_field("net unit price", &line.net_unit_price, true)?;

    Ok((item.to_string(), quantity, uom.to_string(), net_unit_price))
}

async fn ensure_proposal_device_exists(
    pool: &sqlx::PgPool,
    tenant_id: uuid::Uuid,
    device_id: uuid::Uuid,
) -> Result<(), ApiError> {
    let device_exists: Option<uuid::Uuid> = sqlx::query_scalar(
        r#"
        SELECT d.id
        FROM devices d
        WHERE d.tenant_id = $1
          AND d.id = $2
        "#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::internal)?;

    if device_exists.is_none() {
        return Err(ApiError::forbidden("A berendezés nem található a jelenlegi tenanthez."));
    }

    Ok(())
}

pub async fn list_admin_proposals(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    let rows = load_admin_proposal_list_row(pool, user.tenant_id)
        .await?
        .into_iter()
        .map(response_list_row)
        .collect::<Vec<_>>();

    Ok(axum::Json(rows))
}

pub async fn get_admin_proposal_detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(proposal_id): Path<uuid::Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    let row = load_admin_proposal_detail_row(pool, user.tenant_id, proposal_id).await?;
    let lines = load_admin_proposal_lines(pool, user.tenant_id, proposal_id)
        .await?
        .into_iter()
        .map(response_line_from_db)
        .collect::<Vec<_>>();

    Ok(axum::Json(response_detail_row(row, lines)))
}

pub async fn create_admin_proposal(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<CreateAdminProposalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let pool = state
        .db_pool
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("database is not configured"))?;
    let user = require_session_user(&state, &headers).await?;
    require_lead_or_admin(&user)?;

    if payload.lines.is_empty() {
        return Err(ApiError::bad_request("Legalább egy tétel megadása kötelező."));
    }

    ensure_proposal_device_exists(pool, user.tenant_id, payload.device_id).await?;
    let mut validated_lines = Vec::with_capacity(payload.lines.len());
    let mut net_price = Decimal::ZERO;

    for line in &payload.lines {
        let (item, quantity, uom, net_unit_price) = validate_line_request(line)?;
        let line_total = quantity * net_unit_price;
        net_price += line_total;
        validated_lines.push((item, quantity, uom, net_unit_price));
    }

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    let proposal_id = sqlx::query_scalar::<_, uuid::Uuid>(
        r#"
        INSERT INTO proposals (
            tenant_id,
            device_id,
            created_by,
            net_price,
            note
        )
        VALUES ($1, $2, $3, $4, NULLIF(BTRIM($5), ''))
        RETURNING id
        "#,
    )
    .bind(user.tenant_id)
    .bind(payload.device_id)
    .bind(user.id)
    .bind(net_price)
    .bind(&payload.note)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::internal)?;

    for (index, (item, quantity, uom, net_unit_price)) in validated_lines.into_iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO proposal_lines (
                tenant_id,
                proposal_id,
                position,
                item,
                quantity,
                uom,
                net_unit_price
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(user.tenant_id)
        .bind(proposal_id)
        .bind((index + 1) as i32)
        .bind(item)
        .bind(quantity)
        .bind(uom)
        .bind(net_unit_price)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::internal)?;
    }

    tx.commit().await.map_err(ApiError::internal)?;

    let detail_row = load_admin_proposal_detail_row(pool, user.tenant_id, proposal_id).await?;
    let detail_lines = load_admin_proposal_lines(pool, user.tenant_id, proposal_id)
        .await?
        .into_iter()
        .map(response_line_from_db)
        .collect::<Vec<_>>();

    Ok((StatusCode::CREATED, axum::Json(response_detail_row(detail_row, detail_lines))))
}

pub async fn get_admin_proposal_pdf(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(proposal_id): Path<uuid::Uuid>,
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

    let mut tx = pool.begin().await.map_err(ApiError::internal)?;
    let snapshot = load_proposal_pdf_snapshot(&mut tx, user.tenant_id, proposal_id).await?;

    if let Some(url) = snapshot.core.url.as_deref() {
        tx.commit().await.map_err(ApiError::internal)?;
        return download_existing_pdf(storage, &snapshot, url).await;
    }

    let renderer = state
        .typst_renderer
        .as_ref()
        .ok_or_else(|| ApiError::service_unavailable("worksheet render service is not configured"))?;

    let pdf_bytes = match generate_proposal_pdf(renderer, &snapshot).await {
        Ok(bytes) => bytes,
        Err(err) => {
            let _ = tx.rollback().await;
            return Err(err);
        }
    };

    let _ = store_proposal_pdf(&mut tx, storage, &snapshot, &pdf_bytes).await?;
    tx.commit().await.map_err(ApiError::internal)?;

    Ok(proposal_attachment_response(&snapshot, pdf_bytes))
}

#[cfg(test)]
mod tests {
    use super::proposal_filename;

    #[test]
    fn formats_the_requested_proposal_filename() {
        let filename = proposal_filename(
            "Budapest, Kossuth tér 2-4.",
            "20260412",
            uuid::Uuid::parse_str("dfcc66ea-0000-0000-0000-000000000000")
                .expect("valid uuid"),
        );

        assert_eq!(filename, "NoMa_ajanlat_Budapest-Kossuth-ter-2-4_20260412_dfcc66ea.pdf");
    }
}
