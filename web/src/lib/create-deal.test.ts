import { describe, expect, it } from "vitest";

import {
  defaultCreateDealState,
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
          },
        ],
      })
    );

    expect(result.errors).toContain("Milestone 1 amount must be a valid USDC value.");
    expect(result.errors).toContain("Milestone 1 review window must be greater than zero.");
    expect(result.metadataHash).toBeNull();
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
});
