import { parseUnits } from "viem";

import { formatUsdc } from "@/lib/format";

export type FundingGuidanceMilestoneInput = {
  amount: string;
  reviewWindowDays: string;
};

export type FundingGuidanceSummary = {
  isAvailable: boolean;
  totalAmount: bigint;
  currentMilestoneAmount: bigint | null;
  remainingMilestonesAmount: bigint;
  milestoneAmounts: bigint[];
  minReviewWindowDays: number | null;
  maxReviewWindowDays: number | null;
  invalidReason: string | null;
  totalAmountLabel: string | null;
  currentMilestoneAmountLabel: string | null;
  remainingMilestonesAmountLabel: string | null;
  milestoneExposureLabel: string;
  reviewWindowGuidance: string;
  nextFundingGuidance: string;
};

const INVALID_SUMMARY: FundingGuidanceSummary = {
  isAvailable: false,
  totalAmount: 0n,
  currentMilestoneAmount: null,
  remainingMilestonesAmount: 0n,
  milestoneAmounts: [],
  minReviewWindowDays: null,
  maxReviewWindowDays: null,
  invalidReason: "Funding summary unavailable until each milestone has a valid USDC amount and review window.",
  totalAmountLabel: null,
  currentMilestoneAmountLabel: null,
  remainingMilestonesAmountLabel: null,
  milestoneExposureLabel: "Milestone exposure is unavailable until milestone amounts are valid.",
  reviewWindowGuidance: "Review-window guidance is unavailable until each milestone has a review window greater than zero days.",
  nextFundingGuidance:
    "Funding actions stay milestone-based after deployment. Buyers can fund the current milestone or batch fund remaining pending milestones when available.",
};

export function deriveFundingGuidanceSummary(
  milestones: readonly FundingGuidanceMilestoneInput[]
): FundingGuidanceSummary {
  if (milestones.length === 0) {
    return {
      ...INVALID_SUMMARY,
      invalidReason: "Funding summary unavailable until at least one milestone is configured.",
      reviewWindowGuidance: "Review-window guidance is unavailable until at least one milestone is configured.",
    };
  }

  const parsedMilestones = milestones.map((milestone) => {
    const amount = parseUsdcAmount(milestone.amount);
    const reviewWindowDays = parseReviewWindowDays(milestone.reviewWindowDays);

    return {
      amount,
      reviewWindowDays,
    };
  });

  const hasInvalidAmount = parsedMilestones.some((entry) => entry.amount === null || entry.amount <= 0n);
  const hasInvalidReviewWindow = parsedMilestones.some(
    (entry) => entry.reviewWindowDays === null || entry.reviewWindowDays <= 0
  );

  if (hasInvalidAmount || hasInvalidReviewWindow) {
    return INVALID_SUMMARY;
  }

  const milestoneAmounts = parsedMilestones.map((entry) => entry.amount as bigint);
  const reviewWindowDays = parsedMilestones.map((entry) => entry.reviewWindowDays as number);

  const totalAmount = milestoneAmounts.reduce((sum, amount) => sum + amount, 0n);
  const currentMilestoneAmount = milestoneAmounts[0] ?? null;
  const remainingMilestonesAmount = milestoneAmounts.slice(1).reduce((sum, amount) => sum + amount, 0n);

  const minReviewWindowDays = Math.min(...reviewWindowDays);
  const maxReviewWindowDays = Math.max(...reviewWindowDays);

  const reviewWindowGuidance =
    minReviewWindowDays === maxReviewWindowDays
      ? `Each milestone uses a ${minReviewWindowDays}-day buyer review window after seller submission.`
      : `Buyer review windows range from ${minReviewWindowDays} to ${maxReviewWindowDays} days after seller submission, depending on the milestone.`;

  const milestoneExposureLabel = milestoneAmounts
    .map((amount, index) => `M${index + 1}: ${formatUsdc(amount)}`)
    .join(" • ");

  const nextFundingGuidance =
    remainingMilestonesAmount > 0n
      ? `Initial funding covers the current milestone (${formatUsdc(currentMilestoneAmount ?? 0n)}). ${formatUsdc(remainingMilestonesAmount)} remains in pending milestones that can be funded later one-by-one or through a remaining batch-funding action.`
      : `This deal has one milestone. Funding the current milestone (${formatUsdc(currentMilestoneAmount ?? 0n)}) covers the full escrow amount.`;

  return {
    isAvailable: true,
    totalAmount,
    currentMilestoneAmount,
    remainingMilestonesAmount,
    milestoneAmounts,
    minReviewWindowDays,
    maxReviewWindowDays,
    invalidReason: null,
    totalAmountLabel: formatUsdc(totalAmount),
    currentMilestoneAmountLabel: currentMilestoneAmount === null ? null : formatUsdc(currentMilestoneAmount),
    remainingMilestonesAmountLabel: formatUsdc(remainingMilestonesAmount),
    milestoneExposureLabel,
    reviewWindowGuidance,
    nextFundingGuidance,
  };
}

function parseUsdcAmount(value: string): bigint | null {
  if (!value.trim()) return null;

  try {
    return parseUnits(value, 6);
  } catch {
    return null;
  }
}

function parseReviewWindowDays(value: string): number | null {
  if (!value.trim()) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed;
}
