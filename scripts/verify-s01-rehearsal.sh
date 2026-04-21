#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-rehearsal-local}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
BACKEND_PORT="${REHEARSAL_BACKEND_PORT:-4100}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
RESULT_PATH="${REHEARSAL_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-verification.json}"
BACKEND_LOG_PATH="${REHEARSAL_BACKEND_LOG_PATH:-/tmp/milestack-rehearsal-backend.log}"
WEB_PORT="${REHEARSAL_WEB_PORT:-3000}"
WEB_URL="${REHEARSAL_WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
WEB_LOG_PATH="${REHEARSAL_WEB_LOG_PATH:-/tmp/milestack-rehearsal-web.log}"
ARTIFACT_DIR="${REHEARSAL_ARTIFACT_DIR:-${ROOT_DIR}/deployments/${DEPLOY_ENVIRONMENT}/browser-evidence}"

MANAGE_BACKEND="${REHEARSAL_MANAGE_BACKEND:-1}"
MANAGE_WEB="${REHEARSAL_MANAGE_WEB:-1}"

cleanup() {
  for port in "${BACKEND_PORT}" "${WEB_PORT}"; do
    while lsof -ti tcp:"${port}" >/dev/null 2>&1; do
      kill "$(lsof -ti tcp:"${port}" | head -n1)" >/dev/null 2>&1 || true
      sleep 0.1
    done
  done

  if [[ -n "${MANAGED_WEB_PID:-}" ]]; then
    kill "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
  fi

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

wait_for_web() {
  local attempts=80
  local delay_seconds=0.25

  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "${WEB_URL}" >/dev/null 2>&1; then
      return 0
    fi

    sleep "${delay_seconds}"
  done

  return 1
}

log "environment=${DEPLOY_ENVIRONMENT} backend=${BACKEND_URL} web=${WEB_URL} rpc=${RPC_URL}"

log "phase=preflight-port-clean status=running"
pkill -f "backend/node_modules/.bin/tsx src/index.ts" >/dev/null 2>&1 || true
pkill -f "web/node_modules/.bin/next dev" >/dev/null 2>&1 || true
for port in "${BACKEND_PORT}" "${WEB_PORT}"; do
  while lsof -ti tcp:"${port}" >/dev/null 2>&1; do
    kill "$(lsof -ti tcp:"${port}" | head -n1)" >/dev/null 2>&1 || true
    sleep 0.1
  done
done
log "phase=preflight-port-clean status=complete"
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
  log "phase=backend-state-reset status=running"
  rm -f "${ROOT_DIR}/backend/data/milestack.sqlite" "${ROOT_DIR}/backend/data/milestack.sqlite-wal" "${ROOT_DIR}/backend/data/milestack.sqlite-shm"
  log "phase=backend-state-reset status=complete"

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

  if ! kill -0 "${MANAGED_BACKEND_PID}" >/dev/null 2>&1; then
    log "phase=backend-managed-start status=failed reason=backend-process-exited log=${BACKEND_LOG_PATH}"
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

if [[ "${MANAGE_WEB}" == "1" ]]; then
  log "phase=web-managed-start status=running"
  (
    cd "${ROOT_DIR}/web"
    NEXT_PUBLIC_DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
    NEXT_PUBLIC_CHAIN_ID="31337" \
    NEXT_PUBLIC_BACKEND_URL="${BACKEND_URL}" \
    PORT="${WEB_PORT}" \
    npm run dev
  ) >"${WEB_LOG_PATH}" 2>&1 &
  MANAGED_WEB_PID=$!

  if ! wait_for_web; then
    log "phase=web-managed-start status=failed reason=web-unreachable log=${WEB_LOG_PATH}"
    exit 1
  fi

  if ! kill -0 "${MANAGED_WEB_PID}" >/dev/null 2>&1; then
    log "phase=web-managed-start status=failed reason=web-process-exited log=${WEB_LOG_PATH}"
    exit 1
  fi

  log "phase=web-managed-start status=complete pid=${MANAGED_WEB_PID} log=${WEB_LOG_PATH}"
fi

log "phase=browser-uat status=running"
mkdir -p "${ARTIFACT_DIR}"
(
  cd "${ROOT_DIR}/web"
  DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT}" \
  REHEARSAL_WEB_BASE_URL="${WEB_URL}" \
  REHEARSAL_ARTIFACTS_DIR="${ARTIFACT_DIR}" \
  npx playwright test tests/rehearsal-happy.spec.ts tests/rehearsal-timeout.spec.ts tests/rehearsal-dispute.spec.ts
)
log "phase=browser-uat status=complete"

for required in happy-deal.png happy-milestone.png timeout-deal.png timeout-milestone.png dispute-dispute.png; do
  if [[ ! -f "${ARTIFACT_DIR}/${required}" ]]; then
    log "phase=browser-artifact-check status=failed reason=missing-screenshot file=${ARTIFACT_DIR}/${required}"
    exit 1
  fi
done

log "phase=browser-artifact-check status=complete dir=${ARTIFACT_DIR}"

if [[ -f "${ROOT_DIR}/${RESULT_PATH}" ]]; then
  log "artifact=${RESULT_PATH}"
else
  log "phase=artifact-check status=failed reason=missing-artifact path=${RESULT_PATH}"
  exit 1
fi

log "status=complete"
