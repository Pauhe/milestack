#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const environment = process.env.DEPLOY_ENVIRONMENT ?? "rehearsal-local";
const outputPath = process.env.REHEARSAL_SEED_OUTPUT_PATH
  ? path.resolve(rootDir, process.env.REHEARSAL_SEED_OUTPUT_PATH)
  : path.resolve(rootDir, "deployments", environment, "seeded-journeys.json");

const baseTimestamp = process.env.REHEARSAL_BASE_TIMESTAMP ?? "2026-04-21T00:00:00.000Z";
const reviewWindowSeconds = Number(process.env.REHEARSAL_REVIEW_WINDOW_SECONDS ?? 432000);

const addresses = {
  buyer: "0x10000000000000000000000000000000000000a1",
  seller: "0x10000000000000000000000000000000000000b1",
  arbiter: "0x10000000000000000000000000000000000000c1",
  token: "0x10000000000000000000000000000000000000d1",
};

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

const journeys = {
  happyPath: {
    escrowAddress: "0x1000000000000000000000000000000000000101",
    dealId: "rehearsal-happy-001",
    milestoneId: 0,
    events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneClaimed", "MilestoneApproved"],
  },
  timeoutPath: {
    escrowAddress: "0x1000000000000000000000000000000000000202",
    dealId: "rehearsal-timeout-001",
    milestoneId: 0,
    events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneClaimed"],
  },
  disputePath: {
    escrowAddress: "0x1000000000000000000000000000000000000303",
    dealId: "rehearsal-dispute-001",
    milestoneId: 0,
    events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneDisputed", "DisputeResolved"],
  },
} as const;

const seededPayload = {
  version: 1,
  environment,
  generatedAt: new Date().toISOString(),
  baseTimestamp,
  defaults: {
    reviewWindowSeconds,
    metadataVisibility: "public",
  },
  participants: {
    buyer: normalizeAddress(addresses.buyer),
    seller: normalizeAddress(addresses.seller),
    arbiter: normalizeAddress(addresses.arbiter),
    token: normalizeAddress(addresses.token),
  },
  journeys,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(seededPayload, null, 2)}\n`);

console.log(`[bootstrap-rehearsal-data] environment=${environment}`);
console.log(`[bootstrap-rehearsal-data] output=${path.relative(rootDir, outputPath)}`);
console.log(
  `[bootstrap-rehearsal-data] seededEscrows=${Object.values(journeys)
    .map((journey) => journey.escrowAddress)
    .join(",")}`
);
