#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENVIRONMENT="${DEPLOY_ENVIRONMENT:-rehearsal-local}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
BACKEND_PORT="${REHEARSAL_BACKEND_PORT:-4100}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
WEB_PORT="${REHEARSAL_WEB_PORT:-3000}"
WEB_URL="${REHEARSAL_WEB_URL:-http://127.0.0.1:${WEB_PORT}}"

REHEARSAL_RESULT_PATH="${REHEARSAL_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-verification.json}"
RECOVERY_RESULT_PATH="${REHEARSAL_RECOVERY_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/rehearsal-recovery-verification.json}"
ARTIFACT_DIR="${REHEARSAL_ARTIFACT_DIR:-${ROOT_DIR}/deployments/${DEPLOY_ENVIRONMENT}/browser-evidence}"

OPERABILITY_RESULT_PATH="${REHEARSAL_OPERABILITY_RESULT_PATH:-deployments/${DEPLOY_ENVIRONMENT}/operability-verification.json}"

ABORT_MAX_LAG_BLOCKS="${REHEARSAL_ABORT_MAX_LAG_BLOCKS:-0}"
ABORT_ALLOW_DEGRADED="${REHEARSAL_ABORT_ALLOW_DEGRADED:-0}"
ABORT_REQUIRE_SYNC_STATUS="${REHEARSAL_ABORT_REQUIRE_SYNC_STATUS:-healthy}"
ABORT_MAX_STALE_HEALTH_SNAPSHOTS="${REHEARSAL_ABORT_MAX_STALE_HEALTH_SNAPSHOTS:-0}"
ABORT_MAX_BROWSER_MISSING="${REHEARSAL_ABORT_MAX_BROWSER_MISSING:-0}"

S03_STARTED_AT=""
S03_PHASE_START_TS=""
S03_PHASE_FAILED=""
S03_PHASE_FAILURE_REASON=""
S03_PHASE_LOG=()

log() {
  printf '[verify-s03] %s\n' "$1"
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
  S03_PHASE_START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log "phase=${phase} status=running"
}

phase_end() {
  local phase="$1"
  local status="$2"
  local detail="$3"
  local ended_at
  ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local entry
  entry="{\"phase\":$(json_escape "$phase"),\"status\":$(json_escape "$status"),\"detail\":$(json_escape "$detail"),\"startedAt\":$(json_escape "$S03_PHASE_START_TS"),\"endedAt\":$(json_escape "$ended_at")}"
  S03_PHASE_LOG+=("$entry")
  log "phase=${phase} status=${status} detail=${detail}"
  if [[ "$status" == "failed" ]]; then
    S03_PHASE_FAILED="$phase"
    S03_PHASE_FAILURE_REASON="$detail"
  fi
}

build_operability_artifact() {
  local verdict="$1"
  local run_completed_at="$2"
  local detail="$3"

  local phase_json
  phase_json="[$(IFS=,; echo "${S03_PHASE_LOG[*]}")]"

  python3 - <<PY
import json
from pathlib import Path

root = Path(${ROOT_DIR@Q})
out_path = root / ${OPERABILITY_RESULT_PATH@Q}

payload = {
    "ok": ${S03_PHASE_FAILED@Q} == "" and ${verdict@Q} == "pass",
    "verdict": ${verdict@Q},
    "detail": ${detail@Q},
    "environment": ${DEPLOY_ENVIRONMENT@Q},
    "rpcUrl": ${RPC_URL@Q},
    "backendUrl": ${BACKEND_URL@Q},
    "webUrl": ${WEB_URL@Q},
    "inputs": {
        "rehearsalArtifact": str(root / ${REHEARSAL_RESULT_PATH@Q}),
        "recoveryArtifact": str(root / ${RECOVERY_RESULT_PATH@Q}),
        "browserArtifactDir": ${ARTIFACT_DIR@Q},
    },
    "abortThresholds": {
        "maxLagBlocks": int(${ABORT_MAX_LAG_BLOCKS@Q}),
        "allowDegraded": ${ABORT_ALLOW_DEGRADED@Q} == "1",
        "requiredSyncStatus": ${ABORT_REQUIRE_SYNC_STATUS@Q},
        "maxStaleHealthSnapshots": int(${ABORT_MAX_STALE_HEALTH_SNAPSHOTS@Q}),
        "maxMissingBrowserEvidence": int(${ABORT_MAX_BROWSER_MISSING@Q}),
    },
    "runStartedAt": ${S03_STARTED_AT@Q},
    "runCompletedAt": ${run_completed_at@Q},
    "failurePhase": ${S03_PHASE_FAILED@Q} or None,
    "failureReason": ${S03_PHASE_FAILURE_REASON@Q} or None,
    "phases": json.loads(${phase_json@Q}),
}

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"[verify-s03] artifact={out_path}")
PY
}

fail_gate() {
  local phase="$1"
  local detail="$2"
  local completed_at
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  phase_end "$phase" "failed" "$detail"
  build_operability_artifact "fail" "$completed_at" "$detail"
  exit 1
}

log "environment=${DEPLOY_ENVIRONMENT} backend=${BACKEND_URL} web=${WEB_URL}"
S03_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

phase_begin "baseline-rehearsal"
if bash "${ROOT_DIR}/scripts/verify-s01-rehearsal.sh"; then
  phase_end "baseline-rehearsal" "complete" "s01 rehearsal verifier passed"
else
  fail_gate "baseline-rehearsal" "s01 rehearsal verifier failed"
fi

phase_begin "recovery-proof"
if REHEARSAL_RECOVERY_SKIP_S01=1 bash "${ROOT_DIR}/scripts/verify-s02-recovery.sh"; then
  phase_end "recovery-proof" "complete" "s02 recovery verifier passed"
else
  fail_gate "recovery-proof" "s02 recovery verifier failed"
fi

phase_begin "artifact-contract-check"
if ! ROOT_DIR="${ROOT_DIR}" \
  REHEARSAL_RESULT_PATH="${REHEARSAL_RESULT_PATH}" \
  RECOVERY_RESULT_PATH="${RECOVERY_RESULT_PATH}" \
  ARTIFACT_DIR="${ARTIFACT_DIR}" \
  ABORT_MAX_BROWSER_MISSING="${ABORT_MAX_BROWSER_MISSING}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT_DIR"])
rehearsal = root / os.environ["REHEARSAL_RESULT_PATH"]
recovery = root / os.environ["RECOVERY_RESULT_PATH"]
artifact_dir = Path(os.environ["ARTIFACT_DIR"])

for path in [rehearsal, recovery]:
    if not path.exists():
        raise SystemExit(f"missing artifact: {path}")

with rehearsal.open("r", encoding="utf-8") as f:
    r1 = json.load(f)
with recovery.open("r", encoding="utf-8") as f:
    r2 = json.load(f)

if r1.get("ok") is not True:
    raise SystemExit("rehearsal artifact not ok=true")
if r2.get("ok") is not True:
    raise SystemExit("recovery artifact not ok=true")

if not isinstance(r1.get("execute"), dict):
    raise SystemExit("rehearsal artifact missing execute payload")

required_execute = {
    "happyPath": ["escrowAddress", "submitTxHash", "approveTxHash"],
    "timeoutPath": ["escrowAddress", "submitTxHash", "claimTxHash"],
    "disputePath": ["escrowAddress", "submitTxHash", "openDisputeTxHash", "resolveDisputeTxHash"],
}
for route, fields in required_execute.items():
    node = r1["execute"].get(route)
    if not isinstance(node, dict):
        raise SystemExit(f"rehearsal execute missing {route}")
    for field in fields:
        value = node.get(field)
        if not isinstance(value, str) or not value.startswith("0x"):
            raise SystemExit(f"rehearsal execute {route}.{field} malformed")

for field in ["failurePhase", "failureReason", "healthSnapshots", "browserArtifacts", "phases", "continuity"]:
    if field not in r2:
        raise SystemExit(f"recovery artifact missing {field}")

health = r2.get("healthSnapshots")
if not isinstance(health, dict):
    raise SystemExit("recovery healthSnapshots malformed")

required_health_fields = ["beforeRestart", "duringRecovery", "afterRecovery"]
for snap_name in required_health_fields:
    snap = health.get(snap_name)
    if not isinstance(snap, dict):
        raise SystemExit(f"recovery health snapshot missing {snap_name}")
    sync = snap.get("sync")
    if not isinstance(sync, dict):
        raise SystemExit(f"recovery health snapshot {snap_name}.sync missing")
    for key in ["freshness", "degraded", "phase", "status", "lagBlocks", "lastError"]:
        if key not in sync:
            raise SystemExit(f"recovery health snapshot {snap_name}.sync missing {key}")

browser = r2.get("browserArtifacts")
if not isinstance(browser, dict):
    raise SystemExit("recovery browserArtifacts malformed")
required_screens = browser.get("requiredScreenshots")
if not isinstance(required_screens, list) or not required_screens:
    raise SystemExit("recovery requiredScreenshots missing")

missing = []
for name in required_screens:
    if not isinstance(name, str):
        raise SystemExit("recovery requiredScreenshots entry malformed")
    if not (artifact_dir / name).exists():
        missing.append(name)

max_missing = int(os.environ["ABORT_MAX_BROWSER_MISSING"])
if len(missing) > max_missing:
    raise SystemExit(
        f"missing browser evidence exceeds abort threshold: missing={len(missing)} threshold={max_missing} names={','.join(missing)}"
    )

print("[verify-s03] artifact-contract=pass detail=rehearsal/recovery artifacts + browser evidence present")
PY
then
  fail_gate "artifact-contract-check" "artifact contract validation failed"
fi
phase_end "artifact-contract-check" "complete" "artifacts + browser evidence validated"

phase_begin "abort-threshold-check"
if ! ROOT_DIR="${ROOT_DIR}" \
  RECOVERY_RESULT_PATH="${RECOVERY_RESULT_PATH}" \
  ABORT_MAX_LAG_BLOCKS="${ABORT_MAX_LAG_BLOCKS}" \
  ABORT_ALLOW_DEGRADED="${ABORT_ALLOW_DEGRADED}" \
  ABORT_REQUIRE_SYNC_STATUS="${ABORT_REQUIRE_SYNC_STATUS}" \
  ABORT_MAX_STALE_HEALTH_SNAPSHOTS="${ABORT_MAX_STALE_HEALTH_SNAPSHOTS}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT_DIR"])
recovery = root / os.environ["RECOVERY_RESULT_PATH"]

max_lag = int(os.environ["ABORT_MAX_LAG_BLOCKS"])
allow_degraded = os.environ["ABORT_ALLOW_DEGRADED"] == "1"
required_status = os.environ["ABORT_REQUIRE_SYNC_STATUS"].strip().lower()
max_stale = int(os.environ["ABORT_MAX_STALE_HEALTH_SNAPSHOTS"])

with recovery.open("r", encoding="utf-8") as f:
    payload = json.load(f)

health = payload.get("healthSnapshots")
if not isinstance(health, dict):
    raise SystemExit("recovery healthSnapshots missing")

after = health.get("afterRecovery")
if not isinstance(after, dict):
    raise SystemExit("afterRecovery health snapshot missing")

after_sync = after.get("sync")
if not isinstance(after_sync, dict):
    raise SystemExit("afterRecovery sync payload missing")

for key in ["freshness", "degraded", "status", "lagBlocks"]:
    if key not in after_sync:
        raise SystemExit(f"afterRecovery sync missing {key}")

freshness = str(after_sync["freshness"])
status = str(after_sync["status"]).lower()
degraded = bool(after_sync["degraded"])
lag_blocks_raw = after_sync["lagBlocks"]
try:
    lag_blocks = int(str(lag_blocks_raw))
except ValueError:
    raise SystemExit(f"afterRecovery lagBlocks malformed: {lag_blocks_raw}")

if lag_blocks > max_lag:
    raise SystemExit(f"abort threshold breached: lagBlocks={lag_blocks} threshold={max_lag}")

if required_status and status != required_status:
    raise SystemExit(f"abort threshold breached: status={status} required={required_status}")

if (not allow_degraded) and degraded:
    raise SystemExit("abort threshold breached: degraded=true and allowDegraded=false")

if (not allow_degraded) and freshness != "fresh":
    raise SystemExit(f"abort threshold breached: freshness={freshness} requires fresh")

# Boundary condition guard: stale snapshots tolerated only up to threshold.
stale_count = 0
for name in ["beforeRestart", "duringRecovery", "afterRecovery"]:
    snap = health.get(name)
    if not isinstance(snap, dict):
        continue
    sync = snap.get("sync")
    if not isinstance(sync, dict):
        continue
    if str(sync.get("freshness", "")) == "stale":
        stale_count += 1

if stale_count > max_stale:
    raise SystemExit(
        f"abort threshold breached: staleSnapshots={stale_count} threshold={max_stale}"
    )

print(
    f"[verify-s03] abort-threshold=pass detail=freshness={freshness} degraded={degraded} status={status} lagBlocks={lag_blocks} staleSnapshots={stale_count}"
)
PY
then
  fail_gate "abort-threshold-check" "abort/rollback threshold validation failed"
fi
phase_end "abort-threshold-check" "complete" "abort thresholds satisfied"

phase_begin "final-verdict"
phase_end "final-verdict" "complete" "launch-operability verdict: PASS"
run_completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
build_operability_artifact "pass" "$run_completed_at" "launch-operability verdict PASS"
log "status=complete verdict=PASS"
