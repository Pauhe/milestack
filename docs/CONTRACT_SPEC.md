# Milestack Contract Spec

## 1. Purpose

This document defines the intended MVP contract interface and behavior for Milestack.

It is more concrete than the product and architecture docs. The goal is to make contract implementation, testing, and review straightforward by specifying:
- contract responsibilities
- enums and structs
- public functions
- events
- custom errors
- invariants
- exact behavioral rules

This is a specification document, not Solidity code. The implementation may differ in naming details, but not in semantics without updating this doc.

## 2. MVP Scope

The MVP contract layer includes:
- `EscrowFactory`
- `MilestoneEscrow`

Locked assumptions:
- Base deployment
- USDC only
- one buyer, one seller, one arbiter
- one escrow contract per deal
- sequential milestones
- public metadata references
- no mutual settlement in v1
- no platform admin override on milestone state

Additional safety constraint:
- protocol control, if any, must be strictly limited to pausing creation of new escrows and must never permit changing milestone outcomes or withdrawing escrowed funds

## 3. Roles

### 3.1 Buyer

May:
- fund milestones
- approve submitted milestones
- open disputes on submitted milestones before deadline

May not:
- submit milestones
- resolve disputes
- claim seller payout after timeout

### 3.2 Seller

May:
- submit milestones
- claim payout after review timeout

May not:
- fund milestones
- approve milestones
- resolve disputes

### 3.3 Arbiter

May:
- resolve disputed milestones

May not:
- fund milestones
- submit milestones
- approve milestones
- touch undisputed milestone funds

### 3.4 Factory / protocol

May:
- deploy escrow contracts
- set immutable protocol-level fee config for new escrows
- pause creation of new escrows in an emergency if that capability is included

May not:
- intervene in escrow state transitions after deployment
- custody user funds

## 4. Contract Set

## 4.1 `EscrowFactory`

Responsibilities:
- deploy new escrows
- validate creation inputs
- emit creation events
- expose immutable config used for new escrows

Recommended MVP implementation:
- direct deployments, not clones
- bounded admin control over the factory is acceptable only for pausing new escrow creation

Recommended factory admin scope:
- may pause and unpause `createEscrow`
- may not alter deployed escrow state
- may not move escrowed funds
- may not retroactively change fees on existing escrows

### 4.2 `MilestoneEscrow`

Responsibilities:
- hold USDC for a single deal
- enforce milestone sequencing
- enforce review windows
- enforce dispute and payout rules
- emit events for indexers and UI

## 5. Enums

### 5.1 `DealStatus`

```solidity
enum DealStatus {
    Draft,
    Active,
    Completed,
    Cancelled
}
```

### 5.2 `MilestoneStatus`

```solidity
enum MilestoneStatus {
    PendingFunding,
    Funded,
    Submitted,
    Approved,
    Claimable,
    Disputed,
    Resolved,
    PaidOut,
    Refunded,
    Cancelled
}
```

Implementation note:
- `Resolved` may be internal-only in practice if dispute resolution and transfers happen in one transaction.
- `PaidOut`, `Refunded`, and `Cancelled` are terminal in MVP.

## 6. Structs

### 6.1 `DealConfig`

```solidity
struct DealConfig {
    address buyer;
    address seller;
    address arbiter;
    address token;
    address feeRecipient;
    uint16 protocolFeeBps;
    bytes32 metadataHash;
}
```

### 6.2 `MilestoneConfig`

```solidity
struct MilestoneConfig {
    uint256 amount;
    uint32 reviewWindowSeconds;
}
```

### 6.3 `Milestone`

```solidity
struct Milestone {
    uint256 amount;
    MilestoneStatus status;
    uint32 reviewWindowSeconds;
    uint64 submittedAt;
    uint64 reviewDeadline;
    bytes32 evidenceHash;
    bytes32 disputeHash;
    uint256 buyerAward;
    uint256 sellerAward;
}
```

### 6.4 `DealRuntime`

```solidity
struct DealRuntime {
    DealStatus dealStatus;
    uint32 currentMilestoneIndex;
    uint32 activeDisputeMilestoneId;
    uint256 totalFunded;
    uint256 totalReleasedToSeller;
    uint256 totalRefundedToBuyer;
    uint256 totalFeesCollected;
}
```

Implementation note:
- `activeDisputeMilestoneId` may use a sentinel value such as `type(uint32).max` when there is no active dispute.

## 7. Constructor / Creation Inputs

### 7.1 Factory create input

The factory should accept:
- buyer address
- seller address
- arbiter address
- metadata hash
- milestone configs array

The token, fee recipient, and fee basis points should come from factory configuration for MVP.

### 7.2 Create-time validation rules

The factory must reject escrow creation if:
- buyer is zero address
- seller is zero address
- arbiter is zero address
- buyer, seller, and arbiter are not distinct
- milestone count is zero
- any milestone amount is zero
- any review window is zero
- token address is zero
- fee basis points exceed a configured maximum

Recommended additional validation:
- cap milestone count to a reasonable upper bound for MVP to reduce gas and complexity

## 8. Public Interfaces

## 8.1 `EscrowFactory`

Suggested public interface:

```solidity
interface IEscrowFactory {
    function usdc() external view returns (address);
    function feeRecipient() external view returns (address);
    function protocolFeeBps() external view returns (uint16);
    function creationPaused() external view returns (bool);

    function createEscrow(
        address buyer,
        address seller,
        address arbiter,
        bytes32 metadataHash,
        MilestoneConfig[] calldata milestones
    ) external returns (address escrow);

    function pauseCreation() external;
    function unpauseCreation() external;
}
```

Implementation note:
- if these pause functions are included, they should be protected by a narrow admin role such as `owner` or `guardian`
- this role must not have any authority over live escrow settlement logic

## 8.2 `MilestoneEscrow`

Suggested public interface:

```solidity
interface IMilestoneEscrow {
    function buyer() external view returns (address);
    function seller() external view returns (address);
    function arbiter() external view returns (address);
    function token() external view returns (address);
    function metadataHash() external view returns (bytes32);
    function feeRecipient() external view returns (address);
    function protocolFeeBps() external view returns (uint16);

    function dealStatus() external view returns (DealStatus);
    function currentMilestoneIndex() external view returns (uint256);
    function activeDisputeMilestoneId() external view returns (uint256);
    function milestoneCount() external view returns (uint256);

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory);

    function fundMilestone(uint256 milestoneId) external;
    function fundAllMilestones() external;
    function submitMilestone(uint256 milestoneId, bytes32 evidenceHash) external;
    function approveMilestone(uint256 milestoneId) external;
    function claimAfterReviewWindow(uint256 milestoneId) external;
    function openDispute(uint256 milestoneId, bytes32 disputeHash) external;
    function resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount) external;
    function cancelUnfundedMilestones() external;
}
```

## 9. Function Specifications

### 9.1 `fundMilestone(uint256 milestoneId)`

Caller:
- buyer only

Preconditions:
- `milestoneId == currentMilestoneIndex`
- milestone status is `PendingFunding`
- no active dispute exists
- buyer has approved sufficient USDC

Effects:
- transfer `amount` USDC from buyer into escrow
- set milestone to `Funded`
- increment `totalFunded`
- if deal is `Draft`, change it to `Active`

Reverts on:
- unauthorized caller
- factory creation paused
- wrong milestone id
- wrong state
- active dispute
- token transfer failure

### 9.2 `fundAllMilestones()`

Caller:
- buyer only

Purpose:
- convenience funding path only; not required for first UI release

Preconditions:
- no active dispute exists
- remaining milestones from current index onward are `PendingFunding`
- buyer has approved sufficient total USDC

Effects:
- funds all remaining pending milestones
- updates `totalFunded`
- if deal is `Draft`, change it to `Active`

Reverts on:
- unauthorized caller
- active dispute
- any remaining milestone being in an invalid state for bulk funding
- token transfer failure

### 9.3 `submitMilestone(uint256 milestoneId, bytes32 evidenceHash)`

Caller:
- seller only

Preconditions:
- `milestoneId == currentMilestoneIndex`
- milestone is `Funded`
- no active dispute exists
- `evidenceHash != bytes32(0)` if enforced

Effects:
- set `submittedAt`
- set `reviewDeadline = submittedAt + reviewWindowSeconds`
- set `evidenceHash`
- set status to `Submitted`

Reverts on:
- unauthorized caller
- wrong state
- wrong milestone id
- active dispute

### 9.4 `approveMilestone(uint256 milestoneId)`

Caller:
- buyer only

Preconditions:
- milestone is `Submitted`
- current time is before or equal to review deadline
- milestone is not disputed

Effects:
- compute protocol fee on seller-side payout
- set status through `Approved` into terminal `PaidOut`
- transfer seller payout
- transfer fee to fee recipient
- increment `totalReleasedToSeller` and `totalFeesCollected`
- advance `currentMilestoneIndex` if more milestones remain
- mark deal `Completed` if all milestones are terminal

Reverts on:
- unauthorized caller
- wrong state
- expired deadline if late approval is disallowed
- transfer failure

### 9.5 `claimAfterReviewWindow(uint256 milestoneId)`

Caller:
- seller only

Preconditions:
- milestone is `Claimable` or derivably claimable after deadline depending on implementation
- current time is strictly greater than review deadline
- no dispute was opened in time

Effects:
- compute protocol fee on seller-side payout
- transfer seller payout
- transfer fee to fee recipient
- set status to terminal `PaidOut`
- increment `totalReleasedToSeller` and `totalFeesCollected`
- advance `currentMilestoneIndex` if more milestones remain
- mark deal `Completed` if all milestones are terminal

Reverts on:
- unauthorized caller
- wrong state
- deadline not yet passed
- transfer failure

Implementation preference:
- explicit `Claimable` status is acceptable, but if it is not stored, the same condition must still be derivable consistently.

### 9.6 `openDispute(uint256 milestoneId, bytes32 disputeHash)`

Caller:
- buyer only

Preconditions:
- milestone is `Submitted`
- current time is less than or equal to review deadline
- no active dispute exists
- `disputeHash != bytes32(0)` if enforced

Effects:
- set `disputeHash`
- set milestone status to `Disputed`
- set `activeDisputeMilestoneId = milestoneId`

Reverts on:
- unauthorized caller
- wrong state
- deadline already passed
- another milestone already disputed

### 9.7 `resolveDispute(uint256 milestoneId, uint256 buyerAmount, uint256 sellerAmount)`

Caller:
- arbiter only

Preconditions:
- milestone is `Disputed`
- `activeDisputeMilestoneId == milestoneId`
- `buyerAmount + sellerAmount == milestone.amount`

Effects:
- set `buyerAward` and `sellerAward`
- compute fee only on seller-side payout amount
- transfer buyer refund if non-zero
- transfer seller payout if non-zero
- transfer fee if non-zero
- increment aggregate totals accordingly
- clear `activeDisputeMilestoneId`
- set milestone to terminal outcome:
  - `Refunded` if seller amount is zero
  - `PaidOut` if buyer amount is zero
  - implementation may use `PaidOut` or `Resolved` then `PaidOut` for split outcome, but final state must be terminal
- advance `currentMilestoneIndex` if more milestones remain
- mark deal `Completed` if all milestones are terminal

Reverts on:
- unauthorized caller
- wrong state
- invalid split
- transfer failure

### 9.8 `cancelUnfundedMilestones()`

Caller:
- buyer or seller depending on final implementation choice

Recommended MVP rule:
- either party may cancel only remaining `PendingFunding` milestones if no unresolved funded milestone remains

Preconditions:
- all targeted milestones are `PendingFunding`
- no `Funded`, `Submitted`, or `Disputed` milestone remains unresolved

Effects:
- set all remaining pending milestones to `Cancelled`
- if all milestones are now terminal, set deal to `Cancelled`

Reverts on:
- unauthorized caller
- any non-terminal funded/submitted/disputed milestone remains

## 10. View Function Expectations

Required views:
- immutable config fields
- deal status
- current milestone index
- active dispute milestone id
- milestone count
- milestone getter by id

Recommended additional views:
- `totalFunded()`
- `totalReleasedToSeller()`
- `totalRefundedToBuyer()`
- `totalFeesCollected()`

## 11. Events

### 11.1 Factory events

```solidity
event EscrowCreated(
    address indexed escrow,
    address indexed buyer,
    address indexed seller,
    address arbiter,
    address token,
    uint256 milestoneCount,
    bytes32 metadataHash
);
```

### 11.2 Escrow events

```solidity
event MilestoneFunded(uint256 indexed milestoneId, uint256 amount);
event MilestoneSubmitted(uint256 indexed milestoneId, bytes32 evidenceHash, uint64 submittedAt, uint64 reviewDeadline);
event MilestoneApproved(uint256 indexed milestoneId);
event MilestoneClaimable(uint256 indexed milestoneId);
event MilestoneClaimed(uint256 indexed milestoneId, uint256 sellerAmount, uint256 feeAmount);
event MilestoneDisputed(uint256 indexed milestoneId, bytes32 disputeHash);
event DisputeResolved(uint256 indexed milestoneId, uint256 buyerAmount, uint256 sellerAmount, uint256 feeAmount);
event MilestoneCancelled(uint256 indexed milestoneId);
event DealCompleted();
event DealCancelled();
```

Event design rules:
- emit on every meaningful user-visible transition
- include enough payload for indexers to reconstruct timelines efficiently
- do not emit misleading events for states the contract never actually enters

## 12. Custom Errors

Suggested custom errors:

```solidity
error ZeroAddress();
error InvalidPartyConfiguration();
error InvalidMilestoneCount();
error InvalidMilestoneAmount();
error InvalidReviewWindow();
error InvalidFeeBps();
error InvalidMetadataHash();
error CreationPaused();

error Unauthorized();
error InvalidDealState();
error InvalidMilestoneState();
error InvalidMilestoneIndex();
error InvalidMilestoneSequence();
error ActiveDisputeExists();
error NoActiveDispute();
error DeadlineNotReached();
error DeadlinePassed();
error InvalidEvidenceHash();
error InvalidDisputeHash();
error InvalidResolutionSplit();
error NothingToCancel();
```
```

The final implementation can rename these, but the failure modes should remain explicit and testable.

## 13. Invariants

The implementation must preserve these invariants at all times:

1. No unauthorized role can change milestone state.
2. A milestone in `Disputed` can never be claimed by timeout.
3. Terminal milestones cannot transition again.
4. `currentMilestoneIndex` can never move backward.
5. A later milestone cannot be submitted or approved while an earlier one is unresolved.
6. `reviewDeadline` is derived only from `submittedAt + reviewWindowSeconds`.
7. `buyerAward + sellerAward == milestone.amount` for any resolved dispute.
8. Total funded amount equals total seller payouts plus total buyer refunds plus total protocol fees plus any funds still locked in unresolved milestones.

## 14. Fee Rules

MVP fee policy:
- fees apply only to seller-side payout amounts
- fees do not apply to buyer refund amounts

Recommended formula:

```text
feeAmount = sellerAmount * protocolFeeBps / 10_000
sellerNet = sellerAmount - feeAmount
```

Rules:
- fee amount must never exceed seller amount
- if seller amount is zero, fee must be zero
- fee should be transferred in the same transaction as payout settlement

## 15. Token Handling Rules

1. Only the configured USDC token may be used.
2. Use `SafeERC20` for transfers.
3. State updates must happen before external transfers.
4. Any transfer failure must revert the full transaction.
5. Escrow should never depend on backend signatures or offchain custodial actions.

## 16. Timing Rules

The implementation must use one consistent interpretation:

- `dispute` allowed when `block.timestamp <= reviewDeadline`
- `claim` allowed when `block.timestamp > reviewDeadline`

This avoids overlap between dispute and claim eligibility.

Recommended product default:
- review window defaults to 5 days in UI templates

## 17. Cancellation Rules

Cancellation in MVP should be narrow.

Allowed:
- cancelling only unfunded milestones
- cancelling remaining pending milestones after all funded work is already settled

Not allowed:
- cancelling a funded milestone instead of refunding or resolving it
- cancelling a submitted milestone to bypass review rules
- cancelling a disputed milestone to bypass arbitration

## 18. Test Requirements Derived From This Spec

The contract test suite should include, at minimum:

1. escrow creation validation tests
2. factory creation pause tests
3. happy-path funding, submission, approval, payout
4. timeout path and seller claim
5. dispute path with full buyer refund
6. dispute path with full seller payout
7. dispute path with partial split
8. unauthorized caller tests for every state-changing function
9. sequencing enforcement tests
10. exact boundary tests at review deadline
11. fee accounting tests
12. invariant or property tests for fund conservation and terminal states

## 19. Non-Goals For Contract MVP

The contract layer should not attempt to solve these in v1:

1. privacy or encrypted deal metadata
2. multi-party deals
3. delegated permissions
4. milestone editing after creation
5. mutual settlement flow
6. decentralized jury systems
7. multi-token or multi-chain support

Keeping these out of the initial contracts is important for auditability and speed.
