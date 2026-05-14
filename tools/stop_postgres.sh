#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/load_env.sh" "${SCRIPT_DIR}/../.dev.env"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Export it before running this script." >&2
  exit 1
fi

REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/postgres-dev"
LOCAL_PG_DATA_DIR="${POSTGRES_DATA_DIR:-${BUILD_DIR}/postgres-data}"
REQUESTED_PG_MAJOR="${POSTGRES_VERSION:-}"
REQUESTED_PG_MAJOR="${REQUESTED_PG_MAJOR%%.*}"
LOCAL_PG_OWNER="${SUDO_USER:-$(id -un)}"

detect_pg_bin_dir() {
  if [ -n "${REQUESTED_PG_MAJOR}" ] && [ -x "/usr/lib/postgresql/${REQUESTED_PG_MAJOR}/bin/pg_ctl" ]; then
    printf '%s\n' "/usr/lib/postgresql/${REQUESTED_PG_MAJOR}/bin"
    return 0
  fi

  local detected
  detected="$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "${detected}" ] && [ -x "${detected}/bin/pg_ctl" ]; then
    printf '%s\n' "${detected}/bin"
    return 0
  fi

  return 1
}

run_as_local_pg_owner() {
  if [ "$(id -un)" = "${LOCAL_PG_OWNER}" ]; then
    "$@"
    return 0
  fi

  sudo -u "${LOCAL_PG_OWNER}" "$@"
}

PG_BIN_DIR="$(detect_pg_bin_dir || true)"
PG_CTL_BIN="${PG_BIN_DIR:+${PG_BIN_DIR}/pg_ctl}"

if [ ! -d "${LOCAL_PG_DATA_DIR}" ]; then
  if command -v dropdb >/dev/null 2>&1; then
    echo "No local PostgreSQL data directory found; dropping the database from DATABASE_URL..."
    dropdb --if-exists "${DATABASE_URL}"
    echo "Database removed."
    exit 0
  fi

  echo "No local PostgreSQL data directory found at ${LOCAL_PG_DATA_DIR}." >&2
  echo "dropdb is not available, so nothing was deleted." >&2
  exit 1
fi

if [ -x "${PG_CTL_BIN}" ] && run_as_local_pg_owner "${PG_CTL_BIN}" -D "${LOCAL_PG_DATA_DIR}" status >/dev/null 2>&1; then
  echo "Stopping local PostgreSQL cluster..."
  run_as_local_pg_owner "${PG_CTL_BIN}" -D "${LOCAL_PG_DATA_DIR}" stop -m fast >/dev/null
fi

echo "Deleting local PostgreSQL data..."
run_as_local_pg_owner rm -rf "${BUILD_DIR}"

echo "Local PostgreSQL data removed."
