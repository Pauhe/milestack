# Milestack Testing And Deployment Strategy

## 1. Purpose

This document defines how Milestack should be tested locally, in integration environments, in staging, and before production launch.

Because real money is expected later, the strategy assumes:
- contracts are the highest-risk component
- correctness matters more than shipping quickly
- staging must be production-like enough to catch operational and integration failures

## 2. Testing Philosophy

1. Test the smallest unit first.
2. Add invariant and adversarial tests around contract behavior.
3. Test the real user flows end to end on testnet before mainnet.
4. Treat deployment itself as something that must be tested repeatedly.
5. Require health checks and observability in staging before trusting production.

## 3. Test Pyramid For Milestack

### Level 1: Static and lint checks

Purpose:
- catch obvious mistakes cheaply

Includes:
- Solidity formatting and linting
- TypeScript linting
- type checks
- schema validation checks

### Level 2: Unit tests

Purpose:
- validate isolated contract, backend, and frontend logic

Includes:
- contract unit tests per function and transition
- backend pure-function and transformer tests
- frontend component and helper tests

### Level 3: Integration tests

Purpose:
- validate interactions across local services and chain simulators

Includes:
- contract integration tests on local Anvil network
- backend against a real Postgres instance and event streams
- frontend against mocked or ephemeral backend and wallet state

### Level 4: End-to-end tests

Purpose:
- validate real user workflows across deployed services

Includes:
- wallet -> frontend -> backend -> contract -> indexer -> UI feedback loops

### Level 5: Deployment rehearsal and staging health validation

Purpose:
- validate operational safety before real rollout

Includes:
- full environment deploys
- smoke tests
- data path and health verification
- alerting verification

## 4. Local Development Test Strategy

## 4.1 Contracts

Recommended stack:
- Foundry
- Anvil for local chain

Required local test categories:

1. creation validation tests
2. milestone funding tests
3. submission tests
4. approval tests
5. timeout claim tests
6. dispute open tests
7. dispute resolution tests
8. cancellation tests
9. unauthorized caller tests
10. deadline boundary tests
11. fee accounting tests
12. sequencing tests

Required advanced contract testing:

1. fuzz tests for milestone amounts, review windows, and splits
2. invariant tests for:
   - fund conservation
   - terminal-state immutability
   - no dispute/claim overlap
   - sequential milestone enforcement

### 4.2 Backend

Local backend testing should include:

1. event decoding tests
2. idempotent event processor tests
3. reorg handling tests where feasible
4. reputation computation tests
5. metadata hash verification tests
6. API response shape tests

Recommended local setup:
- Postgres in Docker
- backend service connected to local chain and local DB

### 4.3 Frontend

Frontend local testing should include:

1. form validation tests
2. role-based action rendering tests
3. milestone status rendering tests
4. countdown/deadline display tests
5. dispute resolution amount validation tests
6. metadata verification warning tests

## 5. Local Integration Test Strategy

The goal of local integration tests is to ensure the pieces work together before anything is deployed.

Recommended local integration environment:
- Anvil
- Postgres
- backend/indexer service
- frontend app

Recommended orchestration:
- Docker Compose for Postgres and optional backend
- local scripts to boot Anvil, deploy contracts, seed wallets, and run test flows

Key local integration scenarios:

1. create escrow -> fund -> submit -> approve
2. create escrow -> fund -> submit -> timeout -> claim
3. create escrow -> fund -> submit -> dispute -> resolve split
4. event indexer restart and replay
5. frontend reflecting updated backend state after onchain transactions

## 6. End-to-End Test Strategy

Recommended tooling:
- Playwright for browser E2E
- dedicated test wallets for buyer, seller, and arbiter

Core E2E scenarios:

1. Happy path
   - seller deploys
   - buyer funds
   - seller submits
   - buyer approves
   - UI reflects terminal payout

2. Silent buyer path
   - seller submits
   - chain time advances in test environment
   - seller claims after timeout
   - UI reflects payout

3. Dispute path
   - buyer disputes before deadline
   - arbiter resolves
   - UI shows final split/refund/payout

4. Error path
   - wrong wallet role attempts action
   - UI blocks or shows error clearly

5. Metadata path
   - metadata hash mismatch causes warning or failure state

These should run automatically in CI for local ephemeral environments where practical, and manually or scheduled in staging against testnet.

## 7. Deployment Test Strategy

Deployment must be treated as a testable system, not just an ops step.

Each deployment rehearsal should validate:

1. contracts deploy with expected constructor values
2. deployment artifacts and addresses are recorded correctly
3. backend points at the correct chain and contract addresses
4. frontend points at the correct backend and chain config
5. health checks pass after deploy
6. smoke tests succeed for basic read paths and one full transaction flow

## 8. Environments

Milestack should have at least four environments.

### 8.1 Local

Purpose:
- developer iteration

Components:
- Anvil
- Postgres
- backend
- frontend

### 8.2 CI ephemeral

Purpose:
- automated validation per branch or PR

Components:
- ephemeral local chain
- ephemeral Postgres
- test build of backend and frontend

### 8.3 Staging / pre-production

Purpose:
- realistic rehearsal environment
- production-like health and deployment validation

Recommended chain:
- Base Sepolia

Components:
- deployed testnet contracts
- staging backend service
- staging Postgres
- staging frontend
- staging monitoring and alerting
- seeded funded test wallets

### 8.4 Production

Purpose:
- real users and real money

Recommended chain:
- Base mainnet

## 9. Can We Have A Test Environment Where We Check Everything For Health First?

Yes. Milestack should absolutely have that before production.

Recommended environment:
- a full staging environment on Base Sepolia with production-like infrastructure

This environment should be used to verify:

1. deployment health
2. contract address configuration
3. backend ingestion and indexing health
4. API correctness
5. frontend rendering and wallet interactions
6. end-to-end transaction flows
7. alerting and incident visibility

This is the last gate before production rollout.

## 10. Staging Health Checks

Staging should have explicit health endpoints and checks for:

### 10.1 Frontend health

- app is serving successfully
- required environment variables are present
- expected chain configuration is loaded

### 10.2 Backend health

- process is alive
- DB connectivity is healthy
- latest indexed block is recent enough
- contract addresses are loaded
- metadata fetch subsystem is healthy

### 10.3 Indexer health

- last processed block
- lag behind chain head
- replay queue size or failed events count
- reorg handling status

### 10.4 Database health

- connection pool saturation
- migration status
- storage and query latency indicators

### 10.5 Chain/RPC health

- RPC reachable
- latest chain head available
- read calls succeeding

### 10.6 E2E health

- scheduled smoke journey completes successfully

## 11. Production Infrastructure Requirements

For MVP production, Milestack needs the following infrastructure.

### 11.1 Chain and RPC

- primary Base RPC provider
- secondary/fallback RPC provider
- chain configuration management

Reason:
- RPC outages should not completely blind the backend or UI

### 11.2 Contracts

- deployed `EscrowFactory`
- verified contract source
- deployment artifact registry with addresses and config

### 11.3 Frontend hosting

- production-grade frontend hosting platform
- environment-specific configuration
- TLS and domain management

### 11.4 Backend/API hosting

- stateless app service for API and indexing workers or separate processes
- horizontal scaling optional, but clean restart and replay support required

### 11.5 Database

- managed Postgres preferred
- backups enabled
- migration strategy documented

### 11.6 Monitoring and alerting

- uptime monitoring
- error tracking
- metrics and dashboards
- alerting for indexer lag, DB health, API failures, and failed smoke tests

### 11.7 Secrets management

- secure storage for RPC keys, API secrets, and service credentials

### 11.8 Logging

- centralized logs for backend and workers
- searchable logs for incident investigation

## 12. Recommended Production Stack

One pragmatic MVP production stack could be:

- frontend: Vercel or similar
- backend/indexer: containerized service on Fly.io, Render, Railway, ECS, or similar
- database: managed Postgres
- monitoring: Sentry + metrics provider + uptime checks
- RPC: Alchemy + fallback provider
- object or metadata hosting: simple HTTPS or pinned content where appropriate

The exact vendors can change. The important part is redundancy, observability, and operational simplicity.

## 13. Release Gates Before Mainnet

The product should not launch on mainnet until all of these are true:

1. contract test suite is green
2. invariant/fuzz tests are green
3. local integration suite is green
4. staging E2E suite is green
5. staging smoke checks pass repeatedly over time
6. backend reindex from scratch succeeds cleanly
7. deployment rehearsal is documented and repeatable
8. monitoring and alerting are live and tested
9. contract review or audit is completed before meaningful user value is exposed

## 14. Recommended Launch Strategy For Real Money

Do not go from testnet directly to broad public mainnet use.

Recommended path:

1. internal testnet only
2. closed external testnet alpha
3. mainnet soft launch with low-value deals only
4. limited user set initially
5. gradually increase allowed deal size and user count

This reduces blast radius if operational or UX issues appear.

## 15. Incident Readiness

Even if the contracts do not include admin settlement powers, Milestack still needs operational incident readiness.

Before production, define:

1. who responds to alerts
2. how to freeze or disable new frontend deal creation if offchain systems are unhealthy
3. how to communicate incidents to users
4. how to verify whether a problem is contract-side, backend-side, or RPC-side
5. how to safely redeploy backend/indexer services without data loss

## 16. Recommended Immediate Implementation Sequence

1. scaffold `contracts/` with Foundry
2. write contract unit tests before full implementation
3. add invariant/fuzz tests
4. scaffold local backend + Postgres + indexer
5. add Docker Compose for local integration
6. scaffold frontend and Playwright test setup
7. create Base Sepolia staging deployment path
8. add health checks and smoke tests

## 17. Bottom Line

Yes, you should have a full pre-production environment where you can verify system health before production.

For Milestack, that means:

1. local development environment for fast iteration
2. CI ephemeral environment for automated validation
3. Base Sepolia staging environment for realistic end-to-end rehearsals
4. production with monitoring, rollback for offchain systems, and narrow rollout controls

Because real money will be involved later, the most important discipline is this:

Never rely on “we tested the code” alone. Also test:
- the deployments
- the data flow
- the indexer
- the UI behavior under failure
- the operational visibility of the system
