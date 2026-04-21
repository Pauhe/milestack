import { pathToFileURL } from "node:url";

import express from "express";
import { getAddress } from "viem";

import { backendConfig, deploymentManifest } from "./config.js";
import { type SyncHealthState, getSyncHealthState } from "./db.js";
import { deriveEscrowOverviewSemantics, deriveMilestoneSemantics } from "./escrow-semantics.js";
import { deriveActorDetails, deriveTimelineTruth, summarizeTimelineEvent } from "./indexer.js";
import {
  getEscrow,
  getEscrowParticipants,
  getMetadataCache,
  getMilestone,
  getTimeline,
  getUserRoleStats,
  listMilestones,
} from "./repository.js";
import { deriveMetadataTruth } from "./metadata.js";
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
  runtime: {
    deploymentEnv: string;
    chainId: number;
    chainName: string;
    manifestVersion: number;
    manifestEnvironment: string;
    contractAddress: string;
    usdcAddress: string;
    protocolFeeBps: number;
    metadataVisibility: string | null;
  };
};

type HashContextTruth = {
  state: "present" | "missing";
  hash: string | null;
  verified: false;
  degraded: boolean;
  ambiguity: "not-verifiable-from-onchain-hash" | null;
  reason: string | null;
};

function sanitizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 512);
}

function readDeploymentEnv() {
  return process.env.DEPLOYMENT_ENV ?? "local";
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
    runtime: {
      deploymentEnv: readDeploymentEnv(),
      chainId: deploymentManifest.chain.chainId,
      chainName: deploymentManifest.chain.name,
      manifestVersion: deploymentManifest.version,
      manifestEnvironment: deploymentManifest.environment,
      contractAddress: deploymentManifest.contracts.escrowFactory.address,
      usdcAddress: deploymentManifest.config.usdc,
      protocolFeeBps: deploymentManifest.config.protocolFeeBps,
      metadataVisibility: deploymentManifest.config.metadataVisibility ?? null,
    },
  };
}

function buildHashContextTruth(hash: string): HashContextTruth {
  if (hash && hash !== "0x0" && hash !== "0x") {
    return {
      state: "present",
      hash,
      verified: false,
      degraded: false,
      ambiguity: "not-verifiable-from-onchain-hash",
      reason: "Onchain hash is present; backend has no canonical payload to verify yet.",
    };
  }

  return {
    state: "missing",
    hash,
    verified: false,
    degraded: false,
    ambiguity: null,
    reason: null,
  };
}

function toLowerHex(value: string) {
  return value.toLowerCase();
}

function readHexField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  return typeof value === "string" ? value.toLowerCase() : "0x";
}

function pickMilestoneMetadataFromPayload(payload: Record<string, unknown> | null, milestoneId: number) {
  const milestones = payload?.milestones;

  if (!Array.isArray(milestones)) {
    return null;
  }

  return (
    milestones.find((item) => {
      if (typeof item !== "object" || item === null || !("id" in item)) {
        return false;
      }

      const id = (item as { id: unknown }).id;
      if (typeof id === "number") {
        return id === milestoneId;
      }

      if (typeof id === "string") {
        return id === String(milestoneId);
      }

      return false;
    }) ?? null
  );
}

function readMilestoneMetadataTruth(
  metadataPayload: Record<string, unknown> | null,
  milestone: { milestone_id: number; metadata_title: string | null; metadata_description: string | null }
) {
  const entry = pickMilestoneMetadataFromPayload(metadataPayload, milestone.milestone_id);

  if (!entry) {
    return {
      state: metadataPayload ? "missing" : "unavailable",
      verified: false,
      titleVerified: false,
      descriptionVerified: false,
      degraded: Boolean(metadataPayload),
      reason: metadataPayload ? "metadata payload has no milestone entry for this milestoneId" : "deal metadata payload unavailable",
    } as const;
  }

  const title = typeof (entry as Record<string, unknown>).title === "string" ? (entry as Record<string, unknown>).title : null;
  const description =
    typeof (entry as Record<string, unknown>).description === "string"
      ? (entry as Record<string, unknown>).description
      : null;

  const titleVerified = title !== null && milestone.metadata_title === title;
  const descriptionVerified = description !== null && milestone.metadata_description === description;

  if (titleVerified && descriptionVerified) {
    return {
      state: "verified",
      verified: true,
      titleVerified,
      descriptionVerified,
      degraded: false,
      reason: null,
    } as const;
  }

  return {
    state: "mismatched",
    verified: false,
    titleVerified,
    descriptionVerified,
    degraded: false,
    reason: "indexed milestone metadata fields do not fully match verified metadata payload",
  } as const;
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
      runtime: {
        deploymentEnv: readDeploymentEnv(),
        manifestVersion: deploymentManifest.version,
      },
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

      const metadataTruth = deriveMetadataTruth(escrow.metadata_hash, getMetadataCache(escrow.metadata_hash));
      const nowUnixSeconds = Math.floor(Date.now() / 1000);
      const milestones = listMilestones(address).map((milestone) => {
        const metadataVerification = readMilestoneMetadataTruth(metadataTruth.payload, milestone);

        return {
          ...milestone,
          derived: deriveMilestoneSemantics(milestone, escrow, nowUnixSeconds),
          truth: {
            metadataVerification,
            evidence: buildHashContextTruth(toLowerHex(milestone.evidence_hash)),
            disputeContext: buildHashContextTruth(toLowerHex(milestone.dispute_hash)),
          },
        };
      });

      response.json({
        items: milestones,
        metadata: metadataTruth,
        freshness: buildFreshness(),
      });
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

      const metadata = deriveMetadataTruth(overview.metadata_hash, getMetadataCache(overview.metadata_hash));

      response.json({
        ...overview,
        derived: deriveEscrowOverviewSemantics(overview),
        truth: {
          metadata,
          activeDispute: overview.active_dispute_milestone_id
            ? {
                state: "present",
                milestoneId: overview.active_dispute_milestone_id,
                verified: true,
                degraded: false,
                reason: null,
              }
            : {
                state: "none",
                milestoneId: null,
                verified: true,
                degraded: false,
                reason: null,
              },
        },
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
      const escrow = getEscrow(address);
      if (!escrow) {
        response.status(404).json({ error: "Escrow not indexed" });
        return;
      }

      const milestone = getMilestone(address, milestoneId);
      if (!milestone) {
        response.status(404).json({ error: "Milestone not indexed" });
        return;
      }

      const metadataTruth = deriveMetadataTruth(escrow.metadata_hash, getMetadataCache(escrow.metadata_hash));

      response.json({
        ...milestone,
        truth: {
          metadataVerification: readMilestoneMetadataTruth(metadataTruth.payload, milestone),
          evidence: buildHashContextTruth(toLowerHex(milestone.evidence_hash)),
          disputeContext: buildHashContextTruth(toLowerHex(milestone.dispute_hash)),
        },
        freshness: buildFreshness(),
      });
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

        const context = {
          payload,
          previousEventName: index > 0 ? rawTimeline[index - 1]?.event_name : null,
          nextEventName: index < rawTimeline.length - 1 ? rawTimeline[index + 1]?.event_name : null,
          previousPayload,
          nextPayload,
        };

        const actor = deriveActorDetails(event.event_name, participants, context);
        const truth = deriveTimelineTruth(event.event_name, context);

        return {
          time: null,
          type: event.event_name,
          summary: summarizeTimelineEvent(event.event_name, context),
          actor,
          payload,
          truth: {
            ...truth,
            evidence: event.event_name === "MilestoneSubmitted" ? buildHashContextTruth(readHexField(payload, "evidenceHash")) : null,
            disputeContext:
              event.event_name === "MilestoneDisputed" || event.event_name === "DisputeResolved"
                ? buildHashContextTruth(readHexField(payload, "disputeHash"))
                : null,
          },
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
        truth: {
          canonicalSource: "derived_from_events",
          ambiguityPolicy: "claim_attribution_ambiguous_without_adjacent_same_milestone_approval",
        },
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
