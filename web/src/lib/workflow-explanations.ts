import type { BackendFreshnessAssessment, BackendFreshnessSurface } from "@/lib/backend";
import type { MilestoneActionSemantics } from "@/lib/milestone-semantics";
import type { ActionPanelGuidance, DisputeResolutionGuidance } from "@/lib/workflow-guidance";

type KnownFreshnessState = BackendFreshnessAssessment["state"];

const KNOWN_FRESHNESS_STATES: ReadonlySet<string> = new Set([
  "healthy",
  "stale",
  "rebuilding",
  "failed",
  "unavailable",
]);

function normalizeFreshnessState(state: string | null | undefined): KnownFreshnessState {
  if (state && KNOWN_FRESHNESS_STATES.has(state)) {
    return state as KnownFreshnessState;
  }

  return "unavailable";
}

function normalizeLagText(lagBlocks: string | null): string {
  if (!lagBlocks || lagBlocks === "0") {
    return "";
  }

  return ` (lag: ${lagBlocks} blocks)`;
}

function parseUnixSeconds(value: string | number | bigint | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    if (value.length === 0) {
      return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  if (typeof value === "bigint") {
    if (value < 0 || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }

    return Number(value);
  }

  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

export function getFreshnessExplanationCopy(
  assessment: BackendFreshnessAssessment | null | undefined,
  surface: BackendFreshnessSurface
): string {
  if (!assessment) {
    return "Backend freshness is unavailable. Keep timeline and eligibility wording conservative until truth metadata recovers.";
  }

  const state = normalizeFreshnessState(assessment.state);
  const lagText = normalizeLagText(assessment.lagBlocks);
  const fallbackContext =
    surface === "profile"
      ? "This route has no direct onchain aggregate fallback for indexed reputation summaries."
      : "Core escrow state still comes from live contract reads, but backend-derived workflow truth may lag.";

  if (assessment.state !== state) {
    return `Backend freshness payload was malformed; treating freshness as unavailable. ${fallbackContext}`;
  }

  if (state === "healthy") {
    return "Backend freshness is healthy. Timeline truth and eligibility messaging reflect current indexed state.";
  }

  if (state === "stale") {
    return `Backend freshness is stale${lagText}. Keep deadline and timeline wording conservative and avoid certainty claims. ${fallbackContext}`;
  }

  if (state === "rebuilding") {
    return `Backend is rebuilding indexed projections${lagText}. Treat workflow truth as temporarily degraded. ${fallbackContext}`;
  }

  if (state === "failed") {
    return `Backend indexing is failed${lagText}. Treat derived workflow truth as degraded or missing until recovery. ${fallbackContext}`;
  }

  return `Backend freshness is unavailable. Keep workflow explanations conservative and avoid certainty claims. ${fallbackContext}`;
}

export type ReviewDeadlineExplanationInput = {
  reviewDeadline: string | number | bigint | null | undefined;
  nowUnixSeconds?: number;
  milestoneStatus: number;
  semantics: Pick<MilestoneActionSemantics, "canClaimAfterTimeout" | "claimAfterTimeoutHint"> | null;
};

export function getReviewDeadlineExplanationCopy(input: ReviewDeadlineExplanationInput): string {
  const nowUnixSeconds = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const reviewDeadline = parseUnixSeconds(input.reviewDeadline);

  if (input.milestoneStatus === 5) {
    return "Milestone is disputed. Review-window timeout outcomes are deferred to arbiter resolution.";
  }

  if (reviewDeadline === null || reviewDeadline <= 0) {
    return "Review deadline is unavailable from backend truth. Keep timeout-claim expectations conservative.";
  }

  if (nowUnixSeconds < reviewDeadline) {
    return `Review window is open until UNIX ${reviewDeadline}. Buyer review actions remain authoritative before that deadline.`;
  }

  if (nowUnixSeconds === reviewDeadline) {
    return `Review deadline reached at UNIX ${reviewDeadline}. Timeout eligibility depends on backend-derived claim semantics.`;
  }

  if (input.semantics?.canClaimAfterTimeout) {
    return `Review window elapsed at UNIX ${reviewDeadline}. Timeout claim is available per backend-derived eligibility.`;
  }

  if (input.semantics?.claimAfterTimeoutHint) {
    return `Review window elapsed at UNIX ${reviewDeadline}. ${input.semantics.claimAfterTimeoutHint}`;
  }

  return `Review window elapsed at UNIX ${reviewDeadline}. Timeout claim may still be blocked by dispute or missing eligibility context.`;
}

export type TimelineTruthExplanationInput = {
  truthNote: string | null | undefined;
  eventType: string;
};

export function getTimelineTruthExplanationCopy(input: TimelineTruthExplanationInput): string {
  if (input.truthNote && input.truthNote.trim().length > 0) {
    return input.truthNote;
  }

  if (input.eventType === "MilestoneClaimed") {
    return "Timeline truth note unavailable. MilestoneClaimed can reflect buyer approval payout or seller timeout claim, so attribution remains ambiguous without adjacent truth context.";
  }

  return "Timeline truth note unavailable from backend. Treat event attribution as conservative until truth context is present.";
}

export type DealOverviewTrustExplanationInput = {
  freshnessAssessment: BackendFreshnessAssessment | null | undefined;
  hasIndexedMilestones: boolean;
  hasIndexedTimeline: boolean;
};

export type DealOverviewTrustExplanation = {
  liveContractSummary: string;
  indexedDataSummary: string;
  timelineSummary: string;
};

export function getDealOverviewTrustExplanationCopy(
  input: DealOverviewTrustExplanationInput
): DealOverviewTrustExplanation {
  const liveContractSummary =
    "Deal parties, balances, and current status are read live from the escrow contract and remain canonical for settlement state.";

  const indexedDataSummary = getFreshnessExplanationCopy(input.freshnessAssessment, "deal");

  if (!input.hasIndexedTimeline) {
    return {
      liveContractSummary,
      indexedDataSummary,
      timelineSummary:
        "No indexed timeline entries are available yet. Timeline-based attribution remains unavailable until backend truth notes are present.",
    };
  }

  if (!input.hasIndexedMilestones) {
    return {
      liveContractSummary,
      indexedDataSummary,
      timelineSummary:
        "Indexed timeline entries are present, but milestone list context is missing. Keep route-level action and payout attribution wording conservative.",
    };
  }

  return {
    liveContractSummary,
    indexedDataSummary,
    timelineSummary:
      "Timeline summaries are backend-derived context. Keep payout-trigger attribution conservative unless backend truth notes explicitly disambiguate events.",
  };
}

export type ActionAuthorityExplanationInput = {
  guidance: Pick<ActionPanelGuidance, "blockedReason" | "claimAfterTimeoutHint"> | null;
  semantics: Pick<MilestoneActionSemantics, "blockedReason" | "claimAfterTimeoutHint"> | null;
};

export function getActionAuthorityExplanationCopy(input: ActionAuthorityExplanationInput): string {
  if (input.guidance?.blockedReason && input.guidance.blockedReason.length > 0) {
    return input.guidance.blockedReason;
  }

  if (input.semantics?.blockedReason && input.semantics.blockedReason.length > 0) {
    return input.semantics.blockedReason;
  }

  if (input.guidance?.claimAfterTimeoutHint && input.guidance.claimAfterTimeoutHint.length > 0) {
    return input.guidance.claimAfterTimeoutHint;
  }

  if (input.semantics?.claimAfterTimeoutHint && input.semantics.claimAfterTimeoutHint.length > 0) {
    return input.semantics.claimAfterTimeoutHint;
  }

  return "Action authority is derived from backend eligibility semantics and is currently unavailable.";
}

export type DisputeAuthorityExplanationInput = {
  arbiterGuidance: Pick<DisputeResolutionGuidance, "blockedReason" | "canSubmitResolution"> | null;
  visitorGuidance: Pick<DisputeResolutionGuidance, "blockedReason"> | null;
  freshnessAssessment: BackendFreshnessAssessment | null | undefined;
};

export function getDisputeAuthorityExplanationCopy(input: DisputeAuthorityExplanationInput): string {
  if (!input.arbiterGuidance || !input.visitorGuidance) {
    return "Dispute authority is unavailable. Only the designated arbiter may finalize a disputed milestone once route truth is restored.";
  }

  const freshnessState = normalizeFreshnessState(input.freshnessAssessment?.state ?? null);
  if (freshnessState !== "healthy") {
    return `Dispute authority is conservative while backend freshness is ${freshnessState}. Only the designated arbiter should resolve disputes after route truth recovers.`;
  }

  if (input.arbiterGuidance.canSubmitResolution) {
    return "Dispute authority is active for the designated arbiter. Arbiter resolution is final for this milestone once submitted onchain.";
  }

  if (input.arbiterGuidance.blockedReason && input.arbiterGuidance.blockedReason.length > 0) {
    return `Arbiter-only authority applies, but resolution is currently blocked: ${input.arbiterGuidance.blockedReason}`;
  }

  if (input.visitorGuidance.blockedReason && input.visitorGuidance.blockedReason.length > 0) {
    return `Arbiter-only authority applies: ${input.visitorGuidance.blockedReason}`;
  }

  return "Only the designated arbiter can finalize a dispute; keep authority messaging conservative until route guidance is available.";
}

export type DisputeFinalityExplanationInput = {
  disputeGuidance: Pick<DisputeResolutionGuidance, "canSubmitResolution" | "blockedReason"> | null;
  freshnessAssessment: BackendFreshnessAssessment | null | undefined;
};

export function getDisputeFinalityExplanationCopy(input: DisputeFinalityExplanationInput): string {
  const freshnessState = normalizeFreshnessState(input.freshnessAssessment?.state ?? null);

  if (freshnessState !== "healthy") {
    return `Finality claims are conservative while backend freshness is ${freshnessState}. Confirm active dispute truth and arbiter eligibility before treating resolution outcomes as final.`;
  }

  if (!input.disputeGuidance) {
    return "Dispute finality guidance is unavailable. Treat resolution outcomes as pending until arbiter eligibility and route truth are confirmed.";
  }

  if (input.disputeGuidance.canSubmitResolution) {
    return "Arbiter resolution is final for this milestone once the exact buyer/seller split transaction confirms onchain.";
  }

  if (input.disputeGuidance.blockedReason && input.disputeGuidance.blockedReason.length > 0) {
    return `Dispute finality is pending because arbiter resolution is blocked: ${input.disputeGuidance.blockedReason}`;
  }

  return "Dispute finality remains pending until arbiter resolution guidance is available.";
}
