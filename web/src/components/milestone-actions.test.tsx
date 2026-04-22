// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MilestoneActions } from "@/components/milestone-actions";

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
  isConfirming: false,
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
    isLoading: writeState.isConfirming,
    data: null,
  }),
}));

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
  milestoneCount: 1n,
} as const;

const pendingMilestone = {
  amount: 1_000_000n,
  status: 0,
  reviewWindowSeconds: 86400,
  submittedAt: 0n,
  reviewDeadline: 0n,
  evidenceHash: "0x0",
  disputeHash: "0x0",
  buyerAward: 0n,
  sellerAward: 0n,
} as const;

const fundedMilestone = {
  ...pendingMilestone,
  status: 1,
} as const;

const submittedMilestone = {
  ...pendingMilestone,
  status: 2,
  reviewDeadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
} as const;

const disputedMilestone = {
  ...pendingMilestone,
  status: 5,
} as const;

describe("milestone actions", () => {
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
    writeState.isConfirming = false;
  });

  it("keeps visitor/disconnected view fail-closed with explicit blocked guidance", () => {
    render(<MilestoneActions overview={overview} milestoneId={0n} milestone={fundedMilestone} />);

    expect(screen.getByText("Read-only visitor")).toBeTruthy();
    expect(screen.getByText("Connect a wallet to reveal buyer, seller, or arbiter actions.")).toBeTruthy();
    expect(screen.getByText("Wallet connection is required before role-specific actions are available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit milestone" })).toBeNull();
  });

  it("disables buyer funding writes on wrong chain", () => {
    accountState.address = overview.buyer;
    accountState.isConnected = true;
    accountState.chainId = 1;

    render(<MilestoneActions overview={overview} milestoneId={0n} milestone={pendingMilestone} />);

    expect(screen.getByText("Switch to Base Sepolia to perform contract actions.")).toBeTruthy();
    const fundButton = screen.getByRole("button", { name: "Fund milestone" }) as HTMLButtonElement;
    expect(fundButton.disabled).toBe(true);
  });

  it("keeps submission blocked until payload is valid and enforces reference remove boundary", async () => {
    const user = userEvent.setup();
    accountState.address = overview.seller;
    accountState.isConnected = true;

    render(<MilestoneActions overview={overview} milestoneId={0n} milestone={fundedMilestone} />);

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

  it("shows buyer approve/dispute branches and refreshes after successful approve write", async () => {
    const user = userEvent.setup();
    accountState.address = overview.buyer;
    accountState.isConnected = true;

    writeContractMock.mockImplementation((_, callbacks?: { onSuccess?: () => void }) => {
      callbacks?.onSuccess?.();
    });

    render(
      <MilestoneActions
        overview={overview}
        milestoneId={0n}
        milestone={submittedMilestone}
        backendDerived={{
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: true,
          buyerCanDispute: true,
          sellerCanClaim: false,
        }}
      />
    );

    expect(screen.getByText("Choose the milestone outcome: approve payout or open a dispute during the review window.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve milestone" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open dispute" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Approve milestone" }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("shows timeout guidance and keeps claim disabled while transaction is pending", () => {
    accountState.address = overview.seller;
    accountState.isConnected = true;
    writeState.isPending = true;

    render(
      <MilestoneActions
        overview={overview}
        milestoneId={0n}
        milestone={submittedMilestone}
        backendDerived={{
          isCurrent: true,
          isBlocked: false,
          buyerCanApprove: false,
          buyerCanDispute: false,
          sellerCanClaim: true,
        }}
      />
    );

    expect(screen.getByText("Review window elapsed. Timeout claim is available.")).toBeTruthy();
    expect(
      screen.getByText("Transaction submitted. Waiting for confirmation before enabling new writes.")
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Claim after timeout" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows arbiter dispute resolution route affordance", () => {
    accountState.address = overview.arbiter;
    accountState.isConnected = true;

    render(<MilestoneActions overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    const disputeLink = screen.getByRole("link", { name: "Open dispute resolution" }) as HTMLAnchorElement;
    expect(disputeLink.getAttribute("href")).toBe(`/deals/${overview.address}/disputes/0`);
  });
});
