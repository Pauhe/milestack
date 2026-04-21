## Contracts Dependencies

The contracts workspace uses Foundry with libraries stored under `contracts/lib`.

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

### Testing

Run the full contracts test suite with:

```bash
forge test
```

The suite includes:
- unit tests
- fuzz tests
- invariant tests
