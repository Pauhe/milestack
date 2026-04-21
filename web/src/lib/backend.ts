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
    nextActionableMilestoneId: number;
  };
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
};

export type BackendReputation = {
  address: string;
  buyerStats: Record<string, unknown> | null;
  sellerStats: Record<string, unknown> | null;
  arbiterStats: Record<string, unknown> | null;
  freshness?: BackendFreshnessPayload | null;
};

export type BackendItemsResponse<T> = {
  items: T[];
  freshness?: BackendFreshnessPayload | null;
};

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
