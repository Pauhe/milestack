import type { MilestoneActionSemantics, MilestoneRole } from "@/lib/milestone-semantics";

export type ActionPanelGuidanceInput = {
  role: MilestoneRole;
  isConnected: boolean;
  isWrongChain: boolean;
  hasCurrentMilestone: boolean;
  semantics: MilestoneActionSemantics | null;
  disputeRouteHref?: string | null;
};

export type ActionPanelGuidance = {
  nextStepLabel: string;
  nextStepMessage: string;
  blockedReason: string | null;
  wrongChainMessage: string | null;
  claimAfterTimeoutHint: string | null;
  disputeRoute: {
    href: string;
    label: string;
  } | null;
};

export type DisputeResolutionGuidanceInput = {
  role: MilestoneRole;
  isConnected: boolean;
  isWrongChain: boolean;
  isBusy: boolean;
  milestoneStatus: number;
  milestoneId: bigint;
  activeDisputeMilestoneId?: bigint | null;
  hasValidBuyerAward: boolean;
  hasValidSellerAward: boolean;
  isExactSplit: boolean;
};

export type DisputeResolutionGuidance = {
  canSubmitResolution: boolean;
  blockedReason: string | null;
  wrongChainMessage: string | null;
  splitMessage: string;
};

export function deriveActionPanelGuidance(input: ActionPanelGuidanceInput): ActionPanelGuidance {
  const wrongChainMessage = input.isWrongChain
    ? "Switch to Base Sepolia to perform contract actions."
    : null;

  if (!input.hasCurrentMilestone) {
    return {
      nextStepLabel: "Next step",
      nextStepMessage:
        "Current milestone data is unavailable. Keep actions blocked until live contract state and backend-derived eligibility are loaded.",
      blockedReason: "No current milestone data is available for this escrow.",
      wrongChainMessage,
      claimAfterTimeoutHint: null,
      disputeRoute: null,
    };
  }

  if (!input.isConnected) {
    return {
      nextStepLabel: "Next step",
      nextStepMessage: "Connect a wallet to reveal buyer, seller, or arbiter actions.",
      blockedReason: "Wallet connection is required before role-specific actions are available.",
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics?.claimAfterTimeoutHint ?? null,
      disputeRoute: null,
    };
  }

  if (!input.semantics) {
    return {
      nextStepLabel: "Next step",
      nextStepMessage:
        "Action eligibility is unavailable because milestone semantics could not be derived. Keep actions blocked until backend truth reloads.",
      blockedReason:
        "Milestone action eligibility is unavailable. Refresh once backend-derived state is available.",
      wrongChainMessage,
      claimAfterTimeoutHint: null,
      disputeRoute: null,
    };
  }

  if (input.semantics.canFund) {
    return {
      nextStepLabel: "Buyer action",
      nextStepMessage: "Fund this milestone to move it into seller-submittable state.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canSubmit) {
    return {
      nextStepLabel: "Seller action",
      nextStepMessage: "Submit an evidence hash to begin the buyer review window.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canApprove && input.semantics.canDispute) {
    return {
      nextStepLabel: "Buyer action",
      nextStepMessage:
        "Choose the milestone outcome: approve payout or open a dispute during the review window.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canApprove) {
    return {
      nextStepLabel: "Buyer action",
      nextStepMessage: "Approve this submitted milestone to release payout.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canDispute) {
    return {
      nextStepLabel: "Buyer action",
      nextStepMessage: "Open a dispute for arbiter resolution before the review window expires.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canClaimAfterTimeout) {
    return {
      nextStepLabel: "Seller action",
      nextStepMessage: "Claim payout now that the buyer review window has elapsed.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: null,
    };
  }

  if (input.semantics.canResolveDispute) {
    if (!input.disputeRouteHref) {
      return {
        nextStepLabel: "Arbiter action",
        nextStepMessage:
          "This dispute is eligible for arbiter resolution, but the dispute route target is missing.",
        blockedReason:
          "Dispute resolution route is unavailable. Refresh from a milestone/dispute page with a concrete milestone id.",
        wrongChainMessage,
        claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
        disputeRoute: null,
      };
    }

    return {
      nextStepLabel: "Arbiter action",
      nextStepMessage: "Open dispute resolution and submit the exact buyer/seller split.",
      blockedReason: null,
      wrongChainMessage,
      claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
      disputeRoute: {
        href: input.disputeRouteHref,
        label: "Open dispute resolution",
      },
    };
  }

  return {
    nextStepLabel: "Next step",
    nextStepMessage: input.semantics.blockedReason,
    blockedReason: input.semantics.blockedReason,
    wrongChainMessage,
    claimAfterTimeoutHint: input.semantics.claimAfterTimeoutHint,
    disputeRoute: null,
  };
}

export function deriveDisputeResolutionGuidance(
  input: DisputeResolutionGuidanceInput
): DisputeResolutionGuidance {
  const wrongChainMessage = input.isWrongChain
    ? "Switch to Base Sepolia to submit a dispute resolution transaction."
    : null;

  const splitMessage = (() => {
    if (!input.hasValidBuyerAward || !input.hasValidSellerAward) {
      return "Enter valid USDC amounts with up to 6 decimal places.";
    }

    if (!input.isExactSplit) {
      return "Buyer and seller awards must sum exactly to the milestone amount.";
    }

    return "The split matches the milestone amount exactly.";
  })();

  if (!input.isConnected) {
    return {
      canSubmitResolution: false,
      blockedReason: "Connect the designated arbiter wallet to resolve this dispute.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (input.role !== "arbiter") {
    return {
      canSubmitResolution: false,
      blockedReason: "Only the designated arbiter can submit a dispute resolution.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (input.milestoneStatus !== 5) {
    return {
      canSubmitResolution: false,
      blockedReason: "Resolution is unavailable because this milestone is not in disputed status.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (
    input.activeDisputeMilestoneId !== null
    && input.activeDisputeMilestoneId !== undefined
    && input.activeDisputeMilestoneId !== input.milestoneId
  ) {
    return {
      canSubmitResolution: false,
      blockedReason: "Another milestone is marked as the active dispute target. Refresh route context before resolving.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (input.isWrongChain) {
    return {
      canSubmitResolution: false,
      blockedReason: "Resolution is blocked until the connected wallet is on Base Sepolia.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (!input.hasValidBuyerAward || !input.hasValidSellerAward || !input.isExactSplit) {
    return {
      canSubmitResolution: false,
      blockedReason: "Resolution stays blocked until the buyer/seller split is valid and exact.",
      wrongChainMessage,
      splitMessage,
    };
  }

  if (input.isBusy) {
    return {
      canSubmitResolution: false,
      blockedReason: "A resolution transaction is pending confirmation.",
      wrongChainMessage,
      splitMessage,
    };
  }

  return {
    canSubmitResolution: true,
    blockedReason: null,
    wrongChainMessage,
    splitMessage,
  };
}
