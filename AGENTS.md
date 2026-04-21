# Milestack Agent Notes

## Purpose

This file gives a fresh OpenCode instance the minimum project context needed to continue work without re-deriving the plan from scratch.

## Project Summary

Milestack is a non-custodial milestone escrow product for digital work on Base using USDC.

Core MVP properties:
- one escrow contract per deal
- one buyer, one seller, one arbiter
- sequential milestones
- buyer funds milestones
- seller submits evidence
- buyer approves or disputes within review window
- seller can claim after timeout if buyer is silent
- disputes are resolved by a named arbiter

## Source Of Truth Docs

Read these first, in this order:

1. `README.md`
2. `docs/CONTRACT_SPEC.md`
3. `docs/STATE_MACHINE.md`
4. `docs/TECHNICAL_ARCHITECTURE.md`
5. `docs/TESTING_AND_DEPLOYMENT_STRATEGY.md`

Use these as supporting references:

1. `PRODUCT_SPEC.md`
2. `docs/DATA_MODEL.md`
3. `docs/USER_FLOWS.md`
4. `docs/THREAT_MODEL.md`
5. `docs/RUNBOOKS.md`
6. `docs/DEPLOYMENT_MANIFEST_SPEC.md`
7. `docs/SECURITY_REVIEW_CHECKLIST.md`

## Current Implementation Status

Implemented in `contracts/`:
- Foundry workspace scaffolded
- shared types in `src/MilestackTypes.sol`
- shared errors in `src/MilestackErrors.sol`
- shared events in `src/MilestackEvents.sol`
- `EscrowFactory` with:
  - immutable token and fee config
  - validation of parties and milestone configs
  - creation pause support
  - escrow deployment
- `MilestoneEscrow` with:
  - deal config storage
  - milestone initialization
  - getters
  - `fundMilestone`
  - `fundAllMilestones`

Implemented tests:
- `test/EscrowFactory.t.sol`
- `test/MilestoneEscrow.Funding.t.sol`

Current passing state:
- Foundry installed locally
- `forge test` passes in `contracts/`

## Immediate Next Work

Implement the next behavior slice in this order:

1. `submitMilestone`
2. `approveMilestone`
3. tests for submission and approval
4. `claimAfterReviewWindow`
5. tests for timeout path
6. `openDispute`
7. `resolveDispute`
8. dispute tests
9. cancellation logic
10. invariant and fuzz tests

## Constraints To Preserve

Do not expand MVP scope while implementing.

Keep these fixed unless explicitly changed in docs:
- Base only
- USDC only
- public metadata
- no mutual settlement in v1
- no multi-party deals
- no delegated permissions
- no marketplace/discovery work

## Safety Notes

This project may later hold real money. Prefer:
- smallest correct change
- explicit guards and custom errors
- tests before broadening behavior
- no hidden admin controls over live escrow outcomes

If a design decision seems ambiguous, update the docs before implementing behavior that contradicts them.
