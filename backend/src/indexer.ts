import { type Address, decodeEventLog, zeroHash } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { publicClient as defaultPublicClient } from "./clients.js";
import { deploymentManifest } from "./config.js";
import { db, getSyncHealthState, patchSyncHealthState } from "./db.js";
import { recomputeUserRoleStats, recomputeUserRoleStatsFromReadModels } from "./reputation.js";
import {
  clearDerivedReadModels,
  getMetadataCache,
  insertEvent,
  listAllEvents,
  listKnownEscrows,
  listMetadataCache,
  upsertEscrow,
  upsertMilestone,
} from "./repository.js";

type DecodedLog = {
  chainId: number;
  escrowAddress: string;
  blockNumber: string;
  txHash: string;
  logIndex: string;
  eventName: string;
  payloadJson: string;
  summary: string;
};

type ParsedEventEnvelope = {
  blockNumber: bigint;
  txHash: string;
  logIndex: bigint;
  eventName: string;
  payload: Record<string, unknown>;
};

type RebuildMilestone = {
  escrowAddress: string;
  milestoneId: number;
  amount: bigint;
  status: number;
  reviewWindowSeconds: number;
  submittedAt: bigint;
  reviewDeadline: bigint;
  evidenceHash: string;
  disputeHash: string;
  buyerAward: bigint;
  sellerAward: bigint;
  metadataTitle: string | null;
  metadataDescription: string | null;
};

type RebuildEscrow = {
  address: string;
  buyerAddress: string;
  sellerAddress: string;
  arbiterAddress: string;
  tokenAddress: string;
  metadataHash: string;
  milestoneCount: number;
  dealStatus: number;
  currentMilestoneIndex: number;
  activeDisputeMilestoneId: string | null;
  totalFunded: bigint;
  totalReleasedToSeller: bigint;
  totalRefundedToBuyer: bigint;
  totalFeesCollected: bigint;
  createdAtBlock: string;
  updatedAtBlock: string;
  milestones: Map<number, RebuildMilestone>;
};

type SyncSummary = {
  escrowsIndexed: number;
  lastSyncedBlock: string;
  insertedEventCount: number;
  replayedEventCount: number;
};

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

type PublicClientLike = {
  chain: { id: number };
  getBlockNumber: () => Promise<bigint>;
  getLogs: (input: { address: Address; fromBlock: bigint }) => Promise<
    Array<{
      data: `0x${string}`;
      topics: readonly `0x${string}`[];
      blockNumber?: bigint;
      transactionHash?: `0x${string}`;
      logIndex?: number;
    }>
  >;
};

let activePublicClient: PublicClientLike = defaultPublicClient;

export function setIndexerPublicClient(client: PublicClientLike) {
  activePublicClient = client;
}

export function resetIndexerPublicClient() {
  activePublicClient = defaultPublicClient;
}

const milestoneTerminalStatus = {
  paidOut: 7,
  refunded: 8,
  cancelled: 9,
} as const;

const dealCompletedStatus = 2;
const dealCancelledStatus = 3;

export async function syncIndexer() {
  const syncBeforeRun = getSyncHealthState();
  const nowIso = new Date().toISOString();

  let discoveredHead = syncBeforeRun.chainHeadSeen;

  try {
    discoveredHead = await activePublicClient.getBlockNumber();

    patchSyncHealthState({
      lastAttemptedBlock: discoveredHead,
      lastAttemptedAt: nowIso,
      chainHeadSeen: discoveredHead,
      lagBlocks: clampLag(discoveredHead, syncBeforeRun.lastSuccessfulBlock),
      phase: "discover_logs",
      status: "syncing",
      lastError: null,
    });

    const discoveredLogs = await discoverLogs(syncBeforeRun.lastSuccessfulBlock);

    patchSyncHealthState({ phase: "persist_events", status: "syncing" });
    const insertedEventCount = persistEvents(discoveredLogs);

    patchSyncHealthState({ phase: "rebuild_projections", status: "rebuilding" });
    const rebuildResult = await rebuildProjectionsFromEvents(discoveredHead);

    patchSyncHealthState({ phase: "persist_outcome", status: "syncing" });
    persistSuccessfulOutcome(discoveredHead, rebuildResult.degradedError);

    return {
      escrowsIndexed: listKnownEscrows().length,
      lastSyncedBlock: discoveredHead.toString(),
      insertedEventCount,
      replayedEventCount: rebuildResult.replayedEventCount,
    } satisfies SyncSummary;
  } catch (error) {
    patchSyncHealthState({
      chainHeadSeen: discoveredHead,
      lagBlocks: clampLag(discoveredHead, syncBeforeRun.lastSuccessfulBlock),
      status: "failed",
      lastError: sanitizeSyncError(error),
    });

    throw error;
  }
}

export async function rebuildIndexerFromPersistedEvents() {
  const syncBeforeRun = getSyncHealthState();
  const nowIso = new Date().toISOString();

  patchSyncHealthState({
    lastAttemptedBlock: syncBeforeRun.lastSuccessfulBlock,
    lastAttemptedAt: nowIso,
    chainHeadSeen: syncBeforeRun.chainHeadSeen,
    lagBlocks: clampLag(syncBeforeRun.chainHeadSeen, syncBeforeRun.lastSuccessfulBlock),
    phase: "rebuild_projections",
    status: "rebuilding",
    lastError: null,
  });

  try {
    const rebuildResult = await rebuildProjectionsFromEvents(syncBeforeRun.lastSuccessfulBlock);

    patchSyncHealthState({ phase: "persist_outcome", status: "syncing" });
    persistSuccessfulOutcome(syncBeforeRun.lastSuccessfulBlock, rebuildResult.degradedError);

    return {
      escrowsIndexed: listKnownEscrows().length,
      lastSyncedBlock: syncBeforeRun.lastSuccessfulBlock.toString(),
      insertedEventCount: 0,
      replayedEventCount: rebuildResult.replayedEventCount,
    } satisfies SyncSummary;
  } catch (error) {
    patchSyncHealthState({
      status: "failed",
      lastError: sanitizeSyncError(error),
      lagBlocks: clampLag(syncBeforeRun.chainHeadSeen, syncBeforeRun.lastSuccessfulBlock),
    });
    throw error;
  }
}

async function discoverLogs(fromBlockExclusive: bigint) {
  const factoryAddress = deploymentManifest.contracts.escrowFactory.address as Address;
  const fromBlock = fromBlockExclusive > 0n ? fromBlockExclusive + 1n : 0n;

  const factoryLogs = await activePublicClient.getLogs({
    address: factoryAddress,
    fromBlock,
  });

  const discoveredEscrows = new Set<string>();

  const decodedFactoryLogs: DecodedLog[] = [];

  for (const log of factoryLogs) {
    const decoded = decodeEventLog({
      abi: escrowFactoryAbi,
      data: log.data,
      topics: [...log.topics] as [signature: `0x${string}`, ...args: `0x${string}`[]],
    });
    if (decoded.eventName !== "EscrowCreated") {
      continue;
    }

    const args = toPayloadRecord(decoded.args);
    const escrow = args.escrow;
    if (typeof escrow !== "string") {
      continue;
    }

    const escrowAddress = escrow.toLowerCase();
    discoveredEscrows.add(escrowAddress);

    decodedFactoryLogs.push({
      chainId: activePublicClient.chain.id,
      escrowAddress,
      blockNumber: String(log.blockNumber ?? 0n),
      txHash: log.transactionHash ?? zeroHash,
      logIndex: String(log.logIndex ?? 0),
      eventName: decoded.eventName,
      payloadJson: JSON.stringify(args),
      summary: summarizeTimelineEvent(decoded.eventName),
    });
  }

  const knownEscrows = new Set([...listKnownEscrows(), ...discoveredEscrows]);

  const decodedEscrowLogs: DecodedLog[] = [];
  for (const escrowAddress of knownEscrows) {
    const escrowLogs = await activePublicClient.getLogs({
      address: escrowAddress as Address,
      fromBlock,
    });

    for (const log of escrowLogs) {
      const decoded = decodeEventLog({
        abi: milestoneEscrowAbi,
        data: log.data,
        topics: [...log.topics] as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
      const eventName = decoded.eventName;
      if (!eventName || !trackedEventNames.has(eventName)) {
        continue;
      }

      decodedEscrowLogs.push({
        chainId: activePublicClient.chain.id,
        escrowAddress,
        blockNumber: String(log.blockNumber ?? 0n),
        txHash: log.transactionHash ?? zeroHash,
        logIndex: String(log.logIndex ?? 0),
        eventName,
        payloadJson: JSON.stringify(toPayloadRecord(decoded.args)),
        summary: summarizeTimelineEvent(eventName),
      });
    }
  }

  return [...decodedFactoryLogs, ...decodedEscrowLogs];
}

function persistEvents(logs: DecodedLog[]) {
  const persist = db.transaction((entries: DecodedLog[]) => {
    for (const entry of entries) {
      insertEvent({
        chainId: entry.chainId,
        escrowAddress: entry.escrowAddress,
        blockNumber: entry.blockNumber,
        txHash: entry.txHash,
        logIndex: entry.logIndex,
        eventName: entry.eventName,
        summary: entry.summary,
        payloadJson: entry.payloadJson,
      });
    }
  });

  persist(logs);
  return logs.length;
}

async function rebuildProjectionsFromEvents(updatedAtBlock: bigint): Promise<{ replayedEventCount: number; degradedError: string | null }> {
  clearDerivedReadModels();

  const eventRows = listAllEvents();
  const rebuildEscrows = new Map<string, RebuildEscrow>();
  const metadataCache = listMetadataCache();

  for (const row of eventRows) {
    const envelope = parseEventEnvelope(row);

    if (envelope.eventName === "EscrowCreated") {
      applyEscrowCreatedEvent(rebuildEscrows, envelope);
      continue;
    }

    const escrow = rebuildEscrows.get(row.escrow_address.toLowerCase());
    if (!escrow) {
      continue;
    }

    applyEscrowLifecycleEvent(escrow, envelope);
  }

  const metadataErrorByHash = new Map<string, string>();

  for (const escrow of rebuildEscrows.values()) {
    const metadataPayload = readMetadataPayload(escrow.metadataHash, metadataCache);
    if (metadataPayload.error) {
      metadataErrorByHash.set(escrow.metadataHash, metadataPayload.error);
    }

    const milestones = [...escrow.milestones.values()].sort((a, b) => a.milestoneId - b.milestoneId);

    upsertEscrow({
      address: escrow.address,
      buyerAddress: escrow.buyerAddress,
      sellerAddress: escrow.sellerAddress,
      arbiterAddress: escrow.arbiterAddress,
      tokenAddress: escrow.tokenAddress,
      metadataHash: escrow.metadataHash,
      milestoneCount: escrow.milestoneCount,
      dealStatus: escrow.dealStatus,
      currentMilestoneIndex: escrow.currentMilestoneIndex,
      activeDisputeMilestoneId: escrow.activeDisputeMilestoneId,
      totalFunded: escrow.totalFunded.toString(),
      totalReleasedToSeller: escrow.totalReleasedToSeller.toString(),
      totalRefundedToBuyer: escrow.totalRefundedToBuyer.toString(),
      totalFeesCollected: escrow.totalFeesCollected.toString(),
      createdAtBlock: escrow.createdAtBlock,
      updatedAtBlock: escrow.updatedAtBlock,
    });

    for (const milestone of milestones) {
      const metadataMilestone = Array.isArray(metadataPayload.payload?.milestones)
        ? metadataPayload.payload.milestones.find(
            (item) => typeof item === "object" && item !== null && "id" in item && (item as { id: unknown }).id === milestone.milestoneId
          )
        : null;

      upsertMilestone({
        escrowAddress: escrow.address,
        milestoneId: milestone.milestoneId,
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
  }

  let degradedError: string | null = null;
  if (metadataErrorByHash.size > 0) {
    const message = [...metadataErrorByHash.entries()]
      .map(([hash, error]) => `${hash}: ${error}`)
      .join("; ");

    degradedError = `metadata verification degraded: ${message}`;

    patchSyncHealthState({
      status: "stale",
      lastError: degradedError,
    });
  }

  recomputeUserRoleStatsFromReadModels({
    escrows: [...rebuildEscrows.values()],
    milestones: [...rebuildEscrows.values()].flatMap((escrow) => [...escrow.milestones.values()]),
    updatedAtBlock: updatedAtBlock.toString(),
  });

  return {
    replayedEventCount: eventRows.length,
    degradedError,
  };
}

function persistSuccessfulOutcome(latestBlock: bigint, degradedError: string | null) {
  const nowIso = new Date().toISOString();
  patchSyncHealthState({
    lastSuccessfulBlock: latestBlock,
    lastSuccessfulAt: nowIso,
    chainHeadSeen: latestBlock,
    lagBlocks: 0n,
    phase: "idle",
    status: degradedError ? "stale" : "healthy",
    lastError: degradedError,
  });

  // Keep existing SQL-based implementation in sync until all callers migrate.
  recomputeUserRoleStats(latestBlock.toString());
}

function applyEscrowCreatedEvent(rebuildEscrows: Map<string, RebuildEscrow>, event: ParsedEventEnvelope) {
  const address = asString(event.payload.escrow, "EscrowCreated.escrow").toLowerCase();
  const milestoneCount = Number(asBigInt(event.payload.milestoneCount, "EscrowCreated.milestoneCount"));

  const escrow: RebuildEscrow = {
    address,
    buyerAddress: asString(event.payload.buyer, "EscrowCreated.buyer").toLowerCase(),
    sellerAddress: asString(event.payload.seller, "EscrowCreated.seller").toLowerCase(),
    arbiterAddress: asString(event.payload.arbiter, "EscrowCreated.arbiter").toLowerCase(),
    tokenAddress: asString(event.payload.token, "EscrowCreated.token").toLowerCase(),
    metadataHash: asString(event.payload.metadataHash, "EscrowCreated.metadataHash"),
    milestoneCount,
    dealStatus: 1,
    currentMilestoneIndex: 0,
    activeDisputeMilestoneId: null,
    totalFunded: 0n,
    totalReleasedToSeller: 0n,
    totalRefundedToBuyer: 0n,
    totalFeesCollected: 0n,
    createdAtBlock: event.blockNumber.toString(),
    updatedAtBlock: event.blockNumber.toString(),
    milestones: new Map<number, RebuildMilestone>(),
  };

  for (let milestoneId = 0; milestoneId < milestoneCount; milestoneId += 1) {
    escrow.milestones.set(milestoneId, {
      escrowAddress: address,
      milestoneId,
      amount: 0n,
      status: 0,
      reviewWindowSeconds: 0,
      submittedAt: 0n,
      reviewDeadline: 0n,
      evidenceHash: zeroHash,
      disputeHash: zeroHash,
      buyerAward: 0n,
      sellerAward: 0n,
      metadataTitle: null,
      metadataDescription: null,
    });
  }

  rebuildEscrows.set(address, escrow);
}

function applyEscrowLifecycleEvent(escrow: RebuildEscrow, event: ParsedEventEnvelope) {
  escrow.updatedAtBlock = event.blockNumber.toString();

  const milestoneId = event.payload.milestoneId !== undefined ? Number(asBigInt(event.payload.milestoneId, `${event.eventName}.milestoneId`)) : null;
  const milestone = milestoneId !== null ? ensureMilestone(escrow, milestoneId) : null;

  switch (event.eventName) {
    case "MilestoneFunded": {
      if (!milestone) {
        return;
      }

      milestone.amount = asBigInt(event.payload.amount, "MilestoneFunded.amount");
      milestone.status = 1;
      escrow.totalFunded += milestone.amount;
      break;
    }
    case "MilestoneSubmitted": {
      if (!milestone) {
        return;
      }

      milestone.status = 2;
      milestone.evidenceHash = asString(event.payload.evidenceHash, "MilestoneSubmitted.evidenceHash");
      milestone.submittedAt = asBigInt(event.payload.submittedAt, "MilestoneSubmitted.submittedAt");
      milestone.reviewDeadline = asBigInt(event.payload.reviewDeadline, "MilestoneSubmitted.reviewDeadline");
      break;
    }
    case "MilestoneApproved": {
      if (!milestone) {
        return;
      }

      milestone.status = 3;
      break;
    }
    case "MilestoneDisputed": {
      if (!milestone) {
        return;
      }

      milestone.status = 5;
      milestone.disputeHash = asString(event.payload.disputeHash, "MilestoneDisputed.disputeHash");
      escrow.activeDisputeMilestoneId = milestoneId?.toString() ?? null;
      break;
    }
    case "DisputeResolved": {
      if (!milestone) {
        return;
      }

      const buyerAmount = asBigInt(event.payload.buyerAmount, "DisputeResolved.buyerAmount");
      const sellerAmount = asBigInt(event.payload.sellerAmount, "DisputeResolved.sellerAmount");
      const feeAmount = asBigInt(event.payload.feeAmount, "DisputeResolved.feeAmount");

      milestone.buyerAward = buyerAmount;
      milestone.sellerAward = sellerAmount;
      milestone.status = sellerAmount === 0n ? milestoneTerminalStatus.refunded : milestoneTerminalStatus.paidOut;

      escrow.totalRefundedToBuyer += buyerAmount;
      escrow.totalReleasedToSeller += sellerAmount;
      escrow.totalFeesCollected += feeAmount;
      escrow.activeDisputeMilestoneId = null;

      advanceCurrentMilestoneIfTerminal(escrow, milestoneId ?? 0);
      break;
    }
    case "MilestoneClaimed": {
      if (!milestone) {
        return;
      }

      const sellerAmount = asBigInt(event.payload.sellerAmount, "MilestoneClaimed.sellerAmount");
      const feeAmount = asBigInt(event.payload.feeAmount, "MilestoneClaimed.feeAmount");

      milestone.sellerAward = sellerAmount;
      milestone.status = milestoneTerminalStatus.paidOut;

      escrow.totalReleasedToSeller += sellerAmount;
      escrow.totalFeesCollected += feeAmount;

      advanceCurrentMilestoneIfTerminal(escrow, milestoneId ?? 0);
      break;
    }
    case "MilestoneCancelled": {
      if (!milestone) {
        return;
      }

      milestone.status = milestoneTerminalStatus.cancelled;
      break;
    }
    case "DealCompleted": {
      escrow.dealStatus = dealCompletedStatus;
      break;
    }
    case "DealCancelled": {
      escrow.dealStatus = dealCancelledStatus;
      break;
    }
    default:
      break;
  }
}

function ensureMilestone(escrow: RebuildEscrow, milestoneId: number) {
  const existing = escrow.milestones.get(milestoneId);
  if (existing) {
    return existing;
  }

  const created: RebuildMilestone = {
    escrowAddress: escrow.address,
    milestoneId,
    amount: 0n,
    status: 0,
    reviewWindowSeconds: 0,
    submittedAt: 0n,
    reviewDeadline: 0n,
    evidenceHash: zeroHash,
    disputeHash: zeroHash,
    buyerAward: 0n,
    sellerAward: 0n,
    metadataTitle: null,
    metadataDescription: null,
  };
  escrow.milestones.set(milestoneId, created);
  return created;
}

function advanceCurrentMilestoneIfTerminal(escrow: RebuildEscrow, milestoneId: number) {
  if (milestoneId + 1 < escrow.milestoneCount) {
    escrow.currentMilestoneIndex = Math.max(escrow.currentMilestoneIndex, milestoneId + 1);
  }
}

function parseEventEnvelope(row: {
  block_number: string;
  tx_hash: string;
  log_index: string;
  event_name: string;
  payload_json: string;
}) {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Malformed payload_json for event ${row.event_name} at tx=${row.tx_hash},logIndex=${row.log_index}`);
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Malformed payload_json object for event ${row.event_name} at tx=${row.tx_hash},logIndex=${row.log_index}`);
  }

  return {
    blockNumber: BigInt(row.block_number),
    txHash: row.tx_hash,
    logIndex: BigInt(row.log_index),
    eventName: row.event_name,
    payload: payload as Record<string, unknown>,
  } satisfies ParsedEventEnvelope;
}

function readMetadataPayload(
  metadataHash: string,
  rows: Array<{ metadata_hash: string; verified: number; payload_json: string | null; error: string | null }>
): { payload: Record<string, unknown> | null; error: string | null } {
  const row = rows.find((item) => item.metadata_hash === metadataHash) ?? getMetadataCache(metadataHash);
  if (!row) {
    return { payload: null, error: "missing metadata cache" };
  }

  if (row.verified !== 1) {
    return { payload: null, error: row.error ?? "metadata cache not verified" };
  }

  if (!row.payload_json) {
    return { payload: null, error: "metadata cache verified without payload" };
  }

  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { payload: parsed as Record<string, unknown>, error: null };
    }

    return { payload: null, error: "metadata payload is not a JSON object" };
  } catch {
    return { payload: null, error: "metadata payload JSON parse failed" };
  }
}

function asString(value: unknown, fieldName: string) {
  if (typeof value === "string") {
    return value;
  }

  throw new Error(`Malformed event payload for ${fieldName}`);
}

function asBigInt(value: unknown, fieldName: string) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  if (typeof value === "string") {
    return BigInt(value);
  }

  throw new Error(`Malformed event payload for ${fieldName}`);
}

function sanitizeSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function clampLag(chainHeadSeen: bigint, lastSuccessfulBlock: bigint) {
  return chainHeadSeen > lastSuccessfulBlock ? chainHeadSeen - lastSuccessfulBlock : 0n;
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

function normalizePayload(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePayload(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizePayload(item)])
    );
  }

  return value;
}

function toPayloadRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return normalizePayload(value) as Record<string, unknown>;
  }

  return { value: normalizePayload(value) };
}

function getMetadataField(value: unknown, field: "title" | "description") {
  if (typeof value === "object" && value !== null && field in value) {
    const candidate = (value as Record<string, unknown>)[field];
    return typeof candidate === "string" ? candidate : null;
  }

  return null;
}
