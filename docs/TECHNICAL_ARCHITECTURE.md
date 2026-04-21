# Milestack Technical Architecture

## 1. Purpose

This document translates the product spec into an implementation-oriented architecture for Milestack's MVP.

Launch-truth companion references:
- `.gsd/milestones/M001/slices/S03/architecture-interface-reconciliation.md` is the canonical cross-layer semantics reconciliation for conceptual-vs-durable status meaning and timeline interpretation caveats.
- `.gsd/milestones/M001/slices/S02/canonical-launch-boundary.md` defines first-launch scope boundaries and non-goals.

If this architecture guide and those artifacts diverge on launch semantics, treat the S02/S03 artifacts as authoritative until a documented update is made.

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

### 3.4 Decisions locked for MVP

The following decisions should be treated as fixed for the first implementation pass:
- single-chain deployment on Base
- one ERC-20 token, configured as USDC
- one escrow contract per deal
- sequential milestones only
- default review window of 5 days in product templates
- no milestone edits after escrow creation
- no platform admin override on milestone state
- user-selected arbiter per deal
- reputation computed offchain from events
- public deal and reputation pages by default

These constraints are important because they keep the contract state machine narrow and make test coverage tractable.

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

Recommended MVP approach:
- start with direct deployment from the factory
- postpone clone optimization until deployment costs become a practical issue

This reduces moving parts and simplifies debugging and verification during early development.

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

Recommended lifecycle simplification:
- `Draft` should only exist before the first successful funding
- once any milestone is funded, the deal becomes `Active`
- the onchain contract does not need an elaborate negotiation state machine; buyer acceptance can be represented by funding

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

Recommended struct boundaries:
- keep only contract-critical data onchain
- store user-facing text offchain in deal metadata
- use fixed-size values where practical to reduce gas and simplify tests

Suggested onchain layout by concern:

`DealConfig`
- buyer
- seller
- arbiter
- token
- feeRecipient
- protocolFeeBps
- metadataHash

`Milestone`
- amount
- status
- reviewWindowSeconds
- submittedAt
- reviewDeadline
- evidenceHash
- disputeHash
- buyerAward
- sellerAward

`DealRuntime`
- currentMilestoneIndex
- activeDisputeMilestoneId or sentinel value
- totalReleasedToSeller
- totalRefundedToBuyer

Suggested milestone status enum (launch-runtime oriented, user-observable):
- `PendingFunding`
- `Funded`
- `Submitted`
- `Approved` (transient execution step before payout finalization)
- `Disputed`
- `PaidOut`
- `Refunded`
- `Cancelled`

Conceptual/internal-only labels used in product explanations:
- `Claimable` is a derivable timeout-eligibility concept, not currently a guaranteed durable stored state.
- `Resolved` is a conceptual dispute phase; launch-runtime outcomes are user-observable as `PaidOut` or `Refunded`.

### 4.5 State transition rules

Allowed runtime transitions:

1. `PendingFunding -> Funded`
2. `Funded -> Submitted`
3. `Submitted -> Approved`
4. `Approved -> PaidOut` (approval path finalizes payout in the same call flow)
5. `Submitted -> Disputed` before deadline
6. `Disputed -> PaidOut` or `Disputed -> Refunded` depending on arbiter allocation

Conceptual lifecycle guidance (not durable transition guarantees):
- `Submitted -> Claimable -> PaidOut` can be used as UX shorthand for the seller-timeout path.
- `Disputed -> Resolved -> PaidOut/Refunded` can be used as conceptual dispute-phase narration.

Critical invariants:
- disputed milestones cannot be claimed by timeout
- terminal states cannot transition further
- only funded milestones can be submitted
- only submitted milestones can be approved or disputed
- future milestones are blocked while any milestone is disputed
- dispute resolution amounts must sum exactly to milestone amount minus any fee treatment defined for disputed payouts
- only the current milestone index may transition out of pre-terminal active states in MVP
- `reviewDeadline` must be derived from `submittedAt + reviewWindowSeconds`
- contract balance plus distributed funds must always equal total funded amount

### 4.5.1 Recommended lifecycle implementation

The simplest valid implementation for MVP is:

1. Create escrow with full milestone configuration.
2. Allow funding only for the next unfunded milestone, unless `fundAllMilestones()` is explicitly invoked.
3. Allow submission only for the next funded unresolved milestone.
4. Freeze all later milestone actions while one milestone is in `Disputed`.
5. Mark the deal `Completed` when all milestones are terminal.

This avoids dependency graphs, out-of-order execution, and cross-milestone ambiguity.

Recommended product behavior:
- implement `fundAllMilestones()` at the contract layer
- make `fundMilestone()` the default UI path
- optionally expose `fundAllMilestones()` in the UI later once the simpler path is proven

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

Recommended MVP exclusions:
- do not implement `settleDispute` in the first contract pass
- do not implement milestone editing or milestone deletion after creation
- do not implement arbitrary third-party callers or delegated role permissions

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

Implementation notes:
- use OpenZeppelin `SafeERC20`
- update state before external token transfers
- emit payout events after successful transfers
- fail the transaction on any transfer failure rather than trying to continue partially

### 4.9 Events

Events are critical because the web app and reputation layer should be mostly event-driven.

Suggested events:
- `MilestoneFunded(milestoneId, amount)`
- `MilestoneSubmitted(milestoneId, evidenceHash, submittedAt, reviewDeadline)`
- `MilestoneApproved(milestoneId)`
- `MilestoneClaimed(milestoneId, sellerAmount, feeAmount)`
- `MilestoneDisputed(milestoneId, disputeHash)`
- `DisputeResolved(milestoneId, buyerAmount, sellerAmount)`
- `MilestoneCancelled(milestoneId)`
- `DealCompleted()`

Event interpretation caveat:
- `MilestoneClaimed` represents seller payout finalization but may originate from either buyer approval or seller timeout claim flows; indexer and UI narration should derive the cause from surrounding context instead of assuming timeout by event name alone.
- `MilestoneClaimable` can be kept as a conceptual/future event name, but should not be treated as emitted launch-runtime truth unless wired end-to-end and made user-observable through indexed/read-model surfaces.

Recommended event design rules:
- every state transition that matters to the UI should have a dedicated event
- include enough data for the indexer to compute timeline entries without additional chain calls where possible
- avoid events that imply states the contract does not explicitly track

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

### 5.4 Security review checklist for implementation

Before considering the contract MVP ready, verify:
- no caller can release or refund a milestone outside its allowed role
- disputes cannot be opened after the review deadline
- claims cannot happen before the review deadline
- disputes cannot be reopened after resolution
- fee deductions cannot exceed seller-side payout amounts
- funded amounts cannot become stranded through cancellation paths

## 6. Metadata Strategy

The contract should not store verbose milestone descriptions or large evidence payloads.

Recommended approach:
- store human-readable deal terms offchain
- reference them with a content hash or URI hash onchain
- store milestone evidence as hash references onchain

Recommended MVP metadata split:

Onchain:
- metadata hash
- evidence hash
- dispute hash

Offchain:
- milestone names and descriptions
- full service agreement text
- file URLs and attachments
- revision notes
- plain-language dispute explanation

The frontend should validate that offchain metadata hashes to the onchain reference before presenting it as canonical.

MVP visibility rule:
- metadata referenced by public deal pages should be treated as public content
- do not promise private deals until encrypted storage and access control are explicitly designed

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

Recommended additional tables or materialized views:
- `milestone_timeline_entries`
- `user_role_stats`
- `open_disputes`

Operational responsibilities:
- backfill events from deployment block
- keep an idempotent event processor
- handle chain reorgs conservatively
- recompute derived reputation metrics from source events when needed

Recommended MVP backend boundaries:
- no custody or privileged signing
- no backend-dependent settlement logic
- backend is a read and aggregation layer only

## 9. Frontend Architecture

### 9.1 Stack recommendation

Recommended stack:
- Next.js
- TypeScript
- wagmi
- viem
- a minimal component system, likely Tailwind plus a small internal UI layer

Recommended frontend posture:
- server-render read-heavy pages where useful
- keep wallet-connected state transitions in focused client components
- avoid over-abstracting until the deal and milestone flows stabilize

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

Critical UX copy requirements:
- explain that silence after the review window allows seller claim
- explain that disputes require a human arbiter decision
- explain that later milestones are blocked while a dispute is unresolved

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

Recommended validations:
- every milestone amount must be positive
- total milestone amount must match the displayed deal total
- review window must be within allowed bounds
- buyer, seller, and arbiter addresses must be distinct unless intentionally permitted
- at least one milestone must exist

### 9.5 Deal overview page

Must show:
- participants
- token and network
- milestone list with status badges
- funded amount
- claimable amount
- dispute status
- event timeline

Should also show:
- currently actionable milestone
- blocked reason if later milestones cannot proceed
- protocol fee treatment in payout summaries

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

If the connected wallet is the arbiter, the page should also show a narrow resolution interface that makes split outcomes explicit and validates that the resolution amounts sum correctly.

## 10. API Shape

Even if the app is primarily event-driven, a small backend API is useful.

Suggested endpoints:
- `GET /escrows/:address`
- `GET /escrows/:address/milestones`
- `GET /users/:address/reputation`
- `GET /users/:address/activity`
- `GET /disputes/:escrowAddress/:milestoneId`

Recommended additional endpoint:
- `GET /escrows/:address/timeline`

Suggested response shape principles:
- return both raw chain-derived state and UI-friendly derived fields
- include role-aware action hints where cheap to compute
- expose deadline- and dispute-aware eligibility semantics (for example timeout claimability and blocked reasons) as a derived read model owned by the backend
- treat backend data as a convenience layer, not the source of settlement truth

Ownership rule for launch semantics:
- contracts own settlement truth;
- backend owns the derived read model;
- frontend should consume and explain those derived semantics instead of inventing parallel lifecycle logic.

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
- later milestones cannot advance while an earlier one is disputed
- fee recipient plus buyer payouts plus seller payouts equals total funded amount across completed scenarios

### 11.3 Frontend tests

At minimum:
- role-based action rendering
- milestone status rendering
- countdown and deadline display logic
- API integration for timelines and reputation

Recommended additional tests:
- create-deal form validation
- milestone blocking explanation rendering
- dispute resolution amount validation in arbiter UI

## 12. Deployment Plan

### Phase 1

- deploy contracts to Base testnet
- wire event indexing
- build internal operator UI for test deals
- validate milestone and dispute flows manually
- run contract tests and invariant suite in CI before any testnet deployment

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

- whether `fundAllMilestones()` belongs in the first release or shortly after
- how much metadata should be hashed onchain versus stored by URI reference
- whether the initial backend should be fully custom or The Graph-backed
- whether protocol fees should be configurable at factory deployment or immutable per deployment

### Decisions already made

The following are no longer open for MVP:
- direct deployment is acceptable and preferred initially
- mutual settlement is post-MVP
- one escrow contract per deal is the chosen model
- Base is the initial deployment target
- reputation is offchain and event-derived

## 15. Recommended First Implementation Order

1. Define contract structs, enums, custom errors, and invariants.
2. Implement `MilestoneEscrow` with sequential milestone enforcement.
3. Write unit tests for every valid and invalid state transition.
4. Add invariant or property tests for fund conservation and terminal-state behavior.
5. Implement `EscrowFactory` and creation events.
6. Build the indexer and derive escrow timelines from events.
7. Build the deal overview and milestone action UI.
8. Add create-deal flow and dispute-resolution UI.
9. Run end-to-end tests against Base testnet.
