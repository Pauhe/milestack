import { test, expect } from "@playwright/test";

import {
  assertBlockedCallout,
  assertFreshnessBanner,
  assertGuidanceContains,
  readSeedPayload,
  saveRouteScreenshot,
} from "./rehearsal-helpers";

test("rehearsal timeout path surfaces timeout guidance and conservative blocking", async ({ page }) => {
  const seed = await readSeedPayload();
  const { escrowAddress, milestoneId } = seed.journeys.timeoutPath;

  await page.goto(`/deals/${escrowAddress}`);
  await assertFreshnessBanner(page);

  const dealGuidance = page.getByTestId("deal-workflow-guidance");
  await expect(dealGuidance).toBeVisible();
  await assertGuidanceContains(dealGuidance, ["Connect a wallet"]);
  await assertBlockedCallout(dealGuidance, "deal-workflow-blocked-reason");
  await saveRouteScreenshot(page, "timeout", "deal");

  await page.goto(`/deals/${escrowAddress}/milestones/${milestoneId}`);
  await assertFreshnessBanner(page);

  const milestoneGuidance = page.getByTestId("milestone-workflow-guidance");
  await expect(milestoneGuidance).toBeVisible();
  await assertGuidanceContains(milestoneGuidance, [
    "Review deadline meaning",
    "Action authority",
  ]);
  await assertBlockedCallout(milestoneGuidance, "milestone-workflow-blocked-reason");
  await saveRouteScreenshot(page, "timeout", "milestone");
});
