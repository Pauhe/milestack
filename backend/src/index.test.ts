import assert from "node:assert/strict";
import test from "node:test";

import { deploymentManifest } from "./config.js";
import { db, patchSyncHealthState } from "./db.js";
import { createApp, discoveryReaders } from "./index.js";
import { setIndexerPublicClient, resetIndexerPublicClient } from "./indexer.js";
import { insertEvent, upsertEscrow, upsertMetadataCache, upsertMilestone } from "./repository.js";
import { syncLoopState } from "./sync-loop.js";

const ESCROW_ADDRESS = "0x1000000000000000000000000000000000000001";
const MISSING_ESCROW_ADDRESS = "0x1000000000000000000000000000000000000002";
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
    chainId: deploymentManifest.chain.chainId,
    address: ESCROW_ADDRESS,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    arbiterAddress: ARBITER,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta",
    milestoneCount: 2,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: "0",
    totalFunded: "1000",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "10",
    updatedAtBlock: "10",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_ADDRESS,
    milestoneId: 0,
    amount: "600",
    status: 2,
    reviewWindowSeconds: 86400,
    submittedAt: "11",
    reviewDeadline: "12",
    evidenceHash: "0x",
    disputeHash: "0x",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Milestone 0",
    metadataDescription: "Verified from payload",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_ADDRESS,
    milestoneId: 1,
    amount: "400",
    status: 1,
    reviewWindowSeconds: 86400,
    submittedAt: "0",
    reviewDeadline: "0",
    evidenceHash: "0xeeee",
    disputeHash: "0xdddd",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Milestone 1",
    metadataDescription: "No payload row",
  });

  upsertMetadataCache({
    metadataHash: "0xmeta",
    metadataUrl: "mock://meta",
    verified: true,
    payloadJson: JSON.stringify({
      milestones: [
        42,
        {
          id: "0",
          title: "Milestone 0",
          description: "Verified from payload",
        },
      ],
    }),
    error: null,
    updatedAtBlock: "10",
  });
}

async function jsonRequest(path: string, method: "GET" | "POST" = "GET") {
  const app = createApp();
  const server = app.listen(0);

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not resolve ephemeral test port");
    }

    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, { method });
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

test("POST /sync succeeds with indexed checkpoint and fails closed with sanitized errors", async () => {
  resetDb();
  resetLoopState();

  setIndexerPublicClient({
    chain: { id: deploymentManifest.chain.chainId },
    getBlockNumber: async () => 21n,
    getLogs: async () => [],
    multicall: async () => [],
    readContract: async () => {
      throw new Error("not used");
    },
  });

  const success = await jsonRequest("/sync", "POST");
  assert.equal(success.status, 200);
  assert.equal(success.body.ok, true);
  assert.equal(success.body.indexedBlock, "21");

  setIndexerPublicClient({
    chain: { id: deploymentManifest.chain.chainId },
    getBlockNumber: async () => {
      throw new Error("rpc   timeout\n\n while   syncing");
    },
    getLogs: async () => [],
    multicall: async () => [],
    readContract: async () => {
      throw new Error("not used");
    },
  });

  const failed = await jsonRequest("/sync", "POST");
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, "rpc timeout while syncing");

  resetIndexerPublicClient();
});

test("GET /discover keeps stale truth explicit and normalizes malformed role stats", async (t) => {
  resetDb();
  resetLoopState();

  patchSyncHealthState({
    lastAttemptedBlock: 44n,
    lastAttemptedAt: "2026-02-01T00:03:00.000Z",
    lastSuccessfulBlock: 44n,
    lastSuccessfulAt: "2026-02-01T00:03:00.000Z",
    chainHeadSeen: 44n,
    lagBlocks: 0n,
    phase: "idle",
    status: "stale",
    lastError: null,
  });

  const previousVisibility = deploymentManifest.config.metadataVisibility;
  (deploymentManifest.config as { metadataVisibility?: string }).metadataVisibility = undefined;

  t.mock.method(discoveryReaders, "listDiscoveryAggregates", () => [
    {
      identity: {
        chainId: deploymentManifest.chain.chainId,
        address: ESCROW_ADDRESS.toLowerCase(),
        key: `${deploymentManifest.chain.chainId}:${ESCROW_ADDRESS.toLowerCase()}`,
      },
      escrow: {
        chain_id: deploymentManifest.chain.chainId,
        address: ESCROW_ADDRESS.toLowerCase(),
        buyer_address: BUYER.toLowerCase(),
        seller_address: SELLER.toLowerCase(),
        arbiter_address: ARBITER.toLowerCase(),
        token_address: TOKEN.toLowerCase(),
        metadata_hash: "0xmeta-discover",
        milestone_count: 0,
        deal_status: 0,
        current_milestone_index: 0,
        active_dispute_milestone_id: null,
        total_funded: "0",
        total_released_to_seller: "0",
        total_refunded_to_buyer: "0",
        total_fees_collected: "0",
        created_at_block: "1",
        updated_at_block: "1",
      },
      milestones: { totalCount: 0, submittedCount: 0, terminalCount: 0 },
      currentMilestone: null,
      metadataCache: null,
      roleStats: {
        buyer: { bad: true },
        seller: [
          {
            address: SELLER.toLowerCase(),
            role: "seller",
            completed_deals_count: 1,
            completed_milestones_count: 1,
            dispute_count: 0,
            dispute_wins_count: 0,
            dispute_losses_count: 0,
            resolved_dispute_count: 0,
            unresolved_dispute_count: 0,
            dispute_split_count: 0,
            cancellation_count: 0,
            total_volume: "1",
            updated_at_block: "10",
          },
          7,
        ],
        arbiter: [
          {
            address: ARBITER.toLowerCase(),
            role: "arbiter",
            completed_deals_count: 1,
            completed_milestones_count: 1,
            dispute_count: 1,
            dispute_wins_count: 1,
            dispute_losses_count: 0,
            resolved_dispute_count: 1,
            unresolved_dispute_count: 0,
            dispute_split_count: 0,
            cancellation_count: 0,
            total_volume: "10",
            updated_at_block: "8",
          },
          {
            address: ARBITER.toLowerCase(),
            role: "arbiter",
            completed_deals_count: 2,
            completed_milestones_count: 2,
            dispute_count: 2,
            dispute_wins_count: 2,
            dispute_losses_count: 0,
            resolved_dispute_count: 2,
            unresolved_dispute_count: 0,
            dispute_split_count: 0,
            cancellation_count: 0,
            total_volume: "20",
            updated_at_block: "9",
          },
        ],
      },
    },
  ]);

  try {
    const { status, body } = await jsonRequest("/discover");

    assert.equal(status, 200);

    const freshness = body.freshness as Record<string, unknown>;
    assert.equal(freshness.state, "stale");
    assert.equal(freshness.degraded, true);

    const truth = body.truth as Record<string, unknown>;
    const freshnessSummary = truth.freshnessSummary as Record<string, unknown>;
    assert.equal(freshnessSummary.reason, "Backend freshness is stale.");

    const capabilitySummary = truth.capabilitySummary as Record<string, unknown>;
    const metadataVisibility = capabilitySummary.metadataVisibility as Record<string, unknown>;
    assert.equal(metadataVisibility.state, "unknown");
    assert.equal(metadataVisibility.degraded, true);

    const items = body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);

    const roleStats = items[0].roleStats as Record<string, unknown>;
    const buyerStats = roleStats.buyer as Record<string, unknown>;
    const sellerStats = roleStats.seller as Record<string, unknown>;
    const arbiterStats = roleStats.arbiter as Record<string, unknown>;

    assert.equal(buyerStats.truthState, "missing");
    assert.match(String(buyerStats.reason), /Malformed indexed buyer role stats state/);

    assert.equal(sellerStats.truthState, "missing");
    assert.match(String(sellerStats.reason), /Malformed indexed seller role stats rows detected/);

    assert.equal(arbiterStats.truthState, "ambiguous");
    assert.equal(arbiterStats.updatedAtBlock, "9");
    assert.match(String(arbiterStats.reason), /Multiple indexed arbiter stats rows found/);
  } finally {
    (deploymentManifest.config as { metadataVisibility?: string }).metadataVisibility = previousVisibility;
  }
});

test("escrow detail routes preserve active dispute and conservative metadata/evidence truth", async () => {
  resetDb();
  resetLoopState();
  seedEscrow();

  patchSyncHealthState({
    lastAttemptedBlock: 60n,
    lastAttemptedAt: "2026-02-01T00:04:00.000Z",
    lastSuccessfulBlock: 60n,
    lastSuccessfulAt: "2026-02-01T00:04:00.000Z",
    chainHeadSeen: 60n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const escrow = await jsonRequest(`/escrows/${ESCROW_ADDRESS}`);
  assert.equal(escrow.status, 200);
  {
    const truth = escrow.body.truth as Record<string, unknown>;
    const activeDispute = truth.activeDispute as Record<string, unknown>;
    assert.equal(activeDispute.state, "present");
    assert.equal(activeDispute.milestoneId, "0");
  }

  const milestones = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones`);
  assert.equal(milestones.status, 200);
  {
    const items = milestones.body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 2);

    const firstTruth = items[0].truth as Record<string, unknown>;
    const firstMetadata = firstTruth.metadataVerification as Record<string, unknown>;
    assert.equal(firstMetadata.state, "verified");

    const firstEvidence = firstTruth.evidence as Record<string, unknown>;
    const firstDispute = firstTruth.disputeContext as Record<string, unknown>;
    assert.equal(firstEvidence.state, "missing");
    assert.equal(firstDispute.state, "missing");

    const secondTruth = items[1].truth as Record<string, unknown>;
    const secondMetadata = secondTruth.metadataVerification as Record<string, unknown>;
    assert.equal(secondMetadata.state, "missing");
    assert.match(String(secondMetadata.reason), /metadata payload has no milestone entry/);
  }

  const milestoneDetail = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones/1`);
  assert.equal(milestoneDetail.status, 200);
  {
    const truth = milestoneDetail.body.truth as Record<string, unknown>;
    const metadataVerification = truth.metadataVerification as Record<string, unknown>;
    assert.equal(metadataVerification.state, "missing");
  }
});

test("timeline route annotates hash truth and fails closed for malformed payload rows", async () => {
  resetDb();
  resetLoopState();
  seedEscrow();

  insertEvent({
    chainId: deploymentManifest.chain.chainId,
    blockNumber: "20",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000c1",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "MilestoneSubmitted",
    summary: "Submitted",
    payloadJson: JSON.stringify({ milestoneId: "0" }),
  });

  insertEvent({
    chainId: deploymentManifest.chain.chainId,
    blockNumber: "21",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000c2",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "MilestoneDisputed",
    summary: "Disputed",
    payloadJson: JSON.stringify({ milestoneId: "0", disputeHash: "0xabc" }),
  });

  insertEvent({
    chainId: deploymentManifest.chain.chainId,
    blockNumber: "22",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000c3",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "DisputeResolved",
    summary: "Resolved",
    payloadJson: JSON.stringify({ milestoneId: "0" }),
  });

  const timeline = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/timeline`);
  assert.equal(timeline.status, 200);

  const items = timeline.body.items as Array<Record<string, unknown>>;
  const submitted = items.find((item) => item.type === "MilestoneSubmitted");
  const disputed = items.find((item) => item.type === "MilestoneDisputed");
  const resolved = items.find((item) => item.type === "DisputeResolved");

  assert.ok(submitted);
  assert.ok(disputed);
  assert.ok(resolved);

  const submittedTruth = (submitted as Record<string, unknown>).truth as Record<string, unknown>;
  const submittedEvidence = submittedTruth.evidence as Record<string, unknown>;
  assert.equal(submittedEvidence.state, "missing");

  const disputedTruth = (disputed as Record<string, unknown>).truth as Record<string, unknown>;
  const disputedDisputeContext = disputedTruth.disputeContext as Record<string, unknown>;
  assert.equal(disputedDisputeContext.state, "present");
  assert.equal(disputedDisputeContext.hash, "0xabc");

  const resolvedTruth = (resolved as Record<string, unknown>).truth as Record<string, unknown>;
  const resolvedDisputeContext = resolvedTruth.disputeContext as Record<string, unknown>;
  assert.equal(resolvedDisputeContext.state, "missing");

  insertEvent({
    chainId: deploymentManifest.chain.chainId,
    blockNumber: "23",
    txHash: "0x10000000000000000000000000000000000000000000000000000000000000c4",
    logIndex: "0",
    escrowAddress: ESCROW_ADDRESS,
    eventName: "MilestoneSubmitted",
    summary: "Malformed",
    payloadJson: "{not-json",
  });

  const malformed = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/timeline`);
  assert.equal(malformed.status, 400);
  assert.match(String(malformed.body.error), /JSON|Unexpected token/);
});

test("routes reject malformed params and preserve 404s for missing indexed entities", async () => {
  resetDb();
  resetLoopState();

  const missingEscrow = await jsonRequest(`/escrows/${MISSING_ESCROW_ADDRESS}`);
  assert.equal(missingEscrow.status, 404);
  assert.equal(missingEscrow.body.error, "Escrow not indexed");

  const missingMilestones = await jsonRequest(`/escrows/${MISSING_ESCROW_ADDRESS}/milestones`);
  assert.equal(missingMilestones.status, 404);
  assert.equal(missingMilestones.body.error, "Escrow not indexed");

  const missingMilestone = await jsonRequest(`/escrows/${MISSING_ESCROW_ADDRESS}/milestones/0`);
  assert.equal(missingMilestone.status, 404);
  assert.equal(missingMilestone.body.error, "Escrow not indexed");

  seedEscrow();
  const existingEscrowMissingMilestone = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones/999`);
  assert.equal(existingEscrowMissingMilestone.status, 404);
  assert.equal(existingEscrowMissingMilestone.body.error, "Milestone not indexed");

  const badEscrow = await jsonRequest("/escrows/not-a-hex-address");
  assert.equal(badEscrow.status, 400);

  const badMilestones = await jsonRequest("/escrows/not-a-hex-address/milestones");
  assert.equal(badMilestones.status, 400);

  const badMilestone = await jsonRequest("/escrows/not-a-hex-address/milestones/abc");
  assert.equal(badMilestone.status, 400);

  const badTimeline = await jsonRequest("/escrows/not-a-hex-address/timeline");
  assert.equal(badTimeline.status, 400);

  const badUser = await jsonRequest("/users/not-a-hex-address/reputation");
  assert.equal(badUser.status, 400);
});

test("metadata verification exposes mismatched state when payload entry exists but fields are non-string/mismatched", async () => {
  resetDb();
  resetLoopState();

  upsertEscrow({
    chainId: deploymentManifest.chain.chainId,
    address: ESCROW_ADDRESS,
    buyerAddress: BUYER,
    sellerAddress: SELLER,
    arbiterAddress: ARBITER,
    tokenAddress: TOKEN,
    metadataHash: "0xmeta-mismatch",
    milestoneCount: 1,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "1",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "1",
    updatedAtBlock: "1",
  });

  upsertMilestone({
    chainId: deploymentManifest.chain.chainId,
    escrowAddress: ESCROW_ADDRESS,
    milestoneId: 0,
    amount: "1",
    status: 2,
    reviewWindowSeconds: 3600,
    submittedAt: "1",
    reviewDeadline: "2",
    evidenceHash: "0xaaaa",
    disputeHash: "0xbbbb",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "Expected title",
    metadataDescription: "Expected description",
  });

  upsertMetadataCache({
    metadataHash: "0xmeta-mismatch",
    metadataUrl: "mock://mismatch",
    verified: true,
    payloadJson: JSON.stringify({ milestones: [{ id: true, title: "ignored", description: "ignored" }, { id: 0, title: 1, description: null }] }),
    error: null,
    updatedAtBlock: "2",
  });

  const { status, body } = await jsonRequest(`/escrows/${ESCROW_ADDRESS}/milestones/0`);
  assert.equal(status, 200);

  const truth = body.truth as Record<string, unknown>;
  const metadataVerification = truth.metadataVerification as Record<string, unknown>;
  assert.equal(metadataVerification.state, "mismatched");
  assert.equal(metadataVerification.verified, false);
  assert.equal(metadataVerification.titleVerified, false);
  assert.equal(metadataVerification.descriptionVerified, false);

  const evidence = truth.evidence as Record<string, unknown>;
  const disputeContext = truth.disputeContext as Record<string, unknown>;
  assert.equal(evidence.state, "present");
  assert.equal(disputeContext.state, "present");
});

test("health and discover degrade safely when metadata visibility is unknown and non-Error exceptions bubble", async (t) => {
  resetDb();
  resetLoopState();

  patchSyncHealthState({
    lastAttemptedBlock: 77n,
    lastAttemptedAt: "2026-02-01T00:05:00.000Z",
    lastSuccessfulBlock: 77n,
    lastSuccessfulAt: "2026-02-01T00:05:00.000Z",
    chainHeadSeen: 77n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  const previousVisibility = deploymentManifest.config.metadataVisibility;
  (deploymentManifest.config as { metadataVisibility?: string }).metadataVisibility = undefined;

  t.mock.method(discoveryReaders, "listDiscoveryAggregates", () => {
    throw "  non-error\n  discover failure  ";
  });

  try {
    const health = await jsonRequest("/health");
    assert.equal(health.status, 200);
    const sync = health.body.sync as Record<string, unknown>;
    const runtime = sync.runtime as Record<string, unknown>;
    assert.equal(runtime.metadataVisibility, null);

    const discover = await jsonRequest("/discover");
    assert.equal(discover.status, 200);
    const freshness = discover.body.freshness as Record<string, unknown>;
    assert.equal(freshness.degraded, true);
    assert.match(String(freshness.lastError), /discover aggregation degraded: non-error discover failure/);
  } finally {
    (deploymentManifest.config as { metadataVisibility?: string }).metadataVisibility = previousVisibility;
  }
});
