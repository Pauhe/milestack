# Local Stack Runbook

## 1. Purpose

This runbook describes the fastest supported way to run the Milestack local stack during active development.

Current local stack scope:
- contracts
- backend/indexer service
- frontend app

## 2. Install

### Contracts

Run from `contracts/`:

```bash
forge test
```

### Backend

Run from `backend/`:

```bash
npm install
```

### Web

Run from `web/`:

```bash
npm install
```

## 3. Fast Local Startup

From the repository root:

```bash
./scripts/dev-stack.sh
```

This script:
1. starts the backend on `http://localhost:4000`
2. triggers a backend sync
3. starts the web app on `http://localhost:3000`

## 4. Manual Backend Sync

If the backend is already running, trigger a sync manually with:

```bash
./scripts/backend-sync.sh
```

Optional alternate backend URL:

```bash
BACKEND_URL=http://localhost:4000 ./scripts/backend-sync.sh
```

## 5. Health Checks

### Backend health

```bash
curl http://localhost:4000/health
```

The response includes:
- environment
- chain id
- factory address
- last synced block
- sync loop state

## 6. Expected Local URLs

- frontend: `http://localhost:3000`
- backend: `http://localhost:4000`

## 7. Common Local Flow

1. run `forge test` in `contracts/`
2. run `./scripts/dev-stack.sh` from repo root
3. open `/deals/demo-deal`
4. open `/create`
5. if contract state changes, trigger `./scripts/backend-sync.sh`

## 8. Current Limitations

This local stack currently assumes:
- a manifest-driven local config
- a backend using SQLite for persistence
- direct contract reads still exist as fallback in some frontend routes

This is not yet a full production-like orchestration environment with:
- Postgres
- containerized local services
- chain bootstrapping scripts

## 9. Next Upgrade Path

The next likely local-stack improvements are:
1. add Docker Compose for backend dependencies
2. add an anvil/bootstrap script
3. add seeded local deployment manifests and scripted sample escrows

## 10. Local Deployment Manifest Refresh

To refresh the deployment manifest from a real factory deployment:

```bash
USDC_ADDRESS=0x... \
FEE_RECIPIENT=0x... \
PROTOCOL_FEE_BPS=100 \
PRIVATE_KEY=0x... \
./scripts/deploy-factory-and-write-manifest.sh
```

By default this writes to `deployments/rehearsal-local/manifest.json`. To target another environment, set `DEPLOY_ENVIRONMENT` explicitly.

This will:
1. run the Foundry factory deployment script
2. read the latest broadcast output
3. write `deployments/<environment>/manifest.json`

## 11. Rehearsal Bootstrap Path

To generate deterministic rehearsal fixtures for happy/timeout/dispute journeys:

```bash
./scripts/rehearsal-stack.sh
```

This script:
1. refreshes the rehearsal manifest (unless `SKIP_FACTORY_DEPLOY=1`)
2. writes deterministic seeded journeys to `deployments/rehearsal-local/seeded-journeys.json`
3. prints phase-based logs (`phase=deploy-manifest`, `phase=seed-data`) for startup troubleshooting

To run app servers against rehearsal manifests:

```bash
DEPLOY_ENVIRONMENT=rehearsal-local ./scripts/dev-stack.sh
```

The startup logs print the backend `DEPLOYMENT_ENV` and web `NEXT_PUBLIC_DEPLOYMENT_ENV` so environment provenance is inspectable during rehearsals.
