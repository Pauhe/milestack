import { type Address, decodeEventLog, zeroHash } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { publicClient } from "./clients.js";
import { db, getLastSyncedBlock, setLastSyncedBlock } from "./db.js";
import { deploymentManifest } from "./config.js";
import { readEscrowMilestone, readEscrowOverview } from "./escrows.js";
import { loadAndVerifyMetadata } from "./metadata.js";
import { recomputeUserRoleStats } from "./reputation.js";
import {
  insertEvent,
  listKnownEscrows,
  upsertEscrow,
  upsertMetadataCache,
  upsertMilestone,
} from "./repository.js";

const trackedEventNames = new Set([
  "EscrowCreated",
  "MilestoneFunded",
  "MilestoneSubmitted",
  "MilestoneApproved",
  "MilestoneClaimed",
  "MilestoneDisputed",
  "DisputeResolved",
  "MilestoneCancelled",
  "DealCompleted",
  "DealCancelled",
]);

export async function syncIndexer() {
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address as Address;
  const fromBlock = getLastSyncedBlock();

  const factoryLogs = await publicClient.getLogs({
    address: factoryAddress,
    fromBlock,
  });

  const createdEscrows: Address[] = [];

  const transaction = db.transaction(async () => {
    for (const log of factoryLogs) {
      const decoded = decodeEventLog({ abi: escrowFactoryAbi, data: log.data, topics: log.topics });
      const eventName = decoded.eventName;
      if (eventName !== "EscrowCreated") continue;

      const args = toPayloadRecord(decoded.args);
      const escrow = args.escrow;
      if (typeof escrow !== "string") continue;

      const escrowAddress = escrow as Address;
      createdEscrows.push(escrowAddress);

      insertEvent({
        chainId: publicClient.chain.id,
        escrowAddress,
        blockNumber: String(log.blockNumber ?? 0n),
        txHash: log.transactionHash ?? zeroHash,
        logIndex: String(log.logIndex ?? 0),
        eventName,
        summary: summarizeTimelineEvent(eventName),
        payloadJson: JSON.stringify(args),
      });
    }

    const knownEscrows = new Set([...listKnownEscrows().map((item) => item as Address), ...createdEscrows]);

    for (const escrowAddress of knownEscrows) {
      const overview = await readEscrowOverview(escrowAddress);
      const metadataUrl = deploymentManifest.frontend?.defaultDealMetadataPath ?? null;
      const verifiedMetadata = metadataUrl
        ? await loadAndVerifyMetadata(metadataUrl, overview.metadataHash)
        : null;

      if (verifiedMetadata && metadataUrl) {
        upsertMetadataCache({
          metadataHash: overview.metadataHash,
          metadataUrl,
          verified: verifiedMetadata.verified,
          payloadJson: verifiedMetadata.payload ? JSON.stringify(verifiedMetadata.payload) : null,
          error: verifiedMetadata.error,
          updatedAtBlock: fromBlock.toString(),
        });
      }

      upsertEscrow({
        address: overview.address,
        buyerAddress: overview.buyer,
        sellerAddress: overview.seller,
        arbiterAddress: overview.arbiter,
        tokenAddress: overview.token,
        metadataHash: overview.metadataHash,
        milestoneCount: Number(overview.milestoneCount),
        dealStatus: overview.dealStatus,
        currentMilestoneIndex: Number(overview.currentMilestoneIndex),
        activeDisputeMilestoneId:
          overview.activeDisputeMilestoneId === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
            ? null
            : overview.activeDisputeMilestoneId.toString(),
        totalFunded: overview.totals.funded.toString(),
        totalReleasedToSeller: overview.totals.releasedToSeller.toString(),
        totalRefundedToBuyer: overview.totals.refundedToBuyer.toString(),
        totalFeesCollected: overview.totals.feesCollected.toString(),
        createdAtBlock: fromBlock.toString(),
        updatedAtBlock: fromBlock.toString(),
      });

      for (let milestoneId = 0; milestoneId < Number(overview.milestoneCount); milestoneId++) {
        const milestone = await readEscrowMilestone(escrowAddress, BigInt(milestoneId));
        const metadataMilestone = Array.isArray(verifiedMetadata?.payload?.milestones)
          ? verifiedMetadata.payload.milestones.find(
              (item) => typeof item === "object" && item !== null && "id" in item && item.id === milestoneId
            )
          : null;

        upsertMilestone({
          escrowAddress,
          milestoneId,
          amount: milestone.amount.toString(),
          status: milestone.status,
          reviewWindowSeconds: milestone.reviewWindowSeconds,
          submittedAt: milestone.submittedAt.toString(),
          reviewDeadline: milestone.reviewDeadline.toString(),
          evidenceHash: milestone.evidenceHash,
          disputeHash: milestone.disputeHash,
          buyerAward: milestone.buyerAward.toString(),
          sellerAward: milestone.sellerAward.toString(),
          metadataTitle: getMetadataField(metadataMilestone, "title"),
          metadataDescription: getMetadataField(metadataMilestone, "description"),
        });
      }

      const escrowLogs = await publicClient.getLogs({
        address: escrowAddress,
        fromBlock,
      });

      for (const log of escrowLogs) {
        const decoded = decodeEventLog({ abi: milestoneEscrowAbi, data: log.data, topics: log.topics });
        const eventName = decoded.eventName;
        if (!eventName || !trackedEventNames.has(eventName)) continue;

        insertEvent({
          chainId: publicClient.chain.id,
          escrowAddress,
          blockNumber: String(log.blockNumber ?? 0n),
          txHash: log.transactionHash ?? zeroHash,
          logIndex: String(log.logIndex ?? 0),
          eventName,
          summary: summarizeTimelineEvent(eventName),
          payloadJson: JSON.stringify(toPayloadRecord(decoded.args)),
        });
      }
    }

    const latestBlock = await publicClient.getBlockNumber();
    setLastSyncedBlock(latestBlock);
    recomputeUserRoleStats(latestBlock.toString());

    return {
      escrowsIndexed: listKnownEscrows().length,
      lastSyncedBlock: latestBlock.toString(),
    };
  });

  return await transaction();
}

function summarizeBaseEvent(eventName: string) {
  switch (eventName) {
    case "EscrowCreated":
      return "Escrow deployed";
    case "MilestoneFunded":
      return "Buyer funded milestone";
    case "MilestoneSubmitted":
      return "Seller submitted milestone evidence";
    case "MilestoneApproved":
      return "Buyer approved milestone";
    case "MilestoneClaimed":
      return "Milestone payout finalized";
    case "MilestoneDisputed":
      return "Buyer opened a dispute";
    case "DisputeResolved":
      return "Arbiter resolved disputed milestone";
    case "MilestoneCancelled":
      return "Remaining milestone cancelled";
    case "DealCompleted":
      return "Deal completed";
    case "DealCancelled":
      return "Deal cancelled";
    default:
      return eventName;
  }
}

type TimelineSummaryContext = {
  payload?: Record<string, unknown>;
  previousEventName?: string | null;
  nextEventName?: string | null;
};

export function summarizeTimelineEvent(eventName: string, context?: TimelineSummaryContext) {
  if (eventName !== "MilestoneClaimed") {
    return summarizeBaseEvent(eventName);
  }

  const previousEventName = context?.previousEventName ?? null;
  const nextEventName = context?.nextEventName ?? null;

  if (previousEventName === "MilestoneApproved" || nextEventName === "MilestoneApproved") {
    return "Milestone payout finalized after buyer approval";
  }

  return "Milestone payout finalized (approval or seller timeout claim)";
}

export function deriveActorRole(eventName: string, context?: TimelineSummaryContext) {
  switch (eventName) {
    case "MilestoneFunded":
    case "MilestoneApproved":
    case "MilestoneDisputed":
      return "buyer";
    case "MilestoneSubmitted":
      return "seller";
    case "MilestoneClaimed":
      return context?.previousEventName === "MilestoneApproved" || context?.nextEventName === "MilestoneApproved"
        ? "buyer"
        : "seller";
    case "DisputeResolved":
      return "arbiter";
    default:
      return null;
  }
}

export function deriveActorDetails(
  eventName: string,
  participants?: { buyer_address: string; seller_address: string; arbiter_address: string },
  context?: { previousEventName?: string | null; nextEventName?: string | null }
) {
  const actorRole = deriveActorRole(eventName, context);

  if (!actorRole || !participants) {
    return null;
  }

  const actorAddress =
    actorRole === "buyer"
      ? participants.buyer_address
      : actorRole === "seller"
        ? participants.seller_address
        : participants.arbiter_address;

  return {
    address: actorAddress,
    role: actorRole,
  };
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { value };
}

function getMetadataField(value: unknown, field: "title" | "description") {
  if (typeof value === "object" && value !== null && field in value) {
    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === "string" ? candidate : null;
  }

  return null;
}
