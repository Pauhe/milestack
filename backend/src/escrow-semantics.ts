import type { EscrowRow, MilestoneRow } from "./repository.js";

const MILESTONE_STATUS_SUBMITTED = 2;

type NullableNumber = number | null;

function parseNonNegativeInteger(value: string | number | null | undefined): NullableNumber {
  if (value === null || value === undefined) return null;

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return null;

  return numeric;
}

function activeDisputeId(escrow: Pick<EscrowRow, "active_dispute_milestone_id">): NullableNumber {
  return parseNonNegativeInteger(escrow.active_dispute_milestone_id);
}

export function deriveEscrowOverviewSemantics(
  escrow: Pick<EscrowRow, "current_milestone_index" | "active_dispute_milestone_id">
) {
  const currentMilestoneIndex = parseNonNegativeInteger(escrow.current_milestone_index) ?? 0;
  const disputeMilestoneId = activeDisputeId(escrow);

  return {
    isBlockedByDispute: disputeMilestoneId !== null,
    activeDisputeMilestoneId: disputeMilestoneId,
    nextActionableMilestoneId: disputeMilestoneId === null ? currentMilestoneIndex : null,
  };
}

export function deriveMilestoneSemantics(
  milestone: Pick<MilestoneRow, "milestone_id" | "status" | "review_deadline">,
  escrow: Pick<EscrowRow, "current_milestone_index" | "active_dispute_milestone_id">,
  nowUnixSeconds: number
) {
  const milestoneId = parseNonNegativeInteger(milestone.milestone_id) ?? -1;
  const currentMilestoneIndex = parseNonNegativeInteger(escrow.current_milestone_index) ?? -2;
  const disputeMilestoneId = activeDisputeId(escrow);

  const status = parseNonNegativeInteger(milestone.status);
  const statusKnown = status !== null;
  const isSubmitted = status === MILESTONE_STATUS_SUBMITTED;
  const isCurrent = milestoneId === currentMilestoneIndex;

  const reviewDeadline = parseNonNegativeInteger(milestone.review_deadline);
  const reviewDeadlineValid = reviewDeadline !== null && reviewDeadline > 0;
  const reviewWindowElapsed = reviewDeadlineValid && nowUnixSeconds > reviewDeadline;
  const reviewWindowOpen = reviewDeadlineValid && nowUnixSeconds <= reviewDeadline;

  const hasActiveDispute = disputeMilestoneId !== null;
  const disputeBlocksCurrentMilestone = hasActiveDispute && disputeMilestoneId === currentMilestoneIndex;
  const isBlocked = !isCurrent || hasActiveDispute;

  const buyerCanApprove = isSubmitted && isCurrent && !hasActiveDispute && reviewWindowOpen;
  const buyerCanDispute = isSubmitted && isCurrent && !hasActiveDispute && reviewWindowOpen;
  const sellerCanClaim = isSubmitted && isCurrent && !hasActiveDispute && reviewWindowElapsed;

  const buyerBlockedReason = deriveBuyerBlockedReason({
    statusKnown,
    isSubmitted,
    isCurrent,
    hasActiveDispute,
    disputeMilestoneId,
    reviewDeadlineValid,
    reviewWindowElapsed,
  });

  const sellerBlockedReason = deriveSellerBlockedReason({
    statusKnown,
    isSubmitted,
    isCurrent,
    hasActiveDispute,
    disputeMilestoneId,
    reviewDeadlineValid,
    reviewWindowElapsed,
  });

  return {
    isCurrent,
    isBlocked,
    statusKnown,
    reviewDeadlineValid,
    reviewWindowElapsed,
    reviewWindowOpen,
    disputeBlocksCurrentMilestone,
    buyerCanApprove,
    buyerCanDispute,
    sellerCanClaim,
    buyerApprovalBlockedReason: buyerCanApprove ? null : buyerBlockedReason,
    buyerDisputeBlockedReason: buyerCanDispute ? null : buyerBlockedReason,
    sellerClaimBlockedReason: sellerCanClaim ? null : sellerBlockedReason,
  };
}

function deriveBuyerBlockedReason(input: {
  statusKnown: boolean;
  isSubmitted: boolean;
  isCurrent: boolean;
  hasActiveDispute: boolean;
  disputeMilestoneId: NullableNumber;
  reviewDeadlineValid: boolean;
  reviewWindowElapsed: boolean;
}) {
  if (!input.statusKnown) return "Milestone status is unknown";
  if (!input.isSubmitted) return "Milestone is not submitted";
  if (!input.isCurrent) return "Milestone is not current";
  if (input.hasActiveDispute) {
    return input.disputeMilestoneId === null
      ? "Deal has an active dispute"
      : `Deal has an active dispute on milestone ${input.disputeMilestoneId}`;
  }
  if (!input.reviewDeadlineValid) return "Review deadline is unavailable";
  if (input.reviewWindowElapsed) return "Review window has ended";
  return "Action is currently unavailable";
}

function deriveSellerBlockedReason(input: {
  statusKnown: boolean;
  isSubmitted: boolean;
  isCurrent: boolean;
  hasActiveDispute: boolean;
  disputeMilestoneId: NullableNumber;
  reviewDeadlineValid: boolean;
  reviewWindowElapsed: boolean;
}) {
  if (!input.statusKnown) return "Milestone status is unknown";
  if (!input.isSubmitted) return "Milestone is not submitted";
  if (!input.isCurrent) return "Milestone is not current";
  if (input.hasActiveDispute) {
    return input.disputeMilestoneId === null
      ? "Deal has an active dispute"
      : `Deal has an active dispute on milestone ${input.disputeMilestoneId}`;
  }
  if (!input.reviewDeadlineValid) return "Review deadline is unavailable";
  if (!input.reviewWindowElapsed) return "Review window is still active";
  return "Action is currently unavailable";
}
