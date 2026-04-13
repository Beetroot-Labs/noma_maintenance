#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Installing frontend workspace dependencies..."
(
  cd "${REPO_ROOT}/frontend"
  npm install --no-audit --no-fund
)

echo "Building main frontend..."
(
  cd "${REPO_ROOT}/frontend"
  npm run build:main
)

echo "Building labeling frontend..."
(
  cd "${REPO_ROOT}/frontend"
  npm run build:labeling
)

echo "Building backend..."
(
  cd "${REPO_ROOT}/backend"
  cargo build --release
)
