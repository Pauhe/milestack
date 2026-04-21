import type { Abi } from "viem";

import artifact from "../../../../contracts/out/MilestoneEscrow.sol/MilestoneEscrow.json";

export const milestoneEscrowAbi = artifact.abi as Abi;
