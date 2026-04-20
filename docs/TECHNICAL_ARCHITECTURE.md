# Milestack Technical Architecture

## 1. Purpose

This document translates the product spec into an implementation-oriented architecture for Milestack's MVP.

The MVP goal is to deliver a secure, minimal, non-custodial milestone escrow system for digital work with:
- milestone funding in USDC
- seller submission of evidence
- buyer approval or formal dispute
- timeout-based seller claim when buyer is silent
- arbiter-based dispute resolution
- basic reputation derived from completed deals and dispute outcomes

## 2. System Overview

Milestack has four main layers:

1. Smart contracts
2. Indexing and application backend
3. Frontend web app
4. Wallet and chain integrations

### 2.1 High-level flow

1. Seller creates a deal draft in the web app.
2. Deal terms are stored offchain as metadata, with a hash or URI referenced by the contract.
3. The factory deploys a dedicated escrow contract for the deal.
4. Buyer funds milestones in USDC.
5. Seller submits milestone evidence.
6. Buyer approves, disputes, or remains silent.
7. Contract enforces payout or enters dispute resolution.
8. Events feed the indexer and update timelines, dashboards, and reputation views.

## 3. Architecture Decisions

### 3.1 Chain choice

The MVP should launch on a single Ethereum L2.

Recommended default:
- Base

Reasoning:
- low fees
- strong retail and builder distribution
- Ethereum-aligned
- good stablecoin and wallet support

Arbitrum remains a reasonable second deployment target later.

### 3.2 Asset choice

The MVP should support:
- USDC only

Reasoning:
- simplifies contract logic and UI
- removes token selection and pricing confusion
- avoids volatility risk
- easier reconciliation for users

### 3.3 Contract granularity

Recommended model:
- one escrow contract per deal

Reasoning:
- simpler UX and indexing
- all milestones for a deal live in one state machine
- easier to pause future milestones when one is disputed
- lower coordination overhead than per-milestone contracts

## 4. Smart Contract Architecture

### 4.1 Contract set

The MVP contract layer should include:
- `EscrowFactory`
- `MilestoneEscrow`

Potential later additions:
- `FeeVault`
- `ArbiterRegistry`
- `ReputationRegistry` or offchain reputation indexer only

### 4.2 EscrowFactory

Responsibilities:
- deploy new `MilestoneEscrow` instances
- validate common constructor arguments
- emit registry events for indexing
- hold immutable protocol configuration where needed

Suggested responsibilities to avoid in MVP:
- direct admin intervention in escrows
- upgrade logic unless absolutely necessary
- custody of user funds

Suggested constructor/config values:
- accepted USDC token address
- protocol fee recipient
- protocol fee basis points
- optional implementation address if cloning is used

Key events:
- `EscrowCreated(escrow, seller, buyer, arbiter, token, milestoneCount, metadataHash)`

### 4.3 MilestoneEscrow

Responsibilities:
- store deal parties and milestone data
- receive and hold milestone funds
- enforce milestone state transitions
- enforce review windows
- enforce dispute transitions
- execute payouts and refunds

Core immutable or initialization fields:
- `buyer`
- `seller`
- `arbiter`
- `token`
- `metadataHash` or `metadataURIHash`
- `protocolFeeBps`
- `feeRecipient`

Core deal-level state:
- `dealStatus`
- total milestone count
- current blocked-by-dispute flag

Suggested deal statuses:
- `Draft`
- `Active`
- `Completed`
- `Cancelled`

### 4.4 Milestone data model

Each milestone should include:
- `amount`
- `status`
- `reviewWindowSeconds`
- `submittedAt`
- `reviewDeadline`
- `evidenceHash`
- `disputeHash`
- `buyerAward`
- `sellerAward`

Suggested milestone status enum:
- `PendingFunding`
- `Funded`
- `Submitted`
- `Approved`
- `Claimable`
- `Disputed`
- `Resolved`
- `PaidOut`
- `Refunded`
- `Cancelled`

### 4.5 State transition rules

Allowed transitions:

1. `PendingFunding -> Funded`
2. `Funded -> Submitted`
3. `Submitted -> Approved`
4. `Approved -> PaidOut`
5. `Submitted -> Claimable` after review deadline if undisputed
6. `Claimable -> PaidOut`
7. `Submitted -> Disputed` before deadline
8. `Disputed -> Resolved`
9. `Resolved -> PaidOut` or `Resolved -> Refunded` depending on allocation

Critical invariants:
- disputed milestones cannot be claimed by timeout
- terminal states cannot transition further
- only funded milestones can be submitted
- only submitted milestones can be approved or disputed
- future milestones are blocked while any milestone is disputed
- dispute resolution amounts must sum exactly to milestone amount minus any fee treatment defined for disputed payouts

### 4.6 Public functions

Recommended core functions:
- `fundMilestone(uint256 milestoneId)`
- `fundAllMilestones()`
- `submitMilestone(uint256 milestoneId, bytes32 evidenceHash)`
- `approveMilestone(uint256 milestoneId)`
- `claimAfterReviewWindow(uint256 milestoneId)`
- `openDispute(uint256 milestoneId, bytes32 disputeHash)`
- `resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)`
- `cancelUnfundedMilestones()`

Optional but likely useful:
- `settleDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)` requiring both buyer and seller signatures or sequential acceptance

### 4.7 Access control rules

- only buyer funds milestones
- only seller submits milestones
- only buyer approves milestones
- only buyer opens disputes
- only seller claims after timeout
- only arbiter resolves disputes

Avoid platform admin powers in the escrow path.

### 4.8 Token handling

Use standard ERC-20 transfer patterns with explicit return-value handling.

Rules:
- only the configured USDC token is accepted
- milestone funding should mark the exact funded amount
- payouts must happen immediately on approval, claim, or resolution
- contract should not leave ambiguous internal balances after terminal transitions

Fee handling options:

Option A:
- deduct protocol fee only on seller payout paths

Option B:
- waive fee in dispute-refund cases to avoid perverse incentives

Recommended MVP rule:
- deduct fee only from seller-side payouts
- no fee on buyer refunds

### 4.9 Events

Events are critical because the web app and reputation layer should be mostly event-driven.

Suggested events:
- `MilestoneFunded(milestoneId, amount)`
- `MilestoneSubmitted(milestoneId, evidenceHash, submittedAt, reviewDeadline)`
- `MilestoneApproved(milestoneId)`
- `MilestoneClaimable(milestoneId)`
- `MilestoneClaimed(milestoneId, sellerAmount, feeAmount)`
- `MilestoneDisputed(milestoneId, disputeHash)`
- `DisputeResolved(milestoneId, buyerAmount, sellerAmount)`
- `MilestoneCancelled(milestoneId)`
- `DealCompleted()`

## 5. Contract Security Model

### 5.1 Main security goals

- funds cannot be released through invalid state transitions
- buyer objections within the review window block auto-claim
- arbiter cannot move funds outside disputed milestones
- payouts and refunds are exact and auditable
- state cannot be reopened after finalization

### 5.2 Main security risks

- invalid transition bugs
- reentrancy around token transfers
- off-by-one or timestamp logic around review deadlines
- incorrect split resolution accounting
- fee calculation errors
- milestone indexing errors

### 5.3 Mitigations

- keep state machine minimal
- use explicit enums and guards
- follow checks-effects-interactions ordering
- consider reentrancy guards on payout paths
- use custom errors and invariant-driven tests
- add property tests for impossible transitions and fund conservation

## 6. Metadata Strategy

The contract should not store verbose milestone descriptions or large evidence payloads.

Recommended approach:
- store human-readable deal terms offchain
- reference them with a content hash or URI hash onchain
- store milestone evidence as hash references onchain

Possible metadata contents:
- milestone descriptions
- service agreement text
- revision expectations
- deliverable links
- supporting attachments

This keeps gas costs low while preserving verifiability.

## 7. Reputation Architecture

Reputation should be computed offchain for MVP using indexed events.

Why offchain first:
- easier to iterate
- avoids onchain storage and gas costs
- reputation is presentation logic, not settlement logic

Suggested computed metrics:
- completed milestone count
- total payout volume
- total refund volume
- dispute count
- dispute win rate as buyer
- dispute win rate as seller
- cancellation count
- average buyer response time if feasible

Separate views should exist for:
- buyer reputation
- seller reputation
- arbiter reputation later

## 8. Backend And Indexing Layer

The MVP should include a thin backend or indexer service, even if most user interactions are wallet-driven.

Responsibilities:
- index factory and escrow events
- resolve escrow and milestone timelines
- compute reputation metrics
- cache metadata and evidence references
- support frontend queries efficiently

Implementation options:
- simple Node service with database and viem/ethers listeners
- or a managed indexing stack such as The Graph later

Recommended MVP:
- a lightweight Node service with Postgres

Core tables or equivalents:
- `escrows`
- `milestones`
- `events`
- `users`
- `reputation_snapshots`

## 9. Frontend Architecture

### 9.1 Stack recommendation

Recommended stack:
- Next.js
- TypeScript
- wagmi
- viem
- a minimal component system, likely Tailwind plus a small internal UI layer

Reasoning:
- good wallet integration ecosystem
- server and client rendering flexibility
- straightforward data fetching and routing

### 9.2 Core frontend surfaces

1. Landing and product explanation
2. Create deal flow
3. Deal overview page
4. Milestone detail page
5. Dispute view
6. Reputation profile page

### 9.3 Key frontend requirements

- always show current milestone state clearly
- show the exact next action for the connected role
- show countdown timers for review windows
- explain when funds are locked, claimable, released, or disputed
- make dispute and revision concepts visually distinct

### 9.4 Create deal flow

User inputs:
- buyer address
- arbiter address
- milestone descriptions
- milestone amounts
- review windows
- deal-level metadata or external terms reference

Recommended UX:
- guided step-by-step form
- total amount validation
- strong copy around what disputes mean

### 9.5 Deal overview page

Must show:
- participants
- token and network
- milestone list with status badges
- funded amount
- claimable amount
- dispute status
- event timeline

### 9.6 Milestone detail page

Must show:
- description
- amount
- evidence reference
- submission timestamp
- review deadline
- available actions based on role and state

### 9.7 Dispute view

Must show:
- dispute reason reference
- milestone evidence
- current locked amount
- arbiter identity
- final resolution when present

## 10. API Shape

Even if the app is primarily event-driven, a small backend API is useful.

Suggested endpoints:
- `GET /escrows/:address`
- `GET /escrows/:address/milestones`
- `GET /users/:address/reputation`
- `GET /users/:address/activity`
- `GET /disputes/:escrowAddress/:milestoneId`

Later additions:
- signed metadata upload endpoints
- arbiter discovery endpoints
- analytics endpoints

## 11. Testing Strategy

### 11.1 Contract tests

Essential test groups:
- happy path funding, submission, approval, payout
- timeout claim path
- dispute open and resolution path
- invalid transition tests
- unauthorized caller tests
- exact accounting and fee tests
- edge-of-deadline timestamp tests

### 11.2 Property or invariant tests

Important invariants:
- total allocated funds per milestone never exceed funded amount
- disputed milestones cannot be claimed by timeout
- terminal milestones cannot transition again
- only the permitted role can invoke each action

### 11.3 Frontend tests

At minimum:
- role-based action rendering
- milestone status rendering
- countdown and deadline display logic
- API integration for timelines and reputation

## 12. Deployment Plan

### Phase 1

- deploy contracts to Base testnet
- wire event indexing
- build internal operator UI for test deals
- validate milestone and dispute flows manually

### Phase 2

- launch closed alpha with a small number of agencies or crypto-native users
- monitor dispute frequency, timeout behavior, and UX confusion
- refine milestone templates and contract copy

### Phase 3

- deploy to Base mainnet
- open self-serve deal creation
- add reputation profiles and better search/discovery later if needed

## 13. Non-Goals For MVP

- full freelancer marketplace
- fiat payment rails
- decentralized jury/court systems
- objective proof integrations like GitHub merge hooks at launch
- multi-chain deployments
- mobile-first native apps

## 14. Open Technical Decisions

- whether to use direct deployment or minimal proxy clones for escrows
- whether mutual settlement belongs in MVP or immediate post-MVP
- how much metadata should be hashed onchain versus stored by URI reference
- whether the initial backend should be fully custom or The Graph-backed
- whether protocol fees should be configurable at factory deployment or immutable per deployment

## 15. Recommended First Implementation Order

1. Define contract structs, enums, and invariants.
2. Implement `MilestoneEscrow` with the smallest valid state machine.
3. Implement `EscrowFactory` and escrow creation events.
4. Write comprehensive contract tests before frontend integration.
5. Build the deal overview and milestone action UI.
6. Add indexing and reputation computation.
7. Run end-to-end tests against a testnet deployment.
