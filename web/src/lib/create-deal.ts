import { isAddress, parseUnits } from "viem";

import { hashJson } from "@/lib/hash";

export type CreateDealMilestoneInput = {
  title: string;
  description: string;
  amount: string;
  reviewWindowDays: string;
  expectationChecklist: string;
  evidenceGuidance: string;
};

type CreateDealTemplateCatalog = readonly {
  id: string;
  label: string;
  description: string;
  milestones: CreateDealMilestoneInput[];
}[];

const createDealTemplateCatalog = [
  {
    id: "website-refresh",
    label: "Website refresh",
    description: "Three-step website delivery for strategy, build, and launch handoff.",
    milestones: [
      {
        title: "Discovery and UX direction",
        description: "Confirm goals, site map, and first UX direction package.",
        amount: "1500",
        reviewWindowDays: "5",
        expectationChecklist: "Project brief approved\nSitemap + key flows shared\nFirst design direction linked",
        evidenceGuidance: "Include links to the discovery brief, UX artifacts, and a short note describing buyer review scope.",
      },
      {
        title: "Design and implementation",
        description: "Ship approved page designs and implemented frontend build.",
        amount: "3000",
        reviewWindowDays: "5",
        expectationChecklist: "Approved high-fidelity mockups\nFrontend PR or repo link\nStaging URL included",
        evidenceGuidance: "Attach design source, deployment preview URL, and a summary of what changed since discovery.",
      },
      {
        title: "QA and launch handoff",
        description: "Close QA issues and hand over launch-ready assets and runbook.",
        amount: "1000",
        reviewWindowDays: "5",
        expectationChecklist: "QA checklist completed\nAnalytics + monitoring confirmed\nHandoff/runbook delivered",
        evidenceGuidance: "Provide QA results, launch checklist, and final handoff package references.",
      },
    ],
  },
  {
    id: "content-campaign",
    label: "Content campaign",
    description: "Two-phase campaign production for planning and publication assets.",
    milestones: [
      {
        title: "Campaign planning",
        description: "Define campaign narrative, channel plan, and publishing calendar.",
        amount: "1200",
        reviewWindowDays: "4",
        expectationChecklist: "Campaign brief approved\nChannel calendar shared\nSuccess metrics documented",
        evidenceGuidance: "Link the approved campaign brief and calendar with explicit target metrics.",
      },
      {
        title: "Asset production and publication",
        description: "Deliver final creative assets and publish according to schedule.",
        amount: "1800",
        reviewWindowDays: "4",
        expectationChecklist: "Final assets delivered\nPublication proof included\nPerformance snapshot shared",
        evidenceGuidance: "Attach asset folder, publication links/screenshots, and initial performance summary.",
      },
    ],
  },
] as const satisfies CreateDealTemplateCatalog;

export type CreateDealTemplateId = (typeof createDealTemplateCatalog)[number]["id"];
export type CreateDealTemplate = (typeof createDealTemplateCatalog)[number];

const templateById = new Map<CreateDealTemplateId, CreateDealTemplate>(
  createDealTemplateCatalog.map((template) => [template.id, template])
);

export function listCreateDealTemplates(): readonly CreateDealTemplate[] {
  return createDealTemplateCatalog;
}

export function getCreateDealTemplateById(id: string): CreateDealTemplate | null {
  return isCreateDealTemplateId(id) ? (templateById.get(id) ?? null) : null;
}

export function isCreateDealTemplateId(value: string): value is CreateDealTemplateId {
  return templateById.has(value as CreateDealTemplateId);
}

export type CreateDealFormState = {
  buyer: string;
  arbiter: string;
  title: string;
  summary: string;
  termsUrl: string;
  templateId: CreateDealTemplateId | null;
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
  templateId: null,
  milestones: [
    {
      title: "Discovery and handoff",
      description: "Kickoff, first evidence package, and milestone review.",
      amount: "1000",
      reviewWindowDays: "5",
      expectationChecklist: "Kickoff notes attached\nScope and deliverables confirmed\nEvidence package linked",
      evidenceGuidance: "Share links to discovery notes, scoped deliverables, and the first evidence package.",
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

  const selectedTemplate = state.templateId ? getCreateDealTemplateById(state.templateId) : null;
  if (state.templateId && !selectedTemplate) {
    errors.push("Deal template is invalid. Re-select a valid template or continue without one.");
  }

  const milestoneExpectationConfigs = state.milestones.map((milestone, index) => {
    if (!milestone.title.trim()) {
      errors.push(`Milestone ${index + 1} title is required.`);
    }

    if (!milestone.description.trim()) {
      errors.push(`Milestone ${index + 1} description is required.`);
    }

    const checklistItems = parseChecklistItems(milestone.expectationChecklist);
    if (!milestone.expectationChecklist.trim() || checklistItems.length === 0) {
      errors.push(`Milestone ${index + 1} checklist is required.`);
    }

    if (!milestone.evidenceGuidance.trim()) {
      errors.push(`Milestone ${index + 1} evidence guidance is required.`);
    }

    return {
      checklistItems,
      evidenceGuidance: milestone.evidenceGuidance.trim(),
    };
  });

  const milestoneConfigs = state.milestones.map((milestone, index) => {
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
        template: selectedTemplate
          ? {
              id: selectedTemplate.id,
              label: selectedTemplate.label,
              description: selectedTemplate.description,
            }
          : {
              id: "custom",
              label: "Custom",
              description: "No guided template selected.",
            },
        milestones: state.milestones.map((milestone, index) => ({
          id: index,
          title: milestone.title.trim(),
          description: milestone.description.trim(),
          defaultReviewWindowSeconds: milestoneConfigs[index]?.reviewWindowSeconds ?? 0,
          expectations: {
            checklist: milestoneExpectationConfigs[index]?.checklistItems ?? [],
            evidenceGuidance: milestoneExpectationConfigs[index]?.evidenceGuidance ?? "",
          },
        })),
      };

  return {
    errors,
    metadata,
    metadataHash: metadata ? hashJson(metadata) : null,
    milestoneConfigs,
  };
}

function parseChecklistItems(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}
