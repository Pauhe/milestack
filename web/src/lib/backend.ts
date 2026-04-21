import { appEnv } from "@/lib/env";

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
};

export function getBackendBaseUrl() {
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
}

export async function fetchBackendJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Backend request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
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
