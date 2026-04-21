import assert from "node:assert/strict";
import test from "node:test";

import { db, patchSyncHealthState } from "./db.js";
import { createApp } from "./index.js";
import { insertEvent, upsertEscrow, upsertMetadataCache, upsertMilestone } from "./repository.js";
import { syncLoopState } from "./sync-loop.js";

const ESCROW_ADDRESS = "0x1000000000000000000000000000000000000001";
const BUYER = "0x2000000000000000000000000000000000000002";
const SELLER = "0x3000000000000000000000000000000000000003";
const ARBITER = "0x4000000000000000000000000000000000000004";
const TOKEN = "0x5000000000000000000000000000000000000005";

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

function seedEscrow() {
  upsertEscrow({
    address: ESCROW_ADDRESS,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    arbiterAddress: ARBITER,
    tokenAddress: TOKEN,
    metadataHash: "0xhash",
    milestoneCount: 1,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "1000",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "10",
    updatedAtBlock: "10",
  });

  upsertMetadataCache({
    metadataHash: "0xhash",
    metadataUrl: "mock://verified",
    verified: true,
    payloadJson: JSON.stringify({ milestones: [{ id: 0, title: "Title", description: "Description" }] }),
    error: null,
    updatedAtBlock: "10",
  });

  upsertMilestone({
    escrowAddress: ESCROW_ADDRESS,
    milestoneId: 0,
    amount: "1000",
    status: 2,
    reviewWindowSeconds: 86400,
    submittedAt: "11",
    reviewDeadline: "12",
    evidenceHash: "0xevidence",
    disputeHash: "0xdispute",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Title",
    metadataDescription: "Description",
  });
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

test("/health exposes canonical freshness, lag, phase, and loop observability", async () => {
  resetDb();
  resetLoopState();

  patchSyncHealthState({
    lastAttemptedBlock: 150n,
    lastAttemptedAt: "2026-02-01T00:01:00.000Z",
    lastSuccessfulBlock: 148n,
    lastSuccessfulAt: "2026-02-01T00:00:00.000Z",
    chainHeadSeen: 150n,
    lagBlocks: 2n,
    phase: "persist_events",
    status: "syncing",
    lastError: null,
  });

  syncLoopState.isSyncing = true;
  syncLoopState.activeSyncStartedAt = "2026-02-01T00:01:05.000Z";
  syncLoopState.lastSyncAt = "2026-02-01T00:00:30.000Z";
  syncLoopState.lastSyncError = null;

  const { status, body } = await jsonRequest("/health");

  assert.equal(status, 200);
  assert.equal(body.ok, true);

  const sync = body.sync as Record<string, unknown>;
  assert.equal(sync.indexedBlock, "148");
  assert.equal(sync.chainHead, "150");
  assert.equal(sync.lagBlocks, "2");
  assert.equal(sync.phase, "persist_events");
  assert.equal(sync.status, "syncing");
  assert.equal(sync.freshness, "stale");
  assert.equal(sync.degraded, true);
  assert.equal(sync.lastError, null);

  const loop = sync.loop as Record<string, unknown>;
  assert.equal(loop.isSyncing, true);
  assert.equal(loop.activeSyncStartedAt, "2026-02-01T00:01:05.000Z");
});

test("derived endpoints attach freshness metadata for fresh, rebuilding, and failed states", async () => {
  resetDb();
  resetLoopState();
  seedEscrow();

  patchSyncHealthState({
    lastAttemptedBlock: 100n,
    lastAttemptedAt: "2026-02-01T00:02:00.000Z",
    lastSuccessfulBlock: 100n,
    lastSuccessfulAt: "2026-02-01T00:02:00.000Z",
    chainHeadSeen: 100n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const freshEscrow = await jsonRequest(`/escrows/${ESCROW_ADDRESS}`);
  assert.equal(freshEscrow.status, 200);
  {
    const freshness = freshEscrow.body.freshness as Record<string, unknown>;
    assert.equal(freshness.state, "fresh");
    assert.equal(freshness.degraded, false);
    assert.equal(freshness.lagBlocks, "0");
    assert.equal(freshness.lastError, null);
  }

  patchSyncHealthState({
    phase: "rebuild_projections",
    status: "rebuilding",
    lagBlocks: 0n,
    lastError: null,
  });

  const rebuildingTimeline = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/timeline`);
  assert.equal(rebuildingTimeline.status, 200);
  {
    const freshness = rebuildingTimeline.body.freshness as Record<string, unknown>;
    assert.equal(freshness.state, "rebuilding");
    assert.equal(freshness.degraded, true);
    assert.equal(freshness.status, "rebuilding");
    assert.equal(freshness.phase, "rebuild_projections");
  }

  patchSyncHealthState({
    phase: "discover_logs",
    status: "failed",
    lagBlocks: 42n,
    lastError: "rpc timeout while reading logs",
  });
  syncLoopState.lastSyncError = "rpc timeout while reading logs";

  const failedReputation = await jsonRequest(`/users/${BUYER}/reputation`);
  assert.equal(failedReputation.status, 200);
  {
    const freshness = failedReputation.body.freshness as Record<string, unknown>;
    assert.equal(freshness.state, "unavailable");
    assert.equal(freshness.degraded, true);
    assert.equal(freshness.status, "failed");
    assert.equal(freshness.lagBlocks, "42");
    assert.equal(freshness.lastError, "rpc timeout while reading logs");
    assert.equal(freshness.syncLoopError, "rpc timeout while reading logs");
  }
});

test("derived endpoints expose metadata/degraded truth payload contracts", async () => {
  resetDb();
  resetLoopState();
  seedEscrow();

  patchSyncHealthState({
    lastAttemptedBlock: 120n,
    lastAttemptedAt: "2026-02-01T00:02:00.000Z",
    lastSuccessfulBlock: 120n,
    lastSuccessfulAt: "2026-02-01T00:02:00.000Z",
    chainHeadSeen: 120n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const escrow = await jsonRequest(`/escrows/${ESCROW_ADDRESS}`);
  assert.equal(escrow.status, 200);
  {
    const truth = escrow.body.truth as Record<string, unknown>;
    const metadata = truth.metadata as Record<string, unknown>;
    assert.equal(metadata.state, "verified");
    assert.equal(metadata.verified, true);
  }

  const milestones = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones`);
  assert.equal(milestones.status, 200);
  {
    const metadata = milestones.body.metadata as Record<string, unknown>;
    assert.equal(metadata.state, "verified");

    const first = (milestones.body.items as Array<Record<string, unknown>>)[0];
    const milestoneTruth = first.truth as Record<string, unknown>;
    const metadataVerification = milestoneTruth.metadataVerification as Record<string, unknown>;
    assert.equal(metadataVerification.state, "verified");

    const evidence = milestoneTruth.evidence as Record<string, unknown>;
    assert.equal(evidence.state, "present");
    assert.equal(evidence.ambiguity, "not-verifiable-from-onchain-hash");

    const dispute = milestoneTruth.disputeContext as Record<string, unknown>;
    assert.equal(dispute.state, "present");
  }

  resetDb();
  resetLoopState();
  seedEscrow();

  upsertMetadataCache({
    metadataHash: "0xhash",
    metadataUrl: "mock://broken",
    verified: true,
    payloadJson: null,
    error: null,
    updatedAtBlock: "11",
  });

  const degraded = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones`);
  assert.equal(degraded.status, 200);
  {
    const metadata = degraded.body.metadata as Record<string, unknown>;
    assert.equal(metadata.state, "degraded");

    const first = (degraded.body.items as Array<Record<string, unknown>>)[0];
    const milestoneTruth = first.truth as Record<string, unknown>;
    const metadataVerification = milestoneTruth.metadataVerification as Record<string, unknown>;
    assert.equal(metadataVerification.state, "unavailable");
  }
});

test("timeline endpoint preserves ambiguous-but-truthful claim attribution", async () => {
  resetDb();
  resetLoopState();
  seedEscrow();

  insertEvent({
    chainId: 31337,
    blockNumber: "20",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000aa",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "MilestoneApproved",
    summary: "Buyer approved milestone",
    payloadJson: JSON.stringify({ milestoneId: "0" }),
  });

  insertEvent({
    chainId: 31337,
    blockNumber: "21",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000ab",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "MilestoneClaimed",
    summary: "Milestone payout finalized",
    payloadJson: JSON.stringify({ milestoneId: "1", sellerAmount: "100", feeAmount: "1" }),
  });

  patchSyncHealthState({
    lastAttemptedBlock: 120n,
    lastAttemptedAt: "2026-02-01T00:02:00.000Z",
    lastSuccessfulBlock: 120n,
    lastSuccessfulAt: "2026-02-01T00:02:00.000Z",
    chainHeadSeen: 120n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const timeline = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/timeline`);
  assert.equal(timeline.status, 200);

  const items = timeline.body.items as Array<Record<string, unknown>>;
  const claimed = items.find((item) => item.type === "MilestoneClaimed");
  assert.ok(claimed);

  const truth = claimed.truth as Record<string, unknown>;
  assert.equal(truth.ambiguous, true);
  assert.equal(truth.payoutAttribution, "seller_timeout_or_unresolved");
});
