import type { BackendMilestone } from "@/lib/backend";
import type { EscrowOverview } from "@/lib/contracts/milestone-escrow";

export type BatchFundingGuidance = {
  canShowBatchFundAction: boolean;
  blockedReason: string | null;
  summary: string;
  remainingPendingCount: number;
};

function deriveRemainingPendingCount(
  milestoneCount: number,
  currentMilestoneIndex: number,
  indexedMilestones?: readonly BackendMilestone[]
): number {
  if (
    !Number.isInteger(milestoneCount)
    || milestoneCount <= 0
    || !Number.isInteger(currentMilestoneIndex)
    || currentMilestoneIndex < 0
    || currentMilestoneIndex >= milestoneCount
  ) {
    return 0;
  }

  const fallbackCount = milestoneCount - currentMilestoneIndex;
  if (!indexedMilestones || indexedMilestones.length === 0) {
    return fallbackCount;
  }

  const indexedById = new Map<number, BackendMilestone>(
    indexedMilestones.map((item) => [item.milestone_id, item])
  );

  let count = 0;
  for (let milestoneId = currentMilestoneIndex; milestoneId < milestoneCount; milestoneId += 1) {
    const indexed = indexedById.get(milestoneId);
    const status = indexed?.status;

    if (status === undefined || status === 0) {
      count += 1;
    }
  }

  return count;
}

export function deriveBatchFundingGuidance(input: {
  overview: EscrowOverview;
  canFundCurrentMilestone: boolean;
  indexedMilestones?: readonly BackendMilestone[];
}): BatchFundingGuidance {
  const milestoneCount = Number(input.overview.milestoneCount);
  const currentMilestoneIndex = Number(input.overview.currentMilestoneIndex);

  if (!input.overview.currentMilestone) {
    return {
      canShowBatchFundAction: false,
      blockedReason: "Batch funding is unavailable until current milestone data is loaded.",
      summary: "Current milestone data is unavailable, so only conservative funding guidance is shown.",
      remainingPendingCount: 0,
    };
  }

  if (input.overview.currentMilestone.status !== 0) {
    return {
      canShowBatchFundAction: false,
      blockedReason: "Batch funding only applies while remaining milestones are still in pending funding status.",
      summary:
        "Current milestone is no longer pending funding, so funding guidance stays single-milestone only.",
      remainingPendingCount: 0,
    };
  }

  if (
    !Number.isInteger(milestoneCount)
    || milestoneCount <= 0
    || !Number.isInteger(currentMilestoneIndex)
    || currentMilestoneIndex < 0
    || currentMilestoneIndex >= milestoneCount
  ) {
    return {
      canShowBatchFundAction: false,
      blockedReason: "Batch funding is blocked because remaining milestone counts are unavailable.",
      summary: "Remaining pending milestone count is malformed, so batch funding stays blocked.",
      remainingPendingCount: 0,
    };
  }

  const remainingPendingCount = deriveRemainingPendingCount(
    milestoneCount,
    currentMilestoneIndex,
    input.indexedMilestones
  );

  if (remainingPendingCount <= 1) {
    return {
      canShowBatchFundAction: false,
      blockedReason: "Only one pending milestone remains, so batch funding is unnecessary.",
      summary:
        "Only the current pending milestone remains. Fund milestone is the truthful action.",
      remainingPendingCount,
    };
  }

  if (!input.canFundCurrentMilestone) {
    return {
      canShowBatchFundAction: false,
      blockedReason:
        "Batch funding remains blocked until the connected wallet can fund the current milestone.",
      summary:
        "Funding eligibility is currently blocked, so all remaining pending milestones stay explanatory-only.",
      remainingPendingCount,
    };
  }

  return {
    canShowBatchFundAction: true,
    blockedReason: null,
    summary: `Fund current milestone only, or fund all remaining pending milestones (${remainingPendingCount} total) in one transaction.`,
    remainingPendingCount,
  };
}
