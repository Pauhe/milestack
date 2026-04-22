import assert from "node:assert/strict";
import test from "node:test";

import { type Address, encodeEventTopics, keccak256, stringToHex, zeroAddress, zeroHash } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { deploymentManifest } from "./config.js";
import { db, getSyncHealthState, patchSyncHealthState } from "./db.js";
import {
  rebuildIndexerFromPersistedEvents,
  resetIndexerPublicClient,
  setIndexerPublicClient,
  summarizeTimelineEvent,
  deriveActorDetails,
  deriveActorRole,
  deriveTimelineTruth,
  syncIndexer,
} from "./indexer.js";
import {
  getEscrow,
  getEventCount,
  getMilestone,
  getUserRoleStats,
  upsertMetadataCache,
} from "./repository.js";

const ESCROW_ADDRESS = "0x1000000000000000000000000000000000000001";
const BUYER = "0x2000000000000000000000000000000000000002";
const SELLER = "0x3000000000000000000000000000000000000003";
const ARBITER = "0x4000000000000000000000000000000000000004";
const TOKEN = "0x5000000000000000000000000000000000000005";
const METADATA_JSON = {
  version: 1,
  milestones: [
    { id: 0, title: "Discovery", description: "Initial phase" },
    { id: 1, title: "Delivery", description: "Final phase" },
  ],
};
const METADATA_HASH = keccak256(stringToHex(JSON.stringify(METADATA_JSON)));

const dealStatusCompleted = 2;
const milestoneStatusPaidOut = 7;

test("syncIndexer is replay-safe and preserves deterministic projections across restart + rebuild", async () => {
  resetDb();

  const client = createMockClient();
  seedHistory(client, { includeEscrowCreated: true });

  setIndexerPublicClient(client);

  try {
    patchSyncHealthState({
      lastSuccessfulBlock: 0n,
      chainHeadSeen: 0n,
      lagBlocks: 0n,
      phase: "idle",
      status: "idle",
      lastError: null,
      lastSuccessfulAt: null,
      lastAttemptedAt: null,
      lastAttemptedBlock: 0n,
    });

    upsertMetadataCache({
      metadataHash: METADATA_HASH,
      metadataUrl: "mock://metadata",
      verified: true,
      payloadJson: JSON.stringify(METADATA_JSON),
      error: null,
      updatedAtBlock: "0",
    });

    const firstRun = await syncIndexer();
    assert.equal(firstRun.insertedEventCount, 6);
    assert.equal(firstRun.replayedEventCount, 6);
    assert.equal(getEventCount(), 6);

    const escrowAfterFirstRun = getEscrow(31337, ESCROW_ADDRESS);
    assert.ok(escrowAfterFirstRun);
    assert.equal(escrowAfterFirstRun.deal_status, dealStatusCompleted);

    const milestoneAfterFirstRun = getMilestone(31337, ESCROW_ADDRESS, 0);
    assert.ok(milestoneAfterFirstRun);
    assert.equal(milestoneAfterFirstRun.status, milestoneStatusPaidOut);

    const sellerStatsAfterFirstRun = getUserRoleStats(SELLER).find((item) => item.role === "seller");
    assert.ok(sellerStatsAfterFirstRun);
    assert.equal(sellerStatsAfterFirstRun.completed_deals_count, 1);
    assert.equal(sellerStatsAfterFirstRun.completed_milestones_count, 1);

    const secondRun = await syncIndexer();
    assert.equal(secondRun.insertedEventCount, 0, "no new events should be inserted on overlap replay");
    assert.equal(secondRun.replayedEventCount, 6, "rebuild should replay canonical events");
    assert.equal(getEventCount(), 6, "event ingestion must remain idempotent");

    const healthAfterSecondRun = getSyncHealthState();
    assert.equal(healthAfterSecondRun.status, "healthy");
    assert.equal(healthAfterSecondRun.phase, "idle");
    assert.equal(healthAfterSecondRun.lastSuccessfulBlock, 200n);
    assert.equal(healthAfterSecondRun.chainHeadSeen, 200n);
    assert.equal(healthAfterSecondRun.lagBlocks, 0n);

    const rebuildResult = await rebuildIndexerFromPersistedEvents();
    assert.equal(rebuildResult.insertedEventCount, 0);
    assert.equal(rebuildResult.replayedEventCount, 6);
    assert.equal(getEventCount(), 6);

    const escrowAfterRebuild = getEscrow(31337, ESCROW_ADDRESS);
    assert.ok(escrowAfterRebuild);
    assert.equal(escrowAfterRebuild.deal_status, dealStatusCompleted);

    const milestoneAfterRebuild = getMilestone(31337, ESCROW_ADDRESS, 0);
    assert.ok(milestoneAfterRebuild);
    assert.equal(milestoneAfterRebuild.status, milestoneStatusPaidOut);

    const sellerStatsAfterRebuild = getUserRoleStats(SELLER).find((item) => item.role === "seller");
    assert.ok(sellerStatsAfterRebuild);
    assert.equal(sellerStatsAfterRebuild.completed_deals_count, 1);
    assert.equal(sellerStatsAfterRebuild.completed_milestones_count, 1);
  } finally {
    resetIndexerPublicClient();
  }
});

test("syncIndexer batches escrow log discovery into bounded RPC fan-out for high known-escrow sets", async () => {
  resetDb();

  const client = createMockClient();

  const factoryAddress = deploymentManifest.contracts.escrowFactory.address;
  const highEscrowCount = 24;
  const seededEscrows = Array.from({ length: highEscrowCount }, (_, index) => makeAddress(index + 1));

  client.seed(
    factoryAddress,
    seededEscrows.map((escrowAddress, index) =>
      createLog(
        escrowFactoryAbi,
        "EscrowCreated",
        {
          escrow: escrowAddress,
          buyer: BUYER,
          seller: SELLER,
          arbiter: ARBITER,
          token: TOKEN,
          milestoneCount: 1n,
          metadataHash: METADATA_HASH,
        },
        100n + BigInt(index),
        makeTxHash(1000 + index),
        0
      )
    )
  );

  seededEscrows.forEach((escrowAddress, index) => {
    client.seed(escrowAddress, [
      createLog(
        milestoneEscrowAbi,
        "MilestoneFunded",
        { milestoneId: 0n, amount: BigInt(1000 + index) },
150n + BigInt(index),
        makeTxHash(2000 + index),
        0
      ),
    ]);
  });

  setIndexerPublicClient(client);

  try {
    const firstRun = await syncIndexer();

    assert.equal(firstRun.insertedEventCount, highEscrowCount * 2);
    assert.equal(getEventCount(), highEscrowCount * 2);
    assert.equal(client.getEscrowGetLogsCallCount(), 1, "known escrows should be fetched in one batched getLogs call");

    const secondRun = await syncIndexer();
    assert.equal(secondRun.insertedEventCount, 0, "overlap replay remains idempotent");
    assert.equal(secondRun.replayedEventCount, highEscrowCount * 2);
    assert.equal(getEventCount(), highEscrowCount * 2);

    assert.equal(client.getEscrowGetLogsCallCount(), 2, "each sync should make one escrow batched getLogs call");
    assert.equal(client.getLogsCallCount(), 4, "two syncs should call getLogs for factory + escrow batches");
  } finally {
    resetIndexerPublicClient();
  }
});

test("timeline claim semantics stay ambiguous when adjacent approval is for a different milestone", () => {
  const summary = summarizeTimelineEvent("MilestoneClaimed", {
    payload: { milestoneId: "1" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(summary, "Milestone payout finalized (approval or seller timeout claim remains ambiguous)");

  const actorRole = deriveActorRole("MilestoneClaimed", {
    payload: { milestoneId: "1" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(actorRole, null);

  const truth = deriveTimelineTruth("MilestoneClaimed", {
    payload: { milestoneId: "1" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: "0" },
  });
  assert.equal(truth.ambiguous, true);
  assert.equal(truth.payoutAttribution, "seller_timeout_or_unresolved");
});

test("timeline claim semantics treat next-event approval on the same milestone as buyer-approved", () => {
  const context = {
    payload: { milestoneId: "7" },
    nextEventName: "MilestoneApproved",
    nextPayload: { milestoneId: 7n },
  };

  const summary = summarizeTimelineEvent("MilestoneClaimed", context);
  assert.equal(summary, "Milestone payout finalized after buyer approval");

  const actorRole = deriveActorRole("MilestoneClaimed", context);
  assert.equal(actorRole, "buyer");

  const truth = deriveTimelineTruth("MilestoneClaimed", context);
  assert.equal(truth.ambiguous, false);
  assert.equal(truth.payoutAttribution, "buyer_approved");
});

test("timeline helpers fail closed on malformed milestoneId payloads", () => {
  const malformedContexts = [
    { payload: { milestoneId: "01a" }, nextEventName: "MilestoneApproved", nextPayload: { milestoneId: "01a" } },
    { payload: { milestoneId: 1.25 }, previousEventName: "MilestoneApproved", previousPayload: { milestoneId: 1.25 } },
    { payload: { milestoneId: true }, previousEventName: "MilestoneApproved", previousPayload: { milestoneId: true } },
    { payload: { milestoneId: null }, nextEventName: "MilestoneApproved", nextPayload: { milestoneId: 0 } },
  ] as const;

  for (const context of malformedContexts) {
    const summary = summarizeTimelineEvent("MilestoneClaimed", context);
    assert.equal(summary, "Milestone payout finalized (approval or seller timeout claim remains ambiguous)");

    const actorRole = deriveActorRole("MilestoneClaimed", context);
    assert.equal(actorRole, null);

    const truth = deriveTimelineTruth("MilestoneClaimed", context);
    assert.equal(truth.ambiguous, true);
    assert.equal(truth.payoutAttribution, "seller_timeout_or_unresolved");
  }
});

test("deriveActorDetails resolves actor addresses for each role and preserves conservative claim ambiguity", () => {
  const participants = {
    buyer_address: BUYER,
    seller_address: SELLER,
    arbiter_address: ARBITER,
  };

  const funded = deriveActorDetails("MilestoneFunded", participants);
  assert.deepEqual(funded, { address: BUYER, role: "buyer" });

  const submitted = deriveActorDetails("MilestoneSubmitted", participants);
  assert.deepEqual(submitted, { address: SELLER, role: "seller" });

  const resolved = deriveActorDetails("DisputeResolved", participants);
  assert.deepEqual(resolved, { address: ARBITER, role: "arbiter" });

  const claimedWithApproval = deriveActorDetails("MilestoneClaimed", participants, {
    payload: { milestoneId: "3" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: 3 },
  });
  assert.deepEqual(claimedWithApproval, { address: BUYER, role: "buyer" });

  const ambiguousClaimed = deriveActorDetails("MilestoneClaimed", participants, {
    payload: { milestoneId: "3" },
    previousEventName: "MilestoneApproved",
    previousPayload: { milestoneId: 2 },
  });
  assert.equal(ambiguousClaimed, null);

  const unknown = deriveActorDetails("DealCompleted", participants);
  assert.equal(unknown, null);

  const withoutParticipants = deriveActorDetails("MilestoneFunded");
  assert.equal(withoutParticipants, null);
});

test("syncIndexer persists failure state when RPC log discovery fails and keeps last successful checkpoint", async () => {
  resetDb();

  const erroringClient = {
    chain: { id: 31337 },
    getBlockNumber: async () => 55n,
    getLogs: async () => {
      throw new Error("rpc timeout while reading logs");
    },
    multicall: async () => {
      throw new Error("should not be called");
    },
    readContract: async () => {
      throw new Error("should not be called");
    },
  };

  patchSyncHealthState({
    lastSuccessfulBlock: 40n,
    chainHeadSeen: 40n,
    lagBlocks: 0n,
    status: "healthy",
    phase: "idle",
    lastError: null,
    lastSuccessfulAt: "2026-01-01T00:00:00.000Z",
  });

  setIndexerPublicClient(erroringClient);

  await assert.rejects(() => syncIndexer(), /rpc timeout while reading logs/);

  const health = getSyncHealthState();
  assert.equal(health.status, "failed");
  assert.equal(health.phase, "discover_logs");
  assert.equal(health.lastSuccessfulBlock, 40n);
  assert.equal(health.chainHeadSeen, 55n);
  assert.equal(health.lagBlocks, 15n);
  assert.match(health.lastError ?? "", /rpc timeout/);

  resetIndexerPublicClient();
});

test("rebuildIndexerFromPersistedEvents fails on malformed payload JSON and marks sync failed", async () => {
  resetDb();

  db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(deploymentManifest.chain.chainId, "10", "0xmalformed", "0", ESCROW_ADDRESS, "EscrowCreated", "Escrow deployed", "{not-json");

  patchSyncHealthState({
    status: "healthy",
    phase: "idle",
    lastSuccessfulBlock: 10n,
    chainHeadSeen: 10n,
    lagBlocks: 0n,
    lastError: null,
  });

  await assert.rejects(() => rebuildIndexerFromPersistedEvents(), /Malformed payload_json/);

  const health = getSyncHealthState();
  assert.equal(health.status, "failed");
  assert.equal(health.phase, "rebuild_projections");
  assert.match(health.lastError ?? "", /Malformed payload_json/);
});

test("rebuildIndexerFromPersistedEvents on empty canonical events table is stable and healthy", async () => {
  resetDb();

  patchSyncHealthState({
    status: "healthy",
    phase: "idle",
    lastSuccessfulBlock: 0n,
    chainHeadSeen: 0n,
    lagBlocks: 0n,
    lastError: null,
  });

  const result = await rebuildIndexerFromPersistedEvents();
  assert.equal(result.replayedEventCount, 0);
  assert.equal(result.escrowsIndexed, 0);

  const health = getSyncHealthState();
  assert.equal(health.status, "healthy");
  assert.equal(health.phase, "idle");
  assert.equal(health.lastSuccessfulBlock, 0n);
  assert.equal(health.lagBlocks, 0n);
});

test("syncIndexer marks stale status when metadata verification is degraded", async () => {
  resetDb();

  const client = createMockClient();
  seedHistory(client, { includeEscrowCreated: true });
  setIndexerPublicClient(client);

  try {
    upsertMetadataCache({
      metadataHash: METADATA_HASH,
      metadataUrl: "mock://broken",
      verified: true,
      payloadJson: null,
      error: null,
      updatedAtBlock: "0",
    });

    const result = await syncIndexer();
    assert.equal(result.insertedEventCount, 6);

    const health = getSyncHealthState();
    assert.equal(health.status, "stale");
    assert.equal(health.phase, "idle");
    assert.match(health.lastError ?? "", /metadata verification degraded/);
  } finally {
    resetIndexerPublicClient();
  }
});

test("syncIndexer ignores non-EscrowCreated factory logs", async () => {
  resetDb();

  const client = createMockClient();
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address;

  client.seed(factoryAddress, [createNonEscrowFactoryLog(50n, makeTxHash(5001), 0)]);

  setIndexerPublicClient(client);

  try {
    const result = await syncIndexer();

    assert.equal(result.insertedEventCount, 0);
    assert.equal(result.escrowsIndexed, 0);
    assert.equal(getEventCount(), 0);

    const health = getSyncHealthState();
    assert.equal(health.status, "healthy");
    assert.equal(health.lastSuccessfulBlock, 200n);
  } finally {
    resetIndexerPublicClient();
  }
});

test("syncIndexer ignores escrow logs from unknown addresses and untracked event topics", async () => {
  resetDb();

  const client = createMockClient();
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address;
  const unknownEscrow = makeAddress(777);

  client.seed(factoryAddress, [
    createLog(
      escrowFactoryAbi,
      "EscrowCreated",
      {
        escrow: ESCROW_ADDRESS,
        buyer: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        token: TOKEN,
        milestoneCount: 1n,
        metadataHash: METADATA_HASH,
      },
      80n,
      makeTxHash(8001),
      0
    ),
  ]);

  client.seed(ESCROW_ADDRESS, [createUntrackedMilestoneEscrowLog(ESCROW_ADDRESS, 81n, makeTxHash(8002), 0)]);
  client.seed(unknownEscrow, [createUnknownEscrowEventLog(unknownEscrow, 82n, makeTxHash(8003), 0)]);

  setIndexerPublicClient(client);

  try {
    const result = await syncIndexer();

    assert.equal(result.insertedEventCount, 1, "only EscrowCreated should persist");
    assert.equal(getEventCount(), 1);

    const escrow = getEscrow(31337, ESCROW_ADDRESS);
    assert.ok(escrow);
    assert.equal(escrow.total_funded, "0");

    const milestone = getMilestone(31337, ESCROW_ADDRESS, 0);
    assert.ok(milestone);
    assert.equal(milestone.status, 0);
  } finally {
    resetIndexerPublicClient();
  }
});

test("rebuildIndexerFromPersistedEvents tolerates orphan lifecycle events and still persists healthy outcome", async () => {
  resetDb();

  const chainId = 31337;
  const client = createMockClient();
  setIndexerPublicClient(client);

  db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(chainId, "42", makeTxHash(4200), "0", ESCROW_ADDRESS, "MilestoneFunded", "Buyer funded milestone", JSON.stringify({ milestoneId: 0, amount: "1000" }));

  patchSyncHealthState({
    status: "healthy",
    phase: "idle",
    lastSuccessfulBlock: 42n,
    chainHeadSeen: 42n,
    lagBlocks: 0n,
    lastError: null,
  });

  const result = await rebuildIndexerFromPersistedEvents();

  assert.equal(result.replayedEventCount, 1);
  assert.equal(result.escrowsIndexed, 0);
  assert.equal(getEscrow(31337, ESCROW_ADDRESS), undefined);

  const health = getSyncHealthState();
  assert.equal(health.status, "healthy");
  assert.equal(health.phase, "idle");

  resetIndexerPublicClient();
});

test("rebuildIndexerFromPersistedEvents fails when payload_json is not an object", async () => {
  resetDb();

  const chainId = 31337;
  const client = createMockClient();
  setIndexerPublicClient(client);

  db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(chainId, "11", makeTxHash(1100), "0", ESCROW_ADDRESS, "EscrowCreated", "Escrow deployed", JSON.stringify(["not", "object"]));

  patchSyncHealthState({
    status: "healthy",
    phase: "idle",
    lastSuccessfulBlock: 11n,
    chainHeadSeen: 11n,
    lagBlocks: 0n,
    lastError: null,
  });

  await assert.rejects(() => rebuildIndexerFromPersistedEvents(), /Malformed payload_json object/);

  const health = getSyncHealthState();
  assert.equal(health.status, "failed");
  assert.equal(health.phase, "rebuild_projections");

  resetIndexerPublicClient();
});

test("rebuildIndexerFromPersistedEvents applies dispute lifecycle events and metadata fallback behavior", async () => {
  resetDb();

  const client = createMockClient();
  const chainId = 31337;
  const metadataHashNoPayload = "0x" + "ab".repeat(32);

  client.seed(deploymentManifest.contracts.escrowFactory.address, []);
  setIndexerPublicClient(client);

  db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    chainId,
    "10",
    makeTxHash(10000),
    "0",
    ESCROW_ADDRESS,
    "EscrowCreated",
    "Escrow deployed",
    JSON.stringify({
      escrow: ESCROW_ADDRESS,
      buyer: BUYER,
      seller: SELLER,
      arbiter: ARBITER,
      token: TOKEN,
      milestoneCount: "2",
      metadataHash: metadataHashNoPayload,
    })
  );

  const insertEventRow = db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  insertEventRow.run(chainId, "11", makeTxHash(10001), "0", ESCROW_ADDRESS, "MilestoneFunded", "Buyer funded milestone", JSON.stringify({ milestoneId: "0", amount: "111" }));
  insertEventRow.run(chainId, "12", makeTxHash(10002), "0", ESCROW_ADDRESS, "MilestoneSubmitted", "Seller submitted milestone evidence", JSON.stringify({ milestoneId: "0", evidenceHash: zeroHash, submittedAt: "12", reviewDeadline: "112" }));
  insertEventRow.run(chainId, "13", makeTxHash(10003), "0", ESCROW_ADDRESS, "MilestoneDisputed", "Buyer opened a dispute", JSON.stringify({ milestoneId: "0", disputeHash: zeroHash }));
  insertEventRow.run(chainId, "14", makeTxHash(10004), "0", ESCROW_ADDRESS, "DisputeResolved", "Arbiter resolved disputed milestone", JSON.stringify({ milestoneId: "0", buyerAmount: "0", sellerAmount: "100", feeAmount: "11" }));
  insertEventRow.run(chainId, "15", makeTxHash(10005), "0", ESCROW_ADDRESS, "MilestoneCancelled", "Remaining milestone cancelled", JSON.stringify({ milestoneId: "1" }));
  insertEventRow.run(chainId, "16", makeTxHash(10006), "0", ESCROW_ADDRESS, "DealCancelled", "Deal cancelled", JSON.stringify({}));

  upsertMetadataCache({
    metadataHash: metadataHashNoPayload,
    metadataUrl: "mock://degraded",
    verified: false,
    payloadJson: JSON.stringify({ milestones: [{ id: 0, title: 12345, description: "ok" }] }),
    error: "signature mismatch",
    updatedAtBlock: "16",
  });

  try {
    const result = await rebuildIndexerFromPersistedEvents();

    assert.equal(result.replayedEventCount, 7);

    const escrow = getEscrow(31337, ESCROW_ADDRESS);
    assert.ok(escrow);
    assert.equal(escrow.deal_status, 3);
    assert.equal(escrow.current_milestone_index, 1);
    assert.equal(escrow.active_dispute_milestone_id, null);
    assert.equal(escrow.total_released_to_seller, "100");
    assert.equal(escrow.total_fees_collected, "11");

    const milestone0 = getMilestone(31337, ESCROW_ADDRESS, 0);
    assert.ok(milestone0);
    assert.equal(milestone0.status, 7);
    assert.equal(milestone0.amount, "111");
    assert.equal(milestone0.metadata_title, null, "non-string metadata title should fail soft to null");
    assert.equal(milestone0.metadata_description, "ok");

    const milestone1 = getMilestone(31337, ESCROW_ADDRESS, 1);
    assert.ok(milestone1);
    assert.equal(milestone1.status, 9);

    const health = getSyncHealthState();
    assert.equal(health.status, "stale");
    assert.match(health.lastError ?? "", /metadata verification degraded/);
  } finally {
    resetIndexerPublicClient();
  }
});

test("rebuildIndexerFromPersistedEvents preserves terminal paidOut milestone against late MilestoneApproved", async () => {
  resetDb();

  const chainId = 31337;
  const client = createMockClient();
  setIndexerPublicClient(client);

  const insertEventRow = db.prepare(
    `
      INSERT INTO events (
        chain_id,
        block_number,
        tx_hash,
        log_index,
        escrow_address,
        event_name,
        summary,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  insertEventRow.run(
    chainId,
    "10",
    makeTxHash(12000),
    "0",
    ESCROW_ADDRESS,
    "EscrowCreated",
    "Escrow deployed",
    JSON.stringify({
      escrow: ESCROW_ADDRESS,
      buyer: BUYER,
      seller: SELLER,
      arbiter: ARBITER,
      token: TOKEN,
      milestoneCount: "1",
      metadataHash: METADATA_HASH,
    })
  );
  insertEventRow.run(chainId, "11", makeTxHash(12001), "0", ESCROW_ADDRESS, "MilestoneFunded", "Buyer funded milestone", JSON.stringify({ milestoneId: 0, amount: "1500" }));
  insertEventRow.run(chainId, "12", makeTxHash(12002), "0", ESCROW_ADDRESS, "MilestoneClaimed", "Milestone payout finalized", JSON.stringify({ milestoneId: 0, sellerAmount: "1490", feeAmount: "10" }));
  insertEventRow.run(chainId, "13", makeTxHash(12003), "0", ESCROW_ADDRESS, "MilestoneApproved", "Buyer approved milestone", JSON.stringify({ milestoneId: 0 }));

  try {
    const result = await rebuildIndexerFromPersistedEvents();
    assert.equal(result.replayedEventCount, 4);

    const milestone = getMilestone(chainId, ESCROW_ADDRESS, 0);
    assert.ok(milestone);
    assert.equal(milestone.status, 7, "late approval must not downgrade already-terminal payout status");
    assert.equal(milestone.seller_award, "1490");

    const escrow = getEscrow(chainId, ESCROW_ADDRESS);
    assert.ok(escrow);
    assert.equal(escrow.total_released_to_seller, "1490");
  } finally {
    resetIndexerPublicClient();
  }
});

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

function createMockClient() {
  const logsByAddress = new Map<string, MockLog[]>();
  const getLogsCalls: Array<{ addresses: string[]; fromBlock?: bigint }> = [];

  return {
    chain: { id: 31337 },
    getBlockNumber: async () => 200n,
    getLogs: async ({ address, fromBlock }: { address: string | readonly string[]; fromBlock?: bigint }) => {
      const addresses = (Array.isArray(address) ? [...address] : [address]).map((item) => item.toLowerCase());
      getLogsCalls.push({ addresses, fromBlock });

      const start = fromBlock ?? 0n;
      const logs = addresses.flatMap((item) => logsByAddress.get(item) ?? []);

      return logs
        .filter((item) => item.blockNumber >= start)
        .sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber < b.blockNumber ? -1 : 1;
          }

          if (a.transactionHash !== b.transactionHash) {
            return a.transactionHash.localeCompare(b.transactionHash);
          }

          return a.logIndex - b.logIndex;
        });
    },
    multicall: async () => {
      throw new Error("multicall not expected in event-driven rebuild tests");
    },
    readContract: async () => {
      throw new Error("readContract not expected in event-driven rebuild tests");
    },
    seed(address: string, logs: MockLog[]) {
      const normalizedAddress = address.toLowerCase();
      logsByAddress.set(
        normalizedAddress,
        logs.map((log) => ({
          ...log,
          address: normalizedAddress as Address,
        }))
      );
    },
    getLogsCallCount() {
      return getLogsCalls.length;
    },
    getEscrowGetLogsCallCount() {
      const factoryAddress = deploymentManifest.contracts.escrowFactory.address.toLowerCase();
      return getLogsCalls.filter((call) => !call.addresses.includes(factoryAddress)).length;
    },
    getLogsCalls() {
      return [...getLogsCalls];
    },
  };
}

type MockLog = {
  address?: Address;
  data: `0x${string}`;
  topics: [signature: `0x${string}`, ...args: `0x${string}`[]];
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
};

function seedHistory(client: ReturnType<typeof createMockClient>, options: { includeEscrowCreated: boolean }) {
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address;

  const factoryLogs: MockLog[] = [];
  if (options.includeEscrowCreated) {
    factoryLogs.push(
      createLog(escrowFactoryAbi, "EscrowCreated", {
        escrow: ESCROW_ADDRESS,
        buyer: BUYER,
        seller: SELLER,
        arbiter: ARBITER,
        token: TOKEN,
        milestoneCount: 2n,
        metadataHash: METADATA_HASH,
      }, 100n, "0x1000000000000000000000000000000000000000000000000000000000000100", 0)
    );
  }

  client.seed(factoryAddress, factoryLogs);

  client.seed(ESCROW_ADDRESS, [
    createLog(milestoneEscrowAbi, "MilestoneFunded", { milestoneId: 0n, amount: 1000n }, 101n, "0x1000000000000000000000000000000000000000000000000000000000000101", 0),
    createLog(
      milestoneEscrowAbi,
      "MilestoneSubmitted",
      { milestoneId: 0n, evidenceHash: zeroHash, submittedAt: 102n, reviewDeadline: 202n },
      102n,
      "0x1000000000000000000000000000000000000000000000000000000000000102",
      0
    ),
    createLog(
      milestoneEscrowAbi,
      "MilestoneClaimed",
      { milestoneId: 0n, sellerAmount: 990n, feeAmount: 10n },
      103n,
      "0x1000000000000000000000000000000000000000000000000000000000000103",
      0
    ),
    createLog(milestoneEscrowAbi, "MilestoneApproved", { milestoneId: 0n }, 103n, "0x1000000000000000000000000000000000000000000000000000000000000103", 1),
    createLog(milestoneEscrowAbi, "DealCompleted", {}, 104n, "0x1000000000000000000000000000000000000000000000000000000000000104", 0),
  ]);
}

function createNonEscrowFactoryLog(blockNumber: bigint, txHash: `0x${string}`, logIndex: number): MockLog {
  return createLog(
    escrowFactoryAbi,
    "EscrowCreatedWidened",
    {
      escrow: ESCROW_ADDRESS,
      authorityModelVersion: 1,
      participantCount: 2,
      delegationCount: 0,
    },
    blockNumber,
    txHash,
    logIndex
  );
}

function createUnknownEscrowEventLog(address: Address, blockNumber: bigint, txHash: `0x${string}`, logIndex: number): MockLog {
  return {
    address,
    data: "0x",
    topics: [zeroHash],
    blockNumber,
    transactionHash: txHash,
    logIndex,
  };
}

function createUntrackedMilestoneEscrowLog(address: Address, blockNumber: bigint, txHash: `0x${string}`, logIndex: number): MockLog {
  return createLog(
    milestoneEscrowAbi,
    "WidenedAuthorityConfigured",
    {
      authorityModelVersion: 1,
      participantCount: 2,
      delegationCount: 0,
    },
    blockNumber,
    txHash,
    logIndex
  );
}

function createLog(
  abi: readonly unknown[],
  eventName: string,
  args: Record<string, PrimitiveArg>,
  blockNumber: bigint,
  txHash: `0x${string}`,
  logIndex: number
): MockLog {
  const topics = encodeEventTopics({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abi: abi as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventName: eventName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  });

  if (!topics || !Array.isArray(topics) || topics.length === 0 || typeof topics[0] !== "string") {
    throw new Error(`Unable to encode topics for ${eventName}`);
  }

  const encoded = encodeNonIndexedData(eventName, args);

  return {
    data: encoded,
    topics: topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
    blockNumber,
    transactionHash: txHash,
    logIndex,
  };
}

type PrimitiveArg = string | number | bigint | boolean;

function encodeNonIndexedData(eventName: string, args: Record<string, PrimitiveArg>): `0x${string}` {
  if (eventName === "EscrowCreated") {
    const arbiter = String(args.arbiter ?? zeroAddress);
    const token = String(args.token ?? zeroAddress);
    const milestoneCount = BigInt(args.milestoneCount ?? 0n);
    const metadataHash = String(args.metadataHash ?? zeroHash);

    return padAddress(arbiter) + padAddress(token).slice(2) + padUint(milestoneCount).slice(2) + metadataHash.slice(2) as `0x${string}`;
  }

  if (eventName === "EscrowCreatedWidened") {
    return (padUint(BigInt(args.participantCount ?? 0n)) + padUint(BigInt(args.delegationCount ?? 0n)).slice(2)) as `0x${string}`;
  }

  if (eventName === "MilestoneFunded") {
    return padUint(BigInt(args.amount ?? 0n));
  }

  if (eventName === "MilestoneSubmitted") {
    return (
      (args.evidenceHash as string) +
      padUint(BigInt(args.submittedAt ?? 0n)).slice(2) +
      padUint(BigInt(args.reviewDeadline ?? 0n)).slice(2)
    ) as `0x${string}`;
  }

  if (eventName === "MilestoneClaimed") {
    return (padUint(BigInt(args.sellerAmount ?? 0n)) + padUint(BigInt(args.feeAmount ?? 0n)).slice(2)) as `0x${string}`;
  }

  if (eventName === "WidenedAuthorityConfigured") {
    return (padUint(BigInt(args.participantCount ?? 0n)) + padUint(BigInt(args.delegationCount ?? 0n)).slice(2)) as `0x${string}`;
  }

  return "0x";
}

function makeAddress(index: number): Address {
  return `0x${index.toString(16).padStart(40, "0")}` as Address;
}

function makeTxHash(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function padAddress(value: string): `0x${string}` {
  const raw = value.toLowerCase().replace(/^0x/, "");
  return `0x${raw.padStart(64, "0")}`;
}

function padUint(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
