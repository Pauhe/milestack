# Milestack Runbooks

## 1. Purpose

This document defines executable incident and launch-operability runbooks for the current Milestack MVP rehearsal stack.

Scope is intentionally narrow:
- backend `/health` truth surface
- rehearsal/recovery/operability gate scripts
- canary abort and offchain rollback decisions

It does **not** describe a production alerting platform that is not yet implemented in this repository.

## 2. Incident Principles (Current Scope)

1. Treat chain state as settlement truth and backend state as operational truth.
2. If backend truth is degraded, fail closed on launch decisions.
3. Do not claim launch readiness without gate artifacts written by scripts.
4. Keep incident evidence machine-readable (`deployments/rehearsal-local/*.json`).
5. Limit rollback actions to offchain systems; contract outcomes are not "rolled back".

## 3. Runtime Signals You Can Trust

### 3.1 Backend `/health`

Check:

```bash
curl --fail --silent http://127.0.0.1:4100/health
```

`/health` returns:
- top-level: `ok`, `environment`, `chainId`, `factoryAddress`
- `sync` object with:
  - provenance/runtime: `runtime.deploymentEnv`, `runtime.manifestEnvironment`, `runtime.manifestVersion`, `runtime.chainId`, `runtime.contractAddress`
  - freshness/lag: `freshness`, `degraded`, `status`, `phase`, `lagBlocks`
  - failure context: `lastError`, `loop.lastSyncError`

### 3.2 Recovery and operability artifacts

Required artifacts:
- `deployments/rehearsal-local/rehearsal-verification.json`
- `deployments/rehearsal-local/rehearsal-recovery-verification.json`
- `deployments/rehearsal-local/operability-verification.json`
- `deployments/rehearsal-local/browser-evidence/*.png`

These artifacts are the launch/no-launch evidence source.

## 4. Executable Verification Commands

Run from repository root.

### 4.1 Recovery proof (S02)

```bash
bash scripts/verify-s02-recovery.sh
```

This verifies:
- pre-restart, during-recovery, post-recovery `/health` snapshots
- continuity assertions against seeded rehearsal journeys
- browser evidence for degraded and recovered route behavior

Outputs:
- `deployments/rehearsal-local/rehearsal-recovery-verification.json`
- browser screenshots under `deployments/rehearsal-local/browser-evidence/`

### 4.2 Launch-operability gate (S03)

```bash
bash scripts/verify-s03-operability.sh
```

This composes S01 + S02 and then gates:
- artifact contract completeness
- abort threshold contract
- launch verdict artifact generation

For `DEPLOY_ENVIRONMENT=rehearsal-local`, default thresholds are intentionally aligned to current expected degraded/stale metadata semantics:
- `REHEARSAL_ABORT_ALLOW_DEGRADED=1`
- `REHEARSAL_ABORT_REQUIRE_SYNC_STATUS=stale`
- `REHEARSAL_ABORT_MAX_STALE_HEALTH_SNAPSHOTS=3`

For other environments, defaults remain fail-closed (`healthy`/non-degraded/fresh-only).

## 5. Canary Abort Runbook (Executable)

### Trigger: abort threshold breach

If `scripts/verify-s03-operability.sh` exits non-zero with messages like:
- `abort threshold breached: status=... required=...`
- `abort threshold breached: lagBlocks=...`
- `abort threshold breached: degraded=true ...`
- `missing browser evidence exceeds abort threshold ...`

### Canary abort actions

1. Stop canary expansion immediately.
2. Preserve gate evidence files and backend/web logs.
3. Do not relabel the run as healthy by manual edits.
4. Diagnose from `operability-verification.json`:
   - `failurePhase`
   - `failureReason`
   - `abortThresholds`
   - `phases[]`

## 6. Offchain Rollback Runbook

Rollback scope is **only** backend/web/indexer services and deployment configuration.

### Steps

1. Identify failing phase from `operability-verification.json`.
2. Revert the latest offchain release/config to last known-good.
3. Restart backend/web processes.
4. Re-run:
   - `bash scripts/verify-s02-recovery.sh`
   - `bash scripts/verify-s03-operability.sh`
5. Accept rollback only when S03 returns PASS and writes a fresh artifact.

### Unsafe rollback actions

- Editing artifact JSON by hand to force PASS.
- Claiming recovery without rerunning S02/S03.
- Describing contract state changes as rollback.

## 7. Incident Diagnosis Matrix

### A. `/health` shows stale/degraded and S03 fails

Interpretation: launch gate says no-launch under current thresholds.

Action:
1. Read `sync.lastError` and `loop.lastSyncError`.
2. Confirm expected environment policy (`rehearsal-local` vs non-local).
3. Fix root cause or adjust explicit threshold vars only when environment policy requires it.

### B. Artifacts missing or malformed

Interpretation: verification evidence is incomplete.

Action:
1. Re-run S02 and S03.
2. Ensure browser screenshot files exist in expected path.
3. Do not proceed until artifact-contract-check passes.

### C. Browser proofs fail while backend health passes

Interpretation: route truth guidance regressed.

Action:
1. Run `npx playwright test tests/rehearsal-recovery.spec.ts` from repo root.
2. Investigate route guidance/test-id regressions.
3. Re-run S02/S03 after fix.

## 8. Current Launch Boundary (Honesty Contract)

This repo currently provides executable launch-operability proof for `rehearsal-local`.

It does **not** claim verified production/staging abort thresholds or alerting integrations in this document.

Any production/staging launch claim must be backed by environment-specific manifest coverage and successful gate artifacts under that environment’s thresholds.
