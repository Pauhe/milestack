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
    dispute_losses_count INTEGER NOT NULL DEFAULT 0,
    resolved_dispute_count INTEGER NOT NULL DEFAULT 0,
    unresolved_dispute_count INTEGER NOT NULL DEFAULT 0,
    dispute_split_count INTEGER NOT NULL DEFAULT 0,
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

const userRoleStatsColumns = db.prepare("PRAGMA table_info(user_role_stats)").all() as Array<{ name: string }>;
const hasUserRoleStatsColumn = (columnName: string) => userRoleStatsColumns.some((item) => item.name === columnName);

if (!hasUserRoleStatsColumn("dispute_losses_count")) {
  db.exec("ALTER TABLE user_role_stats ADD COLUMN dispute_losses_count INTEGER NOT NULL DEFAULT 0;");
}

if (!hasUserRoleStatsColumn("resolved_dispute_count")) {
  db.exec("ALTER TABLE user_role_stats ADD COLUMN resolved_dispute_count INTEGER NOT NULL DEFAULT 0;");
}

if (!hasUserRoleStatsColumn("unresolved_dispute_count")) {
  db.exec("ALTER TABLE user_role_stats ADD COLUMN unresolved_dispute_count INTEGER NOT NULL DEFAULT 0;");
}

if (!hasUserRoleStatsColumn("dispute_split_count")) {
  db.exec("ALTER TABLE user_role_stats ADD COLUMN dispute_split_count INTEGER NOT NULL DEFAULT 0;");
}

export type SyncPhase =
  | "idle"
  | "discover_logs"
  | "persist_events"
  | "rebuild_projections"
  | "persist_outcome";

export type SyncStatus = "idle" | "syncing" | "healthy" | "stale" | "failed" | "rebuilding";

export type SyncHealthState = {
  lastAttemptedBlock: bigint;
  lastAttemptedAt: string | null;
  lastSuccessfulBlock: bigint;
  lastSuccessfulAt: string | null;
  chainHeadSeen: bigint;
  lagBlocks: bigint;
  phase: SyncPhase;
  status: SyncStatus;
  lastError: string | null;
};

const defaultSyncHealth: SyncHealthState = {
  lastAttemptedBlock: 0n,
  lastAttemptedAt: null,
  lastSuccessfulBlock: 0n,
  lastSuccessfulAt: null,
  chainHeadSeen: 0n,
  lagBlocks: 0n,
  phase: "idle",
  status: "idle",
  lastError: null,
};

const syncKeyMap = {
  lastAttemptedBlock: "last_attempted_block",
  lastAttemptedAt: "last_attempted_at",
  lastSuccessfulBlock: "last_successful_block",
  lastSuccessfulAt: "last_successful_at",
  chainHeadSeen: "chain_head_seen",
  lagBlocks: "lag_blocks",
  phase: "phase",
  status: "status",
  lastError: "last_error",
} as const;

function upsertSyncStateValue(key: string, value: string) {
  db.prepare(
    `
      INSERT INTO sync_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(key, value);
}

export function patchSyncHealthState(patch: Partial<SyncHealthState>) {
  if (patch.lastAttemptedBlock !== undefined) {
    upsertSyncStateValue(syncKeyMap.lastAttemptedBlock, patch.lastAttemptedBlock.toString());
  }

  if (patch.lastAttemptedAt !== undefined) {
    upsertSyncStateValue(syncKeyMap.lastAttemptedAt, patch.lastAttemptedAt ?? "");
  }

  if (patch.lastSuccessfulBlock !== undefined) {
    upsertSyncStateValue(syncKeyMap.lastSuccessfulBlock, patch.lastSuccessfulBlock.toString());
    // Backward-compatible key used by existing endpoints.
    upsertSyncStateValue("last_synced_block", patch.lastSuccessfulBlock.toString());
  }

  if (patch.lastSuccessfulAt !== undefined) {
    upsertSyncStateValue(syncKeyMap.lastSuccessfulAt, patch.lastSuccessfulAt ?? "");
  }

  if (patch.chainHeadSeen !== undefined) {
    upsertSyncStateValue(syncKeyMap.chainHeadSeen, patch.chainHeadSeen.toString());
  }

  if (patch.lagBlocks !== undefined) {
    upsertSyncStateValue(syncKeyMap.lagBlocks, patch.lagBlocks.toString());
  }

  if (patch.phase !== undefined) {
    upsertSyncStateValue(syncKeyMap.phase, patch.phase);
  }

  if (patch.status !== undefined) {
    upsertSyncStateValue(syncKeyMap.status, patch.status);
  }

  if (patch.lastError !== undefined) {
    upsertSyncStateValue(syncKeyMap.lastError, patch.lastError ?? "");
  }
}

export function getSyncHealthState(): SyncHealthState {
  const rows = db.prepare("SELECT key, value FROM sync_state").all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const fallbackSyncedBlock = map.get("last_synced_block") ?? "0";
  const successfulBlockRaw = map.get(syncKeyMap.lastSuccessfulBlock) ?? fallbackSyncedBlock;

  return {
    lastAttemptedBlock: BigInt(map.get(syncKeyMap.lastAttemptedBlock) ?? successfulBlockRaw ?? "0"),
    lastAttemptedAt: map.get(syncKeyMap.lastAttemptedAt) || null,
    lastSuccessfulBlock: BigInt(successfulBlockRaw),
    lastSuccessfulAt: map.get(syncKeyMap.lastSuccessfulAt) || null,
    chainHeadSeen: BigInt(map.get(syncKeyMap.chainHeadSeen) ?? successfulBlockRaw ?? "0"),
    lagBlocks: BigInt(map.get(syncKeyMap.lagBlocks) ?? "0"),
    phase: (map.get(syncKeyMap.phase) as SyncPhase | undefined) ?? defaultSyncHealth.phase,
    status: (map.get(syncKeyMap.status) as SyncStatus | undefined) ?? defaultSyncHealth.status,
    lastError: map.get(syncKeyMap.lastError) || null,
  };
}

export function getLastSyncedBlock() {
  return getSyncHealthState().lastSuccessfulBlock;
}

export function setLastSyncedBlock(blockNumber: bigint) {
  patchSyncHealthState({
    lastSuccessfulBlock: blockNumber,
    chainHeadSeen: blockNumber,
    lagBlocks: 0n,
    lastSuccessfulAt: new Date().toISOString(),
    phase: "persist_outcome",
    status: "healthy",
    lastError: null,
  });
}
