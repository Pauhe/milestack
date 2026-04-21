import type { Abi } from "viem";

import artifact from "../../../../contracts/out/EscrowFactory.sol/EscrowFactory.json";

export const escrowFactoryAbi = artifact.abi as Abi;
