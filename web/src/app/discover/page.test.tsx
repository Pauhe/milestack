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
  };
});

import DiscoverPage from "@/app/discover/page";

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
} as const;

describe("discover route", () => {
  it("renders informational discovery cards with conservative authority language on healthy payloads", async () => {
    mockFetchBackendJson.mockResolvedValue({
      freshness: freshFreshness,
      truth: {
        listingContract: "informational_read_model_only",
        capabilitySummary: {
          writeActionsExposed: false,
          authorityRankingExposed: false,
          roleStatsAreDirectionalOnly: true,
          metadataVisibility: {
            state: "public",
            degraded: false,
            reason: null,
          },
        },
        freshnessSummary: {
          state: "healthy",
          degraded: false,
          reason: null,
        },
      },
      items: [
        {
          identity: {
            chainId: 8453,
            address: "0x1000000000000000000000000000000000000001",
            key: "8453:0x1000000000000000000000000000000000000001",
          },
          participants: {
            buyer: "0x2000000000000000000000000000000000000002",
            seller: "0x3000000000000000000000000000000000000003",
            arbiter: "0x4000000000000000000000000000000000000004",
          },
          overview: {
            dealStatus: 1,
            milestoneCount: 2,
            currentMilestoneIndex: 0,
            activeDisputeMilestoneId: null,
            totalFunded: "1000000",
            totalReleasedToSeller: "0",
            totalRefundedToBuyer: "0",
            totalFeesCollected: "0",
          },
          milestones: {
            totalCount: 2,
            submittedCount: 1,
            terminalCount: 0,
            current: {
              milestoneId: 0,
              status: 2,
              amount: "500000",
              reviewDeadline: "1750000000",
            },
          },
          metadata: {
            state: "verified",
            verified: true,
            degraded: false,
            metadataHash: "0xmeta",
            metadataUrl: "https://example.com/metadata.json",
            payloadPresent: true,
            updatedAtBlock: "100",
            error: null,
          },
          capability: {
            listingMode: "informational",
            writeActionsExposed: false,
            authorityRankingExposed: false,
            trustClaimsLimitedToIndexedTruth: true,
          },
          roleStats: {
            buyer: {
              completedDealsCount: 1,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "1000000",
              updatedAtBlock: "100",
              truthState: "available",
              degraded: false,
              reason: null,
            },
            seller: {
              completedDealsCount: 0,
              completedMilestonesCount: 1,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "500000",
              updatedAtBlock: "100",
              truthState: "available",
              degraded: false,
              reason: null,
            },
            arbiter: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: "100",
              truthState: "available",
              degraded: false,
              reason: null,
            },
          },
        },
      ],
    });

    const element = await DiscoverPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="discover-page"');
    expect(html).toContain('data-testid="discover-truth-contract-panel"');
    expect(html).toContain('data-testid="discover-authority-callout"');
    expect(html).toContain('data-testid="discover-card-grid"');
    expect(html).toContain('data-testid="discover-card-8453:0x1000000000000000000000000000000000000001"');
    expect(html).toContain("Discovery capability contract is informational-only");
    expect(html).toContain("Cards never expose write authority");
    expect(html).not.toContain('data-testid="discover-freshness-banner"');
    expect(html).not.toContain('data-testid="discover-read-failure-panel"');
  });

  it("shows stale freshness banner and degraded card callout when indexed signals are stale/missing", async () => {
    mockFetchBackendJson.mockResolvedValue({
      freshness: {
        ...freshFreshness,
        state: "stale",
        degraded: true,
        lagBlocks: "12",
        status: "degraded",
      },
      truth: {
        listingContract: "informational_read_model_only",
        capabilitySummary: {
          writeActionsExposed: false,
          authorityRankingExposed: false,
          roleStatsAreDirectionalOnly: true,
          metadataVisibility: {
            state: "public",
            degraded: false,
            reason: null,
          },
        },
        freshnessSummary: {
          state: "degraded",
          degraded: true,
          reason: "Backend freshness is stale.",
        },
      },
      items: [
        {
          identity: {
            chainId: 8453,
            address: "0x1000000000000000000000000000000000000001",
            key: "8453:0x1000000000000000000000000000000000000001",
          },
          participants: {
            buyer: "0x2000000000000000000000000000000000000002",
            seller: "0x3000000000000000000000000000000000000003",
            arbiter: "0x4000000000000000000000000000000000000004",
          },
          overview: {
            dealStatus: 1,
            milestoneCount: 2,
            currentMilestoneIndex: 0,
            activeDisputeMilestoneId: "0",
            totalFunded: "1000000",
            totalReleasedToSeller: "0",
            totalRefundedToBuyer: "0",
            totalFeesCollected: "0",
          },
          milestones: {
            totalCount: 2,
            submittedCount: 1,
            terminalCount: 0,
            current: null,
          },
          metadata: {
            state: "missing",
            verified: false,
            degraded: true,
            metadataHash: "0xmeta",
            metadataUrl: null,
            payloadPresent: false,
            updatedAtBlock: null,
            error: "metadata missing",
          },
          capability: {
            listingMode: "informational",
            writeActionsExposed: false,
            authorityRankingExposed: false,
            trustClaimsLimitedToIndexedTruth: true,
          },
          roleStats: {
            buyer: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: null,
              truthState: "missing",
              degraded: true,
              reason: "No indexed buyer role stats available.",
            },
            seller: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: null,
              truthState: "missing",
              degraded: true,
              reason: "No indexed seller role stats available.",
            },
            arbiter: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: null,
              truthState: "missing",
              degraded: true,
              reason: "No indexed arbiter role stats available.",
            },
          },
        },
      ],
    });

    const element = await DiscoverPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="discover-freshness-banner"');
    expect(html).toContain("Indexed backend data is stale");
    expect(html).toContain("One or more indexed truth signals are degraded");
    expect(html).toContain("Discovery truth contract is present but freshness is degraded");
  });

  it("shows degraded card callout when role stats are missing even if capability/metadata are healthy", async () => {
    mockFetchBackendJson.mockResolvedValue({
      freshness: freshFreshness,
      truth: {
        listingContract: "informational_read_model_only",
        capabilitySummary: {
          writeActionsExposed: false,
          authorityRankingExposed: false,
          roleStatsAreDirectionalOnly: true,
          metadataVisibility: {
            state: "public",
            degraded: false,
            reason: null,
          },
        },
        freshnessSummary: {
          state: "healthy",
          degraded: false,
          reason: null,
        },
      },
      items: [
        {
          identity: {
            chainId: 8453,
            address: "0x1000000000000000000000000000000000000001",
            key: "8453:0x1000000000000000000000000000000000000001",
          },
          participants: {
            buyer: "0x2000000000000000000000000000000000000002",
            seller: "0x3000000000000000000000000000000000000003",
            arbiter: "0x4000000000000000000000000000000000000004",
          },
          overview: {
            dealStatus: 1,
            milestoneCount: 2,
            currentMilestoneIndex: 0,
            activeDisputeMilestoneId: null,
            totalFunded: "1000000",
            totalReleasedToSeller: "0",
            totalRefundedToBuyer: "0",
            totalFeesCollected: "0",
          },
          milestones: {
            totalCount: 2,
            submittedCount: 1,
            terminalCount: 0,
            current: {
              milestoneId: 0,
              status: 2,
              amount: "500000",
              reviewDeadline: "1750000000",
            },
          },
          metadata: {
            state: "verified",
            verified: true,
            degraded: false,
            metadataHash: "0xmeta",
            metadataUrl: "https://example.com/metadata.json",
            payloadPresent: true,
            updatedAtBlock: "100",
            error: null,
          },
          capability: {
            listingMode: "informational",
            writeActionsExposed: false,
            authorityRankingExposed: false,
            trustClaimsLimitedToIndexedTruth: true,
          },
          roleStats: {
            buyer: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: null,
              truthState: "missing",
              degraded: true,
              reason: "No indexed buyer role stats available.",
            },
            seller: {
              completedDealsCount: 1,
              completedMilestonesCount: 1,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "1000000",
              updatedAtBlock: "100",
              truthState: "available",
              degraded: false,
              reason: null,
            },
            arbiter: {
              completedDealsCount: 0,
              completedMilestonesCount: 0,
              disputeCount: 0,
              disputeWinsCount: 0,
              disputeLossesCount: 0,
              resolvedDisputeCount: 0,
              unresolvedDisputeCount: 0,
              disputeSplitCount: 0,
              cancellationCount: 0,
              totalVolume: "0",
              updatedAtBlock: "100",
              truthState: "available",
              degraded: false,
              reason: null,
            },
          },
        },
      ],
    });

    const element = await DiscoverPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("data-testid=\"discover-card-grid\"");
    expect(html).toContain("One or more indexed truth signals are degraded");
  });

  it("renders read failure and empty-state conservatively when /discover is unavailable", async () => {
    mockFetchBackendJson.mockRejectedValue(new Error("Backend request failed with status 503."));

    const element = await DiscoverPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="discover-freshness-banner"');
    expect(html).toContain('data-testid="discover-read-failure-panel"');
    expect(html).toContain('data-testid="discover-empty-state"');
    expect(html).toContain("status 503");
    expect(html).toContain("Escrow authority is unchanged and still enforced onchain");
  });
});
