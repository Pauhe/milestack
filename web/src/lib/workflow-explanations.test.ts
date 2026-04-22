import { describe, expect, it } from "vitest";

import type { BackendFreshnessAssessment } from "@/lib/backend";
import { deriveMilestoneActionSemantics } from "@/lib/milestone-semantics";
import { deriveActionPanelGuidance } from "@/lib/workflow-guidance";
import {
  getActionAuthorityExplanationCopy,
  getArbiterTrustExplanationCopy,
  getDealOverviewTrustExplanationCopy,
  getDisputeAuthorityExplanationCopy,
  getDisputeFinalityExplanationCopy,
  getFreshnessExplanationCopy,
  getReviewDeadlineExplanationCopy,
  getRouteGuidanceWithFreshnessOverlay,
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

  it("keeps non-claim events conservative when timeline truth note is missing", () => {
    const copy = getTimelineTruthExplanationCopy({
      truthNote: null,
      eventType: "MilestoneDisputed",
    });

    expect(copy).toContain("unavailable");
    expect(copy).toContain("conservative");
  });
});

describe("getDealOverviewTrustExplanationCopy", () => {
  it("always keeps live contract reads canonical", () => {
    const copy = getDealOverviewTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment(),
      hasIndexedMilestones: true,
      hasIndexedTimeline: true,
    });

    expect(copy.liveContractSummary).toContain("read live");
    expect(copy.liveContractSummary).toContain("canonical");
  });

  it("keeps indexed summary conservative when freshness is stale", () => {
    const copy = getDealOverviewTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment({
        state: "stale",
        degraded: true,
        lagBlocks: "9",
      }),
      hasIndexedMilestones: true,
      hasIndexedTimeline: true,
    });

    expect(copy.indexedDataSummary).toContain("stale");
    expect(copy.indexedDataSummary).toContain("lag: 9 blocks");
    expect(copy.indexedDataSummary).toContain("conservative");
  });

  it("returns explicit timeline fallback when indexed timeline is missing", () => {
    const copy = getDealOverviewTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment({ state: "unavailable", degraded: true }),
      hasIndexedMilestones: false,
      hasIndexedTimeline: false,
    });

    expect(copy.timelineSummary).toContain("No indexed timeline entries");
    expect(copy.timelineSummary).toContain("unavailable");
  });

  it("keeps timeline framing conservative when milestone context is missing", () => {
    const copy = getDealOverviewTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment(),
      hasIndexedMilestones: false,
      hasIndexedTimeline: true,
    });

    expect(copy.timelineSummary).toContain("milestone list context is missing");
    expect(copy.timelineSummary).toContain("conservative");
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

describe("getRouteGuidanceWithFreshnessOverlay", () => {
  it("leaves healthy guidance unchanged", () => {
    const guidance = deriveActionPanelGuidance({
      role: "buyer",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics: deriveMilestoneActionSemantics({
        role: "buyer",
        status: 2,
        milestoneId: 1,
        currentMilestoneIndex: 1,
        derived: {
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: true,
          buyerCanDispute: true,
          sellerCanClaim: false,
        },
      }),
    });

    const output = getRouteGuidanceWithFreshnessOverlay({
      guidance,
      freshnessAssessment: makeFreshnessAssessment(),
      defaultBlockedReason: "fallback",
    });

    expect(output).toEqual(guidance);
  });

  it("adds conservative overlay + fallback blocked reason on malformed freshness", () => {
    const guidance = deriveActionPanelGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics: deriveMilestoneActionSemantics({
        role: "arbiter",
        status: 5,
        milestoneId: 2,
        currentMilestoneIndex: 2,
        activeDisputeMilestoneId: 2,
      }),
    });

    const output = getRouteGuidanceWithFreshnessOverlay({
      guidance: {
        ...guidance,
        blockedReason: null,
      },
      freshnessAssessment: {
        ...makeFreshnessAssessment(),
        state: "mystery-state",
      } as unknown as BackendFreshnessAssessment,
      defaultBlockedReason: "Backend freshness degraded fallback reason.",
    });

    expect(output.nextStepMessage).toContain("Backend freshness is unavailable");
    expect(output.blockedReason).toBe("Backend freshness degraded fallback reason.");
  });

  it("does not duplicate overlay suffix when already present", () => {
    const suffix = "Backend freshness is stale; keep actions conservative until indexed eligibility recovers.";
    const guidance = {
      ...deriveActionPanelGuidance({
        role: "seller",
        isConnected: true,
        isWrongChain: false,
        hasCurrentMilestone: true,
        semantics: deriveMilestoneActionSemantics({
          role: "seller",
          status: 2,
          milestoneId: 3,
          currentMilestoneIndex: 3,
          derived: {
            isCurrent: true,
            isBlocked: true,
            buyerCanApprove: false,
            buyerCanDispute: false,
            sellerCanClaim: false,
          },
        }),
      }),
      nextStepMessage: `Original guidance. ${suffix}`,
    };

    const output = getRouteGuidanceWithFreshnessOverlay({
      guidance,
      freshnessAssessment: makeFreshnessAssessment({ state: "stale", degraded: true }),
      defaultBlockedReason: "fallback",
    });

    expect(output.nextStepMessage).toBe(`Original guidance. ${suffix}`);
  });
});

describe("dispute authority/finality explanations", () => {
  it("keeps dispute authority conservative when freshness is unavailable", () => {
    const copy = getDisputeAuthorityExplanationCopy({
      arbiterGuidance: {
        canSubmitResolution: false,
        blockedReason: "Connect the designated arbiter wallet to resolve this dispute.",
      },
      visitorGuidance: {
        blockedReason: "Only the designated arbiter can submit a dispute resolution.",
      },
      freshnessAssessment: makeFreshnessAssessment({
        state: "unavailable",
        degraded: true,
      }),
    });

    expect(copy).toContain("conservative");
    expect(copy).toContain("designated arbiter");
  });

  it("uses blocked guidance for arbiter-only authority when freshness is healthy", () => {
    const copy = getDisputeAuthorityExplanationCopy({
      arbiterGuidance: {
        canSubmitResolution: false,
        blockedReason: "Resolution is unavailable because this milestone is not in disputed status.",
      },
      visitorGuidance: {
        blockedReason: "Only the designated arbiter can submit a dispute resolution.",
      },
      freshnessAssessment: makeFreshnessAssessment(),
    });

    expect(copy).toContain("Arbiter-only authority applies");
    expect(copy).toContain("not in disputed status");
  });

  it("marks dispute finality as pending when arbiter guidance is blocked", () => {
    const copy = getDisputeFinalityExplanationCopy({
      disputeGuidance: {
        canSubmitResolution: false,
        blockedReason: "Another milestone is marked as the active dispute target. Refresh route context before resolving.",
      },
      freshnessAssessment: makeFreshnessAssessment(),
    });

    expect(copy).toContain("pending");
    expect(copy).toContain("active dispute target");
  });

  it("degrades finality copy when freshness is stale", () => {
    const copy = getDisputeFinalityExplanationCopy({
      disputeGuidance: {
        canSubmitResolution: true,
        blockedReason: null,
      },
      freshnessAssessment: makeFreshnessAssessment({ state: "stale", degraded: true }),
    });

    expect(copy).toContain("conservative");
    expect(copy).toContain("stale");
  });
});

describe("getArbiterTrustExplanationCopy", () => {
  it("keeps arbiter trust copy conservative when freshness is degraded", () => {
    const copy = getArbiterTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment({ state: "stale", degraded: true }),
      truthState: "healthy",
      trustAssessment: {
        state: "degraded",
        message: "Arbiter trust metrics are currently degraded because backend freshness is stale.",
      },
      stats: {
        address: "0x4444444444444444444444444444444444444444",
        role: "arbiter",
        completedDealsCount: 3,
        completedMilestonesCount: 5,
        disputeCount: 2,
        disputeWinsCount: 0,
        disputeLossesCount: 0,
        resolvedDisputeCount: 2,
        unresolvedDisputeCount: 0,
        disputeSplitCount: 1,
        cancellationCount: 0,
        totalVolume: "1000000",
        updatedAtBlock: "100",
      },
    });

    expect(copy).toContain("conservative");
    expect(copy).toContain("stale");
  });

  it("returns healthy informational framing when trust signals are valid", () => {
    const copy = getArbiterTrustExplanationCopy({
      freshnessAssessment: makeFreshnessAssessment(),
      truthState: "healthy",
      trustAssessment: {
        state: "healthy",
        message: "Arbiter trust metrics are backend-derived and informational only (not settlement-authoritative).",
      },
      stats: {
        address: "0x4444444444444444444444444444444444444444",
        role: "arbiter",
        completedDealsCount: 3,
        completedMilestonesCount: 5,
        disputeCount: 2,
        disputeWinsCount: 0,
        disputeLossesCount: 0,
        resolvedDisputeCount: 2,
        unresolvedDisputeCount: 0,
        disputeSplitCount: 1,
        cancellationCount: 0,
        totalVolume: "1000000",
        updatedAtBlock: "100",
      },
    });

    expect(copy).toContain("inform reputation history");
    expect(copy).toContain("never change arbiter-only dispute authority");
  });
});
