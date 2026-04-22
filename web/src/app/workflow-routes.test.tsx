import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

const {
  mockFetchBackendJson,
  mockReadEscrowOverview,
  mockReadEscrowMilestone,
  mockGetDealFallbackAddress,
} = vi.hoisted(() => ({
  mockFetchBackendJson: vi.fn(),
  mockReadEscrowOverview: vi.fn(),
  mockReadEscrowMilestone: vi.fn(),
  mockGetDealFallbackAddress: vi.fn(),
}));

vi.mock("@/lib/chains", () => ({
  configuredChain: { name: "Base Sepolia" },
}));

vi.mock("@/components/deal-actions", () => ({
  DealActions: () => <div data-testid="deal-actions-stub" />,
}));

vi.mock("@/components/milestone-actions", () => ({
  MilestoneActions: () => <div data-testid="milestone-actions-stub" />,
}));

vi.mock("@/components/dispute-resolution-form", () => ({
  DisputeResolutionForm: () => <div data-testid="dispute-resolution-form-stub" />,
}));

vi.mock("@/lib/contracts/milestone-escrow", () => ({
  getDefaultEscrowAddress: () => "0x1111111111111111111111111111111111111111",
  normalizeAddress: (address: string) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("Invalid address");
    }

    return address;
  },
  readEscrowOverview: mockReadEscrowOverview,
  readEscrowMilestone: mockReadEscrowMilestone,
}));

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");

  return {
    ...actual,
    fetchBackendJson: mockFetchBackendJson,
    getDealFallbackAddress: mockGetDealFallbackAddress,
  };
});

import DealOverviewPage from "@/app/deals/[address]/page";
import MilestoneDetailPage from "@/app/deals/[address]/milestones/[milestoneId]/page";
import DisputePage from "@/app/deals/[address]/disputes/[milestoneId]/page";
import HomePage from "@/app/page";
import RootLayout from "@/app/layout";

const escrowAddress = "0x1111111111111111111111111111111111111111";

function baseOverview(overrides: Partial<ReturnType<typeof baseOverview>> = {}) {
  return {
    address: escrowAddress,
    buyer: "0x2222222222222222222222222222222222222222",
    seller: "0x3333333333333333333333333333333333333333",
    arbiter: "0x4444444444444444444444444444444444444444",
    token: "0x5555555555555555555555555555555555555555",
    dealStatus: 1,
    currentMilestoneIndex: 1,
    activeDisputeMilestoneId: 1,
    totalFunded: 1_000_000n,
    totalReleasedToSeller: 0n,
    totalRefundedToBuyer: 0n,
    totalFeesCollected: 0n,
    currentMilestone: {
      status: 2,
      reviewDeadline: 1_750_000_000n,
    },
    ...overrides,
  };
}

function baseMilestone(overrides: Partial<ReturnType<typeof baseMilestone>> = {}) {
  return {
    amount: 1_000_000n,
    status: 5,
    reviewWindowSeconds: 86400n,
    submittedAt: 1_749_000_000n,
    reviewDeadline: 1_750_000_000n,
    evidenceHash: "0xabc",
    disputeHash: "0xdef",
    buyerAward: 400_000n,
    sellerAward: 600_000n,
    ...overrides,
  };
}

const staleFreshness = {
  state: "stale",
  degraded: true,
  indexedBlock: "100",
  chainHead: "112",
  lagBlocks: "12",
  lastSuccessfulAt: "2026-04-21T00:00:00.000Z",
  lastAttemptedAt: "2026-04-21T00:00:01.000Z",
  phase: "steady_sync",
  status: "degraded",
  isSyncing: true,
  syncLoopError: null,
  lastError: null,
};

type BackendOverrides = {
  address?: string;
  overview?: Partial<ReturnType<typeof baseOverview>>;
  milestone?: Partial<ReturnType<typeof baseMilestone>>;
  freshness?: typeof staleFreshness;
  responses?: Record<string, unknown>;
};

function installBackendMocks(overrides: BackendOverrides = {}) {
  const activeAddress = overrides.address ?? escrowAddress;
  const overview = baseOverview({ address: activeAddress, ...overrides.overview });
  const milestone = baseMilestone(overrides.milestone);
  const freshness = overrides.freshness ?? staleFreshness;
  const responses = overrides.responses ?? {};

  mockReadEscrowOverview.mockResolvedValue(overview);
  mockReadEscrowMilestone.mockResolvedValue(milestone);

  mockFetchBackendJson.mockImplementation(async (path: string) => {
    if (path in responses) {
      return responses[path] as unknown;
    }

    if (path === `/escrows/${activeAddress}`) {
      return {
        address: activeAddress,
        buyer_address: overview.buyer,
        seller_address: overview.seller,
        arbiter_address: overview.arbiter,
        token_address: overview.token,
        deal_status: 1,
        current_milestone_index: Number(overview.currentMilestoneIndex),
        active_dispute_milestone_id: String(overview.activeDisputeMilestoneId),
        total_funded: "1000000",
        total_released_to_seller: "0",
        total_refunded_to_buyer: "0",
        total_fees_collected: "0",
        milestone_count: 3,
        freshness,
        truth: {
          metadata: {
            state: "verified",
            verified: true,
            degraded: false,
            metadataHash: "0xmeta",
            metadataUrl: "https://example.com/metadata.json",
            payloadPresent: true,
            updatedAtBlock: "111",
            error: null,
          },
        },
      };
    }

    if (path === `/escrows/${activeAddress}/milestones`) {
      return {
        freshness,
        items: [
          {
            milestone_id: 1,
            metadata_title: "Launch scope",
            status: 5,
            review_deadline: "1750000000",
            derived: {
              isCurrent: true,
              isBlocked: false,
              buyerCanApprove: false,
              buyerCanDispute: false,
              sellerCanClaim: false,
            },
          },
        ],
      };
    }

    if (path === `/escrows/${activeAddress}/timeline`) {
      return {
        freshness,
        items: [
          {
            type: "MilestoneDisputed",
            summary: "Buyer opened a dispute",
            actor: { role: "buyer", address: overview.buyer },
            truth: { note: "derived" },
          },
        ],
      };
    }

    if (path === `/users/${overview.arbiter}/reputation`) {
      return {
        address: overview.arbiter,
        buyerStats: null,
        sellerStats: null,
        arbiterStats: {
          address: overview.arbiter,
          role: "arbiter",
          completed_deals_count: 3,
          completed_milestones_count: 5,
          dispute_count: 2,
          dispute_wins_count: 0,
          dispute_losses_count: 0,
          resolved_dispute_count: 2,
          unresolved_dispute_count: 0,
          dispute_split_count: 1,
          cancellation_count: 0,
          total_volume: "1000000",
          updated_at_block: "111",
        },
        truth: {
          canonicalSource: "derived_from_events",
          ambiguityPolicy: "claim_attribution_ambiguous_without_adjacent_same_milestone_approval",
          disputeOutcomePolicy:
            "count_only_recorded_disputes_with_replayable_resolution_signals; unresolved_or_ambiguous_outcomes_never_counted_as_wins",
        },
        freshness,
      };
    }

    if (path === `/escrows/${activeAddress}/milestones/1`) {
      return {
        amount: "1000000",
        status: 5,
        review_window_seconds: "86400",
        submitted_at: "1749000000",
        review_deadline: "1750000000",
        evidence_hash: "0xabc",
        dispute_hash: "0xdef",
        buyer_award: "400000",
        seller_award: "600000",
        freshness,
        derived: {
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: false,
          buyerCanDispute: false,
          sellerCanClaim: false,
        },
        truth: {
          metadataVerification: {
            state: "verified",
            verified: true,
            titleVerified: true,
            descriptionVerified: true,
            degraded: false,
            reason: null,
          },
          evidence: {
            state: "present",
            hash: "0xabc",
            verified: false,
            degraded: false,
            ambiguity: null,
            reason: null,
          },
          disputeContext: {
            state: "present",
            hash: "0xdef",
            verified: false,
            degraded: false,
            ambiguity: null,
            reason: null,
          },
        },
      };
    }

    throw new Error(`Unhandled backend path: ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDealFallbackAddress.mockImplementation((address: string) => address);
});

describe("workflow route hierarchy", () => {
  it("keeps top-level navigation discover entry points visible", () => {
    const layoutHtml = renderToStaticMarkup(
      <RootLayout>
        <div>content</div>
      </RootLayout>
    );
    const homeHtml = renderToStaticMarkup(<HomePage />);

    expect(layoutHtml).toContain('href="/discover"');
    expect(layoutHtml).toContain("Primary");
    expect(homeHtml).toContain('href="/discover"');
    expect(homeHtml).toContain("Browse discovery");
    expect(homeHtml).toContain("Core screens");
    expect(homeHtml).toContain("Discover");
  });

  it("keeps deal route hierarchy and trust markers explicit", async () => {
    installBackendMocks();

    const element = await DealOverviewPage({ params: Promise.resolve({ address: escrowAddress }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain('data-testid="deal-workflow-guidance"');
    expect(html).toContain('data-testid="deal-action-authority-truth"');
    expect(html).toContain('data-testid="deal-workflow-blocked-reason"');
    expect(html).toContain('data-testid="deal-truth-grid"');
    expect(html).toContain('data-testid="deal-metadata-truth-panel"');
    expect(html).toContain('data-testid="deal-timeline-panel"');
    expect(html).toContain(`/deals/${escrowAddress}/disputes/1`);

    expect(html.indexOf('data-testid="deal-workflow-guidance"')).toBeLessThan(
      html.indexOf('data-testid="deal-truth-grid"')
    );
    expect(html).toContain("Backend freshness is stale");
  });

  it("uses configured demo address when fallback alias differs from route input", async () => {
    const helperFallback = "0x9999999999999999999999999999999999999999";
    const configuredDemoAddress = "0x1111111111111111111111111111111111111111";
    mockGetDealFallbackAddress.mockImplementation((address: string) =>
      address === "alias-route" ? helperFallback : address
    );
    installBackendMocks({
      address: configuredDemoAddress,
      overview: { address: configuredDemoAddress },
    });

    const element = await DealOverviewPage({ params: Promise.resolve({ address: "alias-route" }) });
    const html = renderToStaticMarkup(element);

    expect(mockGetDealFallbackAddress).toHaveBeenCalledWith("alias-route");
    expect(mockFetchBackendJson).toHaveBeenCalledWith(`/escrows/${configuredDemoAddress}`);
    expect(html).toContain(`<h1>${configuredDemoAddress}</h1>`);
    expect(html).toContain(`/deals/${configuredDemoAddress}/milestones/1`);
  });

  it("shows fail-soft copy when deal route address is malformed", async () => {
    const element = await DealOverviewPage({ params: Promise.resolve({ address: "not-an-address" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Escrow address required");
    expect(html).toContain("Pass a real escrow address in the route");
  });

  it("keeps malformed backend freshness truthful on deal routes", async () => {
    installBackendMocks({
      freshness: {
        ...staleFreshness,
        state: "freshness-broken" as unknown as "stale",
      },
    });

    const element = await DealOverviewPage({ params: Promise.resolve({ address: escrowAddress }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Backend data unavailable");
    expect(html).toContain("Backend freshness response was malformed");
    expect(html).toContain('data-testid="deal-workflow-blocked-reason"');
  });

  it("keeps milestone route guidance before truth panels with degraded visibility", async () => {
    installBackendMocks();

    const element = await MilestoneDetailPage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain('data-testid="milestone-workflow-guidance"');
    expect(html).toContain('data-testid="milestone-review-deadline-explanation"');
    expect(html).toContain('data-testid="milestone-action-authority-explanation"');
    expect(html).toContain('data-testid="milestone-workflow-blocked-reason"');
    expect(html).toContain('data-testid="milestone-truth-grid"');
    expect(html).toContain('data-testid="milestone-metadata-panel"');
    expect(html).toContain('data-testid="milestone-hash-context-grid"');

    expect(html.indexOf('data-testid="milestone-workflow-guidance"')).toBeLessThan(
      html.indexOf('data-testid="milestone-truth-grid"')
    );
    expect(html).toContain("Backend freshness is stale");
  });

  it("shows invalid milestone-route copy for malformed route params", async () => {
    const element = await MilestoneDetailPage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "not-a-number" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Invalid milestone route");
    expect(html).toContain("Use a valid escrow address and milestone id");
  });

  it("keeps milestone route fail-soft when backend milestone call throws", async () => {
    installBackendMocks();

    mockFetchBackendJson.mockImplementation(async (path: string) => {
      if (path === `/escrows/${escrowAddress}/milestones/1`) {
        throw new Error("milestone backend unavailable");
      }

      return installFallbackResponse(path);
    });

    const element = await MilestoneDetailPage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain("Backend data unavailable");
    expect(html).toContain('data-testid="milestone-workflow-blocked-reason"');
  });

  it("keeps dispute authority/finality truth plus degraded route guidance", async () => {
    installBackendMocks();

    const element = await DisputePage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="backend-freshness-banner"');
    expect(html).toContain('data-testid="dispute-workflow-guidance"');
    expect(html).toContain('data-testid="dispute-route-authority-explanation"');
    expect(html).toContain('data-testid="dispute-workflow-blocked-reason"');
    expect(html).toContain('data-testid="dispute-arbiter-trust-panel"');
    expect(html).toContain('data-testid="dispute-arbiter-trust-explanation"');
    expect(html).toContain('data-testid="dispute-arbiter-trust-stats"');
    expect(html).toContain('data-testid="dispute-authority-explanation"');
    expect(html).toContain('data-testid="dispute-finality-explanation"');
    expect(html).toContain('data-testid="dispute-truth-grid"');
    expect(html).toContain('data-testid="dispute-verification-grid"');

    expect(html.indexOf('data-testid="dispute-workflow-guidance"')).toBeLessThan(
      html.indexOf('data-testid="dispute-truth-grid"')
    );
    expect(html.indexOf('data-testid="dispute-arbiter-trust-panel"')).toBeLessThan(
      html.indexOf('data-testid="dispute-context-panel"')
    );
    expect(html).toContain("Backend freshness is stale");
  });

  it("surfaces unavailable dispute route truth when overview cannot be read", async () => {
    installBackendMocks();
    mockReadEscrowOverview.mockRejectedValue(new Error("chain read down"));

    const element = await DisputePage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Read failure");
    expect(html).toContain("chain read down");
    expect(html).toContain("could not load this dispute view");
  });

  it("keeps arbiter trust copy conservative when reputation payload is malformed", async () => {
    installBackendMocks({
      responses: {
        [`/users/${baseOverview().arbiter}/reputation`]: {
          address: baseOverview().arbiter,
          buyerStats: null,
          sellerStats: null,
          arbiterStats: { role: "arbiter", completed_deals_count: "bad-value" },
          truth: null,
          freshness: staleFreshness,
        },
      },
    });

    mockFetchBackendJson.mockImplementation(async (path: string) => {
      if (path === `/users/${baseOverview().arbiter}/reputation`) {
        return {
          address: baseOverview().arbiter,
          buyerStats: null,
          sellerStats: null,
          arbiterStats: { role: "arbiter", completed_deals_count: "bad-value" },
          truth: null,
          freshness: staleFreshness,
        };
      }

      return installFallbackResponse(path);
    });

    const element = await DisputePage({
      params: Promise.resolve({ address: escrowAddress, milestoneId: "1" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="dispute-arbiter-trust-missing"');
    expect(html).toContain("Arbiter role stats are unavailable");
    expect(html).toContain('data-testid="dispute-route-authority-explanation"');
  });
});

function installFallbackResponse(path: string) {
  if (path === `/escrows/${escrowAddress}`) {
    return {
      address: escrowAddress,
      buyer_address: baseOverview().buyer,
      seller_address: baseOverview().seller,
      arbiter_address: baseOverview().arbiter,
      token_address: baseOverview().token,
      deal_status: 1,
      current_milestone_index: 1,
      active_dispute_milestone_id: 1,
      total_funded: "1000000",
      total_released_to_seller: "0",
      total_refunded_to_buyer: "0",
      total_fees_collected: "0",
      milestone_count: 3,
      freshness: staleFreshness,
      truth: {
        metadata: {
          state: "verified",
          verified: true,
          degraded: false,
          metadataHash: "0xmeta",
          metadataUrl: "https://example.com/metadata.json",
          payloadPresent: true,
          updatedAtBlock: "111",
          error: null,
        },
      },
    };
  }

  if (path === `/escrows/${escrowAddress}/milestones`) {
    return {
      freshness: staleFreshness,
      items: [
        {
          milestone_id: 1,
          metadata_title: "Launch scope",
          status: 5,
          review_deadline: "1750000000",
          derived: {
            isCurrent: true,
            isBlocked: false,
            buyerCanApprove: false,
            buyerCanDispute: false,
            sellerCanClaim: false,
          },
        },
      ],
    };
  }

  if (path === `/escrows/${escrowAddress}/timeline`) {
    return {
      freshness: staleFreshness,
      items: [
        {
          type: "MilestoneDisputed",
          summary: "Buyer opened a dispute",
          actor: { role: "buyer", address: baseOverview().buyer },
          truth: { note: "derived" },
        },
      ],
    };
  }

  if (path === `/escrows/${escrowAddress}/milestones/1`) {
    return {
      amount: "1000000",
      status: 5,
      review_window_seconds: "86400",
      submitted_at: "1749000000",
      review_deadline: "1750000000",
      evidence_hash: "0xabc",
      dispute_hash: "0xdef",
      buyer_award: "400000",
      seller_award: "600000",
      freshness: staleFreshness,
      derived: {
        isCurrent: true,
        isBlocked: false,
        buyerCanApprove: false,
        buyerCanDispute: false,
        sellerCanClaim: false,
      },
      truth: {
        metadataVerification: {
          state: "verified",
          verified: true,
          titleVerified: true,
          descriptionVerified: true,
          degraded: false,
          reason: null,
        },
        evidence: {
          state: "present",
          hash: "0xabc",
          verified: false,
          degraded: false,
          ambiguity: null,
          reason: null,
        },
        disputeContext: {
          state: "present",
          hash: "0xdef",
          verified: false,
          degraded: false,
          ambiguity: null,
          reason: null,
        },
      },
    };
  }

  if (path === `/users/${baseOverview().arbiter}/reputation`) {
    return {
      address: baseOverview().arbiter,
      buyerStats: null,
      sellerStats: null,
      arbiterStats: {
        address: baseOverview().arbiter,
        role: "arbiter",
        completed_deals_count: 3,
        completed_milestones_count: 5,
        dispute_count: 2,
        dispute_wins_count: 0,
        dispute_losses_count: 0,
        resolved_dispute_count: 2,
        unresolved_dispute_count: 0,
        dispute_split_count: 1,
        cancellation_count: 0,
        total_volume: "1000000",
        updated_at_block: "111",
      },
      truth: {
        canonicalSource: "derived_from_events",
        ambiguityPolicy: "claim_attribution_ambiguous_without_adjacent_same_milestone_approval",
        disputeOutcomePolicy:
          "count_only_recorded_disputes_with_replayable_resolution_signals; unresolved_or_ambiguous_outcomes_never_counted_as_wins",
      },
      freshness: staleFreshness,
    };
  }

  throw new Error(`Unhandled backend path: ${path}`);
}
