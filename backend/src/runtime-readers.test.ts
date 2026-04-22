import assert from "node:assert/strict";
import test from "node:test";

import { type Address, encodeEventTopics } from "viem";

import { escrowFactoryAbi } from "./abi/escrowFactoryAbi.js";
import { milestoneEscrowAbi } from "./abi/milestoneEscrowAbi.js";
import { publicClient } from "./clients.js";
import { deploymentManifest } from "./config.js";
import { readEscrowMilestone, readEscrowOverview } from "./escrows.js";
import { readEscrowTimeline } from "./timeline.js";

const ESCROW = "0x1000000000000000000000000000000000000001" as Address;
const BUYER = "0x2000000000000000000000000000000000000002" as Address;
const SELLER = "0x3000000000000000000000000000000000000003" as Address;
const ARBITER = "0x4000000000000000000000000000000000000004" as Address;
const TOKEN = "0x5000000000000000000000000000000000000005" as Address;
const FACTORY = deploymentManifest.contracts.escrowFactory.address as Address;

function padAddress(value: string): `0x${string}` {
  const raw = value.toLowerCase().replace(/^0x/, "");
  return `0x${raw.padStart(64, "0")}`;
}

function padUint(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

type PrimitiveArg = string | number | bigint | boolean;

function encodeNonIndexedData(eventName: string, args: Record<string, PrimitiveArg>): `0x${string}` {
  if (eventName === "DealCompleted") {
    return "0x";
  }

  if (eventName === "EscrowCreated") {
    const arbiter = String(args.arbiter);
    const token = String(args.token);
    const milestoneCount = BigInt(args.milestoneCount ?? 0n);
    const metadataHash = String(args.metadataHash);

    return (
      padAddress(arbiter) +
      padAddress(token).slice(2) +
      padUint(milestoneCount).slice(2) +
      metadataHash.slice(2)
    ) as `0x${string}`;
  }

  if (eventName === "MilestoneClaimed") {
    return (
      padUint(BigInt(args.sellerAmount ?? 0n)) +
      padUint(BigInt(args.feeAmount ?? 0n)).slice(2)
    ) as `0x${string}`;
  }

  if (eventName === "MilestoneApproved") {
    return "0x";
  }

  if (eventName === "WidenedAuthorityConfigured") {
    return (
      padUint(BigInt(args.modelVersion ?? 0n)) +
      padUint(BigInt(args.participantCount ?? 0n)).slice(2) +
      padUint(BigInt(args.delegationCount ?? 0n)).slice(2)
    ) as `0x${string}`;
  }

  return "0x";
}

function createLog(
  abi: readonly unknown[],
  eventName: string,
  args: Record<string, PrimitiveArg>,
  blockNumber: bigint,
  txHash: `0x${string}`,
  logIndex: bigint,
  address: Address
) {
  const topics = encodeEventTopics({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    abi: abi as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventName: eventName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  });

  return {
    address,
    blockNumber,
    transactionHash: txHash,
    logIndex,
    data: encodeNonIndexedData(eventName, args),
    topics: topics as readonly `0x${string}`[],
  };
}

test("readEscrowOverview maps multicall tuple into typed overview response", async () => {
  const originalMulticall = publicClient.multicall;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (publicClient as any).multicall = async () => [
    BUYER,
    SELLER,
    ARBITER,
    TOKEN,
    "0xabcdef",
    2,
    3n,
    1n,
    0n,
    1000n,
    900n,
    50n,
    10n,
  ];

  try {
    const overview = await readEscrowOverview(ESCROW);

    assert.equal(overview.address, ESCROW);
    assert.equal(overview.chainId, deploymentManifest.chain.chainId);
    assert.equal(overview.dealStatus, 2);
    assert.equal(overview.metadataHash, "0xabcdef");
    assert.equal(overview.milestoneCount, 3n);
    assert.equal(overview.currentMilestoneIndex, 1n);
    assert.deepEqual(overview.totals, {
      funded: 1000n,
      releasedToSeller: 900n,
      refundedToBuyer: 50n,
      feesCollected: 10n,
    });
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publicClient as any).multicall = originalMulticall;
  }
});

test("readEscrowMilestone maps readContract response", async () => {
  const originalReadContract = publicClient.readContract;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (publicClient as any).readContract = async () => ({
    amount: 99n,
    status: 3,
    reviewWindowSeconds: 86400,
    submittedAt: 123n,
    reviewDeadline: 456n,
    evidenceHash: "0xeeee",
    disputeHash: "0xdddd",
    buyerAward: 11n,
    sellerAward: 88n,
  });

  try {
    const milestone = await readEscrowMilestone(ESCROW, 2n);

    assert.equal(milestone.milestoneId, 2n);
    assert.equal(milestone.amount, 99n);
    assert.equal(milestone.status, 3);
    assert.equal(milestone.evidenceHash, "0xeeee");
    assert.equal(milestone.disputeHash, "0xdddd");
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publicClient as any).readContract = originalReadContract;
  }
});

test("readEscrowTimeline decodes, sorts, and derives contextual actor attribution", async () => {
  const originalGetLogs = publicClient.getLogs;

  const factoryLog = createLog(
    escrowFactoryAbi,
    "EscrowCreated",
    {
      escrow: ESCROW,
      buyer: BUYER,
      seller: SELLER,
      arbiter: ARBITER,
      token: TOKEN,
      milestoneCount: 1n,
      metadataHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    1n,
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    0n,
    FACTORY
  );

  const claimLog = createLog(
    milestoneEscrowAbi,
    "MilestoneClaimed",
    { milestoneId: 0n, sellerAmount: 99n, feeAmount: 1n },
    2n,
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    0n,
    ESCROW
  );

  const approveLog = createLog(
    milestoneEscrowAbi,
    "MilestoneApproved",
    { milestoneId: 0n },
    2n,
    "0x2222222222222222222222222222222222222222222222222222222222222222",
    1n,
    ESCROW
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (publicClient as any).getLogs = async ({ address }: { address: Address }) => {
    if (address.toLowerCase() === FACTORY.toLowerCase()) {
      return [factoryLog];
    }
    return [claimLog, approveLog];
  };

  try {
    const events = await readEscrowTimeline(ESCROW);
    assert.equal(events.length, 3);

    const claimed = events.find((item) => item.eventName === "MilestoneClaimed");
    assert.ok(claimed);
    assert.equal(claimed.actorRole, "buyer");
    assert.match(claimed.summary, /buyer approval/i);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publicClient as any).getLogs = originalGetLogs;
  }
});

test("readEscrowTimeline drops untracked and malformed logs", async () => {
  const originalGetLogs = publicClient.getLogs;

  const untracked = createLog(
    milestoneEscrowAbi,
    "WidenedAuthorityConfigured",
    { modelVersion: 1n, participantCount: 1n, delegationCount: 0n },
    3n,
    "0x3333333333333333333333333333333333333333333333333333333333333333",
    0n,
    ESCROW
  );

  const malformed = {
    address: ESCROW,
    blockNumber: 4n,
    transactionHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    logIndex: 0n,
    data: "0x",
    topics: ["0xdeadbeef"],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (publicClient as any).getLogs = async ({ address }: { address: Address }) =>
    address.toLowerCase() === FACTORY.toLowerCase() ? [] : [untracked, malformed];

  try {
    const events = await readEscrowTimeline(ESCROW);
    assert.equal(events.length, 0);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publicClient as any).getLogs = originalGetLogs;
  }
});

test("readEscrowTimeline handles missing data/topics, default logIndex sorting, and non-object payload normalization", async () => {
  const originalGetLogs = publicClient.getLogs;

  const approved = createLog(
    milestoneEscrowAbi,
    "MilestoneApproved",
    { milestoneId: 0n },
    10n,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    2n,
    ESCROW
  );

  const claimedNoIndex = createLog(
    milestoneEscrowAbi,
    "MilestoneClaimed",
    { milestoneId: 0n, sellerAmount: 20n, feeAmount: 1n },
    10n,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    0n,
    ESCROW
  );

  const completedNoIndex = createLog(
    milestoneEscrowAbi,
    "DealCompleted",
    {},
    10n,
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    0n,
    ESCROW
  );

  const missingTopics = {
    address: ESCROW,
    blockNumber: 9n,
    transactionHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    logIndex: 0n,
    data: "0x",
    topics: null,
  };

  const missingData = {
    address: ESCROW,
    blockNumber: 9n,
    transactionHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    logIndex: 1n,
    data: null,
    topics: ["0xdeadbeef"],
  };

  const withUndefinedLogIndex = {
    ...completedNoIndex,
    logIndex: undefined,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (publicClient as any).getLogs = async ({ address }: { address: Address }) => {
    if (address.toLowerCase() === FACTORY.toLowerCase()) {
      return [];
    }

    return [approved, withUndefinedLogIndex, missingTopics, missingData];
  };

  try {
    const events = await readEscrowTimeline(ESCROW);

    assert.equal(events.length, 2);
    assert.equal(events[0]?.eventName, "DealCompleted");
    assert.equal(events[1]?.eventName, "MilestoneApproved");
    assert.equal(events[0]?.logIndex, undefined);
    assert.equal(events[0]?.actorRole, null);
    assert.match(events[0]?.summary ?? "", /deal completed/i);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (publicClient as any).getLogs = originalGetLogs;
  }
});
