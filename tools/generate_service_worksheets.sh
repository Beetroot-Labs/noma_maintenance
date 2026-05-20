#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.dev.env}"

SHIFT_ID="${1:-}"
BUILDING_CODE="${2:-H011.FMG.K0013.A.00344}"
OUTPUT_DIR="${3:-${REPO_ROOT}/generated/service-worksheets/${SHIFT_ID}}"

if [[ -z "${SHIFT_ID}" ]]; then
  printf 'Usage: %s <shift-id> [building-code] [output-dir]\n' "$0" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Env file not found: %s\n' "${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL is not set\n' >&2
  exit 1
fi

if [[ -z "${GCS_BUCKET:-}" ]]; then
  printf 'GCS_BUCKET is not set\n' >&2
  exit 1
fi

if [[ -z "${SERVICE_ACCOUNT:-}" ]]; then
  printf 'SERVICE_ACCOUNT is not set\n' >&2
  exit 1
fi

command -v psql >/dev/null
command -v typst >/dev/null
command -v jq >/dev/null
command -v file >/dev/null
command -v iconv >/dev/null
command -v gcloud >/dev/null

if [[ "${SERVICE_ACCOUNT}" = /* ]]; then
  SERVICE_ACCOUNT_PATH="${SERVICE_ACCOUNT}"
else
  SERVICE_ACCOUNT_PATH="${REPO_ROOT}/${SERVICE_ACCOUNT}"
fi

if [[ ! -f "${SERVICE_ACCOUNT_PATH}" ]]; then
  printf 'Service account key not found: %s\n' "${SERVICE_ACCOUNT_PATH}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"

WORKDIR="$(mktemp -d "/tmp/opencode/service-worksheet.${SHIFT_ID}.XXXXXX")"
cleanup() {
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

export CLOUDSDK_CONFIG="${WORKDIR}/gcloud-config"
mkdir -p "${CLOUDSDK_CONFIG}"
gcloud --quiet auth activate-service-account --key-file="${SERVICE_ACCOUNT_PATH}" >/dev/null

cp "${REPO_ROOT}/worksheet_templates/service_worksheet.typ" "${WORKDIR}/service_worksheet.typ"
cp "${REPO_ROOT}/frontend/apps/main/public/Noma_logo_color_text_vertical.png" "${WORKDIR}/Noma_logo_color_text_vertical.png"

sanitize_filename_component() {
  local value="$1"
  local sanitized

  sanitized="$(printf '%s' "${value}" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null | tr -c 'A-Za-z0-9' '-')"
  while [[ "${sanitized}" == *--* ]]; do
    sanitized="${sanitized//--/-}"
  done
  sanitized="${sanitized#-}"
  sanitized="${sanitized%-}"

  printf '%s' "${sanitized}"
}

service_worksheet_filename() {
  local building_address="$1"
  local service_date_code="$2"
  local maintenance_id="$3"
  local sanitized_address
  local short_id

  sanitized_address="$(sanitize_filename_component "${building_address}")"
  if [[ -z "${sanitized_address}" ]]; then
    sanitized_address="ismeretlen-helyszin"
  fi

  short_id="${maintenance_id//-/}"
  short_id="${short_id:0:8}"

  if [[ -z "${service_date_code}" ]]; then
    service_date_code="00000000"
  fi

  printf 'NoMa_szerviz_munkalap_%s_%s_%s.pdf' "${sanitized_address}" "${service_date_code}" "${short_id}"
}

mime_type_to_extension() {
  case "$1" in
    image/jpeg) printf 'jpg' ;;
    image/png) printf 'png' ;;
    image/webp) printf 'webp' ;;
    image/heic) printf 'heic' ;;
    image/heif) printf 'heif' ;;
    *) printf 'jpg' ;;
  esac
}

download_gcs_object() {
  local object_name="$1"
  local output_path="$2"

  gcloud --quiet storage cp "gs://${GCS_BUCKET}/${object_name}" "${output_path}" >/dev/null
}

download_image_with_extension() {
  local object_name="$1"
  local output_prefix="$2"
  local raw_path
  local mime_type
  local extension
  local final_path

  raw_path="${output_prefix}.raw"
  download_gcs_object "${object_name}" "${raw_path}"
  mime_type="$(file -b --mime-type "${raw_path}")"
  extension="$(mime_type_to_extension "${mime_type}")"
  final_path="${output_prefix}.${extension}"
  mv "${raw_path}" "${final_path}"

  printf '%s' "${final_path}"
}

current_generated_at="$(TZ=Europe/Budapest date '+%Y.%m.%d. %H:%M')"

core_json="$(psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -At <<SQL
SELECT row_to_json(core_row)::text
FROM (
    SELECT
        s.tenant_id::text AS tenant_id,
        b.address AS building_address,
        COALESCE(NULLIF(BTRIM(ss.reference_person_name), ''), '') AS report_client,
        COALESCE(NULLIF(BTRIM(ss.reference_person_role), ''), '') AS report_client_role,
        COALESCE(NULLIF(BTRIM(ss.signature_image_url), ''), '') AS signature_image_url
    FROM shifts s
    JOIN buildings b
      ON b.tenant_id = s.tenant_id
     AND b.id = s.building_id
    LEFT JOIN shift_signatures ss
      ON ss.tenant_id = s.tenant_id
     AND ss.shift_id = s.id
    WHERE s.id = '${SHIFT_ID}'
) AS core_row
SQL
)"

if [[ -z "${core_json}" ]]; then
  printf 'Shift not found: %s\n' "${SHIFT_ID}" >&2
  exit 1
fi

TENANT_ID="$(jq -r '.tenant_id' <<< "${core_json}")"
BUILDING_ADDRESS="$(jq -r '.building_address' <<< "${core_json}")"
REPORT_CLIENT="$(jq -r '.report_client' <<< "${core_json}")"
REPORT_CLIENT_ROLE="$(jq -r '.report_client_role' <<< "${core_json}")"
SIGNATURE_URL="$(jq -r '.signature_image_url' <<< "${core_json}")"

mapfile -t WORK_ROWS < <(psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -At <<SQL
SELECT row_to_json(work_row)::text
FROM (
    SELECT
        mw.id::text AS maintenance_id,
        mw.id::text AS report_id,
        to_char(timezone('Europe/Budapest', mw.started_at), 'YYYY.MM.DD.') AS service_date,
        to_char(timezone('Europe/Budapest', mw.started_at), 'YYYYMMDD') AS service_date_code,
        COALESCE(NULLIF(BTRIM(mw.issue_number), ''), '-') AS issue_number,
        COALESCE(NULLIF(BTRIM(d.source_device_code), ''), '-') AS device_code,
        COALESCE(NULLIF(BTRIM(bc.code), ''), '-') AS device_barcode,
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
        COALESCE(NULLIF(BTRIM(d.brand), ''), '') AS device_brand,
        COALESCE(NULLIF(BTRIM(d.model), ''), '') AS device_model,
        mu.full_name AS maintainer,
        COALESCE(NULLIF(BTRIM(mw.note), ''), '-') AS note
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
    WHERE mw.tenant_id = '${TENANT_ID}'
      AND mw.shift_id = '${SHIFT_ID}'
      AND mw.kind = 'SERVICE'
    ORDER BY mw.started_at ASC, mw.id ASC
) AS work_row
SQL
)

if [[ ${#WORK_ROWS[@]} -eq 0 ]]; then
  printf 'Shift has no service works: %s\n' "${SHIFT_ID}" >&2
  exit 1
fi

signature_input=""
if [[ -n "${SIGNATURE_URL}" ]]; then
  signature_input="$(download_image_with_extension "${SIGNATURE_URL}" "${WORKDIR}/referent_signature")"
fi

for work_json in "${WORK_ROWS[@]}"; do
  WORK_ID="$(jq -r '.maintenance_id' <<< "${work_json}")"
  SERVICE_DATE="$(jq -r '.service_date' <<< "${work_json}")"
  SERVICE_DATE_CODE="$(jq -r '.service_date_code' <<< "${work_json}")"
  ISSUE_NUMBER="$(jq -r '.issue_number' <<< "${work_json}")"
  DEVICE_CODE="$(jq -r '.device_code' <<< "${work_json}")"
  DEVICE_BARCODE="$(jq -r '.device_barcode' <<< "${work_json}")"
  ROOM="$(jq -r '.room' <<< "${work_json}")"
  DEVICE_TYPE="$(jq -r '.device_type' <<< "${work_json}")"
  DEVICE_BRAND="$(jq -r '.device_brand' <<< "${work_json}")"
  DEVICE_MODEL="$(jq -r '.device_model' <<< "${work_json}")"
  MAINTAINER="$(jq -r '.maintainer' <<< "${work_json}")"
  NOTE="$(jq -r '.note' <<< "${work_json}")"

  photo_args='[]'
  mapfile -t PHOTO_ROWS < <(psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 -At <<SQL
SELECT row_to_json(photo_row)::text
FROM (
    SELECT
        mp.id::text AS photo_id,
        mp.photo_url AS photo_url,
        COALESCE(NULLIF(BTRIM(mp.capture_note), ''), '') AS capture_note
    FROM maintenance_photos mp
    WHERE mp.tenant_id = '${TENANT_ID}'
      AND mp.maintenance_work_id = '${WORK_ID}'
    ORDER BY mp.created_at ASC, mp.id ASC
) AS photo_row
SQL
)

  for photo_json in "${PHOTO_ROWS[@]}"; do
    PHOTO_ID="$(jq -r '.photo_id' <<< "${photo_json}")"
    PHOTO_URL="$(jq -r '.photo_url' <<< "${photo_json}")"
    CAPTURE_NOTE="$(jq -r '.capture_note' <<< "${photo_json}")"
    PHOTO_PREFIX="${WORKDIR}/service_photo_${PHOTO_ID}"
    PHOTO_PATH="$(download_image_with_extension "${PHOTO_URL}" "${PHOTO_PREFIX}")"
    PHOTO_FILE="$(basename "${PHOTO_PATH}")"
    photo_args="$(jq -c --arg path "${PHOTO_FILE}" --arg caption "${CAPTURE_NOTE}" '. + [({path:$path} + (if $caption | length > 0 then {caption:$caption} else {} end))]' <<< "${photo_args}")"
  done

  args_json="$(jq -cn --argjson photos "${photo_args}" '{photos:$photos, images:$photos}')"
  output_filename="$(service_worksheet_filename "${BUILDING_ADDRESS}" "${SERVICE_DATE_CODE}" "${WORK_ID}")"
  output_path="${OUTPUT_DIR}/${output_filename}"

  compile_args=(
    compile
    --root "${WORKDIR}"
    --input "report_id=${WORK_ID}"
    --input "report_generated_at=${current_generated_at}"
    --input "service_date=${SERVICE_DATE}"
    --input "device_code=${DEVICE_CODE}"
    --input "device_barcode=${DEVICE_BARCODE}"
    --input "issue_number=${ISSUE_NUMBER}"
    --input "building_address=${BUILDING_ADDRESS}"
    --input "building_code=${BUILDING_CODE}"
    --input "room=${ROOM}"
    --input "device_type=${DEVICE_TYPE}"
    --input "device_brand=${DEVICE_BRAND}"
    --input "device_model=${DEVICE_MODEL}"
    --input "maintainer=${MAINTAINER}"
    --input "note=${NOTE}"
    --input "referent_name=${REPORT_CLIENT}"
    --input "referent_role=${REPORT_CLIENT_ROLE}"
    --input "logo_path=Noma_logo_color_text_vertical.png"
  )

  if [[ -n "${signature_input}" ]]; then
    compile_args+=(--input "referent_signature_path=$(basename "${signature_input}")")
  fi

  compile_args+=(--input "args=${args_json}" "${WORKDIR}/service_worksheet.typ" "${output_path}")

  typst "${compile_args[@]}"

  printf '%s\n' "${output_path}"
done
