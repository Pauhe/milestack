# Contracts Runbook

## 1. Purpose

This runbook documents the normal maintenance workflow for the Foundry contracts workspace.

It covers:
- local setup
- test execution
- dependency management
- safe update practices

## 2. Workspace Scope

The contracts workspace lives in `contracts/` and currently uses:
- Foundry
- `forge-std`
- `@openzeppelin/contracts`

## 3. Local Commands

Run commands from `contracts/` unless stated otherwise.

### Verify toolchain

```bash
forge --version
```

### Run the full suite

```bash
forge test
```

### Re-run after formatting-sensitive edits

```bash
forge fmt --check
forge test
```

## 4. Test Expectations

The contracts suite should remain green across:
- unit tests
- fuzz tests
- invariant tests

Before merging contract changes:
1. run `forge test`
2. confirm no new dependency or remapping breakage
3. confirm failure-path tests still match actual revert behavior

## 5. Dependency Layout

Libraries are stored under `contracts/lib`.

Current remappings:
- `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`

Configuration exists in:
- `contracts/remappings.txt`
- `contracts/foundry.toml`

## 6. Updating OpenZeppelin

Use only tagged stable releases.

Current expected import style:

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
```

Update process:
1. replace `contracts/lib/openzeppelin-contracts` with the new tagged release contents
2. keep the canonical remapping unchanged if the package layout is unchanged
3. run `forge test`
4. check for changed revert surfaces or interface behavior in tests

Important:
- do not import OpenZeppelin using raw relative library paths when the remapping exists
- do not track OpenZeppelin as an accidental nested git repository inside the main repo

## 7. Updating forge-std

Use a tagged stable release compatible with the installed Foundry stable line.

After any update:
1. run `forge test`
2. verify fuzz and invariant runs still behave as expected
3. verify cheatcode imports or namespaced APIs still compile cleanly

## 8. CI Workflow

Contracts CI is defined in:
- `.github/workflows/contracts.yml`

The workflow currently runs:
- `forge test`

If the suite grows materially, consider adding:
- `forge fmt --check`
- separate jobs for unit vs invariant runs

## 9. Safe Practices

1. Prefer stable tool and library releases over RC or prerelease builds.
2. Prefer `SafeERC20` over raw ERC20 transfers.
3. Keep state updates before external token transfers.
4. Keep event semantics aligned with actual stored state transitions.
5. Update tests whenever dependency behavior changes visible revert surfaces.

## 10. Unsafe Practices

Avoid:
- switching to prerelease Foundry builds in normal project maintenance
- importing vendored libraries through ad hoc relative paths
- silently changing revert semantics without updating tests
- adding nested git repositories under `contracts/lib`
