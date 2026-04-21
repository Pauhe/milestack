#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  stringToHex,
} from "../backend/node_modules/viem/index.js";
import { privateKeyToAccount } from "../backend/node_modules/viem/accounts/index.js";

import escrowFactoryArtifact from "../contracts/out/EscrowFactory.sol/EscrowFactory.json" with { type: "json" };
import milestoneEscrowArtifact from "../contracts/out/MilestoneEscrow.sol/MilestoneEscrow.json" with { type: "json" };
import mockErc20Artifact from "../contracts/out/MockERC20.sol/MockERC20.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const environment = process.env.DEPLOY_ENVIRONMENT ?? "rehearsal-local";
const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:4100";
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const mode = process.env.REHEARSAL_MODE ?? "all"; // bootstrap | execute | all

const manifestPath = path.resolve(rootDir, "deployments", environment, "manifest.json");
const seedPath = path.resolve(rootDir, "deployments", environment, "seeded-journeys.json");
const artifactPath = path.resolve(rootDir, "deployments", environment, "rehearsal-verification.json");

const timeoutAdvanceSeconds = Number(process.env.REHEARSAL_TIMEOUT_ADVANCE_SECONDS ?? 604_801);
const disputeBuyerShareBps = Number(process.env.REHEARSAL_DISPUTE_BUYER_SHARE_BPS ?? 4_000);
const milestoneAmount = BigInt(process.env.REHEARSAL_MILESTONE_AMOUNT ?? "1000000");
const reviewWindowSeconds = Number(process.env.REHEARSAL_REVIEW_WINDOW_SECONDS ?? 300);
const protocolFeeBps = Number(process.env.REHEARSAL_PROTOCOL_FEE_BPS ?? 100);

const DEFAULT_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  buyer:
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  seller:
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  arbiter:
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

const deployerPrivateKey = (process.env.REHEARSAL_DEPLOYER_PRIVATE_KEY ?? DEFAULT_KEYS.deployer) as `0x${string}`;
const buyerPrivateKey = (process.env.REHEARSAL_BUYER_PRIVATE_KEY ?? DEFAULT_KEYS.buyer) as `0x${string}`;
const sellerPrivateKey = (process.env.REHEARSAL_SELLER_PRIVATE_KEY ?? DEFAULT_KEYS.seller) as `0x${string}`;
const arbiterPrivateKey = (process.env.REHEARSAL_ARBITER_PRIVATE_KEY ?? DEFAULT_KEYS.arbiter) as `0x${string}`;

type SeedJourney = {
  escrowAddress: string;
  dealId: string;
  milestoneId: number;
  events: string[];
};

type SeedPayload = {
  version: number;
  environment: string;
  generatedAt: string;
  baseTimestamp: string;
  defaults: {
    reviewWindowSeconds: number;
    metadataVisibility: string;
  };
  participants: {
    buyer: string;
    seller: string;
    arbiter: string;
    token: string;
    feeRecipient?: string;
  };
  journeys: {
    happyPath: SeedJourney;
    timeoutPath: SeedJourney;
    disputePath: SeedJourney;
  };
};

type Freshness = {
  state: string;
  degraded: boolean;
  status?: string;
  lastError?: string | null;
};

const escrowFactoryAbi = escrowFactoryArtifact.abi;
const milestoneEscrowAbi = milestoneEscrowArtifact.abi;
const mockErc20Abi = mockErc20Artifact.abi;
const mockErc20Bytecode = mockErc20Artifact.bytecode.object as `0x${string}`;
const escrowFactoryBytecode = escrowFactoryArtifact.bytecode.object as `0x${string}`;

const helperMilestoneAbi = parseAbi([
  "function getMilestone(uint256 milestoneId) view returns (uint256 amount, uint8 status, uint32 reviewWindowSeconds, uint64 submittedAt, uint64 reviewDeadline, bytes32 evidenceHash, bytes32 disputeHash, uint256 buyerAward, uint256 sellerAward)",
]);

function nowIso() {
  return new Date().toISOString();
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function ensureDirFor(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(rootDir, filePath)}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  ensureDirFor(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`GET ${url} failed with status ${response.status}`);
  }
  return body;
}

async function postJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(20_000) });
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`POST ${url} failed with status ${response.status}`);
  }
  return body;
}

function assertFreshnessContract(freshness: Freshness | null | undefined, scope: string) {
  assertCondition(freshness, `${scope}: missing freshness payload`);

  const state =
    typeof freshness.state === "string"
      ? freshness.state
      : typeof (freshness as Record<string, unknown>).freshness === "string"
        ? ((freshness as Record<string, unknown>).freshness as string)
        : null;

  assertCondition(typeof state === "string", `${scope}: freshness.state missing`);
  assertCondition(typeof freshness.degraded === "boolean", `${scope}: freshness.degraded missing`);

  if (state === "fresh") {
    assertCondition(freshness.degraded === false, `${scope}: fresh state cannot be degraded=true`);
  }

  if (state !== "fresh") {
    assertCondition(freshness.degraded === true, `${scope}: non-fresh state must be degraded=true`);
  }

  if (freshness.status === "failed") {
    assertCondition(
      typeof freshness.lastError === "string" && freshness.lastError.length > 0,
      `${scope}: failed freshness requires lastError`
    );
  }
}

function assertTimelineContainsSubsequence(actual: string[], expected: string[], scope: string) {
  let cursor = 0;
  for (const eventName of actual) {
    if (eventName === expected[cursor]) {
      cursor += 1;
      if (cursor === expected.length) {
        return;
      }
    }
  }

  throw new Error(`${scope}: expected subsequence ${expected.join("->")} not found in ${actual.join("->")}`);
}

async function triggerSyncWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await triggerSync();
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
}

async function waitForTimelineEvents(
  escrowAddress: string,
  expected: string[],
  maxAttempts = 15
): Promise<string[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(`${backendUrl}/escrows/${escrowAddress}/timeline`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 200) {
      const body = (await response.json()) as { items?: Array<Record<string, unknown>> };
      const items = Array.isArray(body.items) ? body.items : [];
      const types = items
        .map((item) => (typeof item.type === "string" ? item.type : ""))
        .filter((item): item is string => item.length > 0);

      try {
        assertTimelineContainsSubsequence(types, expected, `${escrowAddress}:timeline`);
        return types;
      } catch {
        // Not ready yet.
      }
    }

    await triggerSyncWithRetry();
    await new Promise((resolve) => setTimeout(resolve, attempt * 200));
  }

  throw new Error(`Timeline for ${escrowAddress} did not include expected sequence after retries`);
}

async function triggerSync() {
  await postJson<Record<string, unknown>>(`${backendUrl}/sync`);
}

function eventHashLabel(label: string): `0x${string}` {
  return keccak256(stringToHex(`${label}-${Date.now()}-${Math.random()}`));
}

async function bootstrapRuntime() {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  // Prevent stale backend checkpoint from skipping freshly created rehearsal logs
  // when local chain head was reset (e.g., anvil restart).
  try {
    const backendHealth = await getJson<Record<string, unknown>>(`${backendUrl}/health`);
    const indexedBlockRaw = ((backendHealth.sync as Record<string, unknown> | undefined)?.indexedBlock ?? "0") as string;
    const indexedBlock = typeof indexedBlockRaw === "string" && /^\d+$/.test(indexedBlockRaw) ? BigInt(indexedBlockRaw) : 0n;
    const chainHead = await publicClient.getBlockNumber();

    if (indexedBlock > chainHead) {
      const blocksToMine = Number(indexedBlock - chainHead + 3n);
      for (let i = 0; i < blocksToMine; i += 1) {
        await publicClient.request({ method: "evm_mine", params: [] });
      }
    }
  } catch {
    // Best-effort alignment only; downstream checks still validate backend truth contracts.
  }

  const deployer = privateKeyToAccount(deployerPrivateKey);
  const buyer = privateKeyToAccount(buyerPrivateKey);
  const seller = privateKeyToAccount(sellerPrivateKey);
  const arbiter = privateKeyToAccount(arbiterPrivateKey);
  const feeRecipient = deployer;

  const walletClient = createWalletClient({ account: deployer, transport: http(rpcUrl) });

  const usdcTx = await walletClient.deployContract({
    abi: mockErc20Abi,
    bytecode: mockErc20Bytecode,
    account: deployer,
  });
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcTx });
  assertCondition(usdcReceipt.contractAddress, "MockERC20 deployment missing contractAddress");
  const usdcAddress = usdcReceipt.contractAddress;

  const factoryTx = await walletClient.deployContract({
    abi: escrowFactoryAbi,
    bytecode: escrowFactoryBytecode,
    args: [usdcAddress, feeRecipient.address, protocolFeeBps],
    account: deployer,
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryTx });
  assertCondition(factoryReceipt.contractAddress, "EscrowFactory deployment missing contractAddress");
  const factoryAddress = factoryReceipt.contractAddress;

  const mintData = encodeFunctionData({
    abi: mockErc20Abi,
    functionName: "mint",
    args: [buyer.address, milestoneAmount * 3n],
  });
  await walletClient.sendTransaction({ account: deployer, to: usdcAddress, data: mintData });

  const approveData = encodeFunctionData({
    abi: mockErc20Abi,
    functionName: "approve",
    args: [factoryAddress, milestoneAmount * 3n],
  });
  await createWalletClient({ account: buyer, transport: http(rpcUrl) }).sendTransaction({
    account: buyer,
    to: usdcAddress,
    data: approveData,
    gas: 200_000n,
  });

  const buildDealHash = (name: string) => keccak256(stringToHex(`rehearsal-${name}-${Date.now()}`));

  async function createFundedEscrow(name: "happy" | "timeout" | "dispute") {
    const createData = encodeFunctionData({
      abi: escrowFactoryAbi,
      functionName: "createEscrow",
      args: [
        buyer.address,
        seller.address,
        arbiter.address,
        buildDealHash(name),
        [{ amount: milestoneAmount, reviewWindowSeconds }],
      ],
    });

    const createHash = await createWalletClient({ account: deployer, transport: http(rpcUrl) }).sendTransaction({
      account: deployer,
      to: factoryAddress,
      data: createData,
      gas: 5_000_000n,
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

    const createdLog = createReceipt.logs.find((log) => normalizeAddress(log.address) === normalizeAddress(factoryAddress));
    assertCondition(createdLog, `${name} escrow creation log missing`);

    const decoded = decodeEventLog({
      abi: escrowFactoryAbi,
      data: createdLog.data,
      topics: [...createdLog.topics] as [signature: `0x${string}`, ...args: `0x${string}`[]],
    });
    assertCondition(decoded.eventName === "EscrowCreated", `${name} escrow creation event mismatch`);
    const escrowAddress = (decoded.args as { escrow: string }).escrow as `0x${string}`;

    const fundData = encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "fundMilestone",
      args: [0n],
    });
    await createWalletClient({ account: buyer, transport: http(rpcUrl) }).sendTransaction({
      account: buyer,
      to: escrowAddress,
      data: fundData,
      gas: 500_000n,
    });

    return escrowAddress;
  }

  const [happyEscrow, timeoutEscrow, disputeEscrow] = [
    await createFundedEscrow("happy"),
    await createFundedEscrow("timeout"),
    await createFundedEscrow("dispute"),
  ];

  const chainId = Number(await publicClient.getChainId());

  const baseManifest = readJson<Record<string, unknown>>(manifestPath);
  const nextManifest = {
    ...baseManifest,
    environment,
    chain: {
      chainId,
      name: chainId === 84532 ? "base-sepolia" : "anvil",
    },
    deployedAt: {
      blockNumber: Number(factoryReceipt.blockNumber ?? 0n),
      timestamp: nowIso(),
      txHash: factoryTx,
    },
    contracts: {
      ...(typeof baseManifest.contracts === "object" && baseManifest.contracts !== null ? baseManifest.contracts : {}),
      escrowFactory: {
        address: factoryAddress,
        deploymentTxHash: factoryTx,
        verified: false,
      },
    },
    config: {
      ...(typeof baseManifest.config === "object" && baseManifest.config !== null ? baseManifest.config : {}),
      usdc: usdcAddress,
      feeRecipient: feeRecipient.address,
      protocolFeeBps,
      defaultReviewWindowSeconds: reviewWindowSeconds,
      metadataVisibility: "public",
    },
    artifacts: {
      ...(typeof baseManifest.artifacts === "object" && baseManifest.artifacts !== null ? baseManifest.artifacts : {}),
      commitSha: "rehearsal-runtime",
      contractBuildId: "rehearsal-runtime",
    },
  };

  const nextSeed: SeedPayload = {
    version: 1,
    environment,
    generatedAt: nowIso(),
    baseTimestamp: nowIso(),
    defaults: {
      reviewWindowSeconds,
      metadataVisibility: "public",
    },
    participants: {
      buyer: normalizeAddress(buyer.address),
      seller: normalizeAddress(seller.address),
      arbiter: normalizeAddress(arbiter.address),
      token: normalizeAddress(usdcAddress),
      feeRecipient: normalizeAddress(feeRecipient.address),
    },
    journeys: {
      happyPath: {
        escrowAddress: happyEscrow,
        dealId: "rehearsal-happy-001",
        milestoneId: 0,
        events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneApproved", "MilestoneClaimed"],
      },
      timeoutPath: {
        escrowAddress: timeoutEscrow,
        dealId: "rehearsal-timeout-001",
        milestoneId: 0,
        events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneClaimed"],
      },
      disputePath: {
        escrowAddress: disputeEscrow,
        dealId: "rehearsal-dispute-001",
        milestoneId: 0,
        events: ["EscrowCreated", "MilestoneFunded", "MilestoneSubmitted", "MilestoneDisputed", "DisputeResolved"],
      },
    },
  };

  writeJson(manifestPath, nextManifest);
  writeJson(seedPath, nextSeed);

  return {
    factoryAddress,
    usdcAddress,
    happyEscrow,
    timeoutEscrow,
    disputeEscrow,
    chainId,
  };
}

async function executeJourneys(seed: SeedPayload) {
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const seller = privateKeyToAccount(sellerPrivateKey);
  const buyer = privateKeyToAccount(buyerPrivateKey);
  const arbiter = privateKeyToAccount(arbiterPrivateKey);

  const verifyViews = async (label: string, journey: SeedJourney, expectedMilestoneStatus: number) => {
    await waitForTimelineEvents(journey.escrowAddress, journey.events);

    const [health, escrow, milestones, timeline, reputation] = await Promise.all([
      getJson<Record<string, unknown>>(`${backendUrl}/health`),
      getJson<Record<string, unknown>>(`${backendUrl}/escrows/${journey.escrowAddress}`),
      getJson<Record<string, unknown>>(`${backendUrl}/escrows/${journey.escrowAddress}/milestones`),
      getJson<Record<string, unknown>>(`${backendUrl}/escrows/${journey.escrowAddress}/timeline`),
      getJson<Record<string, unknown>>(`${backendUrl}/users/${seed.participants.seller}/reputation`),
    ]);

    assertFreshnessContract(health.sync as Freshness, `${label} /health.sync`);
    assertFreshnessContract(escrow.freshness as Freshness, `${label} /escrow freshness`);
    assertFreshnessContract(milestones.freshness as Freshness, `${label} /milestones freshness`);
    assertFreshnessContract(timeline.freshness as Freshness, `${label} /timeline freshness`);
    assertFreshnessContract(reputation.freshness as Freshness, `${label} /reputation freshness`);

    const timelineItems = Array.isArray(timeline.items) ? (timeline.items as Array<Record<string, unknown>>) : [];
    const timelineTypes = timelineItems
      .map((item) => (typeof item.type === "string" ? item.type : ""))
      .filter((item): item is string => item.length > 0);
    assertTimelineContainsSubsequence(timelineTypes, journey.events, `${label} timeline`);

    const milestoneItems = Array.isArray(milestones.items) ? (milestones.items as Array<Record<string, unknown>>) : [];
    const milestone = milestoneItems.find((item) => Number(item.milestone_id) === journey.milestoneId);
    assertCondition(milestone, `${label}: milestone ${journey.milestoneId} missing`);
    assertCondition(
      Number(milestone.status) === expectedMilestoneStatus,
      `${label}: milestone status mismatch expected=${expectedMilestoneStatus} actual=${String(milestone.status)}`
    );

    return { health, escrow, milestones, timeline, reputation };
  };

  const sendTx = async (fromKey: `0x${string}`, to: `0x${string}`, data: `0x${string}`) => {
    const account = privateKeyToAccount(fromKey);
    return createWalletClient({ account, transport: http(rpcUrl) }).sendTransaction({
      account,
      to,
      data,
      gas: 500_000n,
    });
  };

  // Happy path: submit -> approve.
  const happySubmitTx = await sendTx(
    sellerPrivateKey,
    seed.journeys.happyPath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "submitMilestone",
      args: [0n, eventHashLabel("happy-evidence")],
    })
  );
  await triggerSync();

  const happyApproveTx = await sendTx(
    buyerPrivateKey,
    seed.journeys.happyPath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "approveMilestone",
      args: [0n],
    })
  );
  await triggerSync();

  const happyViews = await verifyViews("happy", seed.journeys.happyPath, 7);
  const happyClaim = (happyViews.timeline.items as Array<Record<string, unknown>>).find((item) => item.type === "MilestoneClaimed");
  assertCondition(happyClaim, "happy: MilestoneClaimed missing");
  assertCondition(
    (happyClaim.truth as Record<string, unknown>)?.payoutAttribution === "buyer_approved",
    "happy: expected payoutAttribution=buyer_approved"
  );

  // Timeout path: submit -> advance time -> claim.
  const timeoutSubmitTx = await sendTx(
    sellerPrivateKey,
    seed.journeys.timeoutPath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "submitMilestone",
      args: [0n, eventHashLabel("timeout-evidence")],
    })
  );
  await triggerSync();

  await publicClient.request({ method: "evm_increaseTime", params: [timeoutAdvanceSeconds] });
  await publicClient.request({ method: "evm_mine", params: [] });

  const timeoutClaimTx = await sendTx(
    sellerPrivateKey,
    seed.journeys.timeoutPath.escrowAddress as `0x${string}`,
    encodeFunctionData({ abi: milestoneEscrowAbi, functionName: "claimAfterReviewWindow", args: [0n] })
  );
  await triggerSync();

  const timeoutViews = await verifyViews("timeout", seed.journeys.timeoutPath, 7);
  const timeoutClaim = (timeoutViews.timeline.items as Array<Record<string, unknown>>).find((item) => item.type === "MilestoneClaimed");
  assertCondition(timeoutClaim, "timeout: MilestoneClaimed missing");
  assertCondition(
    (timeoutClaim.truth as Record<string, unknown>)?.payoutAttribution === "seller_timeout_or_unresolved",
    "timeout: expected payoutAttribution=seller_timeout_or_unresolved"
  );

  // Dispute path: submit -> dispute -> resolve.
  const disputeSubmitTx = await sendTx(
    sellerPrivateKey,
    seed.journeys.disputePath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "submitMilestone",
      args: [0n, eventHashLabel("dispute-evidence")],
    })
  );
  await triggerSync();

  const disputeOpenTx = await sendTx(
    buyerPrivateKey,
    seed.journeys.disputePath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "openDispute",
      args: [0n, eventHashLabel("dispute-hash")],
    })
  );
  await triggerSync();

  const onchainMilestone = await publicClient.readContract({
    address: seed.journeys.disputePath.escrowAddress as `0x${string}`,
    abi: helperMilestoneAbi,
    functionName: "getMilestone",
    args: [0n],
  });
  const amount = onchainMilestone[0] as bigint;
  const buyerAward = (amount * BigInt(disputeBuyerShareBps)) / 10_000n;
  const sellerAward = amount - buyerAward;

  const disputeResolveTx = await sendTx(
    arbiterPrivateKey,
    seed.journeys.disputePath.escrowAddress as `0x${string}`,
    encodeFunctionData({
      abi: milestoneEscrowAbi,
      functionName: "resolveDispute",
      args: [0n, buyerAward, sellerAward],
    })
  );
  await triggerSyncWithRetry();

  const disputeViews = await verifyViews("dispute", seed.journeys.disputePath, sellerAward > 0n ? 7 : 8);
  assertCondition(
    ((disputeViews.escrow.truth as Record<string, unknown>)?.activeDispute as Record<string, unknown>)?.state === "none",
    "dispute: escrow truth activeDispute.state should be none after resolution"
  );

  assertCondition(normalizeAddress(seed.participants.buyer) === normalizeAddress(buyer.address), "seed buyer does not match runtime buyer key");
  assertCondition(normalizeAddress(seed.participants.seller) === normalizeAddress(seller.address), "seed seller does not match runtime seller key");
  assertCondition(normalizeAddress(seed.participants.arbiter) === normalizeAddress(arbiter.address), "seed arbiter does not match runtime arbiter key");

  return {
    happyPath: {
      escrowAddress: seed.journeys.happyPath.escrowAddress,
      submitTxHash: happySubmitTx,
      approveTxHash: happyApproveTx,
    },
    timeoutPath: {
      escrowAddress: seed.journeys.timeoutPath.escrowAddress,
      submitTxHash: timeoutSubmitTx,
      claimTxHash: timeoutClaimTx,
    },
    disputePath: {
      escrowAddress: seed.journeys.disputePath.escrowAddress,
      submitTxHash: disputeSubmitTx,
      openDisputeTxHash: disputeOpenTx,
      resolveDisputeTxHash: disputeResolveTx,
      buyerAward: buyerAward.toString(),
      sellerAward: sellerAward.toString(),
    },
  };
}

async function run() {
  const startedAt = nowIso();
  const phases: Array<Record<string, string | boolean | null>> = [];

  const markPhase = (phase: string, status: "running" | "complete" | "failed", details: string) => {
    phases.push({ phase, status, details, at: nowIso() });
    console.log(`[rehearse] phase=${phase} status=${status} details=${details}`);
  };

  try {
    let bootstrapOutput: Record<string, unknown> | null = null;
    if (mode === "bootstrap" || mode === "all") {
      markPhase("bootstrap", "running", "deploy mock token/factory + seed funded escrows + write manifest/seed fixtures");
      bootstrapOutput = await bootstrapRuntime();
      markPhase("bootstrap", "complete", "runtime rehearsal fixtures written");

      if (mode === "all") {
        // Ensure backend indexer starts from current head so rehearsal checks isolate this run.
        await triggerSyncWithRetry();
      }
    }

    let executeOutput: Record<string, unknown> | null = null;
    if (mode === "execute" || mode === "all") {
      markPhase("execute", "running", `backend=${backendUrl}`);
      const health = await getJson<Record<string, unknown>>(`${backendUrl}/health`);
      assertCondition(health.ok === true, "backend health returned ok=false");
      const seed = readJson<SeedPayload>(seedPath);
      executeOutput = await executeJourneys(seed);
      markPhase("execute", "complete", "all journeys verified through backend truth surfaces");
    }

    const result = {
      ok: true,
      environment,
      mode,
      rpcUrl,
      backendUrl,
      startedAt,
      completedAt: nowIso(),
      phases,
      bootstrap: bootstrapOutput,
      execute: executeOutput,
    };

    writeJson(artifactPath, result);
    console.log(`[rehearse] artifact=${path.relative(rootDir, artifactPath)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markPhase("fatal", "failed", message);
    writeJson(artifactPath, {
      ok: false,
      environment,
      mode,
      rpcUrl,
      backendUrl,
      startedAt,
      completedAt: nowIso(),
      phases,
      error: message,
    });
    throw error;
  }
}

void run();
