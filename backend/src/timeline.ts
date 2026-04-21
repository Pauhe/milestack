import { type Address, decodeEventLog } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { publicClient } from "./clients.js";
import { deploymentManifest } from "./config.js";
import { deriveActorRole, summarizeTimelineEvent } from "./indexer.js";

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

function normalizeTimelinePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export async function readEscrowTimeline(address: Address) {
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address as Address;

  const [factoryLogs, escrowLogs] = await Promise.all([
    publicClient.getLogs({ address: factoryAddress, fromBlock: 0n }),
    publicClient.getLogs({ address, fromBlock: 0n }),
  ]);

  const decoded = [...factoryLogs, ...escrowLogs]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
      return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
    })
    .map((log) => decodeLog(address, factoryAddress, log))
    .filter((item) => item !== null);

  return decoded.map((event, index) => ({
    ...event,
    summary: summarizeTimelineEvent(event.eventName, {
      payload: normalizeTimelinePayload(event.payload),
      previousEventName: index > 0 ? decoded[index - 1]?.eventName : null,
      nextEventName: index < decoded.length - 1 ? decoded[index + 1]?.eventName : null,
      previousPayload: index > 0 ? normalizeTimelinePayload(decoded[index - 1]?.payload) : null,
      nextPayload: index < decoded.length - 1 ? normalizeTimelinePayload(decoded[index + 1]?.payload) : null,
    }),
    actorRole: deriveActorRole(event.eventName, {
      payload: normalizeTimelinePayload(event.payload),
      previousEventName: index > 0 ? decoded[index - 1]?.eventName : null,
      nextEventName: index < decoded.length - 1 ? decoded[index + 1]?.eventName : null,
      previousPayload: index > 0 ? normalizeTimelinePayload(decoded[index - 1]?.payload) : null,
      nextPayload: index < decoded.length - 1 ? normalizeTimelinePayload(decoded[index + 1]?.payload) : null,
    }),
  }));
}

function decodeLog(
  escrowAddress: Address,
  factoryAddress: Address,
  log: Awaited<ReturnType<typeof publicClient.getLogs>>[number]
) {
  if (!log.data || !log.topics) return null;

  try {
    const decoded =
      log.address.toLowerCase() === factoryAddress.toLowerCase()
        ? decodeEventLog({ abi: escrowFactoryAbi, data: log.data, topics: log.topics })
        : decodeEventLog({ abi: milestoneEscrowAbi, data: log.data, topics: log.topics });

    const eventName = decoded.eventName;
    if (!eventName || !trackedEventNames.has(eventName)) return null;

    return {
      time: null,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      escrowAddress,
      eventName,
      summary: summarizeTimelineEvent(eventName),
      payload: decoded.args,
    };
  } catch {
    return null;
  }
}
