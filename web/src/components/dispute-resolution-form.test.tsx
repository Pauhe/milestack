// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DisputeResolutionForm } from "@/components/dispute-resolution-form";

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

const disputedMilestone = {
  amount: 1_000_000n,
  status: 5,
  reviewWindowSeconds: 86400,
  submittedAt: 0n,
  reviewDeadline: 0n,
  evidenceHash: "0x0",
  disputeHash: "0x0",
  buyerAward: 0n,
  sellerAward: 0n,
} as const;

describe("dispute resolution form", () => {
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

  it("keeps visitor blocked with explicit arbiter-only messaging", () => {
    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    expect(screen.getByText("Connect the designated arbiter wallet to resolve this dispute.")).toBeTruthy();
    expect(screen.getByText("Resolution is final once submitted on-chain.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks non-arbiter connected wallets", () => {
    accountState.address = overview.buyer;
    accountState.isConnected = true;

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    expect(screen.getByText("Only the designated arbiter can submit a dispute resolution.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks wrong-network arbiter even with exact split", async () => {
    const user = userEvent.setup();
    accountState.address = overview.arbiter;
    accountState.isConnected = true;
    accountState.chainId = 1;

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    await user.type(screen.getByLabelText("Buyer award (USDC)"), "0.4");
    await user.type(screen.getByLabelText("Seller award (USDC)"), "0.6");

    expect(screen.getByText("Switch to Base Sepolia to submit a dispute resolution transaction.")).toBeTruthy();
    expect(screen.getByText("Resolution is blocked until the connected wallet is on Base Sepolia.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps malformed decimal input blocked", async () => {
    const user = userEvent.setup();
    accountState.address = overview.arbiter;
    accountState.isConnected = true;

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    await user.type(screen.getByLabelText("Buyer award (USDC)"), "not-a-number");
    await user.type(screen.getByLabelText("Seller award (USDC)"), "1");

    expect(screen.getByText("Enter valid USDC amounts with up to 6 decimal places.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires exact split totals before enabling submit", async () => {
    const user = userEvent.setup();
    accountState.address = overview.arbiter;
    accountState.isConnected = true;

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    await user.type(screen.getByLabelText("Buyer award (USDC)"), "0.5");
    await user.type(screen.getByLabelText("Seller award (USDC)"), "0.4");

    expect(screen.getByText("Buyer and seller awards must sum exactly to the milestone amount.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText("Seller award (USDC)"));
    await user.type(screen.getByLabelText("Seller award (USDC)"), "0.5");

    expect(screen.getByText("The split matches the milestone amount exactly.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows pending/finality copy and blocks submits while tx is pending", async () => {
    const user = userEvent.setup();
    accountState.address = overview.arbiter;
    accountState.isConnected = true;
    writeState.isPending = true;

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    await user.type(screen.getByLabelText("Buyer award (USDC)"), "0.5");
    await user.type(screen.getByLabelText("Seller award (USDC)"), "0.5");

    expect(screen.getByText("Resolution transaction submitted. Wait for confirmation before sending another split.")).toBeTruthy();
    expect(screen.getByText("A resolution transaction is pending confirmation.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit resolution" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("writes resolveDispute and refreshes on successful submit", async () => {
    const user = userEvent.setup();
    accountState.address = overview.arbiter;
    accountState.isConnected = true;

    writeContractMock.mockImplementation((_, callbacks?: { onSuccess?: () => void }) => {
      callbacks?.onSuccess?.();
    });

    render(<DisputeResolutionForm overview={overview} milestoneId={0n} milestone={disputedMilestone} />);

    await user.type(screen.getByLabelText("Buyer award (USDC)"), "0.25");
    await user.type(screen.getByLabelText("Seller award (USDC)"), "0.75");
    await user.click(screen.getByRole("button", { name: "Submit resolution" }));

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
