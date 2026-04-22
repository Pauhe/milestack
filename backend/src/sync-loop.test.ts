import assert from "node:assert/strict";
import test from "node:test";

import { setIndexerPublicClient, resetIndexerPublicClient } from "./indexer.js";
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
    multicall: async () => [],
    readContract: async () => {
      throw new Error("not used");
    },
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

test("startSyncLoop returns an interval handle that can be cleared", async () => {
  const module = await import(`./sync-loop.js?sync-loop-start-${Date.now()}`);
  const timer = module.startSyncLoop();

  assert.ok(timer);
  clearInterval(timer);
});
