import { test, expect } from "@playwright/test";

import {
  assertBlockedCallout,
  assertFreshnessBanner,
  assertGuidanceContains,
  readSeedPayload,
  saveRouteScreenshot,
} from "./rehearsal-helpers";

test("rehearsal dispute path keeps authority/finality guidance explicit", async ({ page }) => {
  const seed = await readSeedPayload();
  const { escrowAddress, milestoneId } = seed.journeys.disputePath;

  await page.goto(`/deals/${escrowAddress}/disputes/${milestoneId}`);
  await assertFreshnessBanner(page);

  const disputeGuidance = page.getByTestId("dispute-workflow-guidance");
  await expect(disputeGuidance).toBeVisible();
  await assertGuidanceContains(disputeGuidance, [
    "Dispute route eligibility",
    "Route authority",
    "Review deadline meaning",
  ]);
  await assertBlockedCallout(disputeGuidance, "dispute-workflow-blocked-reason");

  await expect(page.getByTestId("dispute-authority-explanation")).toBeVisible();
  await expect(page.getByTestId("dispute-finality-explanation")).toBeVisible();
  await expect(page.getByTestId("dispute-verification-grid")).toBeVisible();

  await saveRouteScreenshot(page, "dispute", "dispute");
});
