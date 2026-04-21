## Contracts Workspace

This workspace uses [Foundry](https://book.getfoundry.sh/) and keeps Solidity dependencies under `contracts/lib`.

## Toolchain setup (from repo root)

Install Foundry in a reproducible way:

```bash
curl -L https://foundry.paradigm.xyz | bash
~/.foundry/bin/foundryup
```

Use Foundry binaries from this repository without relying on shell profile state:

```bash
PATH="$HOME/.foundry/bin:$PATH" forge --version
```

## Dependencies

Current dependencies:
- `forge-std`
- `@openzeppelin/contracts`

### OpenZeppelin

OpenZeppelin Contracts is installed under:

- `contracts/lib/openzeppelin-contracts`

Foundry remappings are configured in:

- `contracts/remappings.txt`
- `contracts/foundry.toml`

Canonical import style:

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
```

## Testing (repo-root entrypoints)

Run lifecycle-focused suites from the repository root:

```bash
PATH="$HOME/.foundry/bin:$PATH" forge test --root contracts --match-contract MilestoneEscrowSubmissionTest
PATH="$HOME/.foundry/bin:$PATH" forge test --root contracts --match-contract MilestoneEscrowFuzzTest
PATH="$HOME/.foundry/bin:$PATH" forge test --root contracts --match-contract MilestoneEscrowInvariantTest
```

Run the full contracts sweep from the repository root:

```bash
PATH="$HOME/.foundry/bin:$PATH" forge test --root contracts
```

The suite includes:
- unit tests
- fuzz tests
- invariant tests

## Deployment

Deploy the factory with the Foundry script:

```bash
PATH="$HOME/.foundry/bin:$PATH" forge script contracts/script/DeployEscrowFactory.s.sol:DeployEscrowFactory --private-key "$PRIVATE_KEY" --broadcast
```

Use the repository wrapper to deploy and write a manifest automatically:

```bash
USDC_ADDRESS=0x... \
FEE_RECIPIENT=0x... \
PROTOCOL_FEE_BPS=100 \
PRIVATE_KEY=0x... \
./scripts/deploy-factory-and-write-manifest.sh
```
