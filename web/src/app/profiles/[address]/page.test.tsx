import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mockFetchBackendJson } = vi.hoisted(() => ({
  mockFetchBackendJson: vi.fn(),
}));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");

  return {
    ...actual,
    fetchBackendJson: mockFetchBackendJson,
    getProfileFallbackAddress: (address: string) => address,
  };
});

import ProfilePage from "@/app/profiles/[address]/page";

const address = "0x1111111111111111111111111111111111111111";

const freshFreshness = {
  state: "fresh",
  degraded: false,
  indexedBlock: "100",
  chainHead: "100",
  lagBlocks: "0",
  lastSuccessfulAt: "2026-04-22T00:00:00.000Z",
  lastAttemptedAt: "2026-04-22T00:00:00.500Z",
  phase: "steady_sync",
  status: "healthy",
  isSyncing: false,
  syncLoopError: null,
  lastError: null,
};

describe("profile reputation trust cards", () => {
  it("renders buyer/seller/arbiter trust cards with informational trust copy for healthy payloads", async () => {
    mockFetchBackendJson.mockResolvedValue({
      address,
      buyerStats: {
        address,
        role: "buyer",
        completed_deals_count: 3,
        completed_milestones_count: 0,
        dispute_count: 2,
        dispute_wins_count: 1,
        dispute_losses_count: 1,
        resolved_dispute_count: 2,
        unresolved_dispute_count: 0,
        dispute_split_count: 0,
        cancellation_count: 0,
        total_volume: "400000000",
        updated_at_block: "100",
      },
      sellerStats: {
        address,
        role: "seller",
        completed_deals_count: 2,
        completed_milestones_count: 4,
        dispute_count: 1,
        dispute_wins_count: 1,
        dispute_losses_count: 0,
        resolved_dispute_count: 1,
        unresolved_dispute_count: 0,
        dispute_split_count: 0,
        cancellation_count: 0,
        total_volume: "1600000000",
        updated_at_block: "100",
      },
      arbiterStats: {
        address,
        role: "arbiter",
        completed_deals_count: 2,
        completed_milestones_count: 0,
        dispute_count: 3,
        dispute_wins_count: 0,
        dispute_losses_count: 0,
        resolved_dispute_count: 2,
        unresolved_dispute_count: 1,
        dispute_split_count: 1,
        cancellation_count: 0,
        total_volume: "2100000000",
        updated_at_block: "100",
      },
      truth: {
        canonicalSource: "derived_from_events",
        ambiguityPolicy: "claim_attribution_ambiguous_without_adjacent_same_milestone_approval",
        disputeOutcomePolicy:
          "count_only_recorded_disputes_with_replayable_resolution_signals; unresolved_or_ambiguous_outcomes_never_counted_as_wins",
      },
      freshness: freshFreshness,
    });

    const element = await ProfilePage({ params: Promise.resolve({ address }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="profile-truth-panel"');
    expect(html).toContain('data-testid="profile-trust-grid"');
    expect(html).toContain('data-testid="profile-buyer-trust-card"');
    expect(html).toContain('data-testid="profile-seller-trust-card"');
    expect(html).toContain('data-testid="profile-arbiter-trust-card"');

    expect(html).toContain("backend-derived indexed views and informational signals only");
    expect(html).toContain("not settlement-authoritative");
    expect(html).toContain("Completed deals");
    expect(html).toContain("Dispute wins");

    expect(html).not.toContain("<pre>");
    expect(html).not.toContain('data-testid="backend-freshness-banner"');
  });

  it("degrades malformed role stats and malformed truth metadata to conservative copy", async () => {
    mockFetchBackendJson.mockResolvedValue({
      address,
      buyerStats: {
        address,
        role: "buyer",
        completed_deals_count: "oops",
      },
      sellerStats: null,
      arbiterStats: {
        address,
        role: "arbiter",
        completed_deals_count: 1,
        completed_milestones_count: 0,
        dispute_count: 1,
        dispute_wins_count: 0,
        dispute_losses_count: 0,
        resolved_dispute_count: 1,
        unresolved_dispute_count: 0,
        dispute_split_count: 1,
        cancellation_count: 0,
        total_volume: "1000000",
        updated_at_block: "99",
      },
      truth: {
        canonicalSource: "derived_from_events",
      },
      freshness: {
        ...freshFreshness,
        state: "stale",
        degraded: true,
        lagBlocks: "12",
        status: "degraded",
      },
    });

    const element = await ProfilePage({ params: Promise.resolve({ address }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain("Indexed backend data is stale");
    expect(html).toContain("backend freshness is stale");

    expect(html).toContain("Trust state: degraded");
    expect(html).toContain("reputation truth metadata is malformed");
    expect(html).toContain("No role stats available yet");
  });

  it("keeps route renderable and shows backend read failure panel when backend fetch fails", async () => {
    mockFetchBackendJson.mockRejectedValue(new Error("Backend request failed with status 503."));

    const element = await ProfilePage({ params: Promise.resolve({ address }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain('data-testid="profile-read-failure-panel"');
    expect(html).toContain("Backend read failure");
    expect(html).toContain("status 503");

    expect(html).toContain('data-testid="profile-buyer-trust-card"');
    expect(html).toContain('data-testid="profile-seller-trust-card"');
    expect(html).toContain('data-testid="profile-arbiter-trust-card"');
    expect(html).toContain("No role stats available yet");
  });
});
