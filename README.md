# Milestack

[![Contracts](https://github.com/Pauhe/milestack/actions/workflows/contracts.yml/badge.svg)](https://github.com/Pauhe/milestack/actions/workflows/contracts.yml)
[![Slither](https://github.com/Pauhe/milestack/actions/workflows/slither.yml/badge.svg)](https://github.com/Pauhe/milestack/actions/workflows/slither.yml)
[![Backend](https://github.com/Pauhe/milestack/actions/workflows/backend.yml/badge.svg)](https://github.com/Pauhe/milestack/actions/workflows/backend.yml)

Milestack is a non-custodial milestone escrow platform for digital work.

First launch is intentionally narrow: Base only, USDC only, one buyer + one seller + one arbiter per deal, sequential milestones, and public-by-default deal metadata. It is designed for cases where buyers and sellers do not fully trust each other, especially in cross-border work. Funds are held in smart contracts, not by the platform. Sellers submit milestone deliverables, buyers approve or dispute within a review window, and sellers can claim payment after timeout if buyers stay silent.

## Why This Exists

Digital work has two persistent trust failures:
- buyers do not want to prepay and risk no delivery
- sellers do not want to deliver and risk non-payment

Milestack uses smart contracts to enforce payout rules without requiring platform custody.

## Core Product Idea

Milestack turns service agreements into milestone-based escrows funded in stablecoins.

Normal flow:
1. Seller creates a deal with milestones.
2. Buyer funds a milestone.
3. Seller submits work with evidence.
4. Buyer approves or disputes during a review window.
5. If the buyer is silent, the seller can claim after timeout.

Dispute flow:
1. Buyer opens a dispute before the review window ends.
2. The disputed milestone is frozen.
3. A named arbiter resolves the dispute.
4. Funds are paid to the buyer, seller, or split between both.

## Initial Wedge

The first target segment is crypto-native agencies and international digital service providers doing milestone-based work in the $2k-$25k range.

Why this segment:
- they already use milestones
- cross-border payment friction is real
- stablecoin payments are acceptable
- trust risk is meaningful enough to justify escrow

## Product Principles

- No platform custody
- Explicit payout rules and role-gated actions
- Timeout-based release path to prevent payment stalling
- Bounded human judgment only for disputes
- Reputation based on real deal outcomes, not vanity metrics
- Narrow first launch: Base only + USDC only
- Sequential milestones only in first launch
- User-selected arbiters, not a platform arbitration network
- Public-by-default metadata in first launch

## Launch Boundary Authority

For first-launch scope decisions, the canonical boundary and recovery program are tracked in the project's internal milestone artifacts and are not published in this repository. The in-repo docs listed below reflect the agreed boundary at time of writing; if a broader doc conflicts with the narrower in-repo specifications (e.g. `docs/TECHNICAL_ARCHITECTURE.md`, `docs/CONTRACT_SPEC.md`), the narrower spec is authoritative.

## Operability Truth Surface (Rehearsal-Local Only)

Current executable launch/no-launch evidence in-repo is rehearsal-local.
Use these exact gates and artifacts when asserting launch readiness in docs or runbooks:

- `bash scripts/verify-s02-recovery.sh`
- `bash scripts/verify-s03-operability.sh`
- `deployments/rehearsal-local/rehearsal-recovery-verification.json`
- `deployments/rehearsal-local/operability-verification.json`
- `/health.sync.freshness`
- `/health.sync.degraded`
- `/health.sync.status`
- `/health.sync.phase`
- `/health.sync.lagBlocks`
- `/health.sync.lastError`

If canary abort conditions are met, treat the verdict as no-launch.
Rollback is offchain-only rollback (backend/web/indexer and config), not contract-state rollback.

## Repository Layout

- `PRODUCT_SPEC.md`: product and market spec
- `docs/TECHNICAL_ARCHITECTURE.md`: contract and frontend architecture
- `contracts/`: smart contract implementation
- `web/`: frontend application

## Development Docs

- Contracts workspace guide: [`contracts/README.md`](./contracts/README.md)
- Contracts maintenance runbook: [`docs/CONTRACTS_RUNBOOK.md`](./docs/CONTRACTS_RUNBOOK.md)
- Local stack runbook: [`docs/LOCAL_STACK_RUNBOOK.md`](./docs/LOCAL_STACK_RUNBOOK.md)

## Current Docs

- Product spec: [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md)
- Technical architecture: [`docs/TECHNICAL_ARCHITECTURE.md`](./docs/TECHNICAL_ARCHITECTURE.md)
- Contract spec: [`docs/CONTRACT_SPEC.md`](./docs/CONTRACT_SPEC.md)
- Delivery plan: [`docs/DELIVERY_PLAN.md`](./docs/DELIVERY_PLAN.md)
- Testing and deployment strategy: [`docs/TESTING_AND_DEPLOYMENT_STRATEGY.md`](./docs/TESTING_AND_DEPLOYMENT_STRATEGY.md)
- Runbooks: [`docs/RUNBOOKS.md`](./docs/RUNBOOKS.md)
- Deployment manifest spec: [`docs/DEPLOYMENT_MANIFEST_SPEC.md`](./docs/DEPLOYMENT_MANIFEST_SPEC.md)
- Security review checklist: [`docs/SECURITY_REVIEW_CHECKLIST.md`](./docs/SECURITY_REVIEW_CHECKLIST.md)
- State machine: [`docs/STATE_MACHINE.md`](./docs/STATE_MACHINE.md)
- Data model: [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md)
- Threat model: [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md)
- User flows: [`docs/USER_FLOWS.md`](./docs/USER_FLOWS.md)

## MVP Summary

In scope:
- Base only
- USDC only
- wallet-to-wallet deals
- milestone funding, submission, approval, dispute, and timeout claim
- one named arbiter per deal
- sequential milestone progression
- offchain deal metadata with onchain hash references
- basic buyer and seller reputation

Out of scope:
- fiat rails
- marketplace discovery
- multi-chain support
- complex oracle verification
- fully decentralized court systems
- mutual settlement flow in v1
- platform-managed arbiter marketplace

## Launch Program (Canonical Sequence)

Launch-critical work is the recovery program `M002` through `M006`, in this order:
1. `M002`: contract correctness and security proof
2. `M003`: backend/read-model reliability
3. `M004`: user-facing workflow clarity
4. `M005`: full-system staging rehearsal
5. `M006`: launch operability + documentation truth

`M007` is intentionally **post-launch** and reserved for widening work (multi-chain, privacy, delegated permissions, multi-party topology, discovery, and other deferred expansion tracks).

