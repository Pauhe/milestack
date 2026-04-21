import assert from "node:assert/strict";
import test from "node:test";

import { deriveEscrowOverviewSemantics, deriveMilestoneSemantics } from "./escrow-semantics.js";
import { deriveActorRole, summarizeTimelineEvent } from "./indexer.js";

const baseEscrow = {
  current_milestone_index: 1,
  active_dispute_milestone_id: null,
};

test("deriveMilestoneSemantics makes sellerCanClaim strictly deadline-aware", () => {
  const milestone = { milestone_id: 1, status: 2, review_deadline: "200" };

  const beforeDeadline = deriveMilestoneSemantics(milestone, baseEscrow, 200);
  assert.equal(beforeDeadline.sellerCanClaim, false);
  assert.equal(beforeDeadline.sellerClaimBlockedReason, "Review window is still active");

  const afterDeadline = deriveMilestoneSemantics(milestone, baseEscrow, 201);
  assert.equal(afterDeadline.sellerCanClaim, true);
  assert.equal(afterDeadline.sellerClaimBlockedReason, null);
});

test("deriveMilestoneSemantics blocks unknown status, zero deadline, and non-current milestones", () => {
  const unknownStatus = deriveMilestoneSemantics({ milestone_id: 1, status: 999, review_deadline: "400" }, baseEscrow, 350);
  assert.equal(unknownStatus.buyerCanApprove, false);
  assert.equal(unknownStatus.buyerCanDispute, false);
  assert.equal(unknownStatus.sellerCanClaim, false);
  assert.equal(unknownStatus.buyerApprovalBlockedReason, "Milestone is not submitted");

  const zeroDeadline = deriveMilestoneSemantics({ milestone_id: 1, status: 2, review_deadline: "0" }, baseEscrow, 350);
  assert.equal(zeroDeadline.sellerCanClaim, false);
  assert.equal(zeroDeadline.sellerClaimBlockedReason, "Review deadline is unavailable");

  const nonCurrent = deriveMilestoneSemantics({ milestone_id: 0, status: 2, review_deadline: "100" }, baseEscrow, 200);
  assert.equal(nonCurrent.sellerCanClaim, false);
  assert.equal(nonCurrent.buyerCanApprove, false);
  assert.equal(nonCurrent.isCurrent, false);
  assert.equal(nonCurrent.buyerApprovalBlockedReason, "Milestone is not current");
});

test("deriveMilestoneSemantics keeps deadline boundary inclusive and null dispute id non-blocking", () => {
  const milestone = { milestone_id: 1, status: 2, review_deadline: "200" };

  const atBoundary = deriveMilestoneSemantics(milestone, {
    current_milestone_index: 1,
    active_dispute_milestone_id: null,
  }, 200);
  assert.equal(atBoundary.reviewWindowOpen, true);
  assert.equal(atBoundary.reviewWindowElapsed, false);
  assert.equal(atBoundary.buyerCanApprove, true);
  assert.equal(atBoundary.sellerCanClaim, false);

  const malformedDispute = deriveMilestoneSemantics(milestone, {
    current_milestone_index: 1,
    active_dispute_milestone_id: "not-a-number",
  }, 200);
  assert.equal(malformedDispute.disputeBlocksCurrentMilestone, false);
  assert.equal(malformedDispute.buyerCanApprove, true);
  assert.equal(malformedDispute.sellerCanClaim, false);
});

test("deriveMilestoneSemantics treats active disputes as non-actionable regardless of deadline", () => {
  const disputedEscrow = {
    current_milestone_index: 1,
    active_dispute_milestone_id: "1",
  };

  const semantics = deriveMilestoneSemantics({ milestone_id: 1, status: 2, review_deadline: "100" }, disputedEscrow, 200);
  assert.equal(semantics.buyerCanApprove, false);
  assert.equal(semantics.buyerCanDispute, false);
  assert.equal(semantics.sellerCanClaim, false);
  assert.equal(semantics.sellerClaimBlockedReason, "Deal has an active dispute on milestone 1");
  assert.equal(semantics.isBlocked, true);
  assert.equal(semantics.disputeBlocksCurrentMilestone, true);
});

test("deriveEscrowOverviewSemantics nulls nextActionableMilestoneId while dispute is active", () => {
  const withDispute = deriveEscrowOverviewSemantics({
    current_milestone_index: 2,
    active_dispute_milestone_id: "1",
  });
  assert.equal(withDispute.isBlockedByDispute, true);
  assert.equal(withDispute.activeDisputeMilestoneId, 1);
  assert.equal(withDispute.nextActionableMilestoneId, null);

  const withoutDispute = deriveEscrowOverviewSemantics({
    current_milestone_index: 2,
    active_dispute_milestone_id: null,
  });
  assert.equal(withoutDispute.isBlockedByDispute, false);
  assert.equal(withoutDispute.nextActionableMilestoneId, 2);
});

test("timeline summary avoids falsely attributing every payout to seller timeout", () => {
  const approvalPath = summarizeTimelineEvent("MilestoneClaimed", {
    payload: { milestoneId: "0" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(approvalPath, "Milestone payout finalized after buyer approval");

  const ambiguousPath = summarizeTimelineEvent("MilestoneClaimed", {
    payload: { milestoneId: "0" },
    previousEventName: "MilestoneSubmitted",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(ambiguousPath, "Milestone payout finalized (approval or seller timeout claim remains ambiguous)");

  const adjacentButDifferentMilestone = summarizeTimelineEvent("MilestoneClaimed", {
    payload: { milestoneId: "1" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(adjacentButDifferentMilestone, "Milestone payout finalized (approval or seller timeout claim remains ambiguous)");
});

test("actor role for MilestoneClaimed depends on proven adjacent approval context", () => {
  const approvalClaimActor = deriveActorRole("MilestoneClaimed", {
    payload: { milestoneId: "0" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(approvalClaimActor, "buyer");

  const timeoutClaimActor = deriveActorRole("MilestoneClaimed", {
    payload: { milestoneId: "0" },
    previousEventName: "MilestoneSubmitted",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(timeoutClaimActor, null);

  const adjacentButDifferentMilestoneActor = deriveActorRole("MilestoneClaimed", {
    payload: { milestoneId: "1" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(adjacentButDifferentMilestoneActor, null);
});
