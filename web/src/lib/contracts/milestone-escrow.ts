import { getAddress, type Address, type Hex } from "viem";
import { createPublicClient, http } from "viem";

import { configuredChain } from "@/lib/chains";
import { appEnv } from "@/lib/env";
import { milestoneEscrowAbi } from "@/lib/contracts/milestone-escrow-abi";

const publicClient = createPublicClient({
  chain: configuredChain,
  transport: http(),
});

export type EscrowMilestone = {
  amount: bigint;
  status: number;
  reviewWindowSeconds: number;
  submittedAt: bigint;
  reviewDeadline: bigint;
  evidenceHash: Hex;
  disputeHash: Hex;
  buyerAward: bigint;
  sellerAward: bigint;
};

type EscrowMilestoneReadResult = {
  amount: bigint;
  status: number;
  reviewWindowSeconds: number;
  submittedAt: bigint;
  reviewDeadline: bigint;
  evidenceHash: Hex;
  disputeHash: Hex;
  buyerAward: bigint;
  sellerAward: bigint;
};

function mapMilestoneReadResult(milestone: EscrowMilestoneReadResult): EscrowMilestone {
  return {
    amount: milestone.amount,
    status: milestone.status,
    reviewWindowSeconds: milestone.reviewWindowSeconds,
    submittedAt: milestone.submittedAt,
    reviewDeadline: milestone.reviewDeadline,
    evidenceHash: milestone.evidenceHash,
    disputeHash: milestone.disputeHash,
    buyerAward: milestone.buyerAward,
    sellerAward: milestone.sellerAward,
  };
}

export type EscrowOverview = {
  address: Address;
  buyer: Address;
  seller: Address;
  arbiter: Address;
  token: Address;
  metadataHash: Hex;
  dealStatus: number;
  currentMilestoneIndex: bigint;
  activeDisputeMilestoneId: bigint;
  totalFunded: bigint;
  totalReleasedToSeller: bigint;
  totalRefundedToBuyer: bigint;
  totalFeesCollected: bigint;
  milestoneCount: bigint;
  currentMilestone: EscrowMilestone | null;
};

export function normalizeAddress(value: string): Address {
  return getAddress(value);
}

export function getDefaultEscrowAddress(): Address | null {
  if (!appEnv.defaultEscrowAddress) return null;

  try {
    return normalizeAddress(appEnv.defaultEscrowAddress);
  } catch {
    return null;
  }
}

export async function readEscrowOverview(address: Address): Promise<EscrowOverview> {
  const result = await publicClient.multicall({
    contracts: [
      { address, abi: milestoneEscrowAbi, functionName: "buyer" },
      { address, abi: milestoneEscrowAbi, functionName: "seller" },
      { address, abi: milestoneEscrowAbi, functionName: "arbiter" },
      { address, abi: milestoneEscrowAbi, functionName: "token" },
      { address, abi: milestoneEscrowAbi, functionName: "metadataHash" },
      { address, abi: milestoneEscrowAbi, functionName: "dealStatus" },
      { address, abi: milestoneEscrowAbi, functionName: "currentMilestoneIndex" },
      { address, abi: milestoneEscrowAbi, functionName: "activeDisputeMilestoneId" },
      { address, abi: milestoneEscrowAbi, functionName: "totalFunded" },
      { address, abi: milestoneEscrowAbi, functionName: "totalReleasedToSeller" },
      { address, abi: milestoneEscrowAbi, functionName: "totalRefundedToBuyer" },
      { address, abi: milestoneEscrowAbi, functionName: "totalFeesCollected" },
      { address, abi: milestoneEscrowAbi, functionName: "milestoneCount" },
    ],
    allowFailure: false,
  });

  const [
    buyer,
    seller,
    arbiter,
    token,
    metadataHash,
    dealStatus,
    currentMilestoneIndex,
    activeDisputeMilestoneId,
    totalFunded,
    totalReleasedToSeller,
    totalRefundedToBuyer,
    totalFeesCollected,
    milestoneCount,
  ] = result;

  const buyerAddress = buyer as Address;
  const sellerAddress = seller as Address;
  const arbiterAddress = arbiter as Address;
  const tokenAddress = token as Address;
  const metadataHashHex = metadataHash as Hex;
  const dealStatusValue = Number(dealStatus);
  const currentMilestoneIndexValue = currentMilestoneIndex as bigint;
  const activeDisputeMilestoneIdValue = activeDisputeMilestoneId as bigint;
  const totalFundedValue = totalFunded as bigint;
  const totalReleasedToSellerValue = totalReleasedToSeller as bigint;
  const totalRefundedToBuyerValue = totalRefundedToBuyer as bigint;
  const totalFeesCollectedValue = totalFeesCollected as bigint;
  const milestoneCountValue = milestoneCount as bigint;

  let currentMilestone: EscrowMilestone | null = null;

  if (currentMilestoneIndexValue < milestoneCountValue) {
    const milestone = (await publicClient.readContract({
      address,
      abi: milestoneEscrowAbi,
      functionName: "getMilestone",
      args: [currentMilestoneIndexValue],
    })) as EscrowMilestoneReadResult;

    currentMilestone = mapMilestoneReadResult(milestone);
  }

  return {
    address,
    buyer: buyerAddress,
    seller: sellerAddress,
    arbiter: arbiterAddress,
    token: tokenAddress,
    metadataHash: metadataHashHex,
    dealStatus: dealStatusValue,
    currentMilestoneIndex: currentMilestoneIndexValue,
    activeDisputeMilestoneId: activeDisputeMilestoneIdValue,
    totalFunded: totalFundedValue,
    totalReleasedToSeller: totalReleasedToSellerValue,
    totalRefundedToBuyer: totalRefundedToBuyerValue,
    totalFeesCollected: totalFeesCollectedValue,
    milestoneCount: milestoneCountValue,
    currentMilestone,
  };
}

export async function readEscrowMilestone(address: Address, milestoneId: bigint): Promise<EscrowMilestone> {
  const milestone = (await publicClient.readContract({
    address,
    abi: milestoneEscrowAbi,
    functionName: "getMilestone",
    args: [milestoneId],
  })) as EscrowMilestoneReadResult;

  return mapMilestoneReadResult(milestone);
}
