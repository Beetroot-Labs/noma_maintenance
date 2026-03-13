#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/load_env.sh" "${SCRIPT_DIR}/../.dev.env"

DB_HOST="${POSTGRES_HOST:-127.0.0.1}"
DB_PORT="${POSTGRES_PORT:-5432}"
export PGPASSWORD="${POSTGRES_PASSWORD}"
BOOTSTRAP_URL="${POSTGRES_BOOTSTRAP_URL:-}"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/builds"
LOCAL_PG_DATA_DIR="${POSTGRES_DATA_DIR:-${BUILD_DIR}/postgres-data}"
LOCAL_PG_LOG_FILE="${POSTGRES_LOG_FILE:-${BUILD_DIR}/postgres.log}"
REQUESTED_PG_MAJOR="${POSTGRES_VERSION%%.*}"
LOCAL_PG_OWNER="${SUDO_USER:-$(id -un)}"
LOCAL_PG_SUPERUSER="${POSTGRES_LOCAL_SUPERUSER:-${LOCAL_PG_OWNER}}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed or not on PATH" >&2
  exit 1
fi

can_use_sudo_postgres=false
if command -v sudo >/dev/null 2>&1 && sudo -n -u postgres true >/dev/null 2>&1; then
  can_use_sudo_postgres=true
fi

bootstrap_conn_args=(-h "${DB_HOST}" -p "${DB_PORT}")
local_socket_conn_args=(-h "${BUILD_DIR}" -p "${DB_PORT}")
local_bootstrap_superuser=false
attempted_local_cluster=false

detect_pg_bin_dir() {
  if [ -n "${REQUESTED_PG_MAJOR}" ] && [ -x "/usr/lib/postgresql/${REQUESTED_PG_MAJOR}/bin/pg_ctl" ]; then
    printf '%s\n' "/usr/lib/postgresql/${REQUESTED_PG_MAJOR}/bin"
    return
  fi

  local detected
  detected="$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "${detected}" ] && [ -x "${detected}/bin/pg_ctl" ]; then
    printf '%s\n' "${detected}/bin"
  fi
}

PG_BIN_DIR="$(detect_pg_bin_dir || true)"
INITDB_BIN="${PG_BIN_DIR:+${PG_BIN_DIR}/initdb}"
PG_CTL_BIN="${PG_BIN_DIR:+${PG_BIN_DIR}/pg_ctl}"
CREATEDB_BIN="${PG_BIN_DIR:+${PG_BIN_DIR}/createdb}"
DROPPDB_BIN="${PG_BIN_DIR:+${PG_BIN_DIR}/dropdb}"

run_as_local_pg_owner() {
  if [ "$(id -un)" = "${LOCAL_PG_OWNER}" ]; then
    "$@"
    return
  fi

  sudo -u "${LOCAL_PG_OWNER}" "$@"
}

start_local_postgres_if_possible() {
  if [ -n "${BOOTSTRAP_URL}" ]; then
    return 1
  fi
  if [ "${DB_HOST}" != "localhost" ] && [ "${DB_HOST}" != "127.0.0.1" ]; then
    return 1
  fi
  if [ -z "${PG_BIN_DIR}" ] || [ ! -x "${INITDB_BIN}" ] || [ ! -x "${PG_CTL_BIN}" ]; then
    return 1
  fi

  attempted_local_cluster=true
  run_as_local_pg_owner mkdir -p "${BUILD_DIR}"

  if [ ! -d "${LOCAL_PG_DATA_DIR}" ]; then
    echo "Initializing local PostgreSQL cluster in ${LOCAL_PG_DATA_DIR}..."
    run_as_local_pg_owner "${INITDB_BIN}" -D "${LOCAL_PG_DATA_DIR}" -U "${LOCAL_PG_SUPERUSER}" --auth-local=trust --auth-host=trust >/dev/null
  fi

  if ! run_as_local_pg_owner "${PG_CTL_BIN}" -D "${LOCAL_PG_DATA_DIR}" status >/dev/null 2>&1; then
    echo "Starting local PostgreSQL on ${DB_HOST}:${DB_PORT}..."
    run_as_local_pg_owner "${PG_CTL_BIN}" \
      -D "${LOCAL_PG_DATA_DIR}" \
      -l "${LOCAL_PG_LOG_FILE}" \
      -o "-h 127.0.0.1 -p ${DB_PORT} -k ${BUILD_DIR}" \
      start >/dev/null || return 2
  fi

  for _ in {1..30}; do
    if run_as_local_pg_owner env PGGSSENCMODE=disable pg_isready "${local_socket_conn_args[@]}" -U "${LOCAL_PG_SUPERUSER}" -d postgres >/dev/null 2>&1; then
      local_bootstrap_superuser=true
      return 0
    fi
    sleep 1
  done

  return 2
}

bootstrap_psql() {
  if [ -n "${BOOTSTRAP_URL}" ]; then
    psql "${BOOTSTRAP_URL}" -v ON_ERROR_STOP=1 "$@"
    return
  fi
  if [ "${local_bootstrap_superuser}" = true ]; then
    run_as_local_pg_owner env PGGSSENCMODE=disable psql "${local_socket_conn_args[@]}" -U "${LOCAL_PG_SUPERUSER}" -v ON_ERROR_STOP=1 postgres "$@"
    return
  fi

  (
    cd /tmp
    sudo -u postgres psql -v ON_ERROR_STOP=1 "${bootstrap_conn_args[@]}" postgres "$@"
  )
}

bootstrap_createdb() {
  if [ -n "${BOOTSTRAP_URL}" ]; then
    createdb --maintenance-db="${BOOTSTRAP_URL}" -O "${POSTGRES_USER}" "${POSTGRES_DB}"
    return
  fi
  if [ "${local_bootstrap_superuser}" = true ]; then
    run_as_local_pg_owner env PGGSSENCMODE=disable "${CREATEDB_BIN:-createdb}" "${local_socket_conn_args[@]}" -U "${LOCAL_PG_SUPERUSER}" -O "${POSTGRES_USER}" "${POSTGRES_DB}"
    return
  fi

  (
    cd /tmp
    sudo -u postgres createdb "${bootstrap_conn_args[@]}" -O "${POSTGRES_USER}" "${POSTGRES_DB}"
  )
}

bootstrap_dropdb() {
  if [ -n "${BOOTSTRAP_URL}" ]; then
    dropdb --maintenance-db="${BOOTSTRAP_URL}" "${POSTGRES_DB}"
    return
  fi
  if [ "${local_bootstrap_superuser}" = true ]; then
    run_as_local_pg_owner env PGGSSENCMODE=disable "${DROPPDB_BIN:-dropdb}" "${local_socket_conn_args[@]}" -U "${LOCAL_PG_SUPERUSER}" "${POSTGRES_DB}"
    return
  fi

  (
    cd /tmp
    sudo -u postgres dropdb "${bootstrap_conn_args[@]}" "${POSTGRES_DB}"
  )
}

app_db_reachable=false
if PGGSSENCMODE=disable pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  if PGGSSENCMODE=disable psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -v ON_ERROR_STOP=1 \
    -c "SELECT 1" >/dev/null 2>&1; then
    app_db_reachable=true
  fi
fi

if [ "${app_db_reachable}" = false ]; then
  local_start_status=0
  start_local_postgres_if_possible || local_start_status=$?

  if [ "${local_start_status}" -ge 2 ]; then
    echo "Failed to start local PostgreSQL. See ${LOCAL_PG_LOG_FILE} for details." >&2
    exit 1
  fi

  if run_as_local_pg_owner env PGGSSENCMODE=disable pg_isready "${local_socket_conn_args[@]}" -U "${LOCAL_PG_SUPERUSER}" -d postgres >/dev/null 2>&1; then
    local_bootstrap_superuser=true
  fi
fi

if [ "${can_use_sudo_postgres}" = false ] && [ -z "${BOOTSTRAP_URL}" ] && [ "${local_bootstrap_superuser}" = false ] && [ "${app_db_reachable}" = false ]; then
  cat >&2 <<EOF
Cannot bootstrap PostgreSQL automatically.

This script needs one of the following:
1. sudo access to run commands as the postgres OS user, or
2. POSTGRES_BOOTSTRAP_URL set to a PostgreSQL superuser/owner connection string, or
3. an already-running database at ${DB_HOST}:${DB_PORT}/${POSTGRES_DB} reachable as ${POSTGRES_USER}, or
4. local PostgreSQL binaries installed so a dev instance can be initialized automatically

Current issue:
- sudo -u postgres is not permitted for this user on this host
- the target database is not reachable with the app credentials
- a local dev PostgreSQL instance could not be initialized or reached

Set POSTGRES_BOOTSTRAP_URL and rerun, or create the role/database manually first.
EOF
  exit 1
fi

if [ "${can_use_sudo_postgres}" = false ] && [ -z "${BOOTSTRAP_URL}" ] && [ "${local_bootstrap_superuser}" = false ] && [ "${app_db_reachable}" = true ]; then
  echo "Skipping PostgreSQL bootstrap because the target database is already reachable."
else
  if [ "${local_bootstrap_superuser}" = true ]; then
    echo "Bootstrapping PostgreSQL via local dev cluster..."
  elif [ "${can_use_sudo_postgres}" = true ]; then
    echo "Bootstrapping PostgreSQL via sudo as the postgres OS user..."
  else
    echo "Bootstrapping PostgreSQL via POSTGRES_BOOTSTRAP_URL..."
  fi

  bootstrap_psql <<SQL
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
  if bootstrap_psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DB}'" | grep -q 1; then
    database_exists=true
  fi

  if [ "${database_exists}" = true ]; then
    printf "Database '%s' already exists. Clear and recreate it first? [y/N] " "${POSTGRES_DB}"
    read -r should_clear

    case "${should_clear}" in
      y|Y|yes|YES)
        bootstrap_dropdb
        bootstrap_createdb
        ;;
      *)
        echo "Keeping existing database '${POSTGRES_DB}' unchanged."
        exit 0
        ;;
    esac
  else
    bootstrap_createdb
  fi
fi

for _ in {1..30}; do
  if PGGSSENCMODE=disable pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! PGGSSENCMODE=disable pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  echo "PostgreSQL is not reachable on ${DB_HOST}:${DB_PORT}/${POSTGRES_DB} for user ${POSTGRES_USER}" >&2
  exit 1
fi

schema_already_initialized=false
if PGGSSENCMODE=disable psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -tAc "SELECT to_regtype('user_role') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL" | grep -q t; then
  schema_already_initialized=true
fi

if [ "${schema_already_initialized}" = true ]; then
  echo "Database schema already exists in '${POSTGRES_DB}'. Resetting via database/reset_prod.sql..."
  PGGSSENCMODE=disable psql \
    -h "${DB_HOST}" \
    -p "${DB_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -v ON_ERROR_STOP=1 \
    -f "${SCRIPT_DIR}/../database/reset_prod.sql"
  exit 0
fi

PGGSSENCMODE=disable psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/../database/setup.sql"

PGGSSENCMODE=disable psql \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/../database/prod_setup.sql"
