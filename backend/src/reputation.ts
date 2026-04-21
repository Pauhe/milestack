import { db } from "./db.js";
import { upsertUserRoleStats } from "./repository.js";

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
    .all(zeroHash) as Array<{ address: string; count: number }>;

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

const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
