import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EscrowOverview } from "@/lib/contracts/milestone-escrow";
import { deriveBatchFundingGuidance } from "@/lib/batch-funding-guidance";

function baseOverview(): EscrowOverview {
  return {
    address: "0x1111111111111111111111111111111111111111",
    buyer: "0x2222222222222222222222222222222222222222",
    seller: "0x3333333333333333333333333333333333333333",
    arbiter: "0x4444444444444444444444444444444444444444",
    token: "0x5555555555555555555555555555555555555555",
    metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    dealStatus: 1,
    currentMilestoneIndex: 1n,
    activeDisputeMilestoneId: 2n,
    totalFunded: 1_000_000n,
    totalReleasedToSeller: 0n,
    totalRefundedToBuyer: 0n,
    totalFeesCollected: 0n,
    milestoneCount: 4n,
    currentMilestone: {
      amount: 1_000_000n,
      status: 0,
      reviewWindowSeconds: 86400,
      submittedAt: 0n,
      reviewDeadline: 0n,
      evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      disputeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      buyerAward: 0n,
      sellerAward: 0n,
    },
  };
}

describe("batch funding guidance", () => {
  it("enables batch funding when current milestone can fund and multiple pending milestones remain", () => {
    const guidance = deriveBatchFundingGuidance({
      overview: baseOverview(),
      canFundCurrentMilestone: true,
    });

    expect(guidance.canShowBatchFundAction).toBe(true);
    expect(guidance.summary).toContain("all remaining pending milestones");
    expect(guidance.remainingPendingCount).toBe(3);
  });

  it("blocks batch funding when current-funding eligibility is blocked", () => {
    const guidance = deriveBatchFundingGuidance({
      overview: baseOverview(),
      canFundCurrentMilestone: false,
    });

    expect(guidance.canShowBatchFundAction).toBe(false);
    expect(guidance.blockedReason).toContain("blocked");
  });

  it("keeps guidance conservative for malformed milestone counts", () => {
    const malformed = {
      ...baseOverview(),
      milestoneCount: 0n,
    };

    const guidance = deriveBatchFundingGuidance({
      overview: malformed,
      canFundCurrentMilestone: true,
    });

    expect(guidance.canShowBatchFundAction).toBe(false);
    expect(guidance.blockedReason).toContain("remaining milestone counts are unavailable");
  });

  it("suppresses batch action when only one pending milestone remains", () => {
    const singleRemaining = {
      ...baseOverview(),
      currentMilestoneIndex: 3n,
      milestoneCount: 4n,
    };

    const guidance = deriveBatchFundingGuidance({
      overview: singleRemaining,
      canFundCurrentMilestone: true,
    });

    expect(guidance.canShowBatchFundAction).toBe(false);
    expect(guidance.blockedReason).toContain("Only one pending milestone remains");
  });

  it("keeps batch action blocked once current milestone is no longer pending", () => {
    const nonPending = {
      ...baseOverview(),
      currentMilestone: {
        ...baseOverview().currentMilestone!,
        status: 1,
      },
    };

    const guidance = deriveBatchFundingGuidance({
      overview: nonPending,
      canFundCurrentMilestone: true,
    });

    expect(guidance.canShowBatchFundAction).toBe(false);
    expect(guidance.blockedReason).toContain("pending funding status");
  });

  it("consumes indexed milestone statuses conservatively when provided", () => {
    const guidance = deriveBatchFundingGuidance({
      overview: baseOverview(),
      canFundCurrentMilestone: true,
      indexedMilestones: [
        {
          escrow_address: baseOverview().address,
          milestone_id: 1,
          amount: "1000000",
          status: 0,
          review_window_seconds: 86400,
          submitted_at: "0",
          review_deadline: "0",
          evidence_hash: "0x",
          dispute_hash: "0x",
          buyer_award: "0",
          seller_award: "0",
          metadata_title: null,
          metadata_description: null,
        },
        {
          escrow_address: baseOverview().address,
          milestone_id: 2,
          amount: "1000000",
          status: 1,
          review_window_seconds: 86400,
          submitted_at: "0",
          review_deadline: "0",
          evidence_hash: "0x",
          dispute_hash: "0x",
          buyer_award: "0",
          seller_award: "0",
          metadata_title: null,
          metadata_description: null,
        },
      ],
    });

    expect(guidance.canShowBatchFundAction).toBe(true);
    expect(guidance.remainingPendingCount).toBe(2);
  });

  it("renders the exact conservative CTA wording used by action surfaces", () => {
    const html = renderToStaticMarkup(<p>{deriveBatchFundingGuidance({ overview: baseOverview(), canFundCurrentMilestone: true }).summary}</p>);

    expect(html).toContain("all remaining pending milestones");
  });
});
