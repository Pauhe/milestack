import type { BackendMilestone } from "@/lib/backend";

export type MilestoneRole = "buyer" | "seller" | "arbiter" | "visitor";

export type MilestoneSemanticsInput = {
  role: MilestoneRole;
  status: number;
  milestoneId: number;
  currentMilestoneIndex: number;
  activeDisputeMilestoneId?: number | null;
  reviewDeadline?: string | number | bigint | null;
  derived?: BackendMilestone["derived"] | null;
  nowUnixSeconds?: number;
};

export type MilestoneActionSemantics = {
  statusLabel: string;
  canFund: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canDispute: boolean;
  canClaimAfterTimeout: boolean;
  canResolveDispute: boolean;
  hasAction: boolean;
  blockedReason: string;
  claimAfterTimeoutHint: string | null;
};

function toUnixSeconds(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    if (value.length === 0) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }

  return Number.isFinite(value) ? value : null;
}

export function getMilestoneStatusSemanticLabel(status: number): string {
  switch (status) {
    case 0:
      return "Pending funding";
    case 1:
      return "Funded";
    case 2:
      return "Submitted";
    case 3:
      return "Approved (transient)";
    case 4:
      return "Concept-only state (Claimable)";
    case 5:
      return "Disputed";
    case 6:
      return "Concept-only state (Resolved)";
    case 7:
      return "Paid out";
    case 8:
      return "Refunded";
    case 9:
      return "Cancelled";
    default:
      return `Unknown (${status})`;
  }
}

export function deriveMilestoneActionSemantics(input: MilestoneSemanticsInput): MilestoneActionSemantics {
  const nowUnixSeconds = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const reviewDeadline = toUnixSeconds(input.reviewDeadline);
  const isCurrent = input.derived?.isCurrent ?? input.milestoneId === input.currentMilestoneIndex;
  const isBlockedByDispute = input.derived?.isBlocked ?? false;

  const isSubmitted = input.status === 2;
  const isDisputed = input.status === 5;

  const canFund = input.role === "buyer" && input.status === 0 && isCurrent && !isBlockedByDispute;
  const canSubmit = input.role === "seller" && input.status === 1 && isCurrent && !isBlockedByDispute;
  const canApprove = input.role === "buyer" && isSubmitted && isCurrent && Boolean(input.derived?.buyerCanApprove);
  const canDispute = input.role === "buyer" && isSubmitted && isCurrent && Boolean(input.derived?.buyerCanDispute);
  const canClaimAfterTimeout = input.role === "seller" && isSubmitted && isCurrent && Boolean(input.derived?.sellerCanClaim);
  const canResolveDispute = input.role === "arbiter"
    && isDisputed
    && isCurrent
    && (input.activeDisputeMilestoneId === null
      || input.activeDisputeMilestoneId === undefined
      || input.activeDisputeMilestoneId === input.milestoneId);

  const hasAction = [canFund, canSubmit, canApprove, canDispute, canClaimAfterTimeout, canResolveDispute].some(Boolean);

  const claimAfterTimeoutHint = (() => {
    if (input.role !== "seller" || !isSubmitted) return null;
    if (canClaimAfterTimeout) {
      return "Review window elapsed. Timeout claim is available.";
    }

    if (!input.derived) {
      return "Timeout claim is unavailable until backend eligibility is loaded.";
    }

    if (reviewDeadline === null || reviewDeadline <= 0) {
      return "Timeout claim is unavailable because this milestone has no review deadline.";
    }

    if (nowUnixSeconds <= reviewDeadline) {
      return `Timeout claim unlocks after UNIX ${reviewDeadline}.`;
    }

    return "Timeout claim is currently blocked by milestone or dispute conditions.";
  })();

  const blockedReason = (() => {
    if (hasAction) return "";
    if (input.role === "visitor") return "Connect a buyer, seller, or arbiter wallet to unlock role-specific actions.";
    if (!isCurrent) return "Only the current milestone can be actioned.";
    if (isBlockedByDispute) return "An active dispute is blocking normal milestone progression.";
    if (claimAfterTimeoutHint) return claimAfterTimeoutHint;
    if (isSubmitted && !input.derived) {
      return "Submitted milestone actions are hidden until backend-derived eligibility is available.";
    }

    return "No direct action is available for the connected role in this milestone state.";
  })();

  return {
    statusLabel: getMilestoneStatusSemanticLabel(input.status),
    canFund,
    canSubmit,
    canApprove,
    canDispute,
    canClaimAfterTimeout,
    canResolveDispute,
    hasAction,
    blockedReason,
    claimAfterTimeoutHint,
  };
}
