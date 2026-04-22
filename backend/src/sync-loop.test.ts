import assert from "node:assert/strict";
import test from "node:test";

import { resetIndexerPublicClient, setIndexerPublicClient } from "./indexer.js";
import { syncLoopState } from "./sync-loop.js";

function resetLoopState() {
  syncLoopState.isSyncing = false;
  syncLoopState.activeSyncStartedAt = null;
  syncLoopState.lastSyncAt = null;
  syncLoopState.lastSyncError = null;
}

test.beforeEach(() => {
  resetLoopState();
});

test("runSyncOnce updates observable sync state on success", async () => {
  const module = await import(`./sync-loop.js?sync-loop-success-${Date.now()}`);

  setIndexerPublicClient({
    chain: { id: 31337 },
    getBlockNumber: async () => 1n,
    getLogs: async () => [],
  });

  try {
    await module.runSyncOnce();

    assert.equal(module.syncLoopState.isSyncing, false);
    assert.equal(module.syncLoopState.activeSyncStartedAt, null);
    assert.equal(module.syncLoopState.lastSyncError, null);
    assert.ok(module.syncLoopState.lastSyncAt);
  } finally {
    resetIndexerPublicClient();
  }
});

test("runSyncOnce remains safe when re-entered while already syncing", async () => {
  const module = await import(`./sync-loop.js?sync-loop-reentrant-${Date.now()}`);

  module.syncLoopState.isSyncing = true;
  const before = module.syncLoopState.lastSyncAt;

  await module.runSyncOnce();

  assert.equal(module.syncLoopState.isSyncing, true);
  assert.equal(module.syncLoopState.lastSyncAt, before);

  module.syncLoopState.isSyncing = false;
});

test("runSyncOnce captures sanitized failure errors and always resets active sync state", async () => {
  const module = await import(`./sync-loop.js?sync-loop-failure-${Date.now()}`);
  const rawError = "sync failed\nwith   irregular\tspacing " + "x".repeat(560);

  setIndexerPublicClient({
    chain: { id: 31337 },
    getBlockNumber: async () => {
      throw new Error(rawError);
    },
    getLogs: async () => [],
  });

  try {
    await assert.rejects(() => module.runSyncOnce(), /sync failed/);

    assert.equal(module.syncLoopState.isSyncing, false);
    assert.equal(module.syncLoopState.activeSyncStartedAt, null);
    assert.equal(module.syncLoopState.lastSyncAt, null);
    assert.ok(module.syncLoopState.lastSyncError);
    assert.equal(module.syncLoopState.lastSyncError?.includes("\n"), false);
    assert.equal(module.syncLoopState.lastSyncError?.includes("\t"), false);
    assert.equal(module.syncLoopState.lastSyncError?.length, 512);
    assert.match(module.syncLoopState.lastSyncError ?? "", /sync failed with irregular spacing/);
  } finally {
    resetIndexerPublicClient();
  }
});

test("runSyncOnce sanitizes thrown non-Error values and still resets loop state", async () => {
  const module = await import(`./sync-loop.js?sync-loop-non-error-${Date.now()}`);

  setIndexerPublicClient({
    chain: { id: 31337 },
    getBlockNumber: async () => {
      throw "rpc malformed payload\nwith\ttabs";
    },
    getLogs: async () => [],
  });

  try {
    await assert.rejects(() => module.runSyncOnce());

    assert.equal(module.syncLoopState.isSyncing, false);
    assert.equal(module.syncLoopState.activeSyncStartedAt, null);
    assert.equal(module.syncLoopState.lastSyncAt, null);
    assert.ok(module.syncLoopState.lastSyncError);
    assert.equal(module.syncLoopState.lastSyncError?.includes("\n"), false);
    assert.equal(module.syncLoopState.lastSyncError?.includes("\t"), false);
    assert.match(module.syncLoopState.lastSyncError ?? "", /rpc malformed payload with tabs/);
    assert.equal(module.syncLoopState.lastSyncError?.length, "rpc malformed payload with tabs".length);
  } finally {
    resetIndexerPublicClient();
  }
});

test("startSyncLoop returns an interval handle that can be cleared", async () => {
  const module = await import(`./sync-loop.js?sync-loop-start-${Date.now()}`);
  const timer = module.startSyncLoop();

  assert.ok(timer);
  clearInterval(timer);
});
