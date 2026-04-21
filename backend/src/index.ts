import { pathToFileURL } from "node:url";

import express from "express";
import { getAddress } from "viem";

import { backendConfig, deploymentManifest } from "./config.js";
import { type SyncHealthState, getSyncHealthState } from "./db.js";
import { deriveEscrowOverviewSemantics, deriveMilestoneSemantics } from "./escrow-semantics.js";
import { deriveActorDetails, summarizeTimelineEvent } from "./indexer.js";
import {
  getEscrow,
  getEscrowParticipants,
  getMilestone,
  getTimeline,
  getUserRoleStats,
  listMilestones,
} from "./repository.js";
import { runSyncOnce, startSyncLoop, syncLoopState } from "./sync-loop.js";

type FreshnessState = "fresh" | "stale" | "rebuilding" | "unavailable";

type EndpointFreshness = {
  state: FreshnessState;
  degraded: boolean;
  indexedBlock: string | null;
  chainHead: string | null;
  lagBlocks: string | null;
  lastSuccessfulAt: string | null;
  lastAttemptedAt: string | null;
  phase: SyncHealthState["phase"] | "unknown";
  status: SyncHealthState["status"] | "unknown";
  isSyncing: boolean;
  syncLoopError: string | null;
  lastError: string | null;
};

type HealthPayload = {
  indexedBlock: string | null;
  chainHead: string | null;
  lagBlocks: string | null;
  lastSuccessfulAt: string | null;
  lastAttemptedAt: string | null;
  phase: SyncHealthState["phase"] | "unknown";
  status: SyncHealthState["status"] | "unknown";
  freshness: FreshnessState;
  degraded: boolean;
  lastError: string | null;
  loop: {
    isSyncing: boolean;
    activeSyncStartedAt: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  };
};

function sanitizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 512);
}

function safeReadSyncHealth(): { health: SyncHealthState | null; error: string | null } {
  try {
    return { health: getSyncHealthState(), error: null };
  } catch (error) {
    return {
      health: null,
      error: `sync health metadata malformed: ${sanitizeErrorMessage(error)}`,
    };
  }
}

function deriveFreshnessState(health: SyncHealthState | null): FreshnessState {
  if (!health) {
    return "unavailable";
  }

  if (health.status === "failed") {
    return "unavailable";
  }

  if (health.status === "rebuilding" || health.phase === "rebuild_projections") {
    return "rebuilding";
  }

  if (health.status === "stale") {
    return "stale";
  }

  if (health.lagBlocks > 0n) {
    return "stale";
  }

  if (health.lastSuccessfulBlock === 0n && health.lastSuccessfulAt === null) {
    return "unavailable";
  }

  return "fresh";
}

function buildFreshness(): EndpointFreshness {
  const { health, error } = safeReadSyncHealth();
  const state = deriveFreshnessState(health);
  const degraded = state !== "fresh";

  return {
    state,
    degraded,
    indexedBlock: health ? health.lastSuccessfulBlock.toString() : null,
    chainHead: health ? health.chainHeadSeen.toString() : null,
    lagBlocks: health ? health.lagBlocks.toString() : null,
    lastSuccessfulAt: health?.lastSuccessfulAt ?? null,
    lastAttemptedAt: health?.lastAttemptedAt ?? null,
    phase: health?.phase ?? "unknown",
    status: health?.status ?? "unknown",
    isSyncing: syncLoopState.isSyncing,
    syncLoopError: syncLoopState.lastSyncError,
    lastError: error ?? health?.lastError ?? null,
  };
}

function buildHealthPayload(): HealthPayload {
  const freshness = buildFreshness();

  return {
    indexedBlock: freshness.indexedBlock,
    chainHead: freshness.chainHead,
    lagBlocks: freshness.lagBlocks,
    lastSuccessfulAt: freshness.lastSuccessfulAt,
    lastAttemptedAt: freshness.lastAttemptedAt,
    phase: freshness.phase,
    status: freshness.status,
    freshness: freshness.state,
    degraded: freshness.degraded,
    lastError: freshness.lastError,
    loop: {
      isSyncing: syncLoopState.isSyncing,
      activeSyncStartedAt: syncLoopState.activeSyncStartedAt,
      lastSyncAt: syncLoopState.lastSyncAt,
      lastSyncError: syncLoopState.lastSyncError,
    },
  };
}

export function createApp() {
  const app = express();

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      environment: deploymentManifest.environment,
      chainId: deploymentManifest.chain.chainId,
      factoryAddress: deploymentManifest.contracts.escrowFactory.address,
      sync: buildHealthPayload(),
    });
  });

  app.post("/sync", async (_request, response) => {
    try {
      await runSyncOnce();
      response.json({
        ok: true,
        indexedBlock: buildFreshness().indexedBlock,
      });
    } catch (error) {
      response.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  });

  app.get("/escrows/:address/milestones", (request, response) => {
    try {
      const address = getAddress(request.params.address);
      const escrow = getEscrow(address);
      if (!escrow) {
        response.status(404).json({ error: "Escrow not indexed" });
        return;
      }

      const nowUnixSeconds = Math.floor(Date.now() / 1000);
      const milestones = listMilestones(address).map((milestone) => ({
        ...milestone,
        derived: deriveMilestoneSemantics(milestone, escrow, nowUnixSeconds),
      }));

      response.json({ items: milestones, freshness: buildFreshness() });
    } catch (error) {
      response.status(400).json({ error: sanitizeErrorMessage(error) });
    }
  });

  app.get("/escrows/:address", async (request, response) => {
    try {
      const address = getAddress(request.params.address);
      const overview = getEscrow(address);
      if (!overview) {
        response.status(404).json({ error: "Escrow not indexed" });
        return;
      }

      response.json({
        ...overview,
        derived: deriveEscrowOverviewSemantics(overview),
        freshness: buildFreshness(),
      });
    } catch (error) {
      response.status(400).json({ error: sanitizeErrorMessage(error) });
    }
  });

  app.get("/escrows/:address/milestones/:milestoneId", async (request, response) => {
    try {
      const address = getAddress(request.params.address);
      const milestoneId = Number(request.params.milestoneId);
      const milestone = getMilestone(address, milestoneId);
      if (!milestone) {
        response.status(404).json({ error: "Milestone not indexed" });
        return;
      }
      response.json({ ...milestone, freshness: buildFreshness() });
    } catch (error) {
      response.status(400).json({ error: sanitizeErrorMessage(error) });
    }
  });

  app.get("/escrows/:address/timeline", async (request, response) => {
    try {
      const address = getAddress(request.params.address);
      const participants = getEscrowParticipants(address);
      const rawTimeline = getTimeline(address) as Array<{ event_name: string; payload_json: string; summary: string }>;

      const timeline = rawTimeline.map((event, index) => {
        const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
        const previousPayload =
          index > 0 ? (JSON.parse(rawTimeline[index - 1]?.payload_json ?? "{}") as Record<string, unknown>) : null;
        const nextPayload =
          index < rawTimeline.length - 1
            ? (JSON.parse(rawTimeline[index + 1]?.payload_json ?? "{}") as Record<string, unknown>)
            : null;

        const actor = deriveActorDetails(event.event_name, participants, {
          previousEventName: index > 0 ? rawTimeline[index - 1]?.event_name : null,
          nextEventName: index < rawTimeline.length - 1 ? rawTimeline[index + 1]?.event_name : null,
          previousPayload,
          nextPayload,
        });

        return {
          time: null,
          type: event.event_name,
          summary: summarizeTimelineEvent(event.event_name, {
            payload,
            previousEventName: index > 0 ? rawTimeline[index - 1]?.event_name : null,
            nextEventName: index < rawTimeline.length - 1 ? rawTimeline[index + 1]?.event_name : null,
            previousPayload,
            nextPayload,
          }),
          actor,
          payload,
        };
      });

      response.json({ items: timeline, freshness: buildFreshness() });
    } catch (error) {
      response.status(400).json({ error: sanitizeErrorMessage(error) });
    }
  });

  app.get("/users/:address/reputation", (request, response) => {
    try {
      const address = getAddress(request.params.address);
      const stats = getUserRoleStats(address);

      response.json({
        address,
        buyerStats: stats.find((item) => item.role === "buyer") ?? null,
        sellerStats: stats.find((item) => item.role === "seller") ?? null,
        arbiterStats: stats.find((item) => item.role === "arbiter") ?? null,
        freshness: buildFreshness(),
      });
    } catch (error) {
      response.status(400).json({ error: sanitizeErrorMessage(error) });
    }
  });

  return app;
}

export const app = createApp();

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startServer() {
  void runSyncOnce().catch(() => {
    // Error state is reflected through persisted sync health and syncLoopState.
  });

  if (!syncTimer) {
    syncTimer = startSyncLoop();
  }

  return app.listen(backendConfig.port, () => {
    console.log(`Milestack backend listening on http://localhost:${backendConfig.port}`);
  });
}

const isEntrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isEntrypoint) {
  startServer();
}
