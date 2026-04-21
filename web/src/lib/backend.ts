import { appEnv } from "@/lib/env";

export type BackendFreshnessState = "fresh" | "stale" | "rebuilding" | "unavailable";

export type BackendFreshnessPayload = {
  state: BackendFreshnessState;
  degraded: boolean;
  indexedBlock: string | null;
  chainHead: string | null;
  lagBlocks: string | null;
  lastSuccessfulAt: string | null;
  lastAttemptedAt: string | null;
  phase: string;
  status: string;
  isSyncing: boolean;
  syncLoopError: string | null;
  lastError: string | null;
};

export type BackendFreshnessAssessmentState =
  | "healthy"
  | "stale"
  | "rebuilding"
  | "failed"
  | "unavailable";

export type BackendFreshnessAssessment = {
  state: BackendFreshnessAssessmentState;
  degraded: boolean;
  lagBlocks: string | null;
  status: string | null;
  message: string;
  error: string | null;
};

export type BackendFreshnessSurface = "deal" | "milestone" | "profile";

export type BackendMetadataVerificationState =
  | "verified"
  | "mismatched"
  | "missing"
  | "degraded"
  | "unverified";

export type BackendMetadataTruth = {
  state: BackendMetadataVerificationState;
  verified: boolean;
  degraded: boolean;
  metadataHash: string;
  metadataUrl: string | null;
  payload: Record<string, unknown> | null;
  payloadPresent: boolean;
  updatedAtBlock: string | null;
  error: string | null;
};

export type BackendMetadataTruthAssessment = {
  state: BackendMetadataVerificationState | "unavailable";
  verified: boolean;
  degraded: boolean;
  message: string;
  detail: string | null;
  metadataUrl: string | null;
  payloadPresent: boolean | null;
  updatedAtBlock: string | null;
};

export type BackendMilestoneMetadataVerificationState =
  | "verified"
  | "mismatched"
  | "missing"
  | "unavailable";

export type BackendMilestoneMetadataVerificationTruth = {
  state: BackendMilestoneMetadataVerificationState;
  verified: boolean;
  titleVerified: boolean;
  descriptionVerified: boolean;
  degraded: boolean;
  reason: string | null;
};

export type BackendMilestoneMetadataVerificationAssessment = {
  state: BackendMilestoneMetadataVerificationState | "unavailable";
  verified: boolean;
  degraded: boolean;
  message: string;
  reason: string | null;
  titleVerified: boolean | null;
  descriptionVerified: boolean | null;
};

export type BackendHashContextTruth = {
  state: "present" | "missing";
  hash: string | null;
  verified: false;
  degraded: boolean;
  ambiguity: "not-verifiable-from-onchain-hash" | null;
  reason: string | null;
};

export type BackendHashContextAssessment = {
  state: "present" | "missing" | "unavailable";
  hash: string | null;
  degraded: boolean;
  message: string;
  reason: string | null;
};

export type BackendEscrowTruth = {
  metadata: BackendMetadataTruth;
  activeDispute: {
    state: "present" | "none";
    milestoneId: string | null;
    verified: boolean;
    degraded: boolean;
    reason: string | null;
  };
};

export type BackendMilestoneTruth = {
  metadataVerification: BackendMilestoneMetadataVerificationTruth;
  evidence: BackendHashContextTruth;
  disputeContext: BackendHashContextTruth;
};

export type BackendTimelineTruth = Record<string, unknown> & {
  ambiguity?: string | null;
  reason?: string | null;
  degraded?: boolean;
};

export type BackendReputationTruth = {
  canonicalSource: string;
  ambiguityPolicy: string;
};

export type BackendReputationTruthAssessment = {
  state: "healthy" | "degraded";
  message: string;
};

export type BackendEscrowOverview = {
  address: string;
  buyer_address: string;
  seller_address: string;
  arbiter_address: string;
  token_address: string;
  metadata_hash: `0x${string}`;
  milestone_count: number;
  deal_status: number;
  current_milestone_index: number;
  active_dispute_milestone_id: string | null;
  total_funded: string;
  total_released_to_seller: string;
  total_refunded_to_buyer: string;
  total_fees_collected: string;
  derived?: {
    isBlockedByDispute: boolean;
    activeDisputeMilestoneId: number | null;
    nextActionableMilestoneId: number | null;
  };
  truth?: BackendEscrowTruth;
  freshness?: BackendFreshnessPayload | null;
};

export type BackendMilestone = {
  escrow_address: string;
  milestone_id: number;
  amount: string;
  status: number;
  review_window_seconds: number;
  submitted_at: string;
  review_deadline: string;
  evidence_hash: string;
  dispute_hash: string;
  buyer_award: string;
  seller_award: string;
  metadata_title: string | null;
  metadata_description: string | null;
  derived?: {
    isCurrent: boolean;
    isBlocked: boolean;
    buyerCanApprove: boolean;
    buyerCanDispute: boolean;
    sellerCanClaim: boolean;
  };
  truth?: BackendMilestoneTruth;
  freshness?: BackendFreshnessPayload | null;
};

export type BackendTimelineEntry = {
  time: string | null;
  type: string;
  summary: string;
  actor: {
    address: string;
    role: string;
  } | null;
  payload: Record<string, unknown>;
  truth?: BackendTimelineTruth | null;
};

export type BackendReputation = {
  address: string;
  buyerStats: Record<string, unknown> | null;
  sellerStats: Record<string, unknown> | null;
  arbiterStats: Record<string, unknown> | null;
  truth?: BackendReputationTruth | null;
  freshness?: BackendFreshnessPayload | null;
};

export type BackendItemsResponse<T> = {
  items: T[];
  freshness?: BackendFreshnessPayload | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getBackendBaseUrl() {
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
}

function sanitizeBackendErrorMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value);
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeLagText(lagBlocks: string | null) {
  if (!lagBlocks || lagBlocks === "0") {
    return "";
  }

  return ` (lag: ${lagBlocks} blocks)`;
}

export async function fetchBackendJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Backend request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function getBackendUnavailableAssessment(error: unknown): BackendFreshnessAssessment {
  const message = sanitizeBackendErrorMessage(error);

  if (message.toLowerCase().includes("timed out")) {
    return {
      state: "unavailable",
      degraded: true,
      lagBlocks: null,
      status: null,
      message: "Backend freshness timed out. Derived data may be stale or unavailable.",
      error: message,
    };
  }

  return {
    state: "unavailable",
    degraded: true,
    lagBlocks: null,
    status: null,
    message: "Backend freshness is unavailable. Derived data may be stale or missing.",
    error: message,
  };
}

export function getBackendFreshnessAssessment(
  freshness: BackendFreshnessPayload | null | undefined
): BackendFreshnessAssessment {
  if (!freshness) {
    return {
      state: "unavailable",
      degraded: true,
      lagBlocks: null,
      status: null,
      message: "Backend freshness metadata is missing. Treat derived data as degraded.",
      error: null,
    };
  }

  const status = safeString(freshness.status);
  const phase = safeString(freshness.phase);
  const lagBlocks = safeString(freshness.lagBlocks);
  const degraded = safeBoolean(freshness.degraded) ?? true;
  const lastError = safeString(freshness.lastError);

  if (
    freshness.state !== "fresh" &&
    freshness.state !== "stale" &&
    freshness.state !== "rebuilding" &&
    freshness.state !== "unavailable"
  ) {
    return {
      state: "unavailable",
      degraded: true,
      lagBlocks: null,
      status,
      message: "Backend freshness response was malformed. Treat derived data as unavailable.",
      error: lastError,
    };
  }

  if (status === "failed") {
    return {
      state: "failed",
      degraded: true,
      lagBlocks,
      status,
      message: "Backend indexing is currently failed. Derived data may be missing or outdated.",
      error: lastError,
    };
  }

  if (
    freshness.state === "rebuilding" ||
    status === "rebuilding" ||
    phase === "rebuild_projections"
  ) {
    return {
      state: "rebuilding",
      degraded: true,
      lagBlocks,
      status,
      message: "Backend is rebuilding indexed projections. Derived data may be incomplete.",
      error: lastError,
    };
  }

  if (freshness.state === "stale" || degraded) {
    return {
      state: "stale",
      degraded: true,
      lagBlocks,
      status,
      message: `Backend indexed data is stale${normalizeLagText(lagBlocks)}.`,
      error: lastError,
    };
  }

  if (freshness.state === "fresh") {
    return {
      state: "healthy",
      degraded: false,
      lagBlocks,
      status,
      message: "Backend indexed data is fresh.",
      error: lastError,
    };
  }

  return {
    state: "unavailable",
    degraded: true,
    lagBlocks,
    status,
    message: "Backend indexed data is unavailable.",
    error: lastError,
  };
}

export function getBackendFreshnessBanner(
  surface: BackendFreshnessSurface,
  assessment: BackendFreshnessAssessment
): { title: string; body: string } | null {
  if (assessment.state === "healthy") {
    return null;
  }

  const chainFallbackNote =
    surface === "profile"
      ? "Reputation is derived from indexed backend events and has no direct onchain aggregate fallback on this page."
      : "Primary escrow fields still come from live contract reads on this page, but indexed backend sections may lag or be missing.";

  if (assessment.state === "stale") {
    return {
      title: "Indexed backend data is stale",
      body: `${assessment.message} ${chainFallbackNote}`,
    };
  }

  if (assessment.state === "rebuilding") {
    return {
      title: "Backend is rebuilding indexed data",
      body: `${assessment.message} ${chainFallbackNote}`,
    };
  }

  if (assessment.state === "failed") {
    return {
      title: "Backend indexer is degraded",
      body: `${assessment.message} ${chainFallbackNote}`,
    };
  }

  return {
    title: "Backend data unavailable",
    body: `${assessment.message} ${chainFallbackNote}`,
  };
}

export function getMetadataTruthAssessment(
  truth: BackendMetadataTruth | null | undefined
): BackendMetadataTruthAssessment {
  if (!truth || !isRecord(truth)) {
    return {
      state: "unavailable",
      verified: false,
      degraded: true,
      message: "Backend metadata verification is unavailable.",
      detail: "Metadata truth contract missing from backend response.",
      metadataUrl: null,
      payloadPresent: null,
      updatedAtBlock: null,
    };
  }

  const state = safeString(truth.state);
  const detail = safeString(truth.error);
  const payloadPresent = typeof truth.payloadPresent === "boolean" ? truth.payloadPresent : null;
  const metadataUrl = safeString(truth.metadataUrl);
  const updatedAtBlock = safeString(truth.updatedAtBlock);

  if (
    state !== "verified" &&
    state !== "mismatched" &&
    state !== "missing" &&
    state !== "degraded" &&
    state !== "unverified"
  ) {
    return {
      state: "unavailable",
      verified: false,
      degraded: true,
      message: "Backend metadata verification payload is malformed.",
      detail,
      metadataUrl,
      payloadPresent,
      updatedAtBlock,
    };
  }

  if (state === "verified") {
    return {
      state,
      verified: true,
      degraded: false,
      message: "Verified against backend metadata cache.",
      detail,
      metadataUrl,
      payloadPresent,
      updatedAtBlock,
    };
  }

  if (state === "mismatched") {
    return {
      state,
      verified: false,
      degraded: false,
      message: "Metadata payload does not match the onchain metadata hash.",
      detail,
      metadataUrl,
      payloadPresent,
      updatedAtBlock,
    };
  }

  if (state === "missing") {
    return {
      state,
      verified: false,
      degraded: true,
      message: "Backend metadata cache entry is missing for this deal.",
      detail,
      metadataUrl,
      payloadPresent,
      updatedAtBlock,
    };
  }

  if (state === "degraded") {
    return {
      state,
      verified: false,
      degraded: true,
      message: "Backend metadata verification is degraded.",
      detail,
      metadataUrl,
      payloadPresent,
      updatedAtBlock,
    };
  }

  return {
    state,
    verified: false,
    degraded: false,
    message: "Metadata exists in backend cache but is not verified yet.",
    detail,
    metadataUrl,
    payloadPresent,
    updatedAtBlock,
  };
}

export function getMilestoneMetadataVerificationAssessment(
  truth: BackendMilestoneMetadataVerificationTruth | null | undefined
): BackendMilestoneMetadataVerificationAssessment {
  if (!truth || !isRecord(truth)) {
    return {
      state: "unavailable",
      verified: false,
      degraded: true,
      message: "Milestone metadata verification is unavailable from backend.",
      reason: "Milestone truth contract missing from backend response.",
      titleVerified: null,
      descriptionVerified: null,
    };
  }

  const state = safeString(truth.state);
  const reason = safeString(truth.reason);
  const titleVerified = typeof truth.titleVerified === "boolean" ? truth.titleVerified : null;
  const descriptionVerified = typeof truth.descriptionVerified === "boolean" ? truth.descriptionVerified : null;

  if (state !== "verified" && state !== "mismatched" && state !== "missing" && state !== "unavailable") {
    return {
      state: "unavailable",
      verified: false,
      degraded: true,
      message: "Milestone metadata verification payload is malformed.",
      reason,
      titleVerified,
      descriptionVerified,
    };
  }

  if (state === "verified") {
    return {
      state,
      verified: true,
      degraded: false,
      message: "Milestone metadata fields match verified backend payload.",
      reason,
      titleVerified,
      descriptionVerified,
    };
  }

  if (state === "mismatched") {
    return {
      state,
      verified: false,
      degraded: false,
      message: "Milestone metadata fields do not fully match backend verified payload.",
      reason,
      titleVerified,
      descriptionVerified,
    };
  }

  if (state === "missing") {
    return {
      state,
      verified: false,
      degraded: true,
      message: "Milestone metadata entry is missing from backend payload.",
      reason,
      titleVerified,
      descriptionVerified,
    };
  }

  return {
    state,
    verified: false,
    degraded: true,
    message: "Milestone metadata payload is unavailable in backend index.",
    reason,
    titleVerified,
    descriptionVerified,
  };
}

export function getHashContextAssessment(
  truth: BackendHashContextTruth | null | undefined,
  label: "evidence" | "dispute"
): BackendHashContextAssessment {
  if (!truth || !isRecord(truth)) {
    return {
      state: "unavailable",
      hash: null,
      degraded: true,
      message: `Backend ${label} truth is unavailable.`,
      reason: "Hash context missing from backend response.",
    };
  }

  const state = safeString(truth.state);
  const hash = safeString(truth.hash);
  const reason = safeString(truth.reason);
  const ambiguity = safeString(truth.ambiguity);

  if (state !== "present" && state !== "missing") {
    return {
      state: "unavailable",
      hash,
      degraded: true,
      message: `Backend ${label} hash context is malformed.`,
      reason,
    };
  }

  if (state === "missing") {
    return {
      state,
      hash,
      degraded: false,
      message: `No ${label} hash is currently stored onchain for this item.`,
      reason,
    };
  }

  if (ambiguity === "not-verifiable-from-onchain-hash") {
    return {
      state,
      hash,
      degraded: true,
      message: `${label[0].toUpperCase()}${label.slice(1)} hash is present onchain but payload verification is ambiguous.`,
      reason,
    };
  }

  return {
    state,
    hash,
    degraded: false,
    message: `${label[0].toUpperCase()}${label.slice(1)} hash is present onchain.`,
    reason,
  };
}

export function getTimelineTruthNote(truth: BackendTimelineTruth | null | undefined): string | null {
  if (!truth || !isRecord(truth)) {
    return "Timeline truth context unavailable from backend.";
  }

  const ambiguity = safeString(truth.ambiguity);
  if (ambiguity) {
    return `Truth note: ${ambiguity}.`;
  }

  const reason = safeString(truth.reason);
  if (reason) {
    return `Truth note: ${reason}.`;
  }

  return null;
}

export function getReputationTruthAssessment(
  truth: BackendReputationTruth | null | undefined
): BackendReputationTruthAssessment {
  if (!truth || !isRecord(truth)) {
    return {
      state: "degraded",
      message: "Backend reputation truth metadata is unavailable; treat role stats as degraded.",
    };
  }

  const canonicalSource = safeString(truth.canonicalSource);
  const ambiguityPolicy = safeString(truth.ambiguityPolicy);

  if (!canonicalSource || !ambiguityPolicy) {
    return {
      state: "degraded",
      message: "Backend reputation truth metadata is malformed; treat role stats as degraded.",
    };
  }

  return {
    state: "healthy",
    message: `Canonical source: ${canonicalSource}. Ambiguity policy: ${ambiguityPolicy}.`,
  };
}

export function getDealFallbackAddress(routeAddress: string) {
  if (routeAddress === "demo-deal") {
    return appEnv.defaultEscrowAddress ?? routeAddress;
  }

  return routeAddress;
}

export function getProfileFallbackAddress(routeAddress: string) {
  if (routeAddress === "demo-profile") {
    return appEnv.defaultEscrowAddress ?? routeAddress;
  }

  return routeAddress;
}
