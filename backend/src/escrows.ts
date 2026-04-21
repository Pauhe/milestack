import { type Address, type Hex } from "viem";

import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { publicClient } from "./clients.js";

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

export type EscrowOverviewResponse = {
  address: Address;
  chainId: number;
  dealStatus: number;
  buyer: Address;
  seller: Address;
  arbiter: Address;
  token: Address;
  metadataHash: Hex;
  milestoneCount: bigint;
  currentMilestoneIndex: bigint;
  activeDisputeMilestoneId: bigint;
  totals: {
    funded: bigint;
    releasedToSeller: bigint;
    refundedToBuyer: bigint;
    feesCollected: bigint;
  };
};

export async function readEscrowOverview(address: Address): Promise<EscrowOverviewResponse> {
  const [
    buyer,
    seller,
    arbiter,
    token,
    metadataHash,
    dealStatus,
    milestoneCount,
    currentMilestoneIndex,
    activeDisputeMilestoneId,
    totalFunded,
    totalReleasedToSeller,
    totalRefundedToBuyer,
    totalFeesCollected,
  ] = await publicClient.multicall({
    contracts: [
      { address, abi: milestoneEscrowAbi, functionName: "buyer" },
      { address, abi: milestoneEscrowAbi, functionName: "seller" },
      { address, abi: milestoneEscrowAbi, functionName: "arbiter" },
      { address, abi: milestoneEscrowAbi, functionName: "token" },
      { address, abi: milestoneEscrowAbi, functionName: "metadataHash" },
      { address, abi: milestoneEscrowAbi, functionName: "dealStatus" },
      { address, abi: milestoneEscrowAbi, functionName: "milestoneCount" },
      { address, abi: milestoneEscrowAbi, functionName: "currentMilestoneIndex" },
      { address, abi: milestoneEscrowAbi, functionName: "activeDisputeMilestoneId" },
      { address, abi: milestoneEscrowAbi, functionName: "totalFunded" },
      { address, abi: milestoneEscrowAbi, functionName: "totalReleasedToSeller" },
      { address, abi: milestoneEscrowAbi, functionName: "totalRefundedToBuyer" },
      { address, abi: milestoneEscrowAbi, functionName: "totalFeesCollected" },
    ],
    allowFailure: false,
  });

  return {
    address,
    chainId: publicClient.chain.id,
    dealStatus: Number(dealStatus),
    buyer: buyer as Address,
    seller: seller as Address,
    arbiter: arbiter as Address,
    token: token as Address,
    metadataHash: metadataHash as Hex,
    milestoneCount: milestoneCount as bigint,
    currentMilestoneIndex: currentMilestoneIndex as bigint,
    activeDisputeMilestoneId: activeDisputeMilestoneId as bigint,
    totals: {
      funded: totalFunded as bigint,
      releasedToSeller: totalReleasedToSeller as bigint,
      refundedToBuyer: totalRefundedToBuyer as bigint,
      feesCollected: totalFeesCollected as bigint,
    },
  };
}

export async function readEscrowMilestone(address: Address, milestoneId: bigint) {
  const milestone = (await publicClient.readContract({
    address,
    abi: milestoneEscrowAbi,
    functionName: "getMilestone",
    args: [milestoneId],
  })) as EscrowMilestoneReadResult;

  return {
    milestoneId,
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
