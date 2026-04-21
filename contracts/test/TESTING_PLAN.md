# Contract Testing Plan

This workspace does not yet include executable Foundry tests because the current environment does not have `forge` installed.

The first contract test implementation should cover:

1. `EscrowFactory` create validation
2. factory creation pause behavior
3. escrow constructor initialization
4. milestone getter correctness
5. role and state transition tests as `MilestoneEscrow` behavior is implemented

Recommended first test files:

- `EscrowFactory.t.sol`
- `MilestoneEscrow.Initialization.t.sol`
- `MilestoneEscrow.HappyPath.t.sol`
- `MilestoneEscrow.Disputes.t.sol`
- `MilestoneEscrow.Invariants.t.sol`
