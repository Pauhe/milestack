// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DealActions } from "@/components/deal-actions";

const refreshMock = vi.fn();

const accountState = vi.hoisted(() => ({
  address: undefined as string | undefined,
  chainId: 84532,
  isConnected: false,
}));

const writeState = vi.hoisted(() => ({
  hash: null as `0x${string}` | null,
  error: null as Error | null,
  isPending: false,
}));

const connectMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const writeContractMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => accountState,
  useConnect: () => ({
    connect: connectMock,
    connectors: [{ uid: "inj", name: "Injected" }],
    isPending: false,
  }),
  useDisconnect: () => ({ disconnect: disconnectMock }),
  useWriteContract: () => ({
    data: writeState.hash,
    error: writeState.error,
    isPending: writeState.isPending,
    writeContract: writeContractMock,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    data: null,
  }),
}));

const baseOverview = {
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
  milestoneCount: 1n,
  currentMilestone: {
    amount: 1_000_000n,
    status: 1,
    reviewWindowSeconds: 86400,
    submittedAt: 0n,
    reviewDeadline: 0n,
    evidenceHash: "0x0",
    disputeHash: "0x0",
    buyerAward: 0n,
    sellerAward: 0n,
  },
} as const;

describe("deal actions", () => {
  afterEach(() => {
    cleanup();
    refreshMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    writeContractMock.mockReset();

    accountState.address = undefined;
    accountState.chainId = 84532;
    accountState.isConnected = false;

    writeState.hash = null;
    writeState.error = null;
    writeState.isPending = false;
  });

  it("keeps visitor/disconnected view blocked with explicit guidance", () => {
    render(<DealActions overview={baseOverview} />);

    expect(screen.getByText("Read-only visitor")).toBeTruthy();
    expect(screen.getByText("Connect a wallet to unlock role-specific milestone actions.")).toBeTruthy();
    expect(screen.getByText("Wallet connection is required before role-specific actions are available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fund milestone" })).toBeNull();
  });

  it("shows buyer funding action but keeps writes disabled on wrong network", () => {
    accountState.address = baseOverview.buyer;
    accountState.isConnected = true;
    accountState.chainId = 1;

    render(
      <DealActions
        overview={{
          ...baseOverview,
          currentMilestone: {
            ...baseOverview.currentMilestone,
            status: 0,
          },
        }}
      />
    );

    expect(screen.getByText("Switch to Base Sepolia to perform contract actions.")).toBeTruthy();
    const fundButton = screen.getByRole("button", { name: "Fund milestone" }) as HTMLButtonElement;
    expect(fundButton.disabled).toBe(true);
  });

  it("submits seller evidence only after payload validation passes and enforces remove-reference boundary", async () => {
    const user = userEvent.setup();

    accountState.address = baseOverview.seller;
    accountState.isConnected = true;

    render(<DealActions overview={baseOverview} />);

    expect(screen.getByText("Canonical submission hash preview: Unavailable until payload is valid.")).toBeTruthy();
    expect(screen.getByText("Public note is required.")).toBeTruthy();
    expect(screen.getByText("Reference 1 label is required.")).toBeTruthy();
    expect(screen.getByText("Reference 1 URL is required.")).toBeTruthy();

    const submitButton = screen.getByRole("button", { name: "Submit milestone" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Add reference" }));
    expect(screen.getAllByRole("button", { name: "Remove reference" }).length).toBe(2);

    await user.click(screen.getAllByRole("button", { name: "Remove reference" })[0]);
    expect(screen.queryByRole("button", { name: "Remove reference" })).toBeNull();

    await user.type(screen.getByLabelText("Public submission note"), "Submission evidence package");
    await user.type(screen.getByLabelText("Reference label"), "QA report");
    await user.type(screen.getByLabelText("Reference URL"), "https://example.com/qa");

    expect(screen.queryByText("Public note is required.")).toBeNull();
    expect(screen.queryByText("Reference 1 label is required.")).toBeNull();
    expect(screen.queryByText("Reference 1 URL is required.")).toBeNull();
    expect((screen.getByRole("button", { name: "Submit milestone" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("surfaces buyer dispute affordances on submitted milestones", () => {
    accountState.address = baseOverview.buyer;
    accountState.isConnected = true;

    render(
      <DealActions
        overview={{
          ...baseOverview,
          currentMilestone: {
            ...baseOverview.currentMilestone,
            status: 2,
            reviewDeadline: BigInt(Math.floor(Date.now() / 1000) + 1000),
          },
        }}
        backendMilestoneDerived={{
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: true,
          buyerCanDispute: true,
          sellerCanClaim: false,
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Approve milestone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dispute" })).toBeTruthy();
    expect(screen.getByText("Choose the milestone outcome: approve payout or open a dispute during the review window.")).toBeTruthy();
  });

  it("shows claim-after-timeout affordance for eligible seller", () => {
    accountState.address = baseOverview.seller;
    accountState.isConnected = true;

    render(
      <DealActions
        overview={{
          ...baseOverview,
          currentMilestone: {
            ...baseOverview.currentMilestone,
            status: 2,
            reviewDeadline: 1n,
          },
        }}
        backendMilestoneDerived={{
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: false,
          buyerCanDispute: false,
          sellerCanClaim: true,
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Claim after timeout" })).toBeTruthy();
    expect(screen.getByText("Review window elapsed. Timeout claim is available.")).toBeTruthy();
  });

  it("shows arbiter dispute resolution route affordance for disputed milestones", () => {
    accountState.address = baseOverview.arbiter;
    accountState.isConnected = true;

    render(
      <DealActions
        overview={{
          ...baseOverview,
          currentMilestone: {
            ...baseOverview.currentMilestone,
            status: 5,
          },
        }}
      />
    );

    const disputeLink = screen.getByRole("link", { name: "Open dispute resolution" }) as HTMLAnchorElement;
    expect(disputeLink.getAttribute("href")).toBe(`/deals/${baseOverview.address}/disputes/0`);
  });

  it("refreshes route after successful write", async () => {
    const user = userEvent.setup();

    accountState.address = baseOverview.buyer;
    accountState.isConnected = true;

    writeContractMock.mockImplementation((_, callbacks?: { onSuccess?: () => void }) => {
      callbacks?.onSuccess?.();
    });

    render(
      <DealActions
        overview={{
          ...baseOverview,
          currentMilestone: {
            ...baseOverview.currentMilestone,
            status: 0,
          },
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Fund milestone" }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
