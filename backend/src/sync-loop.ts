import { backendConfig } from "./config.js";
import { syncIndexer } from "./indexer.js";

export type SyncLoopState = {
  isSyncing: boolean;
  activeSyncStartedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export const syncLoopState: SyncLoopState = {
  isSyncing: false,
  activeSyncStartedAt: null,
  lastSyncAt: null,
  lastSyncError: null,
};

function sanitizeLoopError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 512);
}

export async function runSyncOnce() {
  if (syncLoopState.isSyncing) return;

  syncLoopState.isSyncing = true;
  syncLoopState.activeSyncStartedAt = new Date().toISOString();
  syncLoopState.lastSyncError = null;

  try {
    await syncIndexer();
    syncLoopState.lastSyncAt = new Date().toISOString();
  } catch (error) {
    syncLoopState.lastSyncError = sanitizeLoopError(error);
    throw error;
  } finally {
    syncLoopState.isSyncing = false;
    syncLoopState.activeSyncStartedAt = null;
  }
}

export function startSyncLoop() {
  const timer = setInterval(() => {
    void runSyncOnce().catch(() => {
      // Keep the loop alive and expose the error through health state.
    });
  }, backendConfig.syncIntervalMs);

  return timer;
}
