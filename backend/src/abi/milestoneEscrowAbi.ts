import type { Abi } from "viem";

import artifact from "../../../contracts/out/MilestoneEscrow.sol/MilestoneEscrow.json" with { type: "json" };

export const milestoneEscrowAbi = artifact.abi as Abi;
