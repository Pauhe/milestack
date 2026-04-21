import { db } from "./db.js";
import { upsertUserRoleStats } from "./repository.js";

type NormalizedMilestoneLike = {
  escrowAddress: string;
  status: number;
  disputeHash: string;
  buyerAward: bigint;
  sellerAward: bigint;
};

type NormalizedEscrowLike = {
  address: string;
  buyerAddress: string;
  sellerAddress: string;
  dealStatus: number;
  totalReleasedToSeller: bigint;
  totalRefundedToBuyer: bigint;
};

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const DEAL_STATUS_COMPLETED = 2;
const MILESTONE_STATUS_PAID_OUT = 7;

export function recomputeUserRoleStats(updatedAtBlock: string) {
  const completedBuyerRows = db
    .prepare(
      `
        SELECT buyer_address AS address, COUNT(*) AS count
        FROM escrows
        WHERE deal_status = 2
        GROUP BY buyer_address
      `
    )
    .all() as Array<{ address: string; count: number }>;

  const completedSellerRows = db
    .prepare(
      `
        SELECT seller_address AS address, COUNT(*) AS count
        FROM escrows
        WHERE deal_status = 2
        GROUP BY seller_address
      `
    )
    .all() as Array<{ address: string; count: number }>;

  const buyerVolumeRows = db
    .prepare(
      `
        SELECT e.buyer_address AS address, COALESCE(SUM(CAST(e.total_refunded_to_buyer AS REAL)), 0) AS total_volume
        FROM escrows e
        GROUP BY e.buyer_address
      `
    )
    .all() as Array<{ address: string; total_volume: number }>;

  const sellerVolumeRows = db
    .prepare(
      `
        SELECT e.seller_address AS address, COALESCE(SUM(CAST(e.total_released_to_seller AS REAL)), 0) AS total_volume
        FROM escrows e
        GROUP BY e.seller_address
      `
    )
    .all() as Array<{ address: string; total_volume: number }>;

  const sellerMilestoneRows = db
    .prepare(
      `
        SELECT e.seller_address AS address, COUNT(*) AS count
        FROM milestones m
        JOIN escrows e ON e.address = m.escrow_address
        WHERE m.status = 7
        GROUP BY e.seller_address
      `
    )
    .all() as Array<{ address: string; count: number }>;

  const buyerDisputeRows = db
    .prepare(
      `
        SELECT e.buyer_address AS address, COUNT(*) AS count
        FROM milestones m
        JOIN escrows e ON e.address = m.escrow_address
        WHERE m.dispute_hash != ?
        GROUP BY e.buyer_address
      `
    )
    .all(ZERO_HASH) as Array<{ address: string; count: number }>;

  const sellerDisputeWinRows = db
    .prepare(
      `
        SELECT e.seller_address AS address, COUNT(*) AS count
        FROM milestones m
        JOIN escrows e ON e.address = m.escrow_address
        WHERE CAST(m.seller_award AS REAL) > CAST(m.buyer_award AS REAL)
        GROUP BY e.seller_address
      `
    )
    .all() as Array<{ address: string; count: number }>;

  const buyerStats = mergeByAddress(completedBuyerRows, buyerVolumeRows, buyerDisputeRows);
  for (const item of buyerStats) {
    upsertUserRoleStats({
      address: item.address,
      role: "buyer",
      completedDealsCount: item.completedDeals,
      completedMilestonesCount: 0,
      disputeCount: item.disputeCount,
      disputeWinsCount: 0,
      cancellationCount: 0,
      totalVolume: item.totalVolume.toString(),
      updatedAtBlock,
    });
  }

  const sellerStats = mergeSellerStats(completedSellerRows, sellerVolumeRows, sellerMilestoneRows, sellerDisputeWinRows);
  for (const item of sellerStats) {
    upsertUserRoleStats({
      address: item.address,
      role: "seller",
      completedDealsCount: item.completedDeals,
      completedMilestonesCount: item.completedMilestones,
      disputeCount: 0,
      disputeWinsCount: item.disputeWins,
      cancellationCount: 0,
      totalVolume: item.totalVolume.toString(),
      updatedAtBlock,
    });
  }
}

export function recomputeUserRoleStatsFromReadModels(input: {
  escrows: NormalizedEscrowLike[];
  milestones: NormalizedMilestoneLike[];
  updatedAtBlock: string;
}) {
  const escrowsByAddress = new Map(input.escrows.map((item) => [item.address.toLowerCase(), item]));

  const buyerStats = new Map<string, { completedDeals: number; disputeCount: number; totalVolume: bigint }>();
  const sellerStats = new Map<string, { completedDeals: number; completedMilestones: number; disputeWins: number; totalVolume: bigint }>();

  for (const escrow of input.escrows) {
    const buyerAddress = escrow.buyerAddress.toLowerCase();
    const sellerAddress = escrow.sellerAddress.toLowerCase();

    const buyer = buyerStats.get(buyerAddress) ?? { completedDeals: 0, disputeCount: 0, totalVolume: 0n };
    const seller = sellerStats.get(sellerAddress) ?? {
      completedDeals: 0,
      completedMilestones: 0,
      disputeWins: 0,
      totalVolume: 0n,
    };

    buyer.totalVolume += escrow.totalRefundedToBuyer;
    seller.totalVolume += escrow.totalReleasedToSeller;

    if (escrow.dealStatus === DEAL_STATUS_COMPLETED) {
      buyer.completedDeals += 1;
      seller.completedDeals += 1;
    }

    buyerStats.set(buyerAddress, buyer);
    sellerStats.set(sellerAddress, seller);
  }

  for (const milestone of input.milestones) {
    const escrow = escrowsByAddress.get(milestone.escrowAddress.toLowerCase());
    if (!escrow) {
      continue;
    }

    const buyerAddress = escrow.buyerAddress.toLowerCase();
    const sellerAddress = escrow.sellerAddress.toLowerCase();

    if (milestone.status === MILESTONE_STATUS_PAID_OUT) {
      const seller = sellerStats.get(sellerAddress) ?? {
        completedDeals: 0,
        completedMilestones: 0,
        disputeWins: 0,
        totalVolume: 0n,
      };
      seller.completedMilestones += 1;
      sellerStats.set(sellerAddress, seller);
    }

    if (milestone.disputeHash.toLowerCase() !== ZERO_HASH) {
      const buyer = buyerStats.get(buyerAddress) ?? { completedDeals: 0, disputeCount: 0, totalVolume: 0n };
      buyer.disputeCount += 1;
      buyerStats.set(buyerAddress, buyer);
    }

    if (milestone.sellerAward > milestone.buyerAward) {
      const seller = sellerStats.get(sellerAddress) ?? {
        completedDeals: 0,
        completedMilestones: 0,
        disputeWins: 0,
        totalVolume: 0n,
      };
      seller.disputeWins += 1;
      sellerStats.set(sellerAddress, seller);
    }
  }

  for (const [address, stats] of buyerStats.entries()) {
    upsertUserRoleStats({
      address,
      role: "buyer",
      completedDealsCount: stats.completedDeals,
      completedMilestonesCount: 0,
      disputeCount: stats.disputeCount,
      disputeWinsCount: 0,
      cancellationCount: 0,
      totalVolume: stats.totalVolume.toString(),
      updatedAtBlock: input.updatedAtBlock,
    });
  }

  for (const [address, stats] of sellerStats.entries()) {
    upsertUserRoleStats({
      address,
      role: "seller",
      completedDealsCount: stats.completedDeals,
      completedMilestonesCount: stats.completedMilestones,
      disputeCount: 0,
      disputeWinsCount: stats.disputeWins,
      cancellationCount: 0,
      totalVolume: stats.totalVolume.toString(),
      updatedAtBlock: input.updatedAtBlock,
    });
  }
}

function mergeByAddress(
  completedDeals: Array<{ address: string; count: number }>,
  volume: Array<{ address: string; total_volume: number }>,
  disputeCounts: Array<{ address: string; count: number }>
) {
  const map = new Map<string, { address: string; completedDeals: number; totalVolume: number; disputeCount: number }>();

  for (const row of completedDeals) {
    map.set(row.address, { address: row.address, completedDeals: row.count, totalVolume: 0, disputeCount: 0 });
  }

  for (const row of volume) {
    const existing = map.get(row.address) ?? { address: row.address, completedDeals: 0, totalVolume: 0, disputeCount: 0 };
    existing.totalVolume = row.total_volume;
    map.set(row.address, existing);
  }

  for (const row of disputeCounts) {
    const existing = map.get(row.address) ?? { address: row.address, completedDeals: 0, totalVolume: 0, disputeCount: 0 };
    existing.disputeCount = row.count;
    map.set(row.address, existing);
  }

  return [...map.values()];
}

function mergeSellerStats(
  completedDeals: Array<{ address: string; count: number }>,
  volume: Array<{ address: string; total_volume: number }>,
  milestoneCounts: Array<{ address: string; count: number }>,
  disputeWins: Array<{ address: string; count: number }>
) {
  const map = new Map<string, { address: string; completedDeals: number; completedMilestones: number; totalVolume: number; disputeWins: number }>();

  for (const row of completedDeals) {
    map.set(row.address, {
      address: row.address,
      completedDeals: row.count,
      completedMilestones: 0,
      totalVolume: 0,
      disputeWins: 0,
    });
  }

  for (const row of volume) {
    const existing = map.get(row.address) ?? {
      address: row.address,
      completedDeals: 0,
      completedMilestones: 0,
      totalVolume: 0,
      disputeWins: 0,
    };
    existing.totalVolume = row.total_volume;
    map.set(row.address, existing);
  }

  for (const row of milestoneCounts) {
    const existing = map.get(row.address) ?? {
      address: row.address,
      completedDeals: 0,
      completedMilestones: 0,
      totalVolume: 0,
      disputeWins: 0,
    };
    existing.completedMilestones = row.count;
    map.set(row.address, existing);
  }

  for (const row of disputeWins) {
    const existing = map.get(row.address) ?? {
      address: row.address,
      completedDeals: 0,
      completedMilestones: 0,
      totalVolume: 0,
      disputeWins: 0,
    };
    existing.disputeWins = row.count;
    map.set(row.address, existing);
  }

  return [...map.values()];
}
