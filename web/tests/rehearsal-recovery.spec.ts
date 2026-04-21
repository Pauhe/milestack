import { test, expect } from "@playwright/test";

import {
  assertBlockedCallout,
  assertConservativeFreshnessBanner,
  assertFreshnessBanner,
  assertGuidanceContains,
  readSeedPayload,
  saveRouteScreenshot,
} from "./rehearsal-helpers";

const recoveryPhase = process.env.REHEARSAL_RECOVERY_PHASE ?? "recovered";

test.describe("rehearsal recovery route proof", () => {
  test("deal route stays conservative when backend is degraded during restart", async ({ page }) => {
    test.skip(recoveryPhase !== "degraded", "degraded assertions run only in degraded phase");

    const seed = await readSeedPayload();
    const { escrowAddress } = seed.journeys.timeoutPath;

    await page.goto(`/deals/${escrowAddress}`);
    await assertFreshnessBanner(page);
    await assertConservativeFreshnessBanner(page);

    const dealGuidance = page.getByTestId("deal-workflow-guidance");
    await expect(dealGuidance).toBeVisible();
    await assertGuidanceContains(dealGuidance, ["Backend freshness", "conservative"]);
    await assertBlockedCallout(dealGuidance, "deal-workflow-blocked-reason");

    await saveRouteScreenshot(page, "recovery-degraded", "deal");
  });

  test("milestone route exposes truthful workflow guidance after recovery", async ({ page }) => {
    test.skip(recoveryPhase !== "recovered", "recovered assertions run only in recovered phase");

    const seed = await readSeedPayload();
    const { escrowAddress, milestoneId } = seed.journeys.happyPath;

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

    await saveRouteScreenshot(page, "recovery-healthy", "milestone");
  });

  test("dispute route keeps explicit authority/finality guidance after recovery", async ({ page }) => {
    test.skip(recoveryPhase !== "recovered", "recovered assertions run only in recovered phase");

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

    await saveRouteScreenshot(page, "recovery-healthy", "dispute");
  });
});
