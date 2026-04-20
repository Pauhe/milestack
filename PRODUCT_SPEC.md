# Milestack Product Spec

## 1. Product Summary

Milestack is a non-custodial milestone escrow platform for digital work on Ethereum L2s. It lets clients and service providers structure work as milestone-based agreements funded in stablecoins, with timeout-based payouts, dispute resolution, and reputation built from real transaction history.

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
- they are more likely to accept Ethereum L2 UX

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
3. Arbiter reviews evidence or parties settle mutually.
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
- mutual settlement may also resolve
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

## 14. MVP Scope

### In scope

- one Ethereum L2
- USDC only
- wallet-to-wallet deals
- milestone-based escrows
- seller submission with evidence hash or URI
- buyer approve or dispute
- timeout-based seller claim
- one named arbiter per deal
- split-capable dispute resolution
- basic deal and milestone timeline UI
- basic reputation from completed deals and disputes

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
- submission timestamp
- review deadline
- evidence URI or hash
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

### UX philosophy

Milestack should feel like a contract workflow product, not a casino, marketplace, or generic crypto dashboard.

## 18. Chain And Asset Choice

### Initial chain

Base or Arbitrum

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

- Should future milestones be fundable while an earlier one is disputed?
- Should mutual settlement be included in MVP or shortly after?
- Should Milestack itself provide arbiters, or should arbiters be purely user-selected?
- Should there be one escrow contract per deal or per milestone?
- How much metadata should live onchain versus by URI or hash reference?
- How should reputation be displayed: raw stats, score, or both?
- Which first vertical is strongest: agencies, crypto contributor payments, or creator sponsorships?

## 23. Suggested Roadmap

### Phase 1: product definition

- finalize milestone lifecycle
- finalize dispute policy
- define deal and milestone data model
- define first-user segment precisely

### Phase 2: contract MVP

- implement factory and escrow contracts
- implement core milestone transitions
- add comprehensive tests for edge cases
- verify dispute and timeout logic

### Phase 3: frontend MVP

- wallet connect
- create deal flow
- fund and submit flow
- approve or dispute flow
- timeline and reputation views

### Phase 4: launch wedge

- onboard a narrow first user segment
- gather dispute and review behavior data
- refine milestone templates and reputation display

### Phase 5: expansion

- mutual settlement tooling
- arbiter reputation
- vertical templates for agency, dev, design, sponsorship, and DAO contributor deals
- white-label or API workflows
