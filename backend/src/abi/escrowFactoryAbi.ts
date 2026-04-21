import type { Abi } from "viem";

import artifact from "../../../contracts/out/EscrowFactory.sol/EscrowFactory.json" with { type: "json" };

export const escrowFactoryAbi = artifact.abi as Abi;
