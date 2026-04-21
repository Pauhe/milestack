## Contracts Workspace

This workspace uses [Foundry](https://book.getfoundry.sh/) and keeps Solidity dependencies under `contracts/lib`.

## Toolchain setup (from repo root)

Install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
~/.foundry/bin/foundryup
```

Confirm the runner is discoverable on your default `PATH`:

```bash
forge --version
```

If your shell has not loaded Foundry yet, use a one-off fallback:

```bash
PATH="$HOME/.foundry/bin:$PATH" forge --version
```

## Dependencies

Current dependencies:
- `forge-std`
- `@openzeppelin/contracts`

Canonical import style:

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
```

## Lifecycle proof commands (S01)

Run these from repository root to reproduce the lifecycle verification surface:

```bash
forge test --root contracts
forge test --root contracts --match-contract MilestoneEscrowSubmissionTest
forge test --root contracts --match-contract MilestoneEscrowFuzzTest
forge test --root contracts --match-contract MilestoneEscrowInvariantTest
```

### What each suite proves

- `forge test --root contracts`
  - Full contracts sweep (unit + fuzz + invariant) and the fastest regression localization starting point.
- `--match-contract MilestoneEscrowSubmissionTest`
  - Lifecycle behavior and negative paths: role gating, sequence rules, deadline edges, dispute open/resolve, cancellation gating, transfer-failure reverts, and terminal status transitions.
  - Deterministic adversarial regressions for hardening edges found during fuzz/invariant work: dispute-pointer clearing after resolution (unblocking next-milestone progression) and post-settlement cancellation locking later milestone actions.
- `--match-contract MilestoneEscrowFuzzTest`
  - Accounting and terminal-state properties under bounded randomized inputs for approve/claim/dispute-resolution flows.
  - Two-milestone adversarial sequencing with conservation checks (`escrow balance + released + refunded + fees == totalFunded`) plus post-resolution cancellation/terminal-state enforcement.
- `--match-contract MilestoneEscrowInvariantTest`
  - Global safety properties under adversarial call sequencing: fund conservation, active-dispute/state alignment, and monotonic milestone index progression.
  - Completed/cancelled terminal boundary checks and active-dispute pointer exclusivity/clearing invariants.

### Runtime diagnostics and semantic boundary notes

Primary runtime inspection surfaces are emitted events and custom errors. In particular, lifecycle diagnostics center on `MilestoneSubmitted`, `MilestoneApproved`, `MilestoneClaimed`, `MilestoneDisputed`, `DisputeResolved`, `MilestoneCancelled`, and `DealCompleted`, plus revert selectors in failing tests.

`MilestoneStatus.Approved`, `MilestoneStatus.Claimable`, `MilestoneStatus.Resolved`, and the `MilestoneClaimable` event are currently conceptual labels, not durable end states for launch-scope settlement. Settlement outcomes land in `PaidOut` or `Refunded`, and submission tests explicitly assert that timeout claim flow does not emit `MilestoneClaimable`.

## Deployment

Deploy the factory with Foundry:

```bash
forge script contracts/script/DeployEscrowFactory.s.sol:DeployEscrowFactory --private-key "$PRIVATE_KEY" --broadcast
```

Use the repository wrapper to deploy and write a manifest automatically:

```bash
USDC_ADDRESS=0x... \
FEE_RECIPIENT=0x... \
PROTOCOL_FEE_BPS=100 \
PRIVATE_KEY=0x... \
./scripts/deploy-factory-and-write-manifest.sh
```
