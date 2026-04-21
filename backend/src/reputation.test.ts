import assert from "node:assert/strict";
import test from "node:test";

import { db } from "./db.js";
import { recomputeUserRoleStats } from "./reputation.js";
import { getUserRoleStats } from "./repository.js";

const BUYER = "0xbuyer000000000000000000000000000000000001";
const SELLER = "0xseller00000000000000000000000000000000001";
const ARBITER = "0xarbiter000000000000000000000000000000001";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

test("recomputeUserRoleStats derives buyer and seller stats from persisted rows", () => {
  db.exec("DELETE FROM user_role_stats;");
  db.exec("DELETE FROM milestones;");
  db.exec("DELETE FROM escrows;");

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
    `
  ).run(
    "0xescrow1",
    BUYER,
    SELLER,
    ARBITER,
    "0xusdc",
    ZERO_HASH,
    2,
    2,
    1,
    null,
    "3000000000",
    "990000000",
    "400000000",
    "10000000",
    "1",
    "1"
  );

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
    `
  ).run(
    "0xescrow1",
    0,
    "1000000000",
    7,
    432000,
    "1",
    "2",
    ZERO_HASH,
    ZERO_HASH,
    "1000000000",
    "0",
    "Wireframes",
    "Initial delivery"
  );

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
    `
  ).run(
    "0xescrow1",
    1,
    "2000000000",
    7,
    432000,
    "3",
    "4",
    ZERO_HASH,
    "0xdispute",
    "400000000",
    "600000000",
    "Build",
    "Final implementation"
  );

  recomputeUserRoleStats("100");

  const stats = getUserRoleStats(BUYER);
  const buyerStats = stats.find((item) => item.role === "buyer");
  assert.ok(buyerStats);
  assert.equal(buyerStats.completed_deals_count, 1);
  assert.equal(buyerStats.dispute_count, 1);

  const sellerStats = getUserRoleStats(SELLER).find((item) => item.role === "seller");
  assert.ok(sellerStats);
  assert.equal(sellerStats.completed_deals_count, 1);
  assert.equal(sellerStats.completed_milestones_count, 1);
  assert.equal(sellerStats.dispute_wins_count, 1);
});

test("recomputeUserRoleStats does not overcount dispute wins without dispute context", () => {
  db.exec("DELETE FROM user_role_stats;");
  db.exec("DELETE FROM milestones;");
  db.exec("DELETE FROM escrows;");

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
    `
  ).run(
    "0xescrow2",
    BUYER,
    SELLER,
    ARBITER,
    "0xusdc",
    ZERO_HASH,
    3,
    1,
    2,
    null,
    "3000000000",
    "1900000000",
    "0",
    "10000000",
    "1",
    "1"
  );

  const insertMilestone = db.prepare(
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
    `
  );

  insertMilestone.run(
    "0xescrow2",
    0,
    "1000000000",
    7,
    432000,
    "1",
    "2",
    ZERO_HASH,
    ZERO_HASH,
    "0",
    "1000000000",
    "Milestone 0",
    "Approved payout"
  );

  insertMilestone.run(
    "0xescrow2",
    1,
    "1000000000",
    7,
    432000,
    "3",
    "4",
    ZERO_HASH,
    ZERO_HASH,
    "100000000",
    "900000000",
    "Milestone 1",
    "No dispute hash, so no dispute win"
  );

  insertMilestone.run(
    "0xescrow2",
    2,
    "1000000000",
    5,
    432000,
    "5",
    "6",
    ZERO_HASH,
    "0xdispute-open",
    "100000000",
    "900000000",
    "Milestone 2",
    "Dispute open but unresolved"
  );

  recomputeUserRoleStats("101");

  const buyerStats = getUserRoleStats(BUYER).find((item) => item.role === "buyer");
  assert.ok(buyerStats);
  assert.equal(buyerStats.dispute_count, 1);

  const sellerStats = getUserRoleStats(SELLER).find((item) => item.role === "seller");
  assert.ok(sellerStats);
  assert.equal(sellerStats.completed_milestones_count, 2);
  assert.equal(sellerStats.dispute_wins_count, 0);
});
