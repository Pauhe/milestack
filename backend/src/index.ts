import express from "express";
import { getAddress } from "viem";

import { backendConfig, deploymentManifest } from "./config.js";
import { getLastSyncedBlock } from "./db.js";
import { deriveActorRole } from "./indexer.js";
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
    const escrow = getEscrow(address) as {
      current_milestone_index: number;
      active_dispute_milestone_id: string | null;
    } | undefined;
    if (!escrow) {
      response.status(404).json({ error: "Escrow not indexed" });
      return;
    }

    const milestones = listMilestones(address).map((milestone) => ({
      ...milestone,
      derived: {
        isCurrent: Number(milestone.milestone_id) === Number(escrow.current_milestone_index),
        isBlocked:
          escrow.active_dispute_milestone_id !== null
          && Number(milestone.milestone_id) > Number(escrow.current_milestone_index),
        buyerCanApprove:
          Number(milestone.status) === 2
          && Number(milestone.milestone_id) === Number(escrow.current_milestone_index),
        buyerCanDispute:
          Number(milestone.status) === 2
          && Number(milestone.milestone_id) === Number(escrow.current_milestone_index),
        sellerCanClaim:
          Number(milestone.status) === 2 && Number(milestone.review_deadline) > 0,
      },
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
      derived: {
        isBlockedByDispute: overview.active_dispute_milestone_id !== null,
        nextActionableMilestoneId: overview.current_milestone_index,
      },
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
    const timeline = getTimeline(address).map((event) => {
      const actorRole = deriveActorRole((event as { event_name: string }).event_name);
      const actorAddress =
        actorRole === "buyer"
          ? participants?.buyer_address ?? null
          : actorRole === "seller"
            ? participants?.seller_address ?? null
            : actorRole === "arbiter"
              ? participants?.arbiter_address ?? null
              : null;

      return {
        time: null,
        type: (event as { event_name: string }).event_name,
        summary: (event as { summary: string }).summary,
        actor: actorAddress && actorRole ? { address: actorAddress, role: actorRole } : null,
        payload: JSON.parse((event as { payload_json: string }).payload_json),
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
