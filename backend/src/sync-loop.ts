import { backendConfig } from "./config.js";
import { syncIndexer } from "./indexer.js";

export type SyncLoopState = {
  isSyncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export const syncLoopState: SyncLoopState = {
  isSyncing: false,
  lastSyncAt: null,
  lastSyncError: null,
};

export async function runSyncOnce() {
  if (syncLoopState.isSyncing) return;

  syncLoopState.isSyncing = true;
  syncLoopState.lastSyncError = null;

  try {
    await syncIndexer();
    syncLoopState.lastSyncAt = new Date().toISOString();
  } catch (error) {
    syncLoopState.lastSyncError = error instanceof Error ? error.message : "Sync failed";
    throw error;
  } finally {
    syncLoopState.isSyncing = false;
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
