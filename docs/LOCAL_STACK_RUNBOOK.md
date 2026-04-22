# Local Stack Runbook

## 1. Purpose

This runbook describes the supported local and rehearsal-local stack boot path and the exact verification gates operators should run.

## 2. Install

### Contracts

From `contracts/`:

```bash
forge test
```

### Backend

From `backend/`:

```bash
npm install
```

### Web

From `web/`:

```bash
npm install
```

## 3. Fast Local Startup

From repository root:

```bash
./scripts/dev-stack.sh
```

Default local URLs:
- web: `http://localhost:3000`
- backend: `http://localhost:4000`

## 4. Rehearsal-Local Bootstrap

To generate deterministic rehearsal fixtures and manifest:

```bash
./scripts/rehearsal-stack.sh
```

To run app services against rehearsal-local manifest:

```bash
DEPLOY_ENVIRONMENT=rehearsal-local ./scripts/dev-stack.sh
```

Rehearsal verifier scripts use:
- backend `http://127.0.0.1:4100`
- web `http://127.0.0.1:3000`

## 5. `/health` Check Contract

For rehearsal verification endpoint:

```bash
curl --fail --silent http://127.0.0.1:4100/health
```

Inspect these fields:
- `environment`, `chainId`, `factoryAddress`
- `sync.freshness`, `sync.degraded`, `sync.status`, `sync.phase`, `sync.lagBlocks`
- `sync.lastError`, `sync.loop.lastSyncError`
- `sync.runtime.deploymentEnv`, `sync.runtime.manifestEnvironment`, `sync.runtime.manifestVersion`

## 6. Recovery Gate (S02)

Run:

```bash
bash scripts/verify-s02-recovery.sh
```

It performs:
1. health snapshots before/during/after restart
2. route-level browser assertions (degraded and recovered phases)
3. continuity replay against seeded journeys
4. screenshot gating

Outputs:
- `deployments/rehearsal-local/rehearsal-recovery-verification.json`
- screenshots under `deployments/rehearsal-local/browser-evidence/`

## 7. Operability Gate (S03)

Run:

```bash
bash scripts/verify-s03-operability.sh
```

It composes S01+S02 and emits launch verdict to:
- `deployments/rehearsal-local/operability-verification.json`

Default threshold behavior:
- `DEPLOY_ENVIRONMENT=rehearsal-local`: allows current stale/degraded metadata state (`status=stale`, degraded allowed, stale snapshots up to 3)
- all other environments: fail-closed defaults (`status=healthy`, degraded disallowed, stale snapshots disallowed)

Override knobs when needed:
- `REHEARSAL_ABORT_MAX_LAG_BLOCKS`
- `REHEARSAL_ABORT_ALLOW_DEGRADED`
- `REHEARSAL_ABORT_REQUIRE_SYNC_STATUS`
- `REHEARSAL_ABORT_MAX_STALE_HEALTH_SNAPSHOTS`
- `REHEARSAL_ABORT_MAX_BROWSER_MISSING`

## 8. Canary Abort and Rollback (Local Rehearsal Practice)

If S03 fails with abort-threshold or artifact-contract errors:

1. Treat verdict as no-launch.
2. Review `operability-verification.json` failure details.
3. Roll back only offchain components (backend/web/indexer config or release).
4. Re-run S02 then S03.

Do not:
- hand-edit gate artifacts
- call contract outcome changes a rollback

## 9. Mechanical Documentation Check

Run after runbook edits:

```bash
bash scripts/verify-m006-s01-docs.sh
```

This fails if required operability/recovery references are missing or if unresolved placeholders remain in the three runbook docs.
