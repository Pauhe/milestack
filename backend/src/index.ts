import express from "express";
import { getAddress } from "viem";

import { backendConfig, deploymentManifest } from "./config.js";
import { getLastSyncedBlock } from "./db.js";
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

const app = express();

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    environment: deploymentManifest.environment,
    chainId: deploymentManifest.chain.chainId,
    factoryAddress: deploymentManifest.contracts.escrowFactory.address,
    lastSyncedBlock: getLastSyncedBlock().toString(),
    sync: syncLoopState,
  });
});

app.post("/sync", async (_request, response) => {
  try {
    await runSyncOnce();
    response.json({
      ok: true,
      lastSyncedBlock: getLastSyncedBlock().toString(),
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Sync failed" });
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

    response.json({ items: milestones });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid milestones request" });
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
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid escrow request" });
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
    response.json(milestone);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid milestone request" });
  }
});

app.get("/escrows/:address/timeline", async (request, response) => {
  try {
    const address = getAddress(request.params.address);
    const participants = getEscrowParticipants(address);
    const rawTimeline = getTimeline(address) as Array<{ event_name: string; payload_json: string; summary: string }>;

    const timeline = rawTimeline.map((event, index) => {
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      const actor = deriveActorDetails(event.event_name, participants, {
        previousEventName: index > 0 ? rawTimeline[index - 1]?.event_name : null,
        nextEventName: index < rawTimeline.length - 1 ? rawTimeline[index + 1]?.event_name : null,
      });

      return {
        time: null,
        type: event.event_name,
        summary: summarizeTimelineEvent(event.event_name, {
          payload,
          previousEventName: index > 0 ? rawTimeline[index - 1]?.event_name : null,
          nextEventName: index < rawTimeline.length - 1 ? rawTimeline[index + 1]?.event_name : null,
        }),
        actor,
        payload,
      };
    });

    response.json({ items: timeline });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid timeline request" });
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
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Invalid reputation request" });
  }
});

void runSyncOnce().catch(() => {
  // Error state is reflected in syncLoopState.
});
startSyncLoop();

app.listen(backendConfig.port, () => {
  console.log(`Milestack backend listening on http://localhost:${backendConfig.port}`);
});
