import { db } from "./db.js";

export type EscrowRow = {
  address: string;
  buyer_address: string;
  seller_address: string;
  arbiter_address: string;
  token_address: string;
  metadata_hash: string;
  milestone_count: number;
  deal_status: number;
  current_milestone_index: number;
  active_dispute_milestone_id: string | null;
  total_funded: string;
  total_released_to_seller: string;
  total_refunded_to_buyer: string;
  total_fees_collected: string;
  created_at_block: string;
  updated_at_block: string;
};

export type MilestoneRow = {
  escrow_address: string;
  milestone_id: number;
  amount: string;
  status: number;
  review_window_seconds: number;
  submitted_at: string;
  review_deadline: string;
  evidence_hash: string;
  dispute_hash: string;
  buyer_award: string;
  seller_award: string;
  metadata_title: string | null;
  metadata_description: string | null;
};

export type EventRow = {
  chain_id: number;
  block_number: string;
  tx_hash: string;
  log_index: string;
  escrow_address: string;
  event_name: string;
  summary: string;
  payload_json: string;
};

export function upsertEscrow(input: {
  address: string;
  buyerAddress: string;
  sellerAddress: string;
  arbiterAddress: string;
  tokenAddress: string;
  metadataHash: string;
  milestoneCount: number;
  dealStatus: number;
  currentMilestoneIndex: number;
  activeDisputeMilestoneId: string | null;
  totalFunded: string;
  totalReleasedToSeller: string;
  totalRefundedToBuyer: string;
  totalFeesCollected: string;
  createdAtBlock: string;
  updatedAtBlock: string;
}) {
  db.prepare(
    `
      INSERT INTO escrows (
        address,
        buyer_address,
        seller_address,
        arbiter_address,
        token_address,
        metadata_hash,
        milestone_count,
        deal_status,
        current_milestone_index,
        active_dispute_milestone_id,
        total_funded,
        total_released_to_seller,
        total_refunded_to_buyer,
        total_fees_collected,
        created_at_block,
        updated_at_block
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        buyer_address = excluded.buyer_address,
        seller_address = excluded.seller_address,
        arbiter_address = excluded.arbiter_address,
        token_address = excluded.token_address,
        metadata_hash = excluded.metadata_hash,
        milestone_count = excluded.milestone_count,
        deal_status = excluded.deal_status,
        current_milestone_index = excluded.current_milestone_index,
        active_dispute_milestone_id = excluded.active_dispute_milestone_id,
        total_funded = excluded.total_funded,
        total_released_to_seller = excluded.total_released_to_seller,
        total_refunded_to_buyer = excluded.total_refunded_to_buyer,
        total_fees_collected = excluded.total_fees_collected,
        updated_at_block = excluded.updated_at_block
    `
  ).run(
    input.address.toLowerCase(),
    input.buyerAddress,
    input.sellerAddress,
    input.arbiterAddress,
    input.tokenAddress,
    input.metadataHash,
    input.milestoneCount,
    input.dealStatus,
    input.currentMilestoneIndex,
    input.activeDisputeMilestoneId,
    input.totalFunded,
    input.totalReleasedToSeller,
    input.totalRefundedToBuyer,
    input.totalFeesCollected,
    input.createdAtBlock,
    input.updatedAtBlock
  );
}

export function upsertMilestone(input: {
  escrowAddress: string;
  milestoneId: number;
  amount: string;
  status: number;
  reviewWindowSeconds: number;
  submittedAt: string;
  reviewDeadline: string;
  evidenceHash: string;
  disputeHash: string;
  buyerAward: string;
  sellerAward: string;
  metadataTitle: string | null;
  metadataDescription: string | null;
}) {
  db.prepare(
    `
      INSERT INTO milestones (
        escrow_address,
        milestone_id,
        amount,
        status,
        review_window_seconds,
        submitted_at,
        review_deadline,
        evidence_hash,
        dispute_hash,
        buyer_award,
        seller_award,
        metadata_title,
        metadata_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(escrow_address, milestone_id) DO UPDATE SET
        amount = excluded.amount,
        status = excluded.status,
        review_window_seconds = excluded.review_window_seconds,
        submitted_at = excluded.submitted_at,
        review_deadline = excluded.review_deadline,
        evidence_hash = excluded.evidence_hash,
        dispute_hash = excluded.dispute_hash,
        buyer_award = excluded.buyer_award,
        seller_award = excluded.seller_award,
        metadata_title = excluded.metadata_title,
        metadata_description = excluded.metadata_description
    `
  ).run(
    input.escrowAddress.toLowerCase(),
    input.milestoneId,
    input.amount,
    input.status,
    input.reviewWindowSeconds,
    input.submittedAt,
    input.reviewDeadline,
    input.evidenceHash,
    input.disputeHash,
    input.buyerAward,
    input.sellerAward,
    input.metadataTitle,
    input.metadataDescription
  );
}

export function insertEvent(input: {
  chainId: number;
  blockNumber: string;
  txHash: string;
  logIndex: string;
  escrowAddress: string;
  eventName: string;
  summary: string;
  payloadJson: string;
}) {
  const result = db
    .prepare(
      `
      INSERT OR IGNORE INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.chainId,
      input.blockNumber,
      input.txHash,
      input.logIndex,
      input.escrowAddress.toLowerCase(),
      input.eventName,
      input.summary,
      input.payloadJson
    );

  return result.changes === 1;
}

export function getEscrow(address: string) {
  return db.prepare("SELECT * FROM escrows WHERE address = ?").get(address.toLowerCase()) as EscrowRow | undefined;
}

export function getMilestone(address: string, milestoneId: number) {
  return db
    .prepare("SELECT * FROM milestones WHERE escrow_address = ? AND milestone_id = ?")
    .get(address.toLowerCase(), milestoneId) as MilestoneRow | undefined;
}

export function listMilestones(address: string) {
  return db
    .prepare(
      `
        SELECT * FROM milestones
        WHERE escrow_address = ?
        ORDER BY milestone_id ASC
      `
    )
    .all(address.toLowerCase()) as MilestoneRow[];
}

export function getTimeline(address: string) {
  return db
    .prepare(
      `
        SELECT * FROM events
        WHERE escrow_address = ?
        ORDER BY CAST(block_number AS INTEGER) ASC, CAST(log_index AS INTEGER) ASC
      `
    )
    .all(address.toLowerCase());
}

export function getEscrowParticipants(address: string) {
  return db
    .prepare(
      `
        SELECT buyer_address, seller_address, arbiter_address
        FROM escrows
        WHERE address = ?
      `
    )
    .get(address.toLowerCase()) as
    | {
        buyer_address: string;
        seller_address: string;
        arbiter_address: string;
      }
    | undefined;
}

export function listKnownEscrows(): string[] {
  return db.prepare("SELECT address FROM escrows").all().map((row) => (row as { address: string }).address);
}

export function listAllEvents() {
  return db
    .prepare(
      `
        SELECT * FROM events
        ORDER BY CAST(block_number AS INTEGER) ASC, CAST(log_index AS INTEGER) ASC
      `
    )
    .all() as EventRow[];
}

export function getEventCount() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number };
  return row.count;
}

export function clearDerivedReadModels() {
  db.exec(`
    DELETE FROM milestones;
    DELETE FROM escrows;
    DELETE FROM user_role_stats;
  `);
}

export function clearMetadataCache() {
  db.exec("DELETE FROM metadata_cache;");
}

export function upsertUserRoleStats(input: {
  address: string;
  role: string;
  completedDealsCount: number;
  completedMilestonesCount: number;
  disputeCount: number;
  disputeWinsCount: number;
  cancellationCount: number;
  totalVolume: string;
  updatedAtBlock: string;
}) {
  db.prepare(
    `
      INSERT INTO user_role_stats (
        address,
        role,
        completed_deals_count,
        completed_milestones_count,
        dispute_count,
        dispute_wins_count,
        cancellation_count,
        total_volume,
        updated_at_block
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address, role) DO UPDATE SET
        completed_deals_count = excluded.completed_deals_count,
        completed_milestones_count = excluded.completed_milestones_count,
        dispute_count = excluded.dispute_count,
        dispute_wins_count = excluded.dispute_wins_count,
        cancellation_count = excluded.cancellation_count,
        total_volume = excluded.total_volume,
        updated_at_block = excluded.updated_at_block
    `
  ).run(
    input.address.toLowerCase(),
    input.role,
    input.completedDealsCount,
    input.completedMilestonesCount,
    input.disputeCount,
    input.disputeWinsCount,
    input.cancellationCount,
    input.totalVolume,
    input.updatedAtBlock
  );
}

export function getUserRoleStats(address: string) {
  return db
    .prepare(
      `
        SELECT * FROM user_role_stats
        WHERE address = ?
      `
    )
    .all(address.toLowerCase()) as Array<{
      address: string;
      role: string;
      completed_deals_count: number;
      completed_milestones_count: number;
      dispute_count: number;
      dispute_wins_count: number;
      cancellation_count: number;
      total_volume: string;
      updated_at_block: string;
    }>;
}

export function upsertMetadataCache(input: {
  metadataHash: string;
  metadataUrl: string;
  verified: boolean;
  payloadJson: string | null;
  error: string | null;
  updatedAtBlock: string;
}) {
  db.prepare(
    `
      INSERT INTO metadata_cache (
        metadata_hash,
        metadata_url,
        verified,
        payload_json,
        error,
        updated_at_block
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(metadata_hash) DO UPDATE SET
        metadata_url = excluded.metadata_url,
        verified = excluded.verified,
        payload_json = excluded.payload_json,
        error = excluded.error,
        updated_at_block = excluded.updated_at_block
    `
  ).run(
    input.metadataHash,
    input.metadataUrl,
    input.verified ? 1 : 0,
    input.payloadJson,
    input.error,
    input.updatedAtBlock
  );
}

export function getMetadataCache(metadataHash: string) {
  return db.prepare("SELECT * FROM metadata_cache WHERE metadata_hash = ?").get(metadataHash) as
    | {
        metadata_hash: string;
        metadata_url: string;
        verified: number;
        payload_json: string | null;
        error: string | null;
        updated_at_block: string;
      }
    | undefined;
}

export function listMetadataCache() {
  return db.prepare("SELECT * FROM metadata_cache").all() as Array<{
    metadata_hash: string;
    metadata_url: string;
    verified: number;
    payload_json: string | null;
    error: string | null;
    updated_at_block: string;
  }>;
}
