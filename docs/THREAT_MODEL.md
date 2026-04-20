# Milestack Threat Model

## 1. Purpose

This document identifies realistic threats to the Milestack MVP across:
- smart contract settlement logic
- product abuse and user behavior
- backend and metadata handling
- frontend and UX failure modes

The purpose is not to eliminate all risk. It is to make the highest-value risks explicit so the MVP can be designed, tested, and communicated honestly.

## 2. Security Goals

Milestack should guarantee, within the scope of the MVP:

1. funds only move according to explicit contract rules
2. buyer objections in time can block silent payout paths
3. sellers cannot bypass milestone state transitions
4. arbiters only control disputed milestone allocation
5. backend and frontend failures cannot silently rewrite settlement truth

Milestack does not guarantee:

1. objective determination of creative quality
2. perfect identity truth about counterparties
3. that a chosen arbiter will act quickly or fairly in every case
4. legal enforceability outside the smart contract itself

## 3. Trust Boundaries

### 3.1 Onchain trust boundary

Trusted for:
- custody of escrowed funds
- enforcement of allowed state transitions
- payout accounting and settlement finality

Not trusted for:
- the truth of offchain work quality
- the meaning of ambiguous metadata

### 3.2 Arbiter trust boundary

Trusted for:
- deciding disputed milestone allocation when invoked

Not trusted for:
- changing deal terms
- moving undisputed milestone funds
- acting outside dispute resolution functions

### 3.3 Backend trust boundary

Trusted for:
- indexing convenience
- derived reputation metrics
- serving metadata and timelines

Not trusted for:
- custody
- settlement authority
- privileged transaction signing

### 3.4 Frontend trust boundary

Trusted for:
- clear explanation of current state and available actions

Not trusted for:
- defining settlement truth
- hiding or rewriting onchain outcomes

## 4. Contract Threats

### 4.1 Invalid state transition bug

Threat:
- a bug allows a milestone to skip required states or transition after becoming terminal

Impact:
- incorrect payout, stuck funds, or contradictory milestone state

Mitigation:
- minimal explicit state machine
- transition guard tests
- invariant tests for terminal states and sequencing

### 4.2 Timeout/dispute overlap bug

Threat:
- a milestone becomes both disputable and claimable at the same time because of inconsistent deadline checks

Impact:
- race conditions and unpredictable settlement outcome

Mitigation:
- define exact timing semantics once
- require `block.timestamp <= reviewDeadline` for dispute
- require `block.timestamp > reviewDeadline` for claim
- test boundary timestamps explicitly

### 4.3 Incorrect split accounting

Threat:
- arbiter resolution amounts do not sum correctly or fee logic double-charges the seller

Impact:
- excess payout, underpayment, or stranded funds

Mitigation:
- enforce exact sum checks
- keep fee policy narrow and deterministic
- test full seller payout, full refund, and partial split cases

### 4.4 Reentrancy during payout

Threat:
- payout path is vulnerable to reentrancy around external token transfers

Impact:
- repeated claims or inconsistent state updates

Mitigation:
- checks-effects-interactions ordering
- `SafeERC20`
- reentrancy guard on payout functions if needed

### 4.5 Unauthorized caller actions

Threat:
- wrong role can approve, dispute, resolve, or claim

Impact:
- broken custody and settlement guarantees

Mitigation:
- explicit role checks on every state-changing function
- unit tests for all unauthorized caller scenarios

### 4.6 Cancellation misuse

Threat:
- a funded or submitted milestone is cancelled improperly

Impact:
- funds become stranded or obligations vanish incorrectly

Mitigation:
- allow cancellation only for unfunded milestones in MVP
- make cancellation paths narrow and terminal

## 5. Product Abuse Threats

### 5.1 Buyer griefing by silence

Threat:
- buyer receives work and simply never approves

Impact:
- seller payment delay or loss if timeout path fails

Mitigation:
- seller claim after review timeout
- clear UI explaining the countdown and consequence of silence

### 5.2 Buyer abuse through malicious disputes

Threat:
- buyer disputes weakly or dishonestly to force a discount

Impact:
- seller pain, arbitration overhead, confidence loss

Mitigation:
- dispute outcomes feed buyer reputation
- arbiter can award full payout to seller
- formal disputes are visible and countable

### 5.3 Seller abuse through low-quality submissions

Threat:
- seller submits minimal or junk evidence and hopes the buyer misses the deadline

Impact:
- buyer may lose funds unfairly

Mitigation:
- required evidence reference and submission note
- reasonable review window defaults
- dispute mechanism and seller reputation impact

### 5.4 Arbiter capture or non-performance

Threat:
- arbiter is biased, colluding, or simply disappears

Impact:
- unfair resolution or prolonged dispute freeze

Mitigation:
- make arbiter a bounded trust role, not a hidden platform operator
- require parties to choose arbiter up front
- communicate this trust point clearly
- add arbiter reputation later

This remains a real residual risk for MVP.

### 5.5 Reputation gaming

Threat:
- users try to manufacture fake credibility through self-dealing or low-value wash activity

Impact:
- lower trust in profile signals

Mitigation:
- emphasize raw stats and volume, not only counts
- keep reputation informational, not authoritative
- eventually add suspicious-pattern detection if needed

## 6. Metadata And Backend Threats

### 6.1 Metadata tampering or mismatch

Threat:
- frontend or backend presents metadata that does not match the canonical hash

Impact:
- parties review incorrect terms or evidence context

Mitigation:
- hash validation in frontend/backend
- visibly mark unverified metadata
- treat onchain hash as canonical reference

### 6.1.1 Privacy expectation mismatch

Threat:
- users assume deal metadata is private when the MVP actually exposes public deal pages and publicly retrievable metadata

Impact:
- accidental disclosure of sensitive project terms, URLs, or attachments

Mitigation:
- make public-by-default visibility explicit in product copy
- warn users not to include confidential material in MVP deal metadata
- delay private-deal positioning until encryption and access control exist

### 6.2 Indexer lag or missed events

Threat:
- backend shows stale milestone states or incomplete timelines

Impact:
- user confusion and mistaken expectations

Mitigation:
- idempotent event processing
- reorg-safe indexing
- fallback to direct onchain reads for critical page data where needed
- surface indexing freshness in operator tooling

### 6.3 Reputation miscalculation

Threat:
- derived stats are calculated incorrectly from event history

Impact:
- inaccurate trust signals

Mitigation:
- compute reputation from reproducible source events
- include raw fields in API responses
- avoid over-compressed scores in MVP

## 7. Frontend And UX Threats

### 7.1 User misunderstands timeout rules

Threat:
- buyer does not realize silence will allow seller claim

Impact:
- surprise payout and user distrust

Mitigation:
- explicit countdown copy
- warning banners on submitted milestones
- confirmation UI when submitting work or entering review window

### 7.2 User misunderstands arbiter role

Threat:
- users believe Milestack itself is determining disputes automatically

Impact:
- misplaced trust and support burden

Mitigation:
- clearly state that arbiters are pre-selected humans in MVP
- show arbiter identity prominently on deal pages

### 7.3 Hidden blocked progression

Threat:
- users do not understand why later milestones cannot proceed

Impact:
- confusion and mistaken bug reports

Mitigation:
- explicit “blocked by dispute on milestone N” messaging
- show currently actionable milestone clearly

## 8. Residual Risks Accepted In MVP

These risks are accepted rather than fully solved:

1. subjective work quality still depends on human judgment
2. chosen arbiter may be poor quality or inactive
3. stablecoin and wallet onboarding remain user friction
4. reputation is useful but not tamper-proof in early stages
5. backend/API issues may temporarily degrade UX even if settlement remains safe

## 9. Threat Prioritization

### High priority

- invalid state transition bugs
- deadline logic bugs
- unauthorized caller bugs
- incorrect payout accounting
- metadata mismatch around disputed submissions

### Medium priority

- malicious disputes
- seller low-effort submission abuse
- arbiter non-performance
- indexer lag and stale data

### Low priority for MVP

- sophisticated reputation gaming
- advanced phishing resistance beyond normal wallet hygiene
- marketplace-level spam issues, since marketplace discovery is out of scope

## 10. Recommended Mitigation Work Before Launch

1. complete transition and invariant test suite
2. explicit deadline boundary tests
3. fund conservation tests across every payout path
4. metadata hash verification in the frontend
5. UI copy review for timeout and dispute comprehension
6. closed alpha with real counterparties before open launch
