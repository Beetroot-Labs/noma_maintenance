#!/usr/bin/env bash
# Usage: add_user.sh --tenant <name|id> --name <full name> --email <email> [options]
#
# Options:
#   --tenant    Tenant name or UUID (required)
#   --name      Full name (required)
#   --email     Email address (required)
#   --role      TECHNICIAN | LEAD_TECHNICIAN | ADMIN  (default: TECHNICIAN)
#   --phone     Phone number (optional)
#   --env       Path to env file with DATABASE_URL  (default: ./.dev.env)
#
# Reads DATABASE_URL from the env file or the current environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TENANT=""
FULL_NAME=""
EMAIL=""
ROLE="TECHNICIAN"
PHONE=""
ENV_FILE="${SCRIPT_DIR}/../.dev.env"

# --- argument parsing ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant) TENANT="$2";  shift 2 ;;
    --name)   FULL_NAME="$2"; shift 2 ;;
    --email)  EMAIL="$2";   shift 2 ;;
    --role)   ROLE="$2";    shift 2 ;;
    --phone)  PHONE="$2";   shift 2 ;;
    --env)    ENV_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# --- validation ---
if [[ -z "$TENANT" || -z "$FULL_NAME" || -z "$EMAIL" ]]; then
  echo "Usage: $0 --tenant <name|id> --name <full name> --email <email> [--role TECHNICIAN|LEAD_TECHNICIAN|ADMIN] [--phone <number>] [--env <path>]" >&2
  exit 1
fi

case "$ROLE" in
  TECHNICIAN|LEAD_TECHNICIAN|ADMIN) ;;
  *) echo "Invalid role '$ROLE'. Must be one of: TECHNICIAN, LEAD_TECHNICIAN, ADMIN" >&2; exit 1 ;;
esac

# --- load env file if DATABASE_URL not already set ---
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Provide it via environment or --env <path>" >&2
  exit 1
fi

# --- resolve tenant ---
# Accept either a UUID or a tenant name.
if [[ "$TENANT" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  TENANT_QUERY="SELECT id FROM tenants WHERE id = '${TENANT}'"
else
  TENANT_QUERY="SELECT id FROM tenants WHERE name = '${TENANT}'"
fi

TENANT_ID=$(psql "$DATABASE_URL" -t -A -c "$TENANT_QUERY" 2>/dev/null)

if [[ -z "$TENANT_ID" ]]; then
  echo "Tenant not found: $TENANT" >&2
  echo ""
  echo "Existing tenants:"
  psql "$DATABASE_URL" -c "SELECT id, name FROM tenants ORDER BY name;" 2>/dev/null || true
  exit 1
fi

# --- build phone expression ---
if [[ -n "$PHONE" ]]; then
  PHONE_EXPR="'${PHONE}'"
else
  PHONE_EXPR="NULL"
fi

# --- insert user ---
SQL=$(cat <<SQL
INSERT INTO users (tenant_id, full_name, email, phone_number, role)
VALUES (
  '${TENANT_ID}',
  '${FULL_NAME}',
  '${EMAIL}',
  ${PHONE_EXPR},
  '${ROLE}'::user_role
)
ON CONFLICT (tenant_id, email) DO NOTHING
RETURNING id, full_name, email::text, role::text, phone_number;
SQL
)

RESULT=$(psql "$DATABASE_URL" -t -A -F $'\t' -c "$SQL" 2>&1)

if echo "$RESULT" | grep -q "^ERROR"; then
  echo "Failed to insert user:" >&2
  echo "$RESULT" >&2
  exit 1
fi

if [[ -z "$RESULT" ]]; then
  echo "User with email '$EMAIL' already exists in tenant '$TENANT' — no changes made."
else
  IFS=$'\t' read -r USER_ID RET_NAME RET_EMAIL RET_ROLE RET_PHONE <<< "$RESULT"
  echo "User created successfully:"
  echo "  ID:     $USER_ID"
  echo "  Name:   $RET_NAME"
  echo "  Email:  $RET_EMAIL"
  echo "  Role:   $RET_ROLE"
  echo "  Phone:  ${RET_PHONE:-—}"
  echo "  Tenant: $TENANT_ID"
  echo ""
  echo "The user can now log in with their Google account at $RET_EMAIL."
fi
