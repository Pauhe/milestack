import { type Address, decodeEventLog } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { deploymentManifest } from "./config.js";
import { publicClient } from "./clients.js";

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

export async function readEscrowTimeline(address: Address) {
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address as Address;

  const [factoryLogs, escrowLogs] = await Promise.all([
    publicClient.getLogs({ address: factoryAddress, fromBlock: 0n }),
    publicClient.getLogs({ address, fromBlock: 0n }),
  ]);

  return [...factoryLogs, ...escrowLogs]
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
      return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
    })
    .map((log) => decodeLog(address, factoryAddress, log))
    .filter((item) => item !== null);
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
      summary: summarizeEvent(eventName),
      payload: decoded.args,
    };
  } catch {
    return null;
  }
}

function summarizeEvent(eventName: string) {
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
      return "Seller claimed payout after review window";
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
