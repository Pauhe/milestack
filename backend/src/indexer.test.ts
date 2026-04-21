import assert from "node:assert/strict";
import test from "node:test";

import { encodeEventTopics, keccak256, stringToHex, zeroAddress, zeroHash } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { deploymentManifest } from "./config.js";
import { db, getSyncHealthState, patchSyncHealthState } from "./db.js";
import {
  rebuildIndexerFromPersistedEvents,
  resetIndexerPublicClient,
  setIndexerPublicClient,
  summarizeTimelineEvent,
  deriveActorRole,
  deriveTimelineTruth,
  syncIndexer,
} from "./indexer.js";
import {
  clearMetadataCache,
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

    const escrowAfterFirstRun = getEscrow(ESCROW_ADDRESS);
    assert.ok(escrowAfterFirstRun);
    assert.equal(escrowAfterFirstRun.deal_status, dealStatusCompleted);

    const milestoneAfterFirstRun = getMilestone(ESCROW_ADDRESS, 0);
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

    const escrowAfterRebuild = getEscrow(ESCROW_ADDRESS);
    assert.ok(escrowAfterRebuild);
    assert.equal(escrowAfterRebuild.deal_status, dealStatusCompleted);

    const milestoneAfterRebuild = getMilestone(ESCROW_ADDRESS, 0);
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
  ).run(31337, "10", "0xmalformed", "0", ESCROW_ADDRESS, "EscrowCreated", "Escrow deployed", "{not-json");

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

test("rebuildIndexerFromPersistedEvents keeps degraded status visible when metadata cache is missing", async () => {
  resetDb();

  const client = createMockClient();
  seedHistory(client, { includeEscrowCreated: true });

  setIndexerPublicClient(client);

  try {
    await syncIndexer();
    clearMetadataCache();

    const result = await rebuildIndexerFromPersistedEvents();
    assert.equal(result.replayedEventCount, 6);

    const health = getSyncHealthState();
    assert.equal(health.status, "stale");
    assert.match(health.lastError ?? "", /metadata verification degraded/);
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

  return {
    chain: { id: 31337 },
    getBlockNumber: async () => 200n,
    getLogs: async ({ address, fromBlock }: { address: string; fromBlock?: bigint }) => {
      const logs = logsByAddress.get(address.toLowerCase()) ?? [];
      const start = fromBlock ?? 0n;
      return logs.filter((item) => item.blockNumber >= start);
    },
    multicall: async () => {
      throw new Error("multicall not expected in event-driven rebuild tests");
    },
    readContract: async () => {
      throw new Error("readContract not expected in event-driven rebuild tests");
    },
    seed(address: string, logs: MockLog[]) {
      logsByAddress.set(address.toLowerCase(), logs);
    },
  };
}

type MockLog = {
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

  return "0x";
}

function padAddress(value: string): `0x${string}` {
  const raw = value.toLowerCase().replace(/^0x/, "");
  return `0x${raw.padStart(64, "0")}`;
}

function padUint(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
