import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("wagmi", () => ({
  createConfig: vi.fn(() => ({ mocked: true })),
  http: vi.fn(() => ({})),
  useAccount: () => ({ address: undefined, chainId: 84532, isConnected: false }),
  useConnect: () => ({ connect: vi.fn(), connectors: [{ uid: "inj", name: "Injected" }], isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useWriteContract: () => ({ data: null, error: null, isPending: false, writeContract: vi.fn() }),
  useWaitForTransactionReceipt: () => ({ isLoading: false, data: null }),
  WagmiProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("wagmi/connectors", () => ({
  injected: vi.fn(() => ({ id: "injected" })),
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CreateDealForm } from "@/components/create-deal-form";
import { DealActions } from "@/components/deal-actions";
import { MilestoneActions } from "@/components/milestone-actions";
import { DisputeResolutionForm } from "@/components/dispute-resolution-form";
import { AppProviders } from "@/components/providers";

const overview = {
  address: "0x1111111111111111111111111111111111111111",
  buyer: "0x2222222222222222222222222222222222222222",
  seller: "0x3333333333333333333333333333333333333333",
  arbiter: "0x4444444444444444444444444444444444444444",
  token: "0x5555555555555555555555555555555555555555",
  metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  dealStatus: 1,
  currentMilestoneIndex: 0n,
  activeDisputeMilestoneId: 0n,
  totalFunded: 1_000_000n,
  totalReleasedToSeller: 0n,
  totalRefundedToBuyer: 0n,
  totalFeesCollected: 0n,
  milestoneCount: 2n,
  currentMilestone: {
    amount: 1_000_000n,
    status: 0,
    reviewWindowSeconds: 86400,
    submittedAt: 0n,
    reviewDeadline: 0n,
    evidenceHash: "0x0",
    disputeHash: "0x0",
    buyerAward: 0n,
    sellerAward: 0n,
  },
} as const;

describe("client component entry rendering", () => {
  it("renders create deal form disconnected state", () => {
    const html = renderToStaticMarkup(<CreateDealForm />);

    expect(html).toContain("Connect the seller wallet to create and deploy a deal.");
    expect(html).toContain("Create a milestone escrow");
    expect(html).toContain("Funding guidance");
    expect(html).toContain("Deploy escrow");
  });

  it("renders deal actions with conservative visitor gating", () => {
    const html = renderToStaticMarkup(<DealActions overview={overview} />);

    expect(html).toContain("Read-only visitor");
    expect(html).toContain("Connect a wallet to unlock role-specific milestone actions.");
    expect(html).toContain("Available actions");
  });

  it("renders milestone actions with conservative visitor gating", () => {
    const html = renderToStaticMarkup(
      <MilestoneActions overview={overview} milestoneId={0n} milestone={overview.currentMilestone} />
    );

    expect(html).toContain("Milestone actions");
    expect(html).toContain("Allowed next step");
    expect(html).toContain("Read-only visitor");
  });

  it("renders dispute resolution form with split helper copy", () => {
    const disputed = {
      ...overview,
      currentMilestone: {
        ...overview.currentMilestone,
        status: 5,
      },
    };

    const html = renderToStaticMarkup(
      <DisputeResolutionForm overview={disputed} milestoneId={0n} milestone={disputed.currentMilestone} />
    );

    expect(html).toContain("Resolve disputed milestone");
    expect(html).toContain("Split validation");
    expect(html).toContain("Resolution is final once submitted on-chain.");
  });

  it("renders providers wrapper", () => {
    const html = renderToStaticMarkup(
      <AppProviders>
        <div>child-node</div>
      </AppProviders>
    );

    expect(html).toContain("child-node");
  });
});
