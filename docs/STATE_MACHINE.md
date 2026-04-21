# Milestack State Machine

## 1. Purpose

This document defines the explicit state machine for Milestack's MVP. It is intended to remove ambiguity before contract implementation and testing.

The MVP assumptions in this document are:
- one escrow contract per deal
- Base only
- USDC only
- sequential milestones only
- one buyer, one seller, one arbiter
- a disputed milestone pauses later milestones
- no mutual settlement flow in v1
- `fundMilestone()` is the primary funding path
- `fundAllMilestones()` is supported but non-essential for first UI release

## 2. Actors

- `Buyer`: funds milestones, approves milestones, opens disputes
- `Seller`: submits milestones, claims after review timeout
- `Arbiter`: resolves disputed milestones
- `Factory`: deploys escrows only
- `Indexer/UI`: read-only observers, never a privileged actor

## 3. Deal States

- `Draft`
- `Active`
- `Completed`
- `Cancelled`

### 3.1 Deal state meaning

`Draft`
- escrow exists but no milestone has been funded yet

`Active`
- at least one milestone has been funded and the deal is still in progress

`Completed`
- every milestone is in a terminal state and the deal finished normally

`Cancelled`
- no more work can proceed and all funded milestones have already been refunded or settled

## 4. Milestone States

Durable launch-runtime milestone states (user-observable via storage/events/read models):
- `PendingFunding`
- `Funded`
- `Submitted`
- `Disputed`
- `PaidOut`
- `Refunded`
- `Cancelled`

Conceptual or internal-only labels (not guaranteed durable runtime resting states in launch behavior):
- `Approved` (transient execution step before payout finalization)
- `Claimable` (derivable timeout-eligibility concept)
- `Resolved` (conceptual dispute-phase label when outcomes are finalized as payout/refund)

### 4.1 Terminal milestone states

These states are terminal for MVP and must not transition again:
- `PaidOut`
- `Refunded`
- `Cancelled`

`Resolved` is conceptual/internal-only unless implementation intentionally stores it as a durable pre-terminal state. In launch-runtime semantics, dispute outcomes are user-observable as `PaidOut` and/or `Refunded` settlement results.

## 5. Core Invariants

1. Only the current sequential milestone may move through active execution states.
2. A milestone in `Disputed` blocks later milestones from being funded, submitted, or approved.
3. A milestone cannot be both disputable and claimable at the same time.
4. Terminal milestones cannot be reopened.
5. The total amount distributed to buyer, seller, and fee recipient must equal the total funded amount.
6. Only the designated actor for each action may trigger that transition.
7. The review deadline is derived from `submittedAt + reviewWindowSeconds`.

## 6. Deal-Level Transition Table

| Current State | Trigger | Caller | Preconditions | Next State | Notes |
|---|---|---|---|---|---|
| `Draft` | first milestone funded | Buyer | milestone 0 is `PendingFunding` | `Active` | buyer acceptance is represented by funding |
| `Active` | last unresolved milestone reaches terminal state and no work remains | contract-internal | all milestones terminal | `Completed` | normal successful completion |
| `Draft` | cancel unfunded deal | Buyer or Seller if allowed by implementation | all milestones unfunded | `Cancelled` | optional convenience path |
| `Active` | cancel remaining unfunded milestones after funded work is fully settled | Buyer or Seller if allowed by implementation | no unresolved funded milestones | `Cancelled` | only if project ends early |

## 7. Milestone Transition Table

| Current State | Trigger | Caller | Preconditions | Next State | Settlement |
|---|---|---|---|---|---|
| `PendingFunding` | `fundMilestone` | Buyer | milestone is current sequential milestone and no active dispute | `Funded` | none |
| `PendingFunding` | `fundAllMilestones` | Buyer | allowed by implementation, no active dispute | `Funded` for each affected milestone | none |
| `Funded` | `submitMilestone` | Seller | milestone is current actionable milestone | `Submitted` | none |
| `Submitted` | `approveMilestone` | Buyer | before deadline, no active dispute | `Approved` then `PaidOut` | seller paid immediately |
| `Submitted` | time passes beyond review deadline | none | no dispute opened | derivably timeout-eligible (`Claimable` conceptual) | none |
| `Submitted` (timeout-eligible) | `claimAfterReviewWindow` | Seller | review deadline passed, no dispute | `PaidOut` | seller paid immediately |
| `Submitted` | `openDispute` | Buyer | before deadline | `Disputed` | none |
| `Disputed` | `resolveDispute` | Arbiter | allocation valid | `Resolved` then `PaidOut` or `Refunded` | buyer, seller, or split payout |
| `PendingFunding` | `cancelUnfundedMilestones` | allowed actor | milestone not funded | `Cancelled` | none |

## 8. Function-by-Function Rules

### 8.1 `fundMilestone(uint256 milestoneId)`

Caller:
- Buyer only

Allowed from:
- milestone `PendingFunding`

Preconditions:
- `milestoneId` is the current sequential milestone
- no active disputed milestone exists
- buyer has sufficient USDC allowance and balance

Effects:
- transfers milestone amount into escrow
- marks milestone `Funded`
- if this is the first funded milestone, marks deal `Active`

Reverts if:
- caller is not buyer
- milestone is not `PendingFunding`
- milestone is out of sequence
- active dispute exists
- token transfer fails

### 8.2 `fundAllMilestones()`

Caller:
- Buyer only

Allowed from:
- `Draft` or `Active`, depending on how many milestones remain unfunded

Preconditions:
- no active disputed milestone exists
- all earlier milestones obey sequencing rules
- buyer has sufficient USDC allowance and balance for remaining amount

Effects:
- funds all remaining `PendingFunding` milestones
- marks first unfunded milestone onward as `Funded`

Reverts if:
- caller is not buyer
- active dispute exists
- transfer fails

### 8.3 `submitMilestone(uint256 milestoneId, bytes32 evidenceHash)`

Caller:
- Seller only

Allowed from:
- `Funded`

Preconditions:
- `milestoneId` is current actionable milestone
- no active disputed milestone exists
- `evidenceHash` is non-zero if the contract enforces this

Effects:
- stores evidence hash
- stores `submittedAt`
- computes and stores `reviewDeadline`
- marks milestone `Submitted`

Reverts if:
- caller is not seller
- milestone is not `Funded`
- milestone is out of sequence
- active dispute exists

### 8.4 `approveMilestone(uint256 milestoneId)`

Caller:
- Buyer only

Allowed from:
- `Submitted`

Preconditions:
- current time is before or equal to review deadline
- no dispute was opened for the milestone

Effects:
- marks milestone approved
- transfers seller payout minus protocol fee
- transfers protocol fee if configured
- finalizes milestone as `PaidOut`

Reverts if:
- caller is not buyer
- milestone is not `Submitted`
- review window has already expired if implementation disallows late approval
- active dispute exists for that milestone

### 8.5 `claimAfterReviewWindow(uint256 milestoneId)`

Caller:
- Seller only

Allowed from:
- timeout-eligible `Submitted` milestone (eligibility is derivable from deadline)

Preconditions:
- milestone is `Submitted`
- current time is greater than review deadline
- no dispute was opened in time

Effects:
- transfers seller payout minus protocol fee
- transfers protocol fee if configured
- finalizes milestone as `PaidOut`

Reverts if:
- caller is not seller
- milestone is not `Submitted` (or otherwise not timeout-eligible in an implementation that stores explicit claimability)
- deadline not yet passed
- active dispute exists

### 8.6 `openDispute(uint256 milestoneId, bytes32 disputeHash)`

Caller:
- Buyer only

Allowed from:
- `Submitted`

Preconditions:
- current time is before review deadline
- milestone is not already disputed

Effects:
- stores dispute hash
- marks milestone `Disputed`
- marks deal as blocked by this dispute for sequencing purposes

Reverts if:
- caller is not buyer
- milestone is not `Submitted`
- deadline has passed
- milestone already in terminal state

### 8.7 `resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)`

Caller:
- Arbiter only

Allowed from:
- `Disputed`

Preconditions:
- `buyerAmount + sellerAmount == milestone amount`
- fee behavior follows defined policy

Effects:
- allocates milestone value between buyer and seller
- transfers refund and payout
- transfers protocol fee only if fee policy applies to seller-side payout
- clears active dispute flag
- finalizes milestone as `PaidOut`, `Refunded`, or terminal resolved-with-split depending on implementation naming

Reverts if:
- caller is not arbiter
- milestone is not `Disputed`
- allocation sum is invalid
- transfer fails

### 8.8 `cancelUnfundedMilestones()`

Caller:
- buyer or seller depending on final implementation choice

Allowed from:
- any deal state where only unfunded milestones remain to be cancelled

Preconditions:
- targeted milestones are `PendingFunding`
- no unresolved funded milestone would be abandoned by this action

Effects:
- marks matching milestones `Cancelled`
- may mark deal `Cancelled` if all milestones are now terminal

Reverts if:
- trying to cancel a funded or submitted milestone
- unresolved funded milestones still exist and implementation forbids cancellation in that case

## 9. Invalid Transition Summary

These transitions must never be possible:

- `PendingFunding -> Submitted`
- `Funded -> Approved`
- `Funded -> Disputed`
- `Submitted -> PaidOut` without approval, timeout claim, or dispute resolution
- `Disputed -> Claimable`
- `PaidOut -> Disputed`
- `Refunded -> Submitted`
- `Cancelled -> Funded`

## 10. Sequencing Rules

The MVP uses sequential milestone execution.

Rules:
1. Only the first non-terminal milestone may be actioned.
2. Later milestones may be pre-funded only if `fundAllMilestones()` is supported, but they still cannot be submitted or approved out of order.
3. If milestone `N` is disputed, no action on `N+1` or later may proceed until `N` is resolved.

This keeps dispute effects understandable and greatly reduces edge cases.

## 11. Timeout Semantics

The system must define one precise timing rule and use it everywhere:

- a milestone becomes disputable immediately on submission
- the review deadline is deterministic
- once the deadline passes without dispute, claim becomes available
- a dispute opened before the deadline always defeats the timeout claim path

Recommended implementation rule:
- `block.timestamp > reviewDeadline` is required for claim
- `block.timestamp <= reviewDeadline` is allowed for dispute

Recommended product default:
- review windows default to 5 days unless overridden at deal creation

This prevents overlap between claim and dispute eligibility.

## 12. Event Mapping

Suggested event mapping from transitions:

| Transition | Event |
|---|---|
| first funding | `MilestoneFunded` and optionally deal state change reflected in indexer |
| submission | `MilestoneSubmitted` |
| approval | `MilestoneApproved` |
| timeout eligibility | optional `MilestoneClaimable`, or derived offchain/internal-only in launch-runtime semantics |
| timeout claim | `MilestoneClaimed` |
| dispute opened | `MilestoneDisputed` |
| dispute resolved | `DisputeResolved` |
| milestone cancelled | `MilestoneCancelled` |
| deal fully finished | `DealCompleted` |

## 13. Testing Checklist Derived From State Machine

At minimum, tests should cover:

1. every valid transition path
2. every invalid transition listed above
3. unauthorized callers for each function
4. exact boundary behavior at review deadlines
5. dispute blocking later milestones
6. deal completion and cancellation logic
7. exact payout accounting across approval, claim, refund, and split resolution
