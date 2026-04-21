import fs from "node:fs/promises";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

export type SeedJourney = {
  escrowAddress: string;
  dealId: string;
  milestoneId: number;
  events: string[];
};

export type SeedPayload = {
  version: number;
  environment: string;
  generatedAt: string;
  journeys: {
    happyPath: SeedJourney;
    timeoutPath: SeedJourney;
    disputePath: SeedJourney;
  };
};

const environment = process.env.DEPLOY_ENVIRONMENT ?? "rehearsal-local";
const seedPath = process.env.REHEARSAL_SEED_PATH ?? path.resolve("..", "deployments", environment, "seeded-journeys.json");

function artifactsDir() {
  return process.env.REHEARSAL_ARTIFACTS_DIR ?? path.resolve("..", "deployments", environment, "browser-evidence");
}

export async function readSeedPayload() {
  const raw = await fs.readFile(seedPath, "utf8");
  return JSON.parse(raw) as SeedPayload;
}

export async function saveRouteScreenshot(page: Page, scenario: string, routeName: string) {
  const dir = artifactsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${scenario}-${routeName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function assertFreshnessBanner(page: Page) {
  await expect(page.getByTestId("backend-freshness-banner")).toBeVisible();
}

export async function assertBlockedCallout(guidancePanel: Locator, calloutTestId: string) {
  const blocked = guidancePanel.getByTestId(calloutTestId);
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText(/blocked/i);
}

export async function assertGuidanceContains(guidancePanel: Locator, fragments: string[]) {
  for (const fragment of fragments) {
    await expect(guidancePanel).toContainText(fragment);
  }
}
