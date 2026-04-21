import { describe, expect, it } from "vitest";

import {
  deriveMilestoneActionSemantics,
  getMilestoneStatusSemanticLabel,
} from "@/lib/milestone-semantics";

describe("getMilestoneStatusSemanticLabel", () => {
  it("does not present Claimable and Resolved as durable runtime labels", () => {
    expect(getMilestoneStatusSemanticLabel(4)).toBe("Concept-only state (Claimable)");
    expect(getMilestoneStatusSemanticLabel(6)).toBe("Concept-only state (Resolved)");
  });

  it("returns Unknown for unsupported status values", () => {
    expect(getMilestoneStatusSemanticLabel(999)).toBe("Unknown (999)");
  });
});

describe("deriveMilestoneActionSemantics", () => {
  it("keeps seller timeout claim unavailable before deadline even when status is Submitted", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 1,
      currentMilestoneIndex: 1,
      reviewDeadline: 2_000,
      nowUnixSeconds: 1_000,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    expect(semantics.canClaimAfterTimeout).toBe(false);
    expect(semantics.claimAfterTimeoutHint).toContain("unlocks after UNIX 2000");
    expect(semantics.hasAction).toBe(false);
  });

  it("allows seller timeout claim when backend eligibility says claim is available", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 3,
      currentMilestoneIndex: 3,
      reviewDeadline: 1_000,
      nowUnixSeconds: 2_000,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: true,
      },
    });

    expect(semantics.canClaimAfterTimeout).toBe(true);
    expect(semantics.claimAfterTimeoutHint).toBe("Review window elapsed. Timeout claim is available.");
    expect(semantics.hasAction).toBe(true);
  });

  it("hides submitted milestone actions when backend-derived eligibility is missing", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "buyer",
      status: 2,
      milestoneId: 0,
      currentMilestoneIndex: 0,
      reviewDeadline: 1_000,
      nowUnixSeconds: 1_100,
    });

    expect(semantics.canApprove).toBe(false);
    expect(semantics.canDispute).toBe(false);
    expect(semantics.blockedReason).toContain("backend-derived eligibility");
  });

  it("blocks actions for non-current milestones", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "buyer",
      status: 0,
      milestoneId: 0,
      currentMilestoneIndex: 1,
      derived: {
        isCurrent: false,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    expect(semantics.canFund).toBe(false);
    expect(semantics.blockedReason).toBe("Only the current milestone can be actioned.");
  });

  it("blocks actions when an active dispute blocks progression", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 1,
      milestoneId: 2,
      currentMilestoneIndex: 2,
      activeDisputeMilestoneId: 1,
      derived: {
        isCurrent: true,
        isBlocked: true,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    expect(semantics.canSubmit).toBe(false);
    expect(semantics.blockedReason).toBe("An active dispute is blocking normal milestone progression.");
  });

  it("returns conservative unknown/unavailable messaging for malformed deadline values", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 1,
      currentMilestoneIndex: 1,
      reviewDeadline: "not-a-number",
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    expect(semantics.canClaimAfterTimeout).toBe(false);
    expect(semantics.claimAfterTimeoutHint).toBe(
      "Timeout claim is unavailable because this milestone has no review deadline."
    );
  });

  it("requires disputed status for arbiter dispute resolution affordance", () => {
    const disputed = deriveMilestoneActionSemantics({
      role: "arbiter",
      status: 5,
      milestoneId: 4,
      currentMilestoneIndex: 4,
      activeDisputeMilestoneId: 4,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const nonDisputed = deriveMilestoneActionSemantics({
      role: "arbiter",
      status: 2,
      milestoneId: 4,
      currentMilestoneIndex: 4,
      activeDisputeMilestoneId: 4,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    expect(disputed.canResolveDispute).toBe(true);
    expect(nonDisputed.canResolveDispute).toBe(false);
  });
});
