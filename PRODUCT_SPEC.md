# Milestack Product Spec

## 1. Product Summary

Milestack is a non-custodial milestone escrow platform for digital work.

First launch is intentionally narrow and explicit: Base only, USDC only, one buyer + one seller + one arbiter per deal, sequential milestones, and public-by-default deal metadata. It lets clients and service providers structure work as milestone-based agreements funded in stablecoins, with timeout-based payouts, dispute resolution, and reputation built from real transaction history.

Milestack is designed for situations where counterparties do not fully trust each other and where payment risk, cross-border friction, and platform custody are real problems.

## 2. Vision

Milestack becomes the default contract workflow for digital service agreements that need trust-minimized payments.

The long-term vision is:
- clients can fund work without trusting the seller to deliver after prepayment
- sellers can deliver work without trusting the client to pay afterward
- platforms do not need to custody funds
- disputes follow explicit, visible rules
- users build portable trust through actual completed work and payment history

## 3. Product Thesis

The strongest crypto products are ones that materially lose value if replaced by a normal centralized database.

Milestack fits that test because:
- funds are held by contracts, not by Milestack
- payout rules are enforceable without trusting a platform
- counterparties can transact globally in stablecoins
- milestone state and release conditions are transparent
- reputation can be anchored in actual onchain settlement history

This is not "Upwork onchain." It is contract-native escrow and payout infrastructure for digital work.

## 4. Why Crypto / Trustless Value Is Necessary

Without smart contracts, this product becomes a traditional escrow service or marketplace that requires:
- a company to custody funds
- bank/payment integrations for each corridor
- trust in platform-operated payout decisions
- legal and operational overhead for small cross-border deals

Crypto provides meaningful product advantages:
- non-custodial escrow
- global stablecoin settlement
- automatic timeout-based release rules
- transparent dispute and payout state
- composable contract infrastructure for future integrations

The trustless value is not that the chain can determine creative quality. The trustless value is that money can only move according to pre-agreed rules.

## 5. Problem Statement

Digital work often suffers from two opposing trust problems:
- clients fear paying upfront and not receiving acceptable work
- service providers fear delivering work and not getting paid

This gets worse in cross-border arrangements, where:
- payment rails are slow or expensive
- legal recourse is weak
- neither side knows the other well
- platforms that do offer mediation often require full custody and extract high fees

Current alternatives are weak:
- direct invoices rely mostly on trust
- marketplaces often act as custodians and intermediaries
- legal contracts are expensive and slow to enforce
- manual escrow is operationally heavy

Milestack solves this by turning digital work agreements into milestone-based onchain escrows with explicit states and bounded dispute handling.

## 6. Initial Wedge and Target Users

### Primary wedge

Non-custodial milestone escrow for digital work, starting with crypto-native or stablecoin-comfortable users.

### Initial target users

- small digital agencies
- freelance collectives
- crypto-native service providers
- international web, product, and design agencies
- DAOs or crypto teams paying contributors

### Best first niche

Crypto-native agencies serving international clients on $2k-$25k milestone-based engagements.

Why this niche:
- they already understand wallets and stablecoins
- cross-border payment pain is real
- milestone billing already exists in their workflow
- they are more likely to accept Base + USDC launch constraints

## 7. Core User Stories

### Client

- As a client, I want to fund a milestone without losing control of funds before work is delivered.
- As a client, I want a defined review period to approve or dispute deliverables.
- As a client, I want disputes to be resolved according to pre-agreed rules rather than platform discretion.

### Seller / agency

- As a seller, I want assurance that if I deliver on time, I can get paid without chasing invoices.
- As a seller, I want the client's payment commitment secured before I begin work.
- As a seller, I want a path to payment if the client becomes unresponsive.

### Arbiter

- As an arbiter, I want a clear, bounded role limited to disputed milestones.
- As an arbiter, I want visibility into the evidence and milestone terms before resolving.

## 8. Core Workflow

### Deal setup

1. Seller creates deal draft.
2. Deal draft includes:
   - client wallet
   - seller wallet
   - arbiter wallet
   - payment token
   - milestone list
   - amount per milestone
   - review window per milestone
   - metadata URI or hash for deal terms
3. Client reviews and accepts the deal.
4. Client funds milestone 1, or optionally funds all milestones.

### MVP defaults

The MVP should make a small number of non-optional decisions so product and contract behavior stay predictable:
- chain: Base
- payment asset: USDC only
- escrow shape: one escrow contract per deal
- dispute model: named human arbiter per deal
- milestone ordering: milestones are sequential
- milestone progression: a disputed milestone pauses later milestones
- default review window: 5 days
- settlement path: mutual settlement is post-MVP, not required for first release
- arbiter sourcing: buyer and seller choose the arbiter themselves in MVP
- metadata storage: detailed terms live offchain and are referenced by hash onchain
- deal visibility: public-by-default in MVP
- funding UX: `fundMilestone()` is the core path, `fundAllMilestones()` is supported but optional

These defaults reduce implementation ambiguity and prevent the MVP from becoming a generalized marketplace before the core escrow flow is proven.

### Milestone execution

1. Milestone is funded.
2. Seller completes deliverable and submits milestone with evidence.
3. Review window starts.
4. Client may:
   - approve
   - dispute
   - do nothing
5. If approved, funds release to seller.
6. If disputed in time, milestone enters dispute flow.
7. If client is silent until deadline, seller may claim.

### Dispute resolution

1. Buyer opens dispute before deadline.
2. Milestone is frozen and cannot auto-release.
3. Arbiter reviews evidence.
4. Arbiter allocates funds:
   - full to seller
   - full to buyer
   - split between both
5. Resolution is final for that milestone.

## 9. What A Milestone Is

A milestone is a pre-agreed deliverable unit of work tied to an amount of escrowed funds.

Each milestone should have:
- amount
- description
- submission evidence field
- review window
- release rule

Good milestone examples:
- homepage and pricing page mockups delivered in Figma
- authenticated dashboard implemented and deployed to staging
- backend API endpoints completed according to scope
- final QA pass and production deployment complete

Bad milestone examples:
- make the app better
- finish website
- do branding stuff

Milestones must be specific enough for a client to review and for an arbiter to reason about in a dispute.

## 10. Milestone Lifecycle

### Milestone states

- PendingFunding
- Funded
- Submitted
- Approved
- Claimable
- Disputed
- Resolved
- PaidOut
- Refunded
- Cancelled

### Normal path

1. PendingFunding -> Funded
2. Funded -> Submitted
3. Submitted -> Approved
4. Approved -> PaidOut

### Timeout path

1. PendingFunding -> Funded
2. Funded -> Submitted
3. Submitted -> Claimable after review window expires with no dispute
4. Claimable -> PaidOut

### Dispute path

1. PendingFunding -> Funded
2. Funded -> Submitted
3. Submitted -> Disputed if buyer disputes before deadline
4. Disputed -> Resolved after settlement or arbiter decision
5. Resolved executes payout:
   - seller payout
   - buyer refund
   - split payout

### Critical transition rules

- Submitted -> Claimable only if no dispute was opened in time
- Valid dispute disables timeout claim path
- Terminal states cannot be reopened
- One formal dispute per milestone
- Future milestones are paused while a disputed milestone is unresolved
- Only the next sequential milestone may be funded or submitted in MVP
- Approval, timeout claim, and dispute resolution all immediately settle funds for that milestone

### Deal completion rule

The deal should be considered `Completed` only when every milestone is in a terminal state and there are no funds left under contract control except protocol fees awaiting withdrawal if that pattern is used.

The deal should be considered `Cancelled` only when all funded milestones have either been refunded or settled and all unfunded milestones have been explicitly cancelled.

## 11. Dispute Model

### MVP dispute design

Milestack uses optimistic normal execution with arbiter-based dispute resolution.

Normal case:
- seller submits
- buyer approves or stays silent
- contract executes the agreed payout path

Exception case:
- buyer disputes within review window
- milestone freezes
- arbiter resolves

### Why arbiter-based resolution

Subjective work quality cannot be fully decided onchain. An arbiter is the simplest practical way to resolve:
- incomplete work
- scope mismatch
- low-quality but partially delivered work
- broken deliverables

### Arbiter powers

The arbiter may only act on disputed milestones and may:
- release full amount to seller
- refund full amount to buyer
- split amount between buyer and seller

The arbiter may not:
- move unrelated milestone funds
- alter milestone definitions
- seize custody outside resolution functions

### Revision requests vs disputes

Milestack should distinguish between:
- informal revision requests
- formal disputes

Revision requests do not alter contract state. Formal disputes do.

### Dispute window rules

To avoid ambiguous timing behavior, the MVP should define these hard rules:
- the review window begins at the seller's submission timestamp
- the buyer may dispute at any point before the review deadline
- once the review deadline passes without dispute, the seller may claim
- approval before the deadline immediately releases funds and closes the milestone
- a buyer who misses the dispute window loses the right to block payout for that submission

### Default review window

The default review window for MVP should be 5 days.

Reasoning:
- long enough for normal client response cycles across time zones
- short enough that sellers are not left in limbo for too long
- simple and consistent as a default template for agency-style work

The UI may allow custom review windows per milestone within a bounded range, but 5 days should be the recommended default.

### Evidence expectations

The contract should only store compact evidence references, but the product should require each submission to include at least one evidence item reference. For MVP, accepted evidence types can be:
- URL
- IPFS CID or content hash
- Git commit or pull request link
- Figma link
- document link

The platform should also require a short plain-language submission note so the buyer and arbiter have immediate context without parsing raw hashes.

## 12. Failure Modes And Prevention

### Buyer never approves

Risk:
- buyer stalls after receiving deliverable

Prevention:
- seller submission starts fixed review window
- seller can claim after timeout if no dispute was opened

### Seller claims despite valid objection

Risk:
- contradictory payout paths

Prevention:
- dispute immediately disables auto-claim path

### Funds stuck forever

Risk:
- no valid end to dispute

Prevention:
- arbiter has explicit authority to finalize
- no design requiring both parties to confirm final resolution

### Arbiter disappears

Risk:
- milestone stuck in dispute

MVP handling:
- explicit trust assumption
- arbiter chosen upfront by both parties
- later versions may support arbiter reputation and backup mechanisms

### Vague milestones

Risk:
- unresolvable disputes

Prevention:
- milestone templates
- required description and evidence structure
- guidance on precise deliverable definitions

### Repeated malicious disputes

Risk:
- buyer uses disputes to force discounts

Prevention:
- dispute history affects buyer reputation
- arbiter may award full amount to seller where appropriate
- one formal dispute per milestone

### Seller submits junk work

Risk:
- seller tries to exploit timeout path

Prevention:
- buyer has explicit dispute window
- evidence is attached to submission
- seller reputation reflects dispute outcomes

## 13. Reputation Model

Reputation is a product layer that complements escrow. It does not replace contract rules.

### Design principle

Reputation should be built from actual deal outcomes, not vanity metrics.

### Separate reputation dimensions

Users should have separate:
- Buyer Trust
- Seller Trust
- Arbiter Trust later if arbiters become a networked role

### Core reputation signals

- number of completed paid milestones
- total settled volume
- dispute rate
- dispute win/loss ratio
- cancellation rate
- response speed
- counterparty reviews after completion

### Reputation goals

- help users decide whether to enter a deal
- reduce trust friction before funding
- support future arbiter or counterparty selection

### Reputation constraints

- should not override contract rules
- should not auto-resolve disputes
- should not be easy to game with likes or meaningless endorsements

### MVP reputation display

For the first release, reputation should favor transparent raw stats over a hidden composite score.

Recommended initial profile fields:
- completed deals count
- completed milestones count
- total settled seller volume
- total refunded buyer volume
- dispute count
- dispute outcome breakdown
- cancellation count

This is easier to trust than a black-box trust score and easier to iterate before enough data exists to justify heavier scoring logic.

## 14. MVP Scope

### In scope

- Base only
- USDC only
- wallet-to-wallet deals
- milestone-based escrows with sequential milestone progression
- seller submission with evidence hash or URI
- buyer approve or dispute
- timeout-based seller claim
- one named arbiter per deal
- split-capable dispute resolution
- basic deal and milestone timeline UI
- basic reputation from completed deals and disputes
- offchain deal metadata with onchain hash reference
- event-indexed activity and reputation backend
- public deal pages and public reputation pages in MVP

### Out of scope

- fiat on and off ramps
- platform custody
- multi-chain support
- marketplace discovery
- bidding system
- token incentives
- subscriptions or retainers
- financing against receivables
- fully decentralized court systems
- complex oracle-based deliverable verification
- gas sponsorship for MVP
- platform-supplied arbitration network
- milestone mutual settlement flow
- onchain storage of full deal text and attachments
- private deals or role-gated metadata visibility

### Explicit MVP constraints

The MVP should intentionally avoid these tempting expansions:
- no role abstraction beyond buyer, seller, and arbiter
- no partial milestone funding
- no milestone edits after buyer acceptance
- no support for multiple sellers or multiple buyers in one deal
- no milestone dependency graphs beyond simple ordering

These are valid future features, but they should not shape the first contract design.

## 15. Why This Is Better Than A Generic Prediction Market

Milestack is stronger than a generic decentralized prediction market for startup formation because:
- it does not require liquidity network effects
- it solves a direct business pain
- the trustless need is still strong
- the market is less dominated by entrenched incumbents
- the product is easier to explain to paying users

## 16. Smart Contract Architecture

### Contract set

- EscrowFactory
- MilestoneEscrow

### Architectural decisions locked for MVP

- one escrow contract per deal
- direct contract deployments are acceptable for MVP; clone optimization is optional later
- immutable buyer, seller, arbiter, token, fee recipient, and fee basis points at escrow creation time
- milestone count and milestone amounts are fixed at creation time
- only unfunded milestones may be cancelled

### EscrowFactory responsibilities

- deploy new MilestoneEscrow contracts
- emit registry events
- support indexing and analytics

### MilestoneEscrow responsibilities

- store deal participants
- store token and milestone configuration
- manage milestone state transitions
- hold escrowed funds
- execute payouts and refunds
- enforce review windows and dispute logic

### Core stored data

- client address
- seller address
- arbiter address
- token address
- deal metadata URI or hash
- milestone array

Each milestone stores:
- amount
- status
- review window seconds
- submission timestamp
- review deadline
- evidence URI or hash
- dispute reason URI or hash
- payout allocation after resolution if disputed

### Core functions

- fundMilestone(uint256 milestoneId)
- fundAllMilestones()
- submitMilestone(uint256 milestoneId, bytes32 proofHash or string URI reference)
- approveMilestone(uint256 milestoneId)
- claimAfterReviewWindow(uint256 milestoneId)
- openDispute(uint256 milestoneId, bytes32 disputeReasonHash or URI reference)
- resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)
- cancelUnfundedMilestones()

### Acceptance criteria for contract MVP

The initial contract implementation should be considered complete only if it satisfies all of the following:
- a funded milestone cannot be skipped in favor of a later milestone
- a valid dispute blocks timeout claim on the same milestone
- approval, claim, and resolution each leave the milestone in a terminal state
- only the intended role can call each state-changing function
- fee handling is deterministic and auditable
- all terminal payout paths preserve fund conservation

### Design principles

- smallest correct state machine
- explicit terminal states
- no contradictory transitions
- no admin custody
- no hidden platform override powers

## 17. UX And Screens

### Primary screens

- Create Deal
- Deal Overview
- Milestone Detail
- Dispute Resolution View
- Reputation Profile

### Key UX requirements

- clear current state of each milestone
- visible next actions for each role
- countdown for review windows
- plain-English event history
- clear display of locked, claimable, and released funds
- clear explanation that disputes pause ordinary payout flow
- strong explanation that arbitration is human and pre-selected, not algorithmic
- visible warning when a dispute on an early milestone blocks later milestones

### UX philosophy

Milestack should feel like a contract workflow product, not a casino, marketplace, or generic crypto dashboard.

## 18. Chain And Asset Choice

### Initial chain

Base

Reasoning:
- Ethereum-aligned
- lower fees than mainnet
- stablecoin usage is strong
- wallet support is broad

### Initial asset

USDC only

Reasoning:
- simplest accounting
- lowest user confusion
- avoids volatility risk
- easier to message than multi-token support

## 19. Business Model

### Initial business model

Protocol fee on successful payout release.

Possible starting point:
- 0.5% to 1.0% fee on released milestone funds

Alternative later models:
- SaaS tier for agencies
- white-labeled contract workflows
- premium arbitration tooling
- integrated invoicing and reporting

### Why this model works

- aligned with successful deal completion
- simple for users to understand
- avoids platform custody

### Fee policy recommendation

The MVP should apply protocol fees only to seller-side payout amounts and should not charge protocol fees on buyer refunds.

This keeps incentives cleaner in disputes and makes fee behavior easier to explain.

## 20. Main Risks

### Product risks

- dispute resolution still depends on human judgment
- stablecoin and wallet onboarding remain friction points
- some users may prefer simple invoices where trust is already high

### Market risks

- agencies may not want onchain workflows unless pain is strong enough
- users may compare against full marketplaces with discovery and built-in clients
- legal and compliance questions may emerge if arbitration becomes too platform-operated

### Technical risks

- state machine bugs could create stuck funds or invalid transitions
- poor dispute-state design could enable griefing
- token handling and payout accounting must be exact

## 21. Key Assumptions

- initial users are already comfortable with wallets and stablecoins
- the strongest pain point is payment trust, not freelancer discovery
- milestone-based digital work is a better wedge than physical goods
- bounded dispute trust is acceptable if normal custody and payout are trustless
- reputation built from actual usage will improve trust conversion

## 22. Open Questions

- Should the UI expose `fundAllMilestones()` in the first release or keep it backend/contract-ready for shortly after launch?
- Should seller submissions support multiple evidence references per milestone from day one, or just one canonical reference plus note?
- How much metadata should live onchain versus by URI or hash reference?
- Which first vertical is strongest: agencies, crypto contributor payments, or creator sponsorships?

### Decisions already made

These questions are no longer open for MVP:
- future milestones are paused while an earlier one is disputed
- mutual settlement is post-MVP
- arbiters are user-selected, not platform-assigned
- the contract model is one escrow per deal
- reputation is displayed primarily as raw stats in MVP
- the default review window is 5 days
- deal visibility is public-by-default

## 23. Operability Evidence Boundary (First-Reader Contract)

For launch/no-launch operability claims in this repository, treat rehearsal-local gates and artifacts as the executable source of truth:
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

Canary abort wording must remain fail-closed: if thresholds are breached, verdict is no-launch.
Rollback wording must remain precise: rollback is offchain-only (backend/web/indexer/config), not contract-state rollback.

## 24. Canonical Launch-vs-Post-Launch Roadmap

This section is intentionally aligned to the canonical recovery artifacts:
- `.gsd/milestones/M001/slices/S02/canonical-launch-boundary.md`
- `.gsd/milestones/M001/slices/S04/recovery-program.md`

### Launch-critical sequence (M002–M006)

First launch requires this dependency spine:
1. `M002` — contract correctness and security proof
2. `M003` — read model, indexer, and API reliability
3. `M004` — user-facing workflow clarity and product feel
4. `M005` — full-system integration and staging-like rehearsal
5. `M006` — launch operability and documentation truth

### Post-launch widening (M007)

`M007` is intentionally post-launch and captures widening tracks that are explicitly deferred from first launch, including:
- multi-chain expansion
- private metadata/deals
- delegated permissions
- multi-party deal topology
- discovery/marketplace surfaces
- richer reputation and workflow tooling

This split preserves the first-launch boundary while keeping expansion work explicit and near-term.
