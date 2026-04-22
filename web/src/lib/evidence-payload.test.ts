import { describe, expect, it } from "vitest";

import { composeEvidencePayload, type ComposeEvidencePayloadInput } from "@/lib/evidence-payload";

function makeSubmissionInput(overrides: Partial<ComposeEvidencePayloadInput> = {}): ComposeEvidencePayloadInput {
  return {
    mode: "submission",
    note: "Completed milestone deliverables and attached QA artifacts.",
    references: [
      {
        type: "deliverable",
        label: "Staging build",
        url: "https://example.com/staging",
      },
    ],
    ...overrides,
  };
}

describe("composeEvidencePayload", () => {
  it("builds deterministic canonical payload + hash for minimum valid submission", () => {
    const first = composeEvidencePayload(makeSubmissionInput());
    const second = composeEvidencePayload(makeSubmissionInput());

    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(first.payloadJson).toEqual(second.payloadJson);
    expect(first.payloadHash).toEqual(second.payloadHash);
    expect(first.payloadHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("normalizes ordering and whitespace so edited references do not cause hash drift", () => {
    const first = composeEvidencePayload(
      makeSubmissionInput({
        note: "  Completed   milestone   deliverables.  ",
        references: [
          {
            type: "qa",
            label: "  Test report  ",
            url: "https://example.com/qa",
          },
          {
            type: "deliverable",
            label: "Build artifact",
            url: "https://example.com/build",
          },
        ],
      })
    );

    const second = composeEvidencePayload(
      makeSubmissionInput({
        note: "Completed milestone deliverables.",
        references: [
          {
            type: "deliverable",
            label: "Build artifact",
            url: "https://example.com/build",
          },
          {
            type: "qa",
            label: "Test report",
            url: "https://example.com/qa",
          },
        ],
      })
    );

    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(first.payloadJson).toEqual(second.payloadJson);
    expect(first.payloadHash).toEqual(second.payloadHash);
  });

  it("rejects malformed payloads: blank note, invalid URL, unsupported type, and duplicate references", () => {
    const result = composeEvidencePayload(
      makeSubmissionInput({
        note: "   ",
        references: [
          {
            type: "unsupported",
            label: "Bad type",
            url: "not-a-url",
          },
          {
            type: "deliverable",
            label: "Build",
            url: "https://example.com/build",
          },
          {
            type: "deliverable",
            label: "Build duplicate",
            url: "https://example.com/build",
          },
        ],
      })
    );

    expect(result.payload).toBeNull();
    expect(result.payloadHash).toBeNull();
    expect(result.errors).toContain("Public note is required.");
    expect(result.errors).toContain("Reference 1 uses unsupported type 'unsupported'.");
    expect(result.errors).toContain("Reference 1 URL is invalid.");
    expect(result.errors).toContain("Duplicate reference detected for deliverable (https://example.com/build).");
  });

  it("requires dispute reason code and includes it in canonical payload", () => {
    const missingReason = composeEvidencePayload({
      mode: "dispute",
      note: "Buyer disputes milestone quality.",
      reasonCode: "",
      references: [
        {
          type: "communication",
          label: "Review comments",
          url: "https://example.com/review",
        },
      ],
    });

    expect(missingReason.errors).toContain("Dispute reason code is required.");
    expect(missingReason.payloadHash).toBeNull();

    const validDispute = composeEvidencePayload({
      mode: "dispute",
      note: "Buyer disputes milestone quality.",
      reasonCode: "quality-gap",
      references: [
        {
          type: "communication",
          label: "Review comments",
          url: "https://example.com/review",
        },
      ],
    });

    expect(validDispute.errors).toEqual([]);
    expect(validDispute.payload?.dispute?.reasonCode).toBe("quality-gap");
    expect(validDispute.payloadHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("enforces 10x profile guard by capping reference count", () => {
    const references = Array.from({ length: 11 }, (_, index) => ({
      type: "other",
      label: `Ref ${index + 1}`,
      url: `https://example.com/ref-${index + 1}`,
    }));

    const result = composeEvidencePayload(makeSubmissionInput({ references }));

    expect(result.errors).toContain("No more than 10 references are allowed.");
    expect(result.payloadHash).toBeNull();
  });
});
