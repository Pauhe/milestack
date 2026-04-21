#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-rehearsal-local}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
BACKEND_PORT="${REHEARSAL_BACKEND_PORT:-4100}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
RESULT_PATH="${REHEARSAL_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-verification.json}"
BACKEND_LOG_PATH="${REHEARSAL_BACKEND_LOG_PATH:-/tmp/milestack-rehearsal-backend.log}"

MANAGE_BACKEND="${REHEARSAL_MANAGE_BACKEND:-1}"

cleanup() {
  if [[ -n "${MANAGED_BACKEND_PID:-}" ]]; then
    kill "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

log() {
  printf '[verify-s01] %s\n' "$1"
}

wait_for_backend() {
  local attempts=40
  local delay_seconds=0.25

  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "${BACKEND_URL}/health" >/dev/null 2>&1; then
      return 0
    fi

    sleep "${delay_seconds}"
  done

  return 1
}

log "environment=${DEPLOY_ENVIRONMENT} backend=${BACKEND_URL} rpc=${RPC_URL}"

if [[ "${SKIP_REHEARSAL_STACK:-0}" != "1" ]]; then
  log "phase=stack-bootstrap status=running"
  DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT}" \
  SKIP_FACTORY_DEPLOY="${SKIP_FACTORY_DEPLOY:-1}" \
  "${ROOT_DIR}/scripts/rehearsal-stack.sh"
  log "phase=stack-bootstrap status=complete"
else
  log "phase=stack-bootstrap status=skipped reason=SKIP_REHEARSAL_STACK"
fi

log "phase=runtime-bootstrap status=running"
(
  cd "${ROOT_DIR}/backend"
  DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
  BACKEND_URL="${BACKEND_URL}" \
  RPC_URL="${RPC_URL}" \
  REHEARSAL_MODE="bootstrap" \
  REHEARSAL_RESULT_PATH="${RESULT_PATH}" \
  node --import tsx ./../scripts/rehearse-journeys.ts
)
log "phase=runtime-bootstrap status=complete"

if [[ "${MANAGE_BACKEND}" == "1" ]]; then
  log "phase=backend-managed-start status=running"
  (
    cd "${ROOT_DIR}/backend"
    DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
    RPC_URL="${RPC_URL}" \
    PORT="${BACKEND_PORT}" \
    npm run dev
  ) >"${BACKEND_LOG_PATH}" 2>&1 &
  MANAGED_BACKEND_PID=$!

  if ! wait_for_backend; then
    log "phase=backend-managed-start status=failed reason=backend-unreachable log=${BACKEND_LOG_PATH}"
    exit 1
  fi

  log "phase=backend-managed-start status=complete pid=${MANAGED_BACKEND_PID} log=${BACKEND_LOG_PATH}"
else
  if ! curl --fail --silent --show-error "${BACKEND_URL}/health" >/dev/null; then
    log "phase=preflight status=failed reason=backend-unreachable url=${BACKEND_URL}/health"
    exit 1
  fi
fi

log "phase=journey-rehearsal status=running"
(
  cd "${ROOT_DIR}/backend"
  DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
  BACKEND_URL="${BACKEND_URL}" \
  RPC_URL="${RPC_URL}" \
  REHEARSAL_MODE="execute" \
  REHEARSAL_RESULT_PATH="${RESULT_PATH}" \
  node --import tsx ./../scripts/rehearse-journeys.ts
)
log "phase=journey-rehearsal status=complete"

if [[ -f "${ROOT_DIR}/${RESULT_PATH}" ]]; then
  log "artifact=${RESULT_PATH}"
else
  log "phase=artifact-check status=failed reason=missing-artifact path=${RESULT_PATH}"
  exit 1
fi

log "status=complete"
