import { isAddress, parseUnits } from "viem";

import { hashJson } from "@/lib/hash";

export type CreateDealMilestoneInput = {
  title: string;
  description: string;
  amount: string;
  reviewWindowDays: string;
};

export type CreateDealFormState = {
  buyer: string;
  arbiter: string;
  title: string;
  summary: string;
  termsUrl: string;
  milestones: CreateDealMilestoneInput[];
};

export type CreateDealValidationResult = {
  errors: string[];
  metadataHash: `0x${string}` | null;
  metadata: Record<string, unknown> | null;
  milestoneConfigs: { amount: bigint; reviewWindowSeconds: number }[];
};

export const defaultCreateDealState: CreateDealFormState = {
  buyer: "",
  arbiter: "",
  title: "",
  summary: "",
  termsUrl: "",
  milestones: [
    {
      title: "Discovery and handoff",
      description: "Kickoff, first evidence package, and milestone review.",
      amount: "1000",
      reviewWindowDays: "5",
    },
  ],
};

export function validateCreateDeal(
  sellerAddress: string | undefined,
  state: CreateDealFormState
): CreateDealValidationResult {
  const errors: string[] = [];

  if (!sellerAddress || !isAddress(sellerAddress)) {
    errors.push("Connect the seller wallet before creating a deal.");
  }

  if (!isAddress(state.buyer)) {
    errors.push("Buyer address must be a valid wallet address.");
  }

  if (!isAddress(state.arbiter)) {
    errors.push("Arbiter address must be a valid wallet address.");
  }

  if (!state.title.trim()) {
    errors.push("Deal title is required.");
  }

  if (!state.summary.trim()) {
    errors.push("Deal summary is required.");
  }

  if (state.milestones.length === 0) {
    errors.push("At least one milestone is required.");
  }

  const distinctAddresses = [sellerAddress, state.buyer, state.arbiter].filter(Boolean);
  if (new Set(distinctAddresses.map((value) => value?.toLowerCase())).size !== distinctAddresses.length) {
    errors.push("Buyer, seller, and arbiter must all be distinct addresses.");
  }

  const milestoneConfigs = state.milestones.map((milestone, index) => {
    if (!milestone.title.trim()) {
      errors.push(`Milestone ${index + 1} title is required.`);
    }

    if (!milestone.description.trim()) {
      errors.push(`Milestone ${index + 1} description is required.`);
    }

    let amount = 0n;
    try {
      amount = parseUnits(milestone.amount || "0", 6);
      if (amount <= 0n) {
        errors.push(`Milestone ${index + 1} amount must be greater than zero.`);
      }
    } catch {
      errors.push(`Milestone ${index + 1} amount must be a valid USDC value.`);
    }

    const reviewWindowDays = Number(milestone.reviewWindowDays);
    if (!Number.isFinite(reviewWindowDays) || reviewWindowDays <= 0) {
      errors.push(`Milestone ${index + 1} review window must be greater than zero.`);
    }

    return {
      amount,
      reviewWindowSeconds: Math.floor(reviewWindowDays * 24 * 60 * 60),
    };
  });

  const metadata = errors.length
    ? null
    : {
        version: 1,
        title: state.title.trim(),
        summary: state.summary.trim(),
        visibility: "public",
        buyer: { address: state.buyer },
        seller: { address: sellerAddress },
        arbiter: { address: state.arbiter },
        termsUrl: state.termsUrl.trim() || null,
        milestones: state.milestones.map((milestone, index) => ({
          id: index,
          title: milestone.title.trim(),
          description: milestone.description.trim(),
          defaultReviewWindowSeconds: milestoneConfigs[index]?.reviewWindowSeconds ?? 0,
        })),
      };

  return {
    errors,
    metadata,
    metadataHash: metadata ? hashJson(metadata) : null,
    milestoneConfigs,
  };
}
