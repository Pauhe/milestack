import { describe, expect, it } from "vitest";

import { deriveMilestoneActionSemantics } from "@/lib/milestone-semantics";
import {
  deriveActionPanelGuidance,
  deriveDisputeResolutionGuidance,
} from "@/lib/workflow-guidance";

describe("route-level workflow composition", () => {
  it("keeps overview guidance conservative when backend freshness is degraded", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "visitor",
      status: 2,
      milestoneId: 3,
      currentMilestoneIndex: 3,
      derived: null,
    });

    const baseGuidance = deriveActionPanelGuidance({
      role: "visitor",
      isConnected: false,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
      disputeRouteHref: "/deals/0xabc/disputes/3",
    });

    const freshnessState = "stale";
    const routeGuidance = {
      ...baseGuidance,
      nextStepMessage: `${baseGuidance.nextStepMessage} Backend freshness is ${freshnessState}; keep actions conservative until indexed eligibility recovers.`,
      blockedReason:
        baseGuidance.blockedReason
        ?? "Backend freshness is degraded; keep role actions blocked until backend-derived eligibility is available.",
    };

    expect(routeGuidance.nextStepMessage).toContain("Backend freshness is stale");
    expect(routeGuidance.blockedReason).toContain("Wallet connection is required");
  });

  it("keeps milestone route guidance linked to dispute resolution route without inventing semantics", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "visitor",
      status: 5,
      milestoneId: 8,
      currentMilestoneIndex: 8,
      activeDisputeMilestoneId: 8,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const guidance = deriveActionPanelGuidance({
      role: "visitor",
      isConnected: false,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
      disputeRouteHref: "/deals/0xabc/disputes/8",
    });

    expect(guidance.nextStepLabel).toBe("Next step");
    expect(guidance.nextStepMessage).toContain("Connect a wallet");
    expect(guidance.disputeRoute).toBeNull();
  });

  it("exposes explicit arbiter vs non-arbiter dispute-route blocked messaging", () => {
    const arbiterWalletMissing = deriveDisputeResolutionGuidance({
      role: "arbiter",
      isConnected: false,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 6n,
      activeDisputeMilestoneId: 6n,
      hasValidBuyerAward: false,
      hasValidSellerAward: false,
      isExactSplit: false,
    });

    const nonArbiter = deriveDisputeResolutionGuidance({
      role: "visitor",
      isConnected: false,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 6n,
      activeDisputeMilestoneId: 6n,
      hasValidBuyerAward: false,
      hasValidSellerAward: false,
      isExactSplit: false,
    });

    expect(arbiterWalletMissing.blockedReason).toContain("designated arbiter wallet");
    expect(nonArbiter.blockedReason).toContain("designated arbiter wallet");
    expect(nonArbiter.canSubmitResolution).toBe(false);
    expect(arbiterWalletMissing.canSubmitResolution).toBe(false);
  });
});

describe("deriveActionPanelGuidance", () => {
  it("returns conservative blocked messaging when current milestone is missing", () => {
    const guidance = deriveActionPanelGuidance({
      role: "buyer",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: false,
      semantics: null,
    });

    expect(guidance.blockedReason).toContain("No current milestone data");
    expect(guidance.nextStepMessage).toContain("Current milestone data is unavailable");
  });

  it("surfaces wrong-chain guidance without hiding role guidance", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "seller",
      status: 1,
      milestoneId: 2,
      currentMilestoneIndex: 2,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const guidance = deriveActionPanelGuidance({
      role: "seller",
      isConnected: true,
      isWrongChain: true,
      hasCurrentMilestone: true,
      semantics,
    });

    expect(guidance.nextStepLabel).toBe("Seller action");
    expect(guidance.nextStepMessage).toContain("Submit an evidence hash");
    expect(guidance.wrongChainMessage).toContain("Switch to Base Sepolia");
  });

  it("returns arbiter route affordance when dispute route target is resolvable", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "arbiter",
      status: 5,
      milestoneId: 3,
      currentMilestoneIndex: 3,
      activeDisputeMilestoneId: 3,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
    });

    const guidance = deriveActionPanelGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
      disputeRouteHref: "/deals/0xabc/disputes/3",
    });

    expect(guidance.disputeRoute).toEqual({
      href: "/deals/0xabc/disputes/3",
      label: "Open dispute resolution",
    });
    expect(guidance.blockedReason).toBeNull();
  });

  it("keeps arbiter state blocked when dispute route target is missing", () => {
    const semantics = deriveMilestoneActionSemantics({
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

    const guidance = deriveActionPanelGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
      disputeRouteHref: null,
    });

    expect(guidance.disputeRoute).toBeNull();
    expect(guidance.blockedReason).toContain("route is unavailable");
  });

  it("reuses conservative semantics-blocked reason when backend-derived actions are missing", () => {
    const semantics = deriveMilestoneActionSemantics({
      role: "buyer",
      status: 2,
      milestoneId: 1,
      currentMilestoneIndex: 1,
      reviewDeadline: 1_000,
      nowUnixSeconds: 1_100,
      derived: null,
    });

    const guidance = deriveActionPanelGuidance({
      role: "buyer",
      isConnected: true,
      isWrongChain: false,
      hasCurrentMilestone: true,
      semantics,
    });

    expect(guidance.blockedReason).toContain("backend-derived eligibility");
    expect(guidance.nextStepMessage).toContain("backend-derived eligibility");
  });
});

describe("deriveDisputeResolutionGuidance", () => {
  it("blocks non-arbiter wallets explicitly", () => {
    const guidance = deriveDisputeResolutionGuidance({
      role: "buyer",
      isConnected: true,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 2n,
      activeDisputeMilestoneId: 2n,
      hasValidBuyerAward: true,
      hasValidSellerAward: true,
      isExactSplit: true,
    });

    expect(guidance.canSubmitResolution).toBe(false);
    expect(guidance.blockedReason).toContain("Only the designated arbiter");
  });

  it("blocks when wallet is on the wrong chain", () => {
    const guidance = deriveDisputeResolutionGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: true,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 2n,
      activeDisputeMilestoneId: 2n,
      hasValidBuyerAward: true,
      hasValidSellerAward: true,
      isExactSplit: true,
    });

    expect(guidance.canSubmitResolution).toBe(false);
    expect(guidance.wrongChainMessage).toContain("Switch to Base Sepolia");
    expect(guidance.blockedReason).toContain("blocked until the connected wallet is on Base Sepolia");
  });

  it("blocks exact-split submission when awards are malformed", () => {
    const guidance = deriveDisputeResolutionGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 2n,
      activeDisputeMilestoneId: 2n,
      hasValidBuyerAward: false,
      hasValidSellerAward: true,
      isExactSplit: false,
    });

    expect(guidance.canSubmitResolution).toBe(false);
    expect(guidance.splitMessage).toContain("Enter valid USDC amounts");
    expect(guidance.blockedReason).toContain("split is valid and exact");
  });

  it("blocks resolution when active dispute milestone does not match route milestone", () => {
    const guidance = deriveDisputeResolutionGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 6n,
      activeDisputeMilestoneId: 5n,
      hasValidBuyerAward: true,
      hasValidSellerAward: true,
      isExactSplit: true,
    });

    expect(guidance.canSubmitResolution).toBe(false);
    expect(guidance.blockedReason).toContain("Another milestone is marked as the active dispute target");
  });

  it("allows arbiter resolution only when role, status, chain, and split are all valid", () => {
    const guidance = deriveDisputeResolutionGuidance({
      role: "arbiter",
      isConnected: true,
      isWrongChain: false,
      isBusy: false,
      milestoneStatus: 5,
      milestoneId: 6n,
      activeDisputeMilestoneId: 6n,
      hasValidBuyerAward: true,
      hasValidSellerAward: true,
      isExactSplit: true,
    });

    expect(guidance.canSubmitResolution).toBe(true);
    expect(guidance.blockedReason).toBeNull();
    expect(guidance.splitMessage).toContain("matches the milestone amount exactly");
  });
});
