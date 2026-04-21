import { test, expect } from "@playwright/test";

import { assertFreshnessBanner, assertGuidanceContains, readSeedPayload, saveRouteScreenshot } from "./rehearsal-helpers";

test("rehearsal happy path routes expose truth and guidance", async ({ page }) => {
  const seed = await readSeedPayload();
  const { escrowAddress, milestoneId } = seed.journeys.happyPath;

  await page.goto(`/deals/${escrowAddress}`);
  await assertFreshnessBanner(page);

  const dealGuidance = page.getByTestId("deal-workflow-guidance");
  await expect(dealGuidance).toBeVisible();
  await assertGuidanceContains(dealGuidance, [
    "Traverse the current workflow path",
    "Connect a wallet",
  ]);
  await expect(page.getByTestId("deal-timeline-panel")).toBeVisible();
  await saveRouteScreenshot(page, "happy", "deal");

  await page.goto(`/deals/${escrowAddress}/milestones/${milestoneId}`);
  await assertFreshnessBanner(page);

  const milestoneGuidance = page.getByTestId("milestone-workflow-guidance");
  await expect(milestoneGuidance).toBeVisible();
  await assertGuidanceContains(milestoneGuidance, [
    "Route-to-route progression",
    "Review deadline meaning",
    "Action authority",
  ]);
  await expect(page.getByTestId("milestone-hash-context-grid")).toBeVisible();
  await saveRouteScreenshot(page, "happy", "milestone");
});
