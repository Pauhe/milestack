#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-rehearsal-local}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
BACKEND_PORT="${REHEARSAL_BACKEND_PORT:-4100}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
WEB_PORT="${REHEARSAL_WEB_PORT:-3000}"
WEB_URL="${REHEARSAL_WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
BACKEND_LOG_PATH="${REHEARSAL_BACKEND_LOG_PATH:-/tmp/milestack-rehearsal-backend.log}"
WEB_LOG_PATH="${REHEARSAL_WEB_LOG_PATH:-/tmp/milestack-rehearsal-web.log}"
ARTIFACT_DIR="${REHEARSAL_ARTIFACT_DIR:-${ROOT_DIR}/deployments/${DEPLOY_ENVIRONMENT}/browser-evidence}"
RESULT_PATH="${REHEARSAL_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-verification.json}"
RECOVERY_RESULT_PATH="${REHEARSAL_RECOVERY_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-recovery-verification.json}"

MANAGE_BACKEND="${REHEARSAL_MANAGE_BACKEND:-1}"
MANAGE_WEB="${REHEARSAL_MANAGE_WEB:-1}"
RESTART_WEB_DURING_RECOVERY="${REHEARSAL_RESTART_WEB_DURING_RECOVERY:-1}"
RECOVERY_TIMEOUT_SECONDS="${REHEARSAL_RECOVERY_TIMEOUT_SECONDS:-20}"
RECOVERY_POLL_INTERVAL_SECONDS="${REHEARSAL_RECOVERY_POLL_INTERVAL_SECONDS:-0.5}"

BEFORE_HEALTH_FILE="/tmp/milestack-s02-before-health.json"
DURING_HEALTH_FILE="/tmp/milestack-s02-during-health.json"
AFTER_HEALTH_FILE="/tmp/milestack-s02-after-health.json"

PHASE_LOG=()
PHASE_FAILED=""
PHASE_FAILURE_REASON=""
PHASE_START_TS=""

REHEARSAL_SEED_PATH="${ROOT_DIR}/deployments/${DEPLOY_ENVIRONMENT}/seeded-journeys.json"

log() {
  printf '[verify-s02] %s\n' "$1"
}

json_escape() {
  local value="$1"
  python3 - "$value" <<'PY'
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

phase_begin() {
  local phase="$1"
  PHASE_START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "phase=${phase} status=running"
}

phase_end() {
  local phase="$1"
  local status="$2"
  local detail="$3"
  local ended_at
  ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local entry
  entry="{\"phase\":$(json_escape "$phase"),\"status\":$(json_escape "$status"),\"detail\":$(json_escape "$detail"),\"startedAt\":$(json_escape "$PHASE_START_TS"),\"endedAt\":$(json_escape "$ended_at")}" 
  PHASE_LOG+=("$entry")
  log "phase=${phase} status=${status} detail=${detail}"
  if [[ "$status" == "failed" ]]; then
    PHASE_FAILED="$phase"
    PHASE_FAILURE_REASON="$detail"
  fi
}

cleanup() {
  if [[ -n "${MANAGED_WEB_PID:-}" ]]; then
    kill "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MANAGED_BACKEND_PID:-}" ]]; then
    kill "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

wait_for_backend() {
  local attempts=80
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
  local attempts=120
  local delay_seconds=0.25
  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "${WEB_URL}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
  done
  return 1
}

restart_backend_managed() {
  local reset_db="${1:-1}"

  if [[ -n "${MANAGED_BACKEND_PID:-}" ]]; then
    kill "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${reset_db}" == "1" ]]; then
    rm -f "${ROOT_DIR}/backend/data/milestack.sqlite" "${ROOT_DIR}/backend/data/milestack.sqlite-wal" "${ROOT_DIR}/backend/data/milestack.sqlite-shm"
  fi

  (
    cd "${ROOT_DIR}/backend"
    DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
    RPC_URL="${RPC_URL}" \
    PORT="${BACKEND_PORT}" \
    npm run dev
  ) >"${BACKEND_LOG_PATH}" 2>&1 &
  MANAGED_BACKEND_PID=$!

  if ! wait_for_backend; then
    return 1
  fi

  if ! kill -0 "${MANAGED_BACKEND_PID}" >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

restart_web_managed() {
  if [[ -n "${MANAGED_WEB_PID:-}" ]]; then
    kill "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
    wait "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
  fi

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
    return 1
  fi

  if ! kill -0 "${MANAGED_WEB_PID}" >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

capture_health() {
  local out_file="$1"
  curl --fail --silent --show-error "${BACKEND_URL}/health" >"${out_file}"
}

build_recovery_artifact() {
  local run_started_at="$1"
  local run_completed_at="$2"
  local continuity_ok="$3"

  local phase_json
  phase_json="[$(IFS=,; echo "${PHASE_LOG[*]}")]"

  python3 - <<PY
import json
from pathlib import Path

root = Path(${ROOT_DIR@Q})
recovery_path = root / ${RECOVERY_RESULT_PATH@Q}
before_file = Path(${BEFORE_HEALTH_FILE@Q})
during_file = Path(${DURING_HEALTH_FILE@Q})
after_file = Path(${AFTER_HEALTH_FILE@Q})
phase_log = json.loads(${phase_json@Q})

def read_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text())

before = read_json(before_file)
during = read_json(during_file)
after = read_json(after_file)

payload = {
    "ok": ${PHASE_FAILED@Q} == "",
    "environment": ${DEPLOY_ENVIRONMENT@Q},
    "backendUrl": ${BACKEND_URL@Q},
    "webUrl": ${WEB_URL@Q},
    "seedPath": str(root / "deployments" / ${DEPLOY_ENVIRONMENT@Q} / "seeded-journeys.json"),
    "runStartedAt": ${run_started_at@Q},
    "runCompletedAt": ${run_completed_at@Q},
    "failurePhase": ${PHASE_FAILED@Q} or None,
    "failureReason": ${PHASE_FAILURE_REASON@Q} or None,
    "continuity": {
        "assertionsPassed": ${continuity_ok@Q} == "true",
        "sourceArtifact": str(root / ${RESULT_PATH@Q}),
    },
    "healthSnapshots": {
        "beforeRestart": before,
        "duringRecovery": during,
        "afterRecovery": after,
    },
    "phases": phase_log,
    "browserArtifacts": {
        "root": ${ARTIFACT_DIR@Q},
        "requiredScreenshots": [
            "recovery-degraded-deal.png",
            "recovery-healthy-milestone.png",
            "recovery-healthy-dispute.png",
        ],
    },
}

recovery_path.parent.mkdir(parents=True, exist_ok=True)
recovery_path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"[verify-s02] artifact={recovery_path}")
PY
}

assert_recovery_continuity() {
  python3 - <<'PY'
import json
import os
from pathlib import Path

env = os.environ.get('DEPLOY_ENVIRONMENT', 'rehearsal-local')
root = Path.cwd()
rehearsal_path = root / os.environ.get('REHEARSAL_RESULT_PATH', f'deployments/{env}/rehearsal-verification.json')
seed_path = root / f'deployments/{env}/seeded-journeys.json'

rehearsal = json.loads(rehearsal_path.read_text())
seed = json.loads(seed_path.read_text())

if rehearsal.get('ok') is not True:
    raise SystemExit('rehearsal artifact must be ok=true')

execute = rehearsal.get('execute')
if not isinstance(execute, dict):
    raise SystemExit('rehearsal execute summary missing')

addresses = {
    str(seed['journeys']['happyPath']['escrowAddress']).lower(),
    str(seed['journeys']['timeoutPath']['escrowAddress']).lower(),
    str(seed['journeys']['disputePath']['escrowAddress']).lower(),
}

for key in ['happyPath', 'timeoutPath', 'disputePath']:
    segment = execute.get(key)
    if not isinstance(segment, dict):
        raise SystemExit(f'missing execute.{key}')
    addr = segment.get('escrowAddress')
    if not isinstance(addr, str):
        raise SystemExit(f'execute.{key}.escrowAddress missing')
    if addr.lower() not in addresses:
        raise SystemExit(f'execute.{key}.escrowAddress not in seeded set')

print('[verify-s02] continuity=pass detail=seeded escrow addresses preserved in rehearsal execute output')
PY
}

assert_health_contract() {
  local json_path="$1"
  local phase_name="$2"
  python3 - "$json_path" "$phase_name" <<'PY'
import json
import sys

path = sys.argv[1]
phase = sys.argv[2]
with open(path, 'r', encoding='utf-8') as f:
    payload = json.load(f)

sync = payload.get('sync')
if not isinstance(sync, dict):
    raise SystemExit(f'{phase}: /health.sync missing')

required = ['freshness', 'degraded', 'phase', 'status', 'lagBlocks', 'lastError']
for key in required:
    if key not in sync:
        raise SystemExit(f'{phase}: /health.sync missing field {key}')

if sync['freshness'] not in ['fresh', 'stale', 'rebuilding', 'unavailable']:
    raise SystemExit(f"{phase}: unexpected freshness state {sync['freshness']}")

if not isinstance(sync['degraded'], bool):
    raise SystemExit(f'{phase}: degraded must be boolean')

if sync['freshness'] == 'fresh' and sync['degraded']:
    raise SystemExit(f'{phase}: fresh cannot be degraded=true')

if sync['freshness'] != 'fresh' and not sync['degraded']:
    raise SystemExit(f'{phase}: non-fresh freshness must be degraded=true')

print(f'[verify-s02] health-contract=pass phase={phase} freshness={sync["freshness"]} status={sync["status"]}')
PY
}

log "environment=${DEPLOY_ENVIRONMENT} backend=${BACKEND_URL} web=${WEB_URL} rpc=${RPC_URL}"

run_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
continuity_ok="false"

if [[ "${REHEARSAL_RECOVERY_SKIP_S01:-0}" == "1" ]]; then
  phase_begin "baseline-s01-rehearsal"
  phase_end "baseline-s01-rehearsal" "complete" "skipped because REHEARSAL_RECOVERY_SKIP_S01=1"
else
  phase_begin "baseline-s01-rehearsal"
  if bash "${ROOT_DIR}/scripts/verify-s01-rehearsal.sh"; then
    phase_end "baseline-s01-rehearsal" "complete" "s01 canonical flow passed"
  else
    phase_end "baseline-s01-rehearsal" "failed" "s01 canonical flow failed"
    run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
    exit 1
  fi
fi

phase_begin "post-baseline-service-start"
if restart_backend_managed 0; then
  :
else
  phase_end "post-baseline-service-start" "failed" "backend start failed after baseline log=${BACKEND_LOG_PATH}"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi
if [[ "${MANAGE_WEB}" == "1" ]]; then
  if restart_web_managed; then
    :
  else
    phase_end "post-baseline-service-start" "failed" "web start failed after baseline log=${WEB_LOG_PATH}"
    run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
    exit 1
  fi
fi
phase_end "post-baseline-service-start" "complete" "backend/web restarted for before-restart snapshot"

phase_begin "capture-before-restart-health"
if capture_health "${BEFORE_HEALTH_FILE}" && assert_health_contract "${BEFORE_HEALTH_FILE}" "before-restart"; then
  phase_end "capture-before-restart-health" "complete" "health snapshot captured"
else
  phase_end "capture-before-restart-health" "failed" "unable to capture valid pre-restart health"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

if [[ "${MANAGE_BACKEND}" != "1" ]]; then
  phase_begin "managed-restart-backend"
  phase_end "managed-restart-backend" "failed" "REHEARSAL_MANAGE_BACKEND must be 1 for S02 recovery verifier"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "managed-restart-backend"
if [[ -n "${MANAGED_BACKEND_PID:-}" ]]; then
  kill "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
  wait "${MANAGED_BACKEND_PID}" >/dev/null 2>&1 || true
fi
rm -f "${ROOT_DIR}/backend/data/milestack.sqlite" "${ROOT_DIR}/backend/data/milestack.sqlite-wal" "${ROOT_DIR}/backend/data/milestack.sqlite-shm"
phase_end "managed-restart-backend" "complete" "backend process stopped and index DB reset"

if [[ "${MANAGE_WEB}" == "1" && "${RESTART_WEB_DURING_RECOVERY}" == "1" ]]; then
  phase_begin "managed-restart-web"
  if [[ -n "${MANAGED_WEB_PID:-}" ]]; then
    kill "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
    wait "${MANAGED_WEB_PID}" >/dev/null 2>&1 || true
  fi
  phase_end "managed-restart-web" "complete" "web process stopped for optional restart phase"
fi

phase_begin "capture-during-recovery-health"
if capture_health "${DURING_HEALTH_FILE}" && assert_health_contract "${DURING_HEALTH_FILE}" "during-recovery"; then
  phase_end "capture-during-recovery-health" "complete" "health snapshot captured"
else
  phase_end "capture-during-recovery-health" "failed" "unable to capture valid during-recovery health"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "browser-degraded-proof"
if (
  cd "${ROOT_DIR}/web"
  DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT}" \
  REHEARSAL_WEB_BASE_URL="${WEB_URL}" \
  REHEARSAL_ARTIFACTS_DIR="${ARTIFACT_DIR}" \
  REHEARSAL_RECOVERY_PHASE="degraded" \
  npx playwright test tests/rehearsal-recovery.spec.ts
); then
  phase_end "browser-degraded-proof" "complete" "degraded-state route assertions passed"
else
  phase_end "browser-degraded-proof" "failed" "degraded-state route assertions failed"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "post-restart-services"
if restart_backend_managed 1; then
  :
else
  phase_end "post-restart-services" "failed" "backend restart failed log=${BACKEND_LOG_PATH}"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi
if [[ "${MANAGE_WEB}" == "1" && "${RESTART_WEB_DURING_RECOVERY}" == "1" ]]; then
  if restart_web_managed; then
    :
  else
    phase_end "post-restart-services" "failed" "web restart failed log=${WEB_LOG_PATH}"
    run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
    exit 1
  fi
fi
phase_end "post-restart-services" "complete" "backend/web restarted and reachable"

phase_begin "post-restart-truth-replay"
if (
  cd "${ROOT_DIR}/backend"
  DEPLOYMENT_ENV="${DEPLOY_ENVIRONMENT}" \
  BACKEND_URL="${BACKEND_URL}" \
  RPC_URL="${RPC_URL}" \
  REHEARSAL_MODE="execute" \
  REHEARSAL_RESULT_PATH="${RESULT_PATH}" \
  node --import tsx ./../scripts/rehearse-journeys.ts
); then
  continuity_ok="true"
  phase_end "post-restart-truth-replay" "complete" "execute replay checks passed"
else
  phase_end "post-restart-truth-replay" "failed" "execute replay checks failed"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "capture-after-recovery-health"
if capture_health "${AFTER_HEALTH_FILE}" && assert_health_contract "${AFTER_HEALTH_FILE}" "after-recovery"; then
  phase_end "capture-after-recovery-health" "complete" "health snapshot captured"
else
  phase_end "capture-after-recovery-health" "failed" "unable to capture valid post-recovery health"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "assert-continuity-artifacts"
if assert_recovery_continuity; then
  phase_end "assert-continuity-artifacts" "complete" "seed + execute continuity assertions passed"
else
  phase_end "assert-continuity-artifacts" "failed" "continuity assertions failed"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "browser-recovery-proof"
if (
  cd "${ROOT_DIR}/web"
  DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT}" \
  REHEARSAL_WEB_BASE_URL="${WEB_URL}" \
  REHEARSAL_ARTIFACTS_DIR="${ARTIFACT_DIR}" \
  REHEARSAL_RECOVERY_PHASE="recovered" \
  npx playwright test tests/rehearsal-recovery.spec.ts
); then
  phase_end "browser-recovery-proof" "complete" "recovery route assertions passed"
else
  phase_end "browser-recovery-proof" "failed" "playwright recovery assertions failed"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi

phase_begin "browser-artifact-gating"
missing=""
for required in recovery-degraded-deal.png recovery-healthy-milestone.png recovery-healthy-dispute.png; do
  if [[ ! -f "${ARTIFACT_DIR}/${required}" ]]; then
    missing+=" ${required}"
  fi
done
if [[ -n "$missing" ]]; then
  phase_end "browser-artifact-gating" "failed" "missing screenshots:${missing}"
  run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
  exit 1
fi
phase_end "browser-artifact-gating" "complete" "required screenshots present"

run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_recovery_artifact "$run_started_at" "$run_completed_at" "$continuity_ok"
log "status=complete"
