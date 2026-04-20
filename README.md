# Milestack

Milestack is a non-custodial milestone escrow platform for digital work on Ethereum L2s.

It is designed for cases where buyers and sellers do not fully trust each other, especially in cross-border work. Funds are held in smart contracts, not by the platform. Sellers submit milestone deliverables, buyers approve or dispute within a review window, and sellers can claim payment after timeout if buyers stay silent.

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
- Explicit milestone states
- Timeout-based release path to prevent payment stalling
- Bounded human judgment only for disputes
- Reputation based on real deal outcomes, not vanity metrics
- Minimal MVP focused on Base and USDC
- Sequential milestones only in the first release
- User-selected arbiters, not a platform arbitration network

## Repository Layout

- `PRODUCT_SPEC.md`: product and market spec
- `docs/TECHNICAL_ARCHITECTURE.md`: contract and frontend architecture
- `contracts/`: smart contract implementation
- `web/`: frontend application

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

## Near-Term Build Plan

1. Implement `MilestoneEscrow` with a minimal sequential state machine.
2. Add tests for valid paths, invalid transitions, deadlines, and fund conservation.
3. Implement `EscrowFactory` and event indexing.
4. Build the create-deal, deal overview, milestone action, and dispute screens.
5. Validate the full flow with a narrow first-user segment on Base testnet.
