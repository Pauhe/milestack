import { describe, expect, it } from "vitest";

import type { BackendFreshnessAssessment } from "@/lib/backend";
import { deriveMilestoneActionSemantics } from "@/lib/milestone-semantics";
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
import {
  getActionAuthorityExplanationCopy,
  getFreshnessExplanationCopy,
  getReviewDeadlineExplanationCopy,
  getTimelineTruthExplanationCopy,
} from "@/lib/workflow-explanations";

function makeFreshnessAssessment(
  overrides: Partial<BackendFreshnessAssessment> = {}
): BackendFreshnessAssessment {
  return {
    state: "healthy",
    degraded: false,
    lagBlocks: "0",
    status: "healthy",
    message: "Backend indexed data is fresh.",
    error: null,
    ...overrides,
  };
}

describe("getFreshnessExplanationCopy", () => {
  it("keeps malformed freshness payloads conservative", () => {
    const malformed = {
      ...makeFreshnessAssessment(),
      state: "mystery-state",
    } as unknown as BackendFreshnessAssessment;

    const copy = getFreshnessExplanationCopy(malformed, "deal");

    expect(copy).toContain("malformed");
    expect(copy).toContain("unavailable");
  });

  it("explains stale freshness with lag details", () => {
    const copy = getFreshnessExplanationCopy(
      makeFreshnessAssessment({ state: "stale", degraded: true, lagBlocks: "12" }),
      "milestone"
    );

    expect(copy).toContain("stale");
    expect(copy).toContain("12 blocks");
    expect(copy).toContain("conservative");
  });

  it("uses profile-specific fallback wording for unavailable freshness", () => {
    const copy = getFreshnessExplanationCopy(
      makeFreshnessAssessment({ state: "unavailable", degraded: true }),
      "profile"
    );

    expect(copy).toContain("unavailable");
    expect(copy).toContain("no direct onchain aggregate fallback");
  });
});

describe("getReviewDeadlineExplanationCopy", () => {
  it("returns conservative wording for missing review deadline", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 1,
      currentMilestoneIndex: 1,
      derived: null,
    });

    const copy = getReviewDeadlineExplanationCopy({
      reviewDeadline: null,
      milestoneStatus: 2,
      semantics,
      nowUnixSeconds: 1_000,
    });

    expect(copy).toContain("deadline is unavailable");
    expect(copy).toContain("conservative");
  });

  it("marks exact deadline boundary as semantics-dependent", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 2,
      currentMilestoneIndex: 2,
      reviewDeadline: 2_000,
      nowUnixSeconds: 2_000,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const copy = getReviewDeadlineExplanationCopy({
      reviewDeadline: 2_000,
      milestoneStatus: 2,
      semantics,
      nowUnixSeconds: 2_000,
    });

    expect(copy).toContain("Review deadline reached");
    expect(copy).toContain("depends on backend-derived claim semantics");
  });

  it("keeps disputed milestones tied to arbiter resolution", () => {
    const copy = getReviewDeadlineExplanationCopy({
      reviewDeadline: 2_000,
      milestoneStatus: 5,
      semantics: null,
      nowUnixSeconds: 3_000,
    });

    expect(copy).toContain("Milestone is disputed");
    expect(copy).toContain("arbiter resolution");
  });

  it("uses semantics hint when deadline elapsed but timeout remains blocked", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 2,
      milestoneId: 3,
      currentMilestoneIndex: 3,
      reviewDeadline: 1_000,
      nowUnixSeconds: 1_500,
      derived: {
        isCurrent: true,
        isBlocked: true,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const copy = getReviewDeadlineExplanationCopy({
      reviewDeadline: 1_000,
      milestoneStatus: 2,
      semantics,
      nowUnixSeconds: 1_500,
    });

    expect(copy).toContain("Review window elapsed");
    expect(copy).toContain("blocked by milestone or dispute conditions");
  });
});

describe("getTimelineTruthExplanationCopy", () => {
  it("keeps MilestoneClaimed narration ambiguous when truth note is missing", () => {
    const copy = getTimelineTruthExplanationCopy({
      truthNote: null,
      eventType: "MilestoneClaimed",
    });

    expect(copy).toContain("buyer approval payout or seller timeout claim");
    expect(copy).toContain("ambiguous");
  });

  it("returns backend truth note verbatim when present", () => {
    const copy = getTimelineTruthExplanationCopy({
      truthNote: "Truth note: claim-attribution-ambiguous.",
      eventType: "MilestoneClaimed",
    });

    expect(copy).toBe("Truth note: claim-attribution-ambiguous.");
  });
});

describe("getActionAuthorityExplanationCopy", () => {
  it("prefers workflow guidance blocked reason over other hints", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "buyer",
      status: 2,
      milestoneId: 1,
      currentMilestoneIndex: 1,
      reviewDeadline: 2_000,
      nowUnixSeconds: 1_000,
      derived: null,
    });

    const guidance = deriveActionPanelGuidance({
      role: "buyer",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
    });

    const copy = getActionAuthorityExplanationCopy({ guidance, semantics });

    expect(copy).toContain("backend-derived eligibility");
  });

  it("falls back to unavailable authority copy when inputs are null", () => {
    const copy = getActionAuthorityExplanationCopy({
      guidance: null,
      semantics: null,
    });

    expect(copy).toContain("currently unavailable");
  });
});
