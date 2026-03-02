#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/load_env.sh" "${SCRIPT_DIR}/../.dev.env"

DB_HOST="${POSTGRES_HOST:-127.0.0.1}"
DB_PORT="${POSTGRES_PORT:-5432}"
export PGPASSWORD="${POSTGRES_PASSWORD}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed or not on PATH" >&2
  exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to bootstrap the PostgreSQL role and database" >&2
  exit 1
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 postgres <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}');
    ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}');
    END IF;
END
\$\$;
SQL

database_exists=false
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
  database_exists=true
fi

if [ "${database_exists}" = true ]; then
  printf "Database '%s' already exists. Clear and recreate it first? [y/N] " "${POSTGRES_DB}"
  read -r should_clear

  case "${should_clear}" in
    y|Y|yes|YES)
      sudo -u postgres dropdb "${POSTGRES_DB}"
      sudo -u postgres createdb -O "${POSTGRES_USER}" "${POSTGRES_DB}"
      ;;
    *)
      echo "Keeping existing database '${POSTGRES_DB}' unchanged."
      exit 0
      ;;
  esac
else
  sudo -u postgres createdb -O "${POSTGRES_USER}" "${POSTGRES_DB}"
fi

for _ in {1..30}; do
  if pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  echo "PostgreSQL is not reachable on ${DB_HOST}:${DB_PORT}/${POSTGRES_DB} for user ${POSTGRES_USER}" >&2
  exit 1
fi

psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/../database/setup.sql"

psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/../database/dev_data.sql"
