import assert from "node:assert/strict";
import test from "node:test";

import { db, getLastSyncedBlock, getSyncHealthState, patchSyncHealthState, setLastSyncedBlock } from "./db.js";

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

test.beforeEach(() => {
  resetDb();
});

test("getSyncHealthState falls back to legacy last_synced_block and default lag", () => {
  db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)`)
    .run(
      "last_synced_block",
      "42",
      "last_attempted_at",
      "2026-01-01T00:00:00.000Z",
      "last_successful_at",
      "2026-01-01T00:00:00.000Z",
      "phase",
      "idle",
      "status",
      "healthy",
      "last_error",
      "",
      "chain_head_seen",
      "42"
    );

  const health = getSyncHealthState();
  assert.equal(health.lastSuccessfulBlock, 42n);
  assert.equal(health.lastAttemptedBlock, 42n);
  assert.equal(health.lagBlocks, 0n);
  assert.equal(health.lastError, null);
});

test("getSyncHealthState prefers explicit last_successful_block over legacy key", () => {
  db.prepare(`INSERT INTO sync_state (key, value) VALUES (?, ?), (?, ?), (?, ?)`)
    .run(
      "last_synced_block",
      "10",
      "last_successful_block",
      "77",
      "chain_head_seen",
      "77"
    );

  const health = getSyncHealthState();
  assert.equal(health.lastSuccessfulBlock, 77n);
  assert.equal(health.lastAttemptedBlock, 77n);
});

test("setLastSyncedBlock writes modern + legacy sync keys with healthy status", () => {
  setLastSyncedBlock(88n);

  const health = getSyncHealthState();
  assert.equal(health.lastSuccessfulBlock, 88n);
  assert.equal(health.chainHeadSeen, 88n);
  assert.equal(health.lagBlocks, 0n);
  assert.equal(health.phase, "persist_outcome");
  assert.equal(health.status, "healthy");

  const legacy = db.prepare(`SELECT value FROM sync_state WHERE key = 'last_synced_block'`).get() as { value: string };
  assert.equal(legacy.value, "88");
  assert.equal(getLastSyncedBlock(), 88n);
});

test("patchSyncHealthState persists nullable keys as empty strings and round-trips to null", () => {
  patchSyncHealthState({
    lastAttemptedBlock: 99n,
    lastAttemptedAt: null,
    lastSuccessfulBlock: 90n,
    lastSuccessfulAt: null,
    chainHeadSeen: 120n,
    lagBlocks: 30n,
    phase: "discover_logs",
    status: "failed",
    lastError: null,
  });

  const health = getSyncHealthState();
  assert.equal(health.lastAttemptedBlock, 99n);
  assert.equal(health.lastAttemptedAt, null);
  assert.equal(health.lastSuccessfulAt, null);
  assert.equal(health.lastError, null);
  assert.equal(health.status, "failed");
  assert.equal(health.phase, "discover_logs");
});
