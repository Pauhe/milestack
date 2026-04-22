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

function getColumnNames(table: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.map((column) => column.name);
}

function getTableSql(table: string) {
  const row = db
    .prepare(
      `
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(table) as { sql: string } | undefined;

  return row?.sql ?? null;
}

async function importDbFresh() {
  return import(`./db.js?db-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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

test("db bootstrap migrates legacy escrows/milestones/events/user_role_stats schemas and preserves compatible rows", async () => {
  resetDb();

  db.exec(`
    DROP TABLE IF EXISTS escrows;
    DROP TABLE IF EXISTS milestones;
    DROP TABLE IF EXISTS events;
    DROP TABLE IF EXISTS user_role_stats;
    DROP TABLE IF EXISTS metadata_cache;

    CREATE TABLE escrows (
      address TEXT PRIMARY KEY,
      buyer_address TEXT NOT NULL,
      seller_address TEXT NOT NULL,
      arbiter_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      metadata_hash TEXT NOT NULL,
      milestone_count INTEGER NOT NULL,
      deal_status INTEGER NOT NULL,
      current_milestone_index INTEGER NOT NULL,
      active_dispute_milestone_id TEXT,
      total_funded TEXT NOT NULL,
      total_released_to_seller TEXT NOT NULL,
      total_refunded_to_buyer TEXT NOT NULL,
      total_fees_collected TEXT NOT NULL,
      created_at_block TEXT NOT NULL,
      updated_at_block TEXT NOT NULL
    );

    CREATE TABLE milestones (
      escrow_address TEXT NOT NULL,
      milestone_id INTEGER NOT NULL,
      amount TEXT NOT NULL,
      status INTEGER NOT NULL,
      review_window_seconds INTEGER NOT NULL,
      submitted_at TEXT NOT NULL,
      review_deadline TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      dispute_hash TEXT NOT NULL,
      buyer_award TEXT NOT NULL,
      seller_award TEXT NOT NULL,
      metadata_title TEXT,
      metadata_description TEXT,
      PRIMARY KEY (escrow_address, milestone_id)
    );

    CREATE TABLE events (
      chain_id INTEGER NOT NULL,
      block_number TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index TEXT NOT NULL,
      escrow_address TEXT NOT NULL,
      event_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );

    CREATE TABLE user_role_stats (
      address TEXT NOT NULL,
      role TEXT NOT NULL,
      completed_deals_count INTEGER NOT NULL,
      completed_milestones_count INTEGER NOT NULL,
      dispute_count INTEGER NOT NULL,
      dispute_wins_count INTEGER NOT NULL,
      cancellation_count INTEGER NOT NULL,
      total_volume TEXT NOT NULL,
      updated_at_block TEXT NOT NULL,
      PRIMARY KEY (address, role)
    );
  `);

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
    31337,
    "100",
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0",
    "0x1000000000000000000000000000000000000001",
    "EscrowCreated",
    "legacy row",
    "{}"
  );

  db.prepare(
    `
      INSERT INTO user_role_stats (
        address,
        role,
        completed_deals_count,
        completed_milestones_count,
        dispute_count,
        dispute_wins_count,
        cancellation_count,
        total_volume,
        updated_at_block
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    "0x2000000000000000000000000000000000000002",
    "seller",
    1,
    2,
    0,
    0,
    0,
    "1000",
    "100"
  );

  await importDbFresh();

  const escrowsColumns = getColumnNames("escrows");
  assert.equal(escrowsColumns.includes("chain_id"), true);

  const milestonesColumns = getColumnNames("milestones");
  assert.equal(milestonesColumns.includes("chain_id"), true);

  const userRoleStatsColumns = getColumnNames("user_role_stats");
  assert.equal(userRoleStatsColumns.includes("dispute_losses_count"), true);
  assert.equal(userRoleStatsColumns.includes("resolved_dispute_count"), true);
  assert.equal(userRoleStatsColumns.includes("unresolved_dispute_count"), true);
  assert.equal(userRoleStatsColumns.includes("dispute_split_count"), true);

  const eventsSql = getTableSql("events");
  assert.ok(eventsSql);
  assert.match(eventsSql ?? "", /PRIMARY KEY \(chain_id, tx_hash, log_index\)/);

  const migratedEventsCount = db.prepare(`SELECT COUNT(*) as count FROM events`).get() as { count: number };
  assert.equal(migratedEventsCount.count, 1);

  const migratedEvent = db
    .prepare(`SELECT chain_id, tx_hash, log_index, event_name FROM events WHERE tx_hash = ? AND log_index = ?`)
    .get(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0"
    ) as { chain_id: number; tx_hash: string; log_index: string; event_name: string };
  assert.equal(migratedEvent.chain_id, 31337);
  assert.equal(migratedEvent.event_name, "EscrowCreated");

  const migratedRoleStats = db
    .prepare(
      `
        SELECT dispute_losses_count, resolved_dispute_count, unresolved_dispute_count, dispute_split_count
        FROM user_role_stats
        WHERE address = ? AND role = ?
      `
    )
    .get("0x2000000000000000000000000000000000000002", "seller") as {
    dispute_losses_count: number;
    resolved_dispute_count: number;
    unresolved_dispute_count: number;
    dispute_split_count: number;
  };

  assert.equal(migratedRoleStats.dispute_losses_count, 0);
  assert.equal(migratedRoleStats.resolved_dispute_count, 0);
  assert.equal(migratedRoleStats.unresolved_dispute_count, 0);
  assert.equal(migratedRoleStats.dispute_split_count, 0);

  const legacyEscrows = db
    .prepare(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='escrows_legacy'`)
    .get() as { count: number };
  const legacyMilestones = db
    .prepare(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='milestones_legacy'`)
    .get() as { count: number };
  const legacyEvents = db
    .prepare(`SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='events_legacy'`)
    .get() as { count: number };

  assert.equal(legacyEscrows.count, 0);
  assert.equal(legacyMilestones.count, 0);
  assert.equal(legacyEvents.count, 0);
});

test("events migration preserves rows from legacy events table without chain-aware primary key", async () => {
  resetDb();

  db.exec(`
    DROP TABLE IF EXISTS events;

    CREATE TABLE events (
      chain_id INTEGER NOT NULL,
      block_number TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index TEXT NOT NULL,
      escrow_address TEXT NOT NULL,
      event_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    31337,
    "100",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "5",
    "0x1000000000000000000000000000000000000001",
    "EscrowCreated",
    "duplicate A",
    "{}",
    84532,
    "101",
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "5",
    "0x1000000000000000000000000000000000000001",
    "EscrowCreated",
    "duplicate B",
    "{}"
  );

  await importDbFresh();

  const migratedRows = db.prepare(`SELECT chain_id, summary FROM events ORDER BY chain_id ASC`).all() as Array<{
    chain_id: number;
    summary: string;
  }>;

  assert.equal(migratedRows.length, 2);
  assert.deepEqual(
    migratedRows.map((row) => row.chain_id),
    [31337, 84532]
  );
});
