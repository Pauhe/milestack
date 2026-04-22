import { describe, expect, it } from "vitest";

import { deriveFundingGuidanceSummary } from "@/lib/funding-guidance";

describe("deriveFundingGuidanceSummary", () => {
  it("derives total, current, and remaining funding guidance for multi-milestone input", () => {
    const summary = deriveFundingGuidanceSummary([
      { amount: "1000", reviewWindowDays: "5" },
      { amount: "250.5", reviewWindowDays: "7" },
      { amount: "99.25", reviewWindowDays: "4" },
    ]);

    expect(summary.isAvailable).toBe(true);
    expect(summary.totalAmountLabel).toBe("1349.75 USDC");
    expect(summary.currentMilestoneAmountLabel).toBe("1000 USDC");
    expect(summary.remainingMilestonesAmountLabel).toBe("349.75 USDC");
    expect(summary.milestoneExposureLabel).toBe("M1: 1000 USDC • M2: 250.5 USDC • M3: 99.25 USDC");
    expect(summary.reviewWindowGuidance).toContain("range from 4 to 7 days");
    expect(summary.nextFundingGuidance).toContain("remaining batch-funding action");
  });

  it("describes one-milestone exposure without optimistic remaining-batch copy", () => {
    const summary = deriveFundingGuidanceSummary([{ amount: "500", reviewWindowDays: "3" }]);

    expect(summary.isAvailable).toBe(true);
    expect(summary.totalAmountLabel).toBe("500 USDC");
    expect(summary.remainingMilestonesAmount).toBe(0n);
    expect(summary.nextFundingGuidance).toContain("one milestone");
    expect(summary.reviewWindowGuidance).toContain("3-day buyer review window");
  });

  it("returns unavailable guidance for malformed amounts", () => {
    const summary = deriveFundingGuidanceSummary([
      { amount: "", reviewWindowDays: "5" },
      { amount: "bad", reviewWindowDays: "5" },
    ]);

    expect(summary.isAvailable).toBe(false);
    expect(summary.invalidReason).toContain("Funding summary unavailable");
    expect(summary.totalAmountLabel).toBeNull();
    expect(summary.milestoneExposureLabel).toContain("unavailable");
  });

  it("returns unavailable guidance for zero or malformed review windows", () => {
    const zeroWindow = deriveFundingGuidanceSummary([{ amount: "120", reviewWindowDays: "0" }]);
    const malformedWindow = deriveFundingGuidanceSummary([{ amount: "120", reviewWindowDays: "abc" }]);

    expect(zeroWindow.isAvailable).toBe(false);
    expect(zeroWindow.reviewWindowGuidance).toContain("unavailable");
    expect(malformedWindow.isAvailable).toBe(false);
  });

  it("returns unavailable guidance for empty milestone lists", () => {
    const summary = deriveFundingGuidanceSummary([]);

    expect(summary.isAvailable).toBe(false);
    expect(summary.invalidReason).toContain("at least one milestone");
  });

  it("recomputes deterministically when template-seeded milestones are edited", () => {
    const seeded = deriveFundingGuidanceSummary([
      { amount: "1500", reviewWindowDays: "5" },
      { amount: "3000", reviewWindowDays: "5" },
      { amount: "1000", reviewWindowDays: "5" },
    ]);

    const edited = deriveFundingGuidanceSummary([
      { amount: "1500", reviewWindowDays: "5" },
      { amount: "2800", reviewWindowDays: "4" },
      { amount: "900", reviewWindowDays: "6" },
    ]);

    expect(seeded.totalAmountLabel).toBe("5500 USDC");
    expect(edited.totalAmountLabel).toBe("5200 USDC");
    expect(edited.reviewWindowGuidance).toContain("range from 4 to 6 days");
    expect(edited.milestoneExposureLabel).toBe("M1: 1500 USDC • M2: 2800 USDC • M3: 900 USDC");
  });
});
