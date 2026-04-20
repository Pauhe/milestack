# Milestack Delivery Plan

## 1. Purpose

This document defines a practical path from documentation to a working Milestack product.

It focuses on:
- implementation phases
- dependencies between phases
- definition of done for each phase
- the shortest path to a usable MVP without weakening safety

Because Milestack will eventually hold real money, the plan intentionally treats correctness, observability, and staged rollout as first-class requirements.

## 2. Delivery Principles

1. Contracts come first.
2. Every state transition must be testable before frontend polish.
3. Backend and UI must be able to explain contract state clearly, not reinterpret it.
4. Production rollout must happen only after repeated testnet and staging rehearsals.
5. Any feature that weakens auditability or expands trust assumptions should wait.

## 3. High-Level Phases

1. Development foundation
2. Contract MVP
3. Indexing and backend MVP
4. Frontend MVP
5. End-to-end test environment
6. Closed alpha on testnet
7. Production readiness review
8. Mainnet launch with narrow exposure

## 4. Phase 1: Development Foundation

### Goals

- choose contract and app tooling
- scaffold repos and local developer environment
- define CI checks from day one

### Deliverables

- `contracts/` project scaffold
- `web/` project scaffold
- local dev orchestration docs
- CI pipeline for linting and tests
- environment variable templates

### Recommended choices

- contracts: Foundry
- frontend: Next.js + TypeScript
- chain library: viem + wagmi
- backend/indexer: Node.js + TypeScript + Postgres
- containerized local services with Docker Compose

### Definition of done

- a new developer can clone the repo and run all local services
- CI runs on every push and fails on test or lint regressions

## 5. Phase 2: Contract MVP

### Goals

- implement `EscrowFactory`
- implement `MilestoneEscrow`
- satisfy the contract spec and state machine

### Work items

1. define structs, enums, custom errors, and events
2. implement escrow creation validation
3. implement milestone funding paths
4. implement submission and deadline logic
5. implement approval path
6. implement timeout claim path
7. implement dispute path and arbiter resolution
8. implement cancellation of remaining unfunded milestones
9. implement aggregate accounting and view functions

### Definition of done

- contract code matches `docs/CONTRACT_SPEC.md`
- all unit tests pass
- invariant tests pass
- gas profile is understood, even if not fully optimized yet

## 6. Phase 3: Indexing And Backend MVP

### Goals

- ingest contract events reliably
- provide queryable deal, milestone, timeline, and reputation data

### Work items

1. event ingestion from deployment block
2. event normalization and idempotent processing
3. escrow and milestone materialized views
4. timeline derivation
5. reputation computation
6. metadata fetch and hash verification support
7. API routes for frontend consumption

### Definition of done

- backend can rebuild state from chain events
- API returns consistent derived fields for all core pages
- indexer survives restart and replay cleanly

## 7. Phase 4: Frontend MVP

### Goals

- let real users create and operate deals without ambiguity

### Work items

1. landing page
2. create-deal flow
3. deal overview page
4. milestone detail page
5. dispute view for buyer, seller, and arbiter
6. reputation profile page
7. strong empty/loading/error states
8. metadata verification and warning states

### Definition of done

- all core user journeys in `docs/USER_FLOWS.md` are functional
- role-based actions are correct
- deadline and dispute messaging is clear

## 8. Phase 5: End-to-End Test Environment

### Goals

- create a realistic environment that behaves like production without risking real funds

### Work items

1. deploy contracts to Base Sepolia
2. stand up staging backend and staging frontend
3. connect staging to testnet RPC and staging database
4. seed test wallets and scripted user scenarios
5. run deterministic end-to-end flows repeatedly

### Definition of done

- the full deal lifecycle can be exercised in staging from wallet to UI to backend to contract
- staging has health checks and monitoring
- test results are visible and repeatable

## 9. Phase 6: Mainnet-Fork And Deployment Rehearsal Environment

### Goals

- test against Base mainnet state and production-like deployment inputs before using real funds

### Work items

1. run contract and integration tests against a Base mainnet fork
2. verify deployment scripts against real chain config and live token addresses
3. verify backend config, RPC fallback behavior, and address manifests against production-like values
4. verify smoke journeys against forked chain state

### Definition of done

- mainnet-fork test suite passes consistently
- deployment scripts produce expected artifacts and addresses in rehearsal
- no environment-specific assumptions remain hidden until mainnet

## 10. Phase 7: Closed Alpha On Testnet

### Goals

- test real user behavior before any mainnet exposure

### Work items

1. onboard a small group of trusted users
2. run agency-style deals end to end
3. intentionally exercise dispute paths
4. observe confusion, stalled flows, and backend issues
5. refine copy, defaults, and operational runbooks

### Definition of done

- multiple successful testnet deals completed
- at least one or more dispute scenarios resolved cleanly
- no unresolved correctness issues remain in the contract or indexer

## 11. Phase 8: Mainnet Canary

### Goals

- prove the full production stack with real chain conditions before opening access widely

### Work items

1. deploy production contracts and infrastructure
2. run team-controlled low-value canary deals only
3. verify contract events, indexing, reputation derivation, alerting, and operator runbooks
4. hold public rollout until canary operations remain stable for a defined period

### Definition of done

- canary deals complete successfully end to end
- no indexing drift or alert blind spots are discovered
- incident and rollback procedures have been exercised at least once for offchain systems

## 12. Phase 9: Production Readiness Review

### Required gates

1. contract unit, fuzz, invariant, and integration tests all passing
2. frontend and backend test suites passing
3. end-to-end staging suite passing
4. Base mainnet-fork rehearsals completed
5. canary mainnet deals completed successfully
5. monitoring and alerting in place
6. rollback strategy documented for offchain systems
7. incident response and pause policy documented
8. contract review or audit completed before meaningful mainnet funds

### Important note

For Milestack, “production ready” is not just code complete. It means:
- the product is testable in a production-like environment
- operational failures are observable
- the team knows how to detect and respond to issues quickly

## 13. Phase 10: Mainnet Launch

### Launch strategy

Use a narrow launch, not a broad public release.

Recommended rollout:
1. deploy to Base mainnet
2. keep the user set limited initially
3. encourage low-value initial deals only
4. monitor all events and user sessions closely
5. expand only after stable operation

### First-launch constraints

- low total value per deal
- limited invite-only or allowlisted user set if desired
- explicit warnings that the product is early

## 12. Suggested Work Breakdown Order

### Track A: Contracts

1. scaffold Foundry project
2. implement enums, structs, errors
3. implement milestone transitions
4. add unit tests
5. add invariant tests

### Track B: Backend

1. scaffold Node service and Postgres schema
2. ingest events
3. derive state and timelines
4. expose API

### Track C: Frontend

1. scaffold Next.js app
2. build read-only deal pages first
3. add wallet actions
4. add create-deal and dispute flows

### Track D: Staging and Ops

1. add staging deployment manifests
2. add health checks and monitoring
3. wire end-to-end environment
4. add deployment rehearsal scripts
5. add mainnet-fork rehearsal scripts
6. add canary launch checklist

## 13. Definition Of A Working MVP

Milestack should be considered a working MVP when all of the following are true:

1. a seller can create a deal and deploy an escrow
2. a buyer can fund a milestone in USDC on Base Sepolia
3. a seller can submit milestone evidence
4. a buyer can approve or dispute before deadline
5. a seller can claim after timeout if buyer is silent
6. an arbiter can resolve disputes with exact split accounting
7. the backend shows accurate deal and reputation data
8. the frontend clearly renders role-appropriate actions and statuses
9. all end-to-end flows pass in staging

## 14. What Should Not Delay MVP

These are useful later, but should not block the first working version:

1. private deals
2. multi-chain support
3. delegated roles
4. mutual settlement flow
5. arbiter marketplace
6. sophisticated reputation scoring
7. growth or marketplace features

## 15. Immediate Next Step

The next concrete implementation step should be:

1. scaffold `contracts/` with Foundry
2. implement `MilestoneEscrow` first
3. write exhaustive tests before building the backend or action-heavy frontend
