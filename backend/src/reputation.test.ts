import assert from "node:assert/strict";
import test from "node:test";

import { deploymentManifest } from "./config.js";
import { db } from "./db.js";
import { recomputeUserRoleStats } from "./reputation.js";
import { getUserRoleStats } from "./repository.js";

const BUYER = "0xbuyer000000000000000000000000000000000001";
const SELLER = "0xseller00000000000000000000000000000000001";
const ARBITER = "0xarbiter000000000000000000000000000000001";
const ALT_BUYER = "0xbuyer000000000000000000000000000000000002";
const ALT_SELLER = "0xseller00000000000000000000000000000000002";
const ALT_ARBITER = "0xarbiter000000000000000000000000000000002";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

function resetReadModels() {
  db.exec("DELETE FROM user_role_stats;");
  db.exec("DELETE FROM milestones;");
  db.exec("DELETE FROM escrows;");
}

function insertEscrow(input: {
  chainId?: number;
  address: string;
  buyer: string;
  seller: string;
  arbiter: string;
  dealStatus: number;
  totalReleasedToSeller: string;
  totalRefundedToBuyer: string;
  milestoneCount?: number;
  currentMilestoneIndex?: number;
}) {
  db.prepare(
    `
      INSERT INTO escrows (
        chain_id,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.chainId ?? deploymentManifest.chain.chainId,
    input.address,
    input.buyer,
    input.seller,
    input.arbiter,
    "0xusdc",
    ZERO_HASH,
    input.milestoneCount ?? 3,
    input.dealStatus,
    input.currentMilestoneIndex ?? 0,
    null,
    "0",
    input.totalReleasedToSeller,
    input.totalRefundedToBuyer,
    "0",
    "1",
    "1"
  );
}

function insertMilestone(input: {
  chainId?: number;
  escrowAddress: string;
  milestoneId: number;
  amount: string;
  status: number;
  disputeHash?: string;
  buyerAward: string;
  sellerAward: string;
}) {
  db.prepare(
    `
      INSERT INTO milestones (
        chain_id,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.chainId ?? deploymentManifest.chain.chainId,
    input.escrowAddress,
    input.milestoneId,
    input.amount,
    input.status,
    432000,
    "1",
    "2",
    ZERO_HASH,
    input.disputeHash ?? ZERO_HASH,
    input.buyerAward,
    input.sellerAward,
    null,
    null
  );
}

test("recomputeUserRoleStats derives additive buyer/seller/arbiter dispute stats from replayable rows", () => {
  resetReadModels();

  insertEscrow({
    address: "0xescrow1",
    buyer: BUYER,
    seller: SELLER,
    arbiter: ARBITER,
    dealStatus: 2,
    totalReleasedToSeller: "1600000000",
    totalRefundedToBuyer: "400000000",
  });

  insertMilestone({
    escrowAddress: "0xescrow1",
    milestoneId: 0,
    amount: "1000000000",
    status: 7,
    buyerAward: "0",
    sellerAward: "1000000000",
  });

  insertMilestone({
    escrowAddress: "0xescrow1",
    milestoneId: 1,
    amount: "1000000000",
    status: 7,
    disputeHash: "0xdispute-seller-win",
    buyerAward: "400000000",
    sellerAward: "600000000",
  });

  insertMilestone({
    escrowAddress: "0xescrow1",
    milestoneId: 2,
    amount: "500000000",
    status: 8,
    disputeHash: "0xdispute-buyer-win",
    buyerAward: "500000000",
    sellerAward: "0",
  });

  recomputeUserRoleStats("100");

  const buyerStats = getUserRoleStats(BUYER).find((item) => item.role === "buyer");
  assert.ok(buyerStats);
  assert.equal(buyerStats.completed_deals_count, 1);
  assert.equal(buyerStats.dispute_count, 2);
  assert.equal(buyerStats.dispute_wins_count, 1);
  assert.equal(buyerStats.dispute_losses_count, 1);
  assert.equal(buyerStats.resolved_dispute_count, 2);
  assert.equal(buyerStats.unresolved_dispute_count, 0);
  assert.equal(buyerStats.dispute_split_count, 0);

  const sellerStats = getUserRoleStats(SELLER).find((item) => item.role === "seller");
  assert.ok(sellerStats);
  assert.equal(sellerStats.completed_deals_count, 1);
  assert.equal(sellerStats.completed_milestones_count, 2);
  assert.equal(sellerStats.dispute_count, 2);
  assert.equal(sellerStats.dispute_wins_count, 1);
  assert.equal(sellerStats.dispute_losses_count, 1);
  assert.equal(sellerStats.resolved_dispute_count, 2);
  assert.equal(sellerStats.unresolved_dispute_count, 0);
  assert.equal(sellerStats.dispute_split_count, 0);

  const arbiterStats = getUserRoleStats(ARBITER).find((item) => item.role === "arbiter");
  assert.ok(arbiterStats);
  assert.equal(arbiterStats.completed_deals_count, 1);
  assert.equal(arbiterStats.dispute_count, 2);
  assert.equal(arbiterStats.resolved_dispute_count, 2);
  assert.equal(arbiterStats.unresolved_dispute_count, 0);
  assert.equal(arbiterStats.dispute_split_count, 0);
  assert.equal(arbiterStats.total_volume, "1500000000");
});

test("recomputeUserRoleStats keeps unresolved or ambiguous dispute outcomes out of win counts", () => {
  resetReadModels();

  insertEscrow({
    address: "0xescrow2",
    buyer: BUYER,
    seller: SELLER,
    arbiter: ARBITER,
    dealStatus: 1,
    totalReleasedToSeller: "500000000",
    totalRefundedToBuyer: "0",
  });

  insertMilestone({
    escrowAddress: "0xescrow2",
    milestoneId: 0,
    amount: "500000000",
    status: 5,
    disputeHash: "0xdispute-open",
    buyerAward: "100000000",
    sellerAward: "100000000",
  });

  insertMilestone({
    escrowAddress: "0xescrow2",
    milestoneId: 1,
    amount: "500000000",
    status: 8,
    disputeHash: "0xdispute-zero-awards",
    buyerAward: "0",
    sellerAward: "0",
  });

  recomputeUserRoleStats("101");

  const buyerStats = getUserRoleStats(BUYER).find((item) => item.role === "buyer");
  assert.ok(buyerStats);
  assert.equal(buyerStats.dispute_count, 2);
  assert.equal(buyerStats.dispute_wins_count, 0);
  assert.equal(buyerStats.dispute_losses_count, 0);
  assert.equal(buyerStats.resolved_dispute_count, 1);
  assert.equal(buyerStats.unresolved_dispute_count, 1);
  assert.equal(buyerStats.dispute_split_count, 0);

  const sellerStats = getUserRoleStats(SELLER).find((item) => item.role === "seller");
  assert.ok(sellerStats);
  assert.equal(sellerStats.dispute_count, 2);
  assert.equal(sellerStats.dispute_wins_count, 0);
  assert.equal(sellerStats.dispute_losses_count, 0);
  assert.equal(sellerStats.resolved_dispute_count, 1);
  assert.equal(sellerStats.unresolved_dispute_count, 1);
  assert.equal(sellerStats.dispute_split_count, 0);

  const arbiterStats = getUserRoleStats(ARBITER).find((item) => item.role === "arbiter");
  assert.ok(arbiterStats);
  assert.equal(arbiterStats.dispute_count, 2);
  assert.equal(arbiterStats.resolved_dispute_count, 1);
  assert.equal(arbiterStats.unresolved_dispute_count, 1);
  assert.equal(arbiterStats.dispute_split_count, 0);
});

test("recomputeUserRoleStats ignores malformed/zero-hash/missing-escrow dispute context and preserves role isolation", () => {
  resetReadModels();

  insertEscrow({
    address: "0xescrow3",
    buyer: BUYER,
    seller: SELLER,
    arbiter: ARBITER,
    dealStatus: 2,
    totalReleasedToSeller: "900000000",
    totalRefundedToBuyer: "100000000",
    milestoneCount: 2,
  });

  insertEscrow({
    address: "0xescrow4",
    buyer: ALT_BUYER,
    seller: ALT_SELLER,
    arbiter: ALT_ARBITER,
    dealStatus: 2,
    totalReleasedToSeller: "300000000",
    totalRefundedToBuyer: "200000000",
    milestoneCount: 1,
  });

  insertMilestone({
    escrowAddress: "0xescrow3",
    milestoneId: 0,
    amount: "700000000",
    status: 7,
    disputeHash: ZERO_HASH,
    buyerAward: "100000000",
    sellerAward: "600000000",
  });

  insertMilestone({
    escrowAddress: "0xescrow3",
    milestoneId: 1,
    amount: "200000000",
    status: 7,
    disputeHash: "0xdispute-split",
    buyerAward: "100000000",
    sellerAward: "100000000",
  });

  // missing escrow row for this milestone should never produce stats for any role
  insertMilestone({
    escrowAddress: "0xescrow-missing",
    milestoneId: 0,
    amount: "900000000",
    status: 8,
    disputeHash: "0xorphan-dispute",
    buyerAward: "900000000",
    sellerAward: "0",
  });

  recomputeUserRoleStats("102");

  const buyerStats = getUserRoleStats(BUYER).find((item) => item.role === "buyer");
  assert.ok(buyerStats);
  assert.equal(buyerStats.dispute_count, 1, "zero-hash dispute context must not increment dispute counters");
  assert.equal(buyerStats.dispute_wins_count, 0);
  assert.equal(buyerStats.dispute_losses_count, 0);
  assert.equal(buyerStats.dispute_split_count, 1);

  const sellerStats = getUserRoleStats(SELLER).find((item) => item.role === "seller");
  assert.ok(sellerStats);
  assert.equal(sellerStats.dispute_count, 1);
  assert.equal(sellerStats.dispute_wins_count, 0);
  assert.equal(sellerStats.dispute_losses_count, 0);
  assert.equal(sellerStats.dispute_split_count, 1);

  const arbiterStats = getUserRoleStats(ARBITER).find((item) => item.role === "arbiter");
  assert.ok(arbiterStats);
  assert.equal(arbiterStats.dispute_count, 1);
  assert.equal(arbiterStats.dispute_split_count, 1);
  assert.equal(arbiterStats.total_volume, "200000000");

  const altBuyerStats = getUserRoleStats(ALT_BUYER).find((item) => item.role === "buyer");
  assert.ok(altBuyerStats);
  assert.equal(altBuyerStats.completed_deals_count, 1);
  assert.equal(altBuyerStats.dispute_count, 0);

  const altSellerStats = getUserRoleStats(ALT_SELLER).find((item) => item.role === "seller");
  assert.ok(altSellerStats);
  assert.equal(altSellerStats.completed_deals_count, 1);
  assert.equal(altSellerStats.dispute_count, 0);

  const altArbiterStats = getUserRoleStats(ALT_ARBITER).find((item) => item.role === "arbiter");
  assert.ok(altArbiterStats);
  assert.equal(altArbiterStats.completed_deals_count, 1);
  assert.equal(altArbiterStats.dispute_count, 0);
});
