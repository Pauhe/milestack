import { db } from "./db.js";
import { upsertUserRoleStats } from "./repository.js";

type NormalizedMilestoneLike = {
  escrowAddress: string;
  amount: bigint;
  status: number;
  disputeHash: string;
  buyerAward: bigint;
  sellerAward: bigint;
};

type NormalizedEscrowLike = {
  address: string;
  buyerAddress: string;
  sellerAddress: string;
  arbiterAddress: string;
  dealStatus: number;
  totalReleasedToSeller: bigint;
  totalRefundedToBuyer: bigint;
};

type RoleStats = {
  completedDeals: number;
  completedMilestones: number;
  disputeCount: number;
  disputeWins: number;
  disputeLosses: number;
  resolvedDisputes: number;
  unresolvedDisputes: number;
  disputeSplits: number;
  totalVolume: bigint;
};

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEAL_STATUS_COMPLETED = 2;
const MILESTONE_STATUS_PAID_OUT = 7;
const MILESTONE_STATUS_REFUNDED = 8;

function createEmptyRoleStats(): RoleStats {
  return {
    completedDeals: 0,
    completedMilestones: 0,
    disputeCount: 0,
    disputeWins: 0,
    disputeLosses: 0,
    resolvedDisputes: 0,
    unresolvedDisputes: 0,
    disputeSplits: 0,
    totalVolume: 0n,
  };
}

function getOrCreate(map: Map<string, RoleStats>, address: string) {
  const normalized = address.toLowerCase();
  const existing = map.get(normalized) ?? createEmptyRoleStats();
  map.set(normalized, existing);
  return existing;
}

function isMilestonePaidFromReplayableSemantics(milestone: Pick<NormalizedMilestoneLike, "status" | "sellerAward">) {
  return milestone.status === MILESTONE_STATUS_PAID_OUT && milestone.sellerAward > 0n;
}

function isMilestoneDisputeRecorded(disputeHash: string) {
  return disputeHash.toLowerCase() !== ZERO_HASH;
}

function classifyDisputeOutcome(milestone: Pick<NormalizedMilestoneLike, "status" | "disputeHash" | "buyerAward" | "sellerAward">): {
  isRecorded: boolean;
  isResolved: boolean;
  winner: "buyer" | "seller" | "split" | "none";
} {
  if (!isMilestoneDisputeRecorded(milestone.disputeHash)) {
    return {
      isRecorded: false,
      isResolved: false,
      winner: "none",
    };
  }

  const hasTerminalStatus = milestone.status === MILESTONE_STATUS_PAID_OUT || milestone.status === MILESTONE_STATUS_REFUNDED;
  const isResolved = hasTerminalStatus;

  if (!isResolved) {
    return {
      isRecorded: true,
      isResolved: false,
      winner: "none",
    };
  }

  if (milestone.buyerAward > milestone.sellerAward) {
    return {
      isRecorded: true,
      isResolved: true,
      winner: "buyer",
    };
  }

  if (milestone.sellerAward > milestone.buyerAward) {
    return {
      isRecorded: true,
      isResolved: true,
      winner: "seller",
    };
  }

  if (milestone.buyerAward > 0n && milestone.sellerAward > 0n) {
    return {
      isRecorded: true,
      isResolved: true,
      winner: "split",
    };
  }

  return {
    isRecorded: true,
    isResolved: true,
    winner: "none",
  };
}

function upsertRoleStats(role: "buyer" | "seller" | "arbiter", statsByAddress: Map<string, RoleStats>, updatedAtBlock: string) {
  for (const [address, stats] of statsByAddress.entries()) {
    upsertUserRoleStats({
      address,
      role,
      completedDealsCount: stats.completedDeals,
      completedMilestonesCount: stats.completedMilestones,
      disputeCount: stats.disputeCount,
      disputeWinsCount: stats.disputeWins,
      disputeLossesCount: stats.disputeLosses,
      resolvedDisputeCount: stats.resolvedDisputes,
      unresolvedDisputeCount: stats.unresolvedDisputes,
      disputeSplitCount: stats.disputeSplits,
      cancellationCount: 0,
      totalVolume: stats.totalVolume.toString(),
      updatedAtBlock,
    });
  }
}

export function recomputeUserRoleStats(updatedAtBlock: string) {
  const escrows = db
    .prepare(
      `
        SELECT
          address,
          buyer_address,
          seller_address,
          arbiter_address,
          deal_status,
          total_released_to_seller,
          total_refunded_to_buyer
        FROM escrows
      `
    )
    .all() as Array<{
    address: string;
    buyer_address: string;
    seller_address: string;
    arbiter_address: string;
    deal_status: number;
    total_released_to_seller: string;
    total_refunded_to_buyer: string;
  }>;

  const milestones = db
    .prepare(
      `
        SELECT
          escrow_address,
          amount,
          status,
          dispute_hash,
          buyer_award,
          seller_award
        FROM milestones
      `
    )
    .all() as Array<{
    escrow_address: string;
    amount: string;
    status: number;
    dispute_hash: string;
    buyer_award: string;
    seller_award: string;
  }>;

  recomputeUserRoleStatsFromReadModels({
    escrows: escrows.map((item) => ({
      address: item.address,
      buyerAddress: item.buyer_address,
      sellerAddress: item.seller_address,
      arbiterAddress: item.arbiter_address,
      dealStatus: item.deal_status,
      totalReleasedToSeller: BigInt(item.total_released_to_seller),
      totalRefundedToBuyer: BigInt(item.total_refunded_to_buyer),
    })),
    milestones: milestones.map((item) => ({
      escrowAddress: item.escrow_address,
      amount: BigInt(item.amount),
      status: item.status,
      disputeHash: item.dispute_hash,
      buyerAward: BigInt(item.buyer_award),
      sellerAward: BigInt(item.seller_award),
    })),
    updatedAtBlock,
  });
}

export function recomputeUserRoleStatsFromReadModels(input: {
  escrows: NormalizedEscrowLike[];
  milestones: NormalizedMilestoneLike[];
  updatedAtBlock: string;
}) {
  const escrowsByAddress = new Map(input.escrows.map((item) => [item.address.toLowerCase(), item]));

  const buyerStatsByAddress = new Map<string, RoleStats>();
  const sellerStatsByAddress = new Map<string, RoleStats>();
  const arbiterStatsByAddress = new Map<string, RoleStats>();

  for (const escrow of input.escrows) {
    const buyer = getOrCreate(buyerStatsByAddress, escrow.buyerAddress);
    const seller = getOrCreate(sellerStatsByAddress, escrow.sellerAddress);
    const arbiter = getOrCreate(arbiterStatsByAddress, escrow.arbiterAddress);

    buyer.totalVolume += escrow.totalRefundedToBuyer;
    seller.totalVolume += escrow.totalReleasedToSeller;

    if (escrow.dealStatus === DEAL_STATUS_COMPLETED) {
      buyer.completedDeals += 1;
      seller.completedDeals += 1;
      arbiter.completedDeals += 1;
    }
  }

  for (const milestone of input.milestones) {
    const escrow = escrowsByAddress.get(milestone.escrowAddress.toLowerCase());
    if (!escrow) {
      continue;
    }

    const buyer = getOrCreate(buyerStatsByAddress, escrow.buyerAddress);
    const seller = getOrCreate(sellerStatsByAddress, escrow.sellerAddress);
    const arbiter = getOrCreate(arbiterStatsByAddress, escrow.arbiterAddress);

    if (isMilestonePaidFromReplayableSemantics(milestone)) {
      seller.completedMilestones += 1;
    }

    const dispute = classifyDisputeOutcome(milestone);
    if (!dispute.isRecorded) {
      continue;
    }

    buyer.disputeCount += 1;
    seller.disputeCount += 1;
    arbiter.disputeCount += 1;

    arbiter.totalVolume += milestone.amount;

    if (!dispute.isResolved) {
      buyer.unresolvedDisputes += 1;
      seller.unresolvedDisputes += 1;
      arbiter.unresolvedDisputes += 1;
      continue;
    }

    buyer.resolvedDisputes += 1;
    seller.resolvedDisputes += 1;
    arbiter.resolvedDisputes += 1;

    if (dispute.winner === "buyer") {
      buyer.disputeWins += 1;
      seller.disputeLosses += 1;
      continue;
    }

    if (dispute.winner === "seller") {
      seller.disputeWins += 1;
      buyer.disputeLosses += 1;
      continue;
    }

    if (dispute.winner === "split") {
      buyer.disputeSplits += 1;
      seller.disputeSplits += 1;
      arbiter.disputeSplits += 1;
    }
  }

  upsertRoleStats("buyer", buyerStatsByAddress, input.updatedAtBlock);
  upsertRoleStats("seller", sellerStatsByAddress, input.updatedAtBlock);
  upsertRoleStats("arbiter", arbiterStatsByAddress, input.updatedAtBlock);
}
