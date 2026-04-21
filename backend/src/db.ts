import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const databasePath = path.join(dataDir, "milestack.sqlite");

export const db = new Database(databasePath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS escrows (
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

  CREATE TABLE IF NOT EXISTS milestones (
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

  CREATE TABLE IF NOT EXISTS events (
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

  CREATE TABLE IF NOT EXISTS user_role_stats (
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

  CREATE TABLE IF NOT EXISTS metadata_cache (
    metadata_hash TEXT PRIMARY KEY,
    metadata_url TEXT NOT NULL,
    verified INTEGER NOT NULL,
    payload_json TEXT,
    error TEXT,
    updated_at_block TEXT NOT NULL
  );
`);

export function getLastSyncedBlock() {
  const row = db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_synced_block'")
    .get() as { value?: string } | undefined;

  return BigInt(row?.value ?? "0");
}

export function setLastSyncedBlock(blockNumber: bigint) {
  db.prepare(
    `
      INSERT INTO sync_state (key, value)
      VALUES ('last_synced_block', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(blockNumber.toString());
}
