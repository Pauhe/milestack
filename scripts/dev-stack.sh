#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -d "${ROOT_DIR}/backend/node_modules" ]]; then
  printf 'backend dependencies missing: run npm install in backend/\n' >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/web/node_modules" ]]; then
  printf 'web dependencies missing: run npm install in web/\n' >&2
  exit 1
fi

printf 'Starting backend on http://localhost:4000\n'
(cd "${ROOT_DIR}/backend" && npm run dev) &
BACKEND_PID=$!

sleep 3

printf 'Triggering backend sync\n'
curl --fail --silent --show-error -X POST "http://localhost:4000/sync" >/dev/null

printf 'Starting web on http://localhost:3000\n'
cd "${ROOT_DIR}/web"
export NEXT_PUBLIC_BACKEND_URL="http://localhost:4000"
npm run dev
