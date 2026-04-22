import assert from "node:assert/strict";
import test from "node:test";

import { assertRuntimeChainSupported, getConfiguredChain } from "./chains.js";
import { deploymentManifest, validatedDeploymentManifests } from "./config.js";
import { db } from "./db.js";
import {
  clearDerivedReadModels,
  getEscrow,
  getEventCount,
  getMilestone,
  insertEvent,
  listMilestones,
  listKnownEscrows,
  upsertEscrow,
  upsertMilestone,
} from "./repository.js";

test.beforeEach(() => {
  clearDerivedReadModels();
  db.exec(`
    DELETE FROM events;
    DELETE FROM sync_state;
  `);
});

test("repository keys escrows and milestones by (chain_id, escrow_address)", () => {
  const sameEscrow = "0x1000000000000000000000000000000000000001";

  upsertEscrow({
    chainId: 31337,
    address: sameEscrow,
    buyerAddress: "0x2000000000000000000000000000000000000002",
    sellerAddress: "0x3000000000000000000000000000000000000003",
    arbiterAddress: "0x4000000000000000000000000000000000000004",
    tokenAddress: "0x5000000000000000000000000000000000000005",
    metadataHash: "0xmeta31337",
    milestoneCount: 1,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "100",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "10",
    updatedAtBlock: "10",
  });

  upsertEscrow({
    chainId: 84532,
    address: sameEscrow,
    buyerAddress: "0x6000000000000000000000000000000000000006",
    sellerAddress: "0x7000000000000000000000000000000000000007",
    arbiterAddress: "0x8000000000000000000000000000000000000008",
    tokenAddress: "0x9000000000000000000000000000000000000009",
    metadataHash: "0xmeta84532",
    milestoneCount: 1,
    dealStatus: 2,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "200",
    totalReleasedToSeller: "50",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "1",
    createdAtBlock: "20",
    updatedAtBlock: "20",
  });

  upsertMilestone({
    chainId: 31337,
    escrowAddress: sameEscrow,
    milestoneId: 0,
    amount: "100",
    status: 1,
    reviewWindowSeconds: 60,
    submittedAt: "0",
    reviewDeadline: "0",
    evidenceHash: "0x",
    disputeHash: "0x",
    buyerAward: "0",
    sellerAward: "0",
    metadataTitle: "anvil",
    metadataDescription: "anvil chain row",
  });

  upsertMilestone({
    chainId: 84532,
    escrowAddress: sameEscrow,
    milestoneId: 0,
    amount: "200",
    status: 2,
    reviewWindowSeconds: 120,
    submittedAt: "1",
    reviewDeadline: "2",
    evidenceHash: "0xevidence",
    disputeHash: "0xdispute",
    buyerAward: "0",
    sellerAward: "50",
    metadataTitle: "base sepolia",
    metadataDescription: "base sepolia chain row",
  });

  const escrowAnvil = getEscrow(31337, sameEscrow);
  const escrowBaseSepolia = getEscrow(84532, sameEscrow);
  assert.ok(escrowAnvil);
  assert.ok(escrowBaseSepolia);
  assert.equal(escrowAnvil.metadata_hash, "0xmeta31337");
  assert.equal(escrowBaseSepolia.metadata_hash, "0xmeta84532");

  const milestoneAnvil = getMilestone(31337, sameEscrow, 0);
  const milestoneBaseSepolia = getMilestone(84532, sameEscrow, 0);
  assert.ok(milestoneAnvil);
  assert.ok(milestoneBaseSepolia);
  assert.equal(milestoneAnvil.metadata_title, "anvil");
  assert.equal(milestoneBaseSepolia.metadata_title, "base sepolia");

  assert.equal(listMilestones(31337, sameEscrow).length, 1);
  assert.equal(listMilestones(84532, sameEscrow).length, 1);
  assert.deepEqual(listKnownEscrows(31337), [sameEscrow]);
  assert.deepEqual(listKnownEscrows(84532), [sameEscrow]);
});

test("events remain chain-separated even with duplicate tx hash/log index", () => {
  insertEvent({
    chainId: 31337,
    blockNumber: "1",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0",
    escrowAddress: "0x1000000000000000000000000000000000000001",
    eventName: "EscrowCreated",
    summary: "anvil event",
    payloadJson: "{}",
  });

  insertEvent({
    chainId: 84532,
    blockNumber: "2",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0",
    escrowAddress: "0x1000000000000000000000000000000000000001",
    eventName: "EscrowCreated",
    summary: "base sepolia event",
    payloadJson: "{}",
  });

  assert.equal(getEventCount(31337), 1);
  assert.equal(getEventCount(84532), 1);
  assert.equal(getEventCount(), 2);
});

test("chain queries fail closed and never coerce unsupported identity to chain 0", () => {
  const sameEscrow = "0x1000000000000000000000000000000000000001";

  upsertEscrow({
    chainId: 31337,
    address: sameEscrow,
    buyerAddress: "0x2000000000000000000000000000000000000002",
    sellerAddress: "0x3000000000000000000000000000000000000003",
    arbiterAddress: "0x4000000000000000000000000000000000000004",
    tokenAddress: "0x5000000000000000000000000000000000000005",
    metadataHash: "0xmeta31337",
    milestoneCount: 1,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: "100",
    totalReleasedToSeller: "0",
    totalRefundedToBuyer: "0",
    totalFeesCollected: "0",
    createdAtBlock: "10",
    updatedAtBlock: "10",
  });

  assert.equal(getEscrow(0, sameEscrow), undefined);
  assert.equal(getEscrow(8453, sameEscrow), undefined);
  assert.ok(getEscrow(31337, sameEscrow));
});

test("unsupported runtime chain ids throw actionable errors", () => {
  assert.throws(() => assertRuntimeChainSupported(999999), /Unsupported runtime chain id/);
});

test("configured runtime chain matches the deployment manifest chain", async () => {
  const configured = getConfiguredChain();
  const { deploymentManifest } = await import(`./config.js?runtime-manifest-${Date.now()}`);
  assert.equal(configured.id, deploymentManifest.chain.chainId);
});

test("legacy sync checkpoint helpers round-trip from runtime tests", async () => {
  const dbModule = await import(`./db.js?runtime-identity-db-${Date.now()}`);

  dbModule.patchSyncHealthState({
    lastSuccessfulBlock: 123n,
    chainHeadSeen: 123n,
    lagBlocks: 0n,
    phase: "idle",
    status: "healthy",
    lastError: null,
  });

  assert.equal(dbModule.getLastSyncedBlock(), 123n);

  dbModule.setLastSyncedBlock(124n);
  assert.equal(dbModule.getSyncHealthState().lastSuccessfulBlock, 124n);
});

test("manifest and runtime chain support sets remain aligned", () => {
  const runtimeSupported = [31337, 8453, 84532].sort((a, b) => a - b);
  const manifestSupported = [...new Set(Object.values(validatedDeploymentManifests).map((manifest) => manifest.chain.chainId))].sort(
    (a, b) => a - b
  );

  assert.deepEqual(manifestSupported, runtimeSupported.filter((chainId) => manifestSupported.includes(chainId)));
  assert.equal(manifestSupported.includes(deploymentManifest.chain.chainId), true);
});

test("chains module import fails closed when manifest contains unsupported chain id", async () => {
  const configModule = await import(`./config.js?runtime-identity-config-${Date.now()}`);

  const originalLocalChainId = configModule.validatedDeploymentManifests.local.chain.chainId;

  try {
    configModule.validatedDeploymentManifests.local.chain.chainId = 999999;

    await assert.rejects(
      () => import(`./chains.js?unsupported-manifest-${Date.now()}`),
      /Unsupported manifest chain ids 999999/
    );
  } finally {
    configModule.validatedDeploymentManifests.local.chain.chainId = originalLocalChainId;
  }
});
