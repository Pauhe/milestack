# Milestack Testing And Deployment Strategy

## 1. Purpose

This document defines how Milestack is tested and deployed across local rehearsal, integration, staging, and launch readiness.

Because real money is expected later, strategy stays fail-closed:
- contracts remain highest-risk correctness surface
- offchain operability must be proven with executable gates
- launch claims require artifacts, not prose

## 2. Testing Philosophy

1. Test smallest units first.
2. Add adversarial/invariant checks around contract behavior.
3. Exercise full user flows in browser tests.
4. Treat deployment and recovery as testable systems.
5. Require machine-assertable `/health` and artifact contracts before launch.

## 3. Verification Layers

### 3.1 Static and lint checks

Catch fast failures early:
- solidity formatting/lint
- TypeScript lint/type checks
- schema and config validation

### 3.2 Unit tests

- contract function/transition tests
- backend transformer and semantics tests
- frontend presenter/helper tests

### 3.3 Integration tests

- contract + local chain integration
- backend + database + chain ingestion
- frontend + backend route integration

### 3.4 End-to-end tests

- wallet → frontend → backend/indexer → contract → UI truth surfaces

### 3.5 Recovery and operability gates

For launch-operability rehearsal:
- `bash scripts/verify-s02-recovery.sh`
- `bash scripts/verify-s03-operability.sh`

These gates produce required artifacts under `deployments/rehearsal-local/`.

## 4. Local Development Strategy

### 4.1 Contracts

Required categories:
1. create validation
2. funding
3. submission
4. approval
5. timeout claim
6. dispute open
7. dispute resolution
8. cancellation
9. unauthorized caller
10. review-window boundary
11. fee accounting
12. sequential enforcement

Advanced categories:
- fuzz tests for amounts/windows/splits
- invariants for fund conservation and terminal-state correctness

### 4.2 Backend

Local backend verification should include:
1. event decoding/idempotency
2. sync-state and freshness semantics
3. metadata verification degradation paths
4. API shape checks for `/health` and escrow truth endpoints

### 4.3 Frontend

Frontend verification should include:
1. role-gated actions
2. workflow guidance correctness per route
3. freshness/degraded callouts
4. dispute/finality explanation surfaces

## 5. Rehearsal-Local Deployment And Recovery Proof

### 5.1 Bootstrap

```bash
./scripts/rehearsal-stack.sh
DEPLOY_ENVIRONMENT=rehearsal-local ./scripts/dev-stack.sh
```

### 5.2 Recovery gate

```bash
bash scripts/verify-s02-recovery.sh
```

Expected outputs:
- `deployments/rehearsal-local/rehearsal-recovery-verification.json`
- `deployments/rehearsal-local/browser-evidence/recovery-degraded-deal.png`
- `deployments/rehearsal-local/browser-evidence/recovery-healthy-milestone.png`
- `deployments/rehearsal-local/browser-evidence/recovery-healthy-dispute.png`

### 5.3 Operability gate

```bash
bash scripts/verify-s03-operability.sh
```

Expected output:
- `deployments/rehearsal-local/operability-verification.json`

Gate enforces:
- rehearsal + recovery artifacts are present and structurally valid
- abort threshold checks on `/health.sync` freshness/degraded/status/lag
- browser evidence completeness

## 6. `/health` Contract For Operability Decisions

Launch/recovery scripts rely on these machine fields:
- `/health.sync.freshness`
- `/health.sync.degraded`
- `/health.sync.status`
- `/health.sync.phase`
- `/health.sync.lagBlocks`
- `/health.sync.lastError`
- `/health.sync.runtime.deploymentEnv`
- `/health.sync.runtime.manifestEnvironment`
- `/health.sync.runtime.manifestVersion`

Operational guidance should treat these fields as authoritative for offchain readiness, while still distinguishing them from onchain settlement truth.

## 7. Canary Abort And Offchain Rollback Strategy

### 7.1 Canary abort

Abort canary expansion when S03 exits non-zero due to:
- abort threshold breach
- malformed/missing artifacts
- missing required browser evidence

### 7.2 Rollback scope

Rollback applies only to offchain components:
- backend service
- frontend app
- indexer/runtime config

Contract deployments are not rolled back; mitigation is pause/new deployment path.

### 7.3 Recovery verification after rollback

After rollback actions:
1. run `bash scripts/verify-s02-recovery.sh`
2. run `bash scripts/verify-s03-operability.sh`
3. accept recovery only when S03 writes PASS verdict

## 8. Environment Boundary And Honesty Contract

Current executable gate coverage in this repo is for `rehearsal-local`.

This document does not claim complete production/staging operability verification until those environments have:
- environment-specific manifest coverage
- environment-specific threshold policy
- successful S02/S03-equivalent artifacts for that environment

## 9. Mechanical Runbook Verification

After changes to ops docs, run:

```bash
bash scripts/verify-m006-s01-docs.sh
```

This prevents stale command names and missing operability references from regressing silently.
