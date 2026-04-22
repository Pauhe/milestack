import assert from "node:assert/strict";
import test from "node:test";

import { deploymentManifest } from "./config.js";
import { db, patchSyncHealthState } from "./db.js";
import { createApp, discoveryReaders } from "./index.js";
import { upsertEscrow, upsertMetadataCache, upsertMilestone, upsertUserRoleStats } from "./repository.js";
import { syncLoopState } from "./sync-loop.js";

const ESCROW_A = "0x1000000000000000000000000000000000000001";
const ESCROW_B = "0x1000000000000000000000000000000000000002";

const BUYER_A = "0x2000000000000000000000000000000000000002";
const SELLER_A = "0x3000000000000000000000000000000000000003";
const ARBITER_A = "0x4000000000000000000000000000000000000004";

const BUYER_B = "0x5000000000000000000000000000000000000005";
const SELLER_B = "0x6000000000000000000000000000000000000006";
const ARBITER_B = "0x7000000000000000000000000000000000000007";

const TOKEN = "0x9000000000000000000000000000000000000009";

function resetDb() {
  db.exec(`
    DELETE FROM events;
    DELETE FROM milestones;
    DELETE FROM escrows;
    DELETE FROM user_role_stats;
    DELETE FROM metadata_cache;
    DELETE FROM sync_state;
  `);
}

function resetLoopState() {
  syncLoopState.isSyncing = false;
  syncLoopState.activeSyncStartedAt = null;
  syncLoopState.lastSyncAt = null;
  syncLoopState.lastSyncError = null;
}

async function jsonRequest(path: string) {
  const app = createApp();
  const server = app.listen(0);

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not resolve ephemeral test port");
    }

    const res = await fetch(`http://127.0.0.1:${address.port}${path}`);
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function seedEscrows() {
  upsertEscrow({
    chainId: deploymentManifest.chain.chainId,
    address: ESCROW_A,
    buyerAddress: BUYER_A,
    sellerAddress: SELLER_A,
    arbiterAddress: ARBITER_A,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta-a",
    milestoneCount: 2,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "1000",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "10",
    updatedAtBlock: "30",
  });

  upsertEscrow({
    chainId: deploymentManifest.chain.chainId,
    address: ESCROW_B,
    buyerAddress: BUYER_B,
    sellerAddress: SELLER_B,
    arbiterAddress: ARBITER_B,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta-b",
    milestoneCount: 1,
    dealStatus: 2,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: "0",
    totalFunded: "2500",
    totalReleasedToSeller: "2200",
    totalRefundedToBuyer: "200",
    totalFeesCollected: "100",
    createdAtBlock: "20",
    updatedAtBlock: "40",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_A,
    milestoneId: 0,
    amount: "600",
    status: 2,
    reviewWindowSeconds: 86400,
    submittedAt: "11",
    reviewDeadline: "12",
    evidenceHash: "0xevidence-a",
    disputeHash: "0x",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Scope",
    metadataDescription: "Milestone scope",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_A,
    milestoneId: 1,
    amount: "400",
    status: 1,
    reviewWindowSeconds: 86400,
    submittedAt: "0",
    reviewDeadline: "0",
    evidenceHash: "0x",
    disputeHash: "0x",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Delivery",
    metadataDescription: "Final delivery",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_B,
    milestoneId: 0,
    amount: "2500",
    status: 7,
    reviewWindowSeconds: 86400,
    submittedAt: "21",
    reviewDeadline: "22",
    evidenceHash: "0xevidence-b",
    disputeHash: "0xdispute-b",
    buyerAward: "300",
    sellerAward: "2200",
    metadataTitle: "Complete",
    metadataDescription: "Paid out",
  });

  upsertMetadataCache({
    metadataHash: "0xmeta-a",
    metadataUrl: "mock://meta-a",
    verified: true,
    payloadJson: JSON.stringify({ title: "Deal A", milestones: [{ id: 0, title: "Scope", description: "Milestone scope" }] }),
    error: null,
    updatedAtBlock: "30",
  });

  upsertMetadataCache({
    metadataHash: "0xmeta-b",
    metadataUrl: "mock://meta-b",
    verified: true,
    payloadJson: null,
    error: null,
    updatedAtBlock: "40",
  });

  upsertUserRoleStats({
    address: BUYER_A,
    role: "buyer",
    completedDealsCount: 1,
    completedMilestonesCount: 0,
    disputeCount: 0,
    disputeWinsCount: 0,
    disputeLossesCount: 0,
    resolvedDisputeCount: 0,
    unresolvedDisputeCount: 0,
    disputeSplitCount: 0,
    cancellationCount: 0,
    totalVolume: "1000",
    updatedAtBlock: "31",
  });

  upsertUserRoleStats({
    address: SELLER_A,
    role: "seller",
    completedDealsCount: 0,
    completedMilestonesCount: 0,
    disputeCount: 0,
    disputeWinsCount: 0,
    disputeLossesCount: 0,
    resolvedDisputeCount: 0,
    unresolvedDisputeCount: 0,
    disputeSplitCount: 0,
    cancellationCount: 0,
    totalVolume: "0",
    updatedAtBlock: "31",
  });

  upsertUserRoleStats({
    address: ARBITER_A,
    role: "arbiter",
    completedDealsCount: 0,
    completedMilestonesCount: 0,
    disputeCount: 0,
    disputeWinsCount: 0,
    disputeLossesCount: 0,
    resolvedDisputeCount: 0,
    unresolvedDisputeCount: 0,
    disputeSplitCount: 0,
    cancellationCount: 0,
    totalVolume: "0",
    updatedAtBlock: "31",
  });
}

test("GET /discover returns chain-aware informational rows with conservative truth/capability metadata", async () => {
  resetDb();
  resetLoopState();
  seedEscrows();

  patchSyncHealthState({
    lastAttemptedBlock: 50n,
    lastAttemptedAt: "2026-02-01T00:01:00.000Z",
    lastSuccessfulBlock: 50n,
    lastSuccessfulAt: "2026-02-01T00:01:00.000Z",
    chainHeadSeen: 50n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const { status, body } = await jsonRequest("/discover");

  assert.equal(status, 200);

  const freshness = body.freshness as Record<string, unknown>;
  assert.equal(freshness.state, "fresh");
  assert.equal(freshness.degraded, false);

  const truth = body.truth as Record<string, unknown>;
  assert.equal(truth.listingContract, "informational_read_model_only");

  const capabilitySummary = truth.capabilitySummary as Record<string, unknown>;
  assert.equal(capabilitySummary.writeActionsExposed, false);
  assert.equal(capabilitySummary.authorityRankingExposed, false);
  assert.equal(capabilitySummary.roleStatsAreDirectionalOnly, true);

  const items = body.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);

  const first = items[0];
  const firstIdentity = first.identity as Record<string, unknown>;
  assert.equal(firstIdentity.chainId, deploymentManifest.chain.chainId);
  assert.equal(firstIdentity.key, `${deploymentManifest.chain.chainId}:${ESCROW_B.toLowerCase()}`);

  const firstCapability = first.capability as Record<string, unknown>;
  assert.equal(firstCapability.listingMode, "informational");
  assert.equal(firstCapability.writeActionsExposed, false);
  assert.equal(firstCapability.authorityRankingExposed, false);

  const firstMetadata = first.metadata as Record<string, unknown>;
  assert.equal(firstMetadata.state, "degraded");
  assert.equal(firstMetadata.degraded, true);

  const second = items[1];
  const secondIdentity = second.identity as Record<string, unknown>;
  assert.equal(secondIdentity.key, `${deploymentManifest.chain.chainId}:${ESCROW_A.toLowerCase()}`);

  const secondMilestones = second.milestones as Record<string, unknown>;
  assert.equal(secondMilestones.totalCount, 2);
  assert.equal(secondMilestones.submittedCount, 1);
  assert.equal(secondMilestones.terminalCount, 0);

  const secondMetadata = second.metadata as Record<string, unknown>;
  assert.equal(secondMetadata.state, "verified");
  assert.equal(secondMetadata.verified, true);
});

test("GET /discover degrades freshness and missing role stats conservatively", async () => {
  resetDb();
  resetLoopState();
  seedEscrows();

  patchSyncHealthState({
    lastAttemptedBlock: 60n,
    lastAttemptedAt: "2026-02-01T00:02:00.000Z",
    lastSuccessfulBlock: 40n,
    lastSuccessfulAt: "2026-02-01T00:01:00.000Z",
    chainHeadSeen: 60n,
    lagBlocks: 20n,
    phase: "discover_logs",
    status: "failed",
    lastError: "rpc timeout while reading logs",
  });

  const { status, body } = await jsonRequest("/discover");

  assert.equal(status, 200);

  const freshness = body.freshness as Record<string, unknown>;
  assert.equal(freshness.state, "unavailable");
  assert.equal(freshness.degraded, true);
  assert.equal(freshness.lastError, "rpc timeout while reading logs");

  const truth = body.truth as Record<string, unknown>;
  const freshnessSummary = truth.freshnessSummary as Record<string, unknown>;
  assert.equal(freshnessSummary.state, "degraded");
  assert.equal(freshnessSummary.degraded, true);

  const items = body.items as Array<Record<string, unknown>>;
  const escrowB = items.find((item) => {
    const identity = item.identity as Record<string, unknown>;
    return identity.address === ESCROW_B.toLowerCase();
  });

  assert.ok(escrowB);

  const roleStats = (escrowB as Record<string, unknown>).roleStats as Record<string, unknown>;
  const buyerStats = roleStats.buyer as Record<string, unknown>;
  const sellerStats = roleStats.seller as Record<string, unknown>;
  const arbiterStats = roleStats.arbiter as Record<string, unknown>;

  assert.equal(buyerStats.truthState, "missing");
  assert.equal(buyerStats.degraded, true);
  assert.match(String(buyerStats.reason), /No indexed buyer role stats available/);

  assert.equal(sellerStats.truthState, "missing");
  assert.equal(arbiterStats.truthState, "missing");
});

test("GET /discover preserves chain-aware identity key when address bytes match across chains", async () => {
  resetDb();
  resetLoopState();

  upsertEscrow({
    chainId: deploymentManifest.chain.chainId,
    address: ESCROW_A,
    buyerAddress: BUYER_A,
    sellerAddress: SELLER_A,
    arbiterAddress: ARBITER_A,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta-a",
    milestoneCount: 0,
    dealStatus: 0,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "0",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "1",
    updatedAtBlock: "1",
  });

  upsertEscrow({
    chainId: 31337,
    address: ESCROW_A,
    buyerAddress: BUYER_B,
    sellerAddress: SELLER_B,
    arbiterAddress: ARBITER_B,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta-other-chain",
    milestoneCount: 0,
    dealStatus: 0,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "0",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "1",
    updatedAtBlock: "2",
  });

  patchSyncHealthState({
    lastAttemptedBlock: 2n,
    lastAttemptedAt: "2026-02-01T00:00:00.000Z",
    lastSuccessfulBlock: 2n,
    lastSuccessfulAt: "2026-02-01T00:00:00.000Z",
    chainHeadSeen: 2n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const { status, body } = await jsonRequest("/discover");
  assert.equal(status, 200);

  const items = body.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);

  const identity = items[0].identity as Record<string, unknown>;
  assert.equal(identity.address, ESCROW_A.toLowerCase());
  assert.equal(identity.chainId, deploymentManifest.chain.chainId);
  assert.equal(identity.key, `${deploymentManifest.chain.chainId}:${ESCROW_A.toLowerCase()}`);
});

test("GET /discover returns degraded empty payload instead of crashing on malformed aggregate rows", async (t) => {
  resetDb();
  resetLoopState();

  patchSyncHealthState({
    lastAttemptedBlock: 60n,
    lastAttemptedAt: "2026-02-01T00:02:00.000Z",
    lastSuccessfulBlock: 60n,
    lastSuccessfulAt: "2026-02-01T00:02:00.000Z",
    chainHeadSeen: 60n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  t.mock.method(discoveryReaders, "listDiscoveryAggregates", () => {
    throw new Error("malformed aggregate state");
  });

  const { status, body } = await jsonRequest("/discover");

  assert.equal(status, 200);

  const items = body.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 0);

  const freshness = body.freshness as Record<string, unknown>;
  assert.equal(freshness.state, "unavailable");
  assert.equal(freshness.degraded, true);
  assert.match(String(freshness.lastError), /discover aggregation degraded/);

  const truth = body.truth as Record<string, unknown>;
  const freshnessSummary = truth.freshnessSummary as Record<string, unknown>;
  assert.equal(freshnessSummary.state, "degraded");
  assert.equal(freshnessSummary.degraded, true);
});
