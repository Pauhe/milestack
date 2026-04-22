import { describe, expect, it } from "vitest";

import {
  defaultCreateDealState,
  listCreateDealTemplates,
  validateCreateDeal,
  type CreateDealFormState,
} from "@/lib/create-deal";

const SELLER = "0xa11ce00000000000000000000000000000000000";
const BUYER = "0x0b0b000000000000000000000000000000000000";
const ARBITER = "0xcafe000000000000000000000000000000000000";

function makeValidState(overrides: Partial<CreateDealFormState> = {}): CreateDealFormState {
  return {
    ...defaultCreateDealState,
    buyer: BUYER,
    arbiter: ARBITER,
    title: "Website redesign",
    summary: "Design and implement a landing page refresh.",
    milestones: [
      {
        title: "Wireframes",
        description: "Deliver first-pass wireframes.",
        amount: "1000",
        reviewWindowDays: "5",
        expectationChecklist: "Wireframes linked\nBuyer review comments addressed",
        evidenceGuidance: "Include links to wireframes and a short review-response summary.",
      },
    ],
    ...overrides,
  };
}

describe("validateCreateDeal", () => {
  it("returns a metadata hash and milestone config for a valid form", () => {
    const result = validateCreateDeal(SELLER, makeValidState());

    expect(result.errors).toEqual([]);
    expect(result.metadata).not.toBeNull();
    expect(result.metadataHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.milestoneConfigs).toEqual([
      {
        amount: 1_000_000_000n,
        reviewWindowSeconds: 432000,
      },
    ]);
    expect(result.fundingGuidance.isAvailable).toBe(true);
    expect(result.fundingGuidance.totalAmountLabel).toBe("1000 USDC");
    expect(result.fundingGuidance.currentMilestoneAmountLabel).toBe("1000 USDC");
    expect(result.fundingGuidance.remainingMilestonesAmountLabel).toBe("0 USDC");
  });

  it("requires distinct buyer, seller, and arbiter addresses", () => {
    const result = validateCreateDeal(
      SELLER,
      makeValidState({
        buyer: SELLER,
      })
    );

    expect(result.errors).toContain("Buyer, seller, and arbiter must all be distinct addresses.");
  });

  it("rejects invalid milestone amounts and review windows", () => {
    const result = validateCreateDeal(
      SELLER,
      makeValidState({
        milestones: [
          {
            title: "Bad milestone",
            description: "Missing amount and bad review window.",
            amount: "abc",
            reviewWindowDays: "0",
            expectationChecklist: "Criterion one",
            evidenceGuidance: "Attach a relevant reference.",
          },
        ],
      })
    );

    expect(result.errors).toContain("Milestone 1 amount must be a valid USDC value.");
    expect(result.errors).toContain("Milestone 1 review window must be greater than zero.");
    expect(result.metadataHash).toBeNull();
    expect(result.fundingGuidance.isAvailable).toBe(false);
    expect(result.fundingGuidance.invalidReason).toContain("Funding summary unavailable");
  });

  it("changes the metadata hash when form content changes", () => {
    const first = validateCreateDeal(SELLER, makeValidState());
    const second = validateCreateDeal(
      SELLER,
      makeValidState({
        summary: "Design and implement a larger site refresh.",
      })
    );

    expect(first.metadataHash).not.toBeNull();
    expect(second.metadataHash).not.toBeNull();
    expect(first.metadataHash).not.toEqual(second.metadataHash);
  });

  it("embeds selected template identity and milestone expectations into hashed metadata", () => {
    const template = listCreateDealTemplates()[0];
    const result = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: template?.id ?? null,
        milestones: template ? template.milestones.map((milestone) => ({ ...milestone })) : [],
      })
    );

    expect(result.errors).toEqual([]);
    expect(result.metadataHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(result.metadata).toMatchObject({
      template: {
        id: template?.id,
        label: template?.label,
      },
    });

    const metadataMilestones = (result.metadata as { milestones: Array<{ expectations: { checklist: string[]; evidenceGuidance: string } }> })
      .milestones;
    expect(metadataMilestones.length).toBeGreaterThan(0);
    expect(metadataMilestones[0]?.expectations.checklist.length).toBeGreaterThan(0);
    expect(metadataMilestones[0]?.expectations.evidenceGuidance).toBeTruthy();
  });

  it("fails validation for unknown template ids", () => {
    const result = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: "non-existent-template" as CreateDealFormState["templateId"],
      })
    );

    expect(result.errors).toContain("Deal template is invalid. Re-select a valid template or continue without one.");
    expect(result.metadata).toBeNull();
    expect(result.metadataHash).toBeNull();
  });

  it("fails validation for blank checklist or evidence guidance after template edits", () => {
    const result = validateCreateDeal(
      SELLER,
      makeValidState({
        milestones: [
          {
            title: "Edited milestone",
            description: "Manual edit after selecting template.",
            amount: "800",
            reviewWindowDays: "4",
            expectationChecklist: "   ",
            evidenceGuidance: "",
          },
        ],
      })
    );

    expect(result.errors).toContain("Milestone 1 checklist is required.");
    expect(result.errors).toContain("Milestone 1 evidence guidance is required.");
    expect(result.metadataHash).toBeNull();
  });

  it("produces deterministic hashes for identical template-backed states", () => {
    const template = listCreateDealTemplates()[1];
    const templateMilestones = template ? template.milestones.map((milestone) => ({ ...milestone })) : [];

    const first = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: template?.id ?? null,
        milestones: templateMilestones,
      })
    );

    const second = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: template?.id ?? null,
        milestones: templateMilestones.map((milestone) => ({ ...milestone })),
      })
    );

    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(first.metadataHash).toEqual(second.metadataHash);
  });

  it("derives deterministic funding guidance after editing template milestones", () => {
    const template = listCreateDealTemplates()[0];
    const seeded = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: template?.id ?? null,
        milestones: template ? template.milestones.map((milestone) => ({ ...milestone })) : [],
      })
    );

    const editedMilestones = (template ? template.milestones : []).map((milestone, index) =>
      index === 1
        ? {
            ...milestone,
            amount: "2800",
            reviewWindowDays: "4",
          }
        : { ...milestone }
    );

    const edited = validateCreateDeal(
      SELLER,
      makeValidState({
        templateId: template?.id ?? null,
        milestones: editedMilestones,
      })
    );

    expect(seeded.fundingGuidance.isAvailable).toBe(true);
    expect(edited.fundingGuidance.isAvailable).toBe(true);
    expect(seeded.fundingGuidance.totalAmountLabel).toBe("5500 USDC");
    expect(edited.fundingGuidance.totalAmountLabel).toBe("5300 USDC");
    expect(edited.fundingGuidance.reviewWindowGuidance).toContain("range from 4 to 5 days");
  });

  it("keeps funding guidance conservative for malformed milestone drafts", () => {
    const malformed = validateCreateDeal(
      SELLER,
      makeValidState({
        milestones: [
          {
            title: "Draft",
            description: "Draft row",
            amount: "",
            reviewWindowDays: "",
            expectationChecklist: "Item",
            evidenceGuidance: "Evidence",
          },
        ],
      })
    );

    expect(malformed.fundingGuidance.isAvailable).toBe(false);
    expect(malformed.fundingGuidance.totalAmountLabel).toBeNull();
    expect(malformed.fundingGuidance.reviewWindowGuidance).toContain("unavailable");
  });
});
