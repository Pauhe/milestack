// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateDealForm, extractEscrowAddressFromReceipt } from "@/components/create-deal-form";

const pushMock = vi.fn();
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
  receiptLogs: null as Array<{ topics: string[]; data: string }> | null,
}));

const connectMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const writeContractMock = vi.hoisted(() => vi.fn());
const parseEventLogsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    parseEventLogs: parseEventLogsMock,
  };
});

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
  useWaitForTransactionReceipt: ({ hash }: { hash: `0x${string}` | null | undefined }) => ({
    isLoading: false,
    data: hash
      ? {
          logs: writeState.receiptLogs ?? [{ topics: ["0x1"], data: "0x" }],
        }
      : null,
  }),
}));

describe("create deal form", () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    refreshMock.mockReset();
    connectMock.mockReset();
    disconnectMock.mockReset();
    writeContractMock.mockReset();
    parseEventLogsMock.mockReset();

    accountState.address = undefined;
    accountState.chainId = 84532;
    accountState.isConnected = false;

    writeState.hash = null;
    writeState.error = null;
    writeState.isPending = false;
    writeState.receiptLogs = null;
  });

  it("keeps deploy blocked when wallet is disconnected", () => {
    render(<CreateDealForm />);

    expect(screen.getByText("Connect the seller wallet to create and deploy a deal.")).toBeTruthy();
    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);
  });

  it("shows wrong-network gating copy and keeps deploy disabled", () => {
    accountState.address = "0xa11ce00000000000000000000000000000000000";
    accountState.isConnected = true;
    accountState.chainId = 1;

    render(<CreateDealForm />);

    expect(screen.getByText("Switch to Base Sepolia before deploying.")).toBeTruthy();
    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);
  });

  it("supports guided template selection/reselection and protects final milestone remove boundary", async () => {
    const user = userEvent.setup();
    accountState.address = "0xa11ce00000000000000000000000000000000000";
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<CreateDealForm />);

    const templateSelect = screen.getByRole("combobox", { name: /Guided template/i }) as HTMLSelectElement;

    await user.selectOptions(templateSelect, "website-refresh");
    expect(screen.getByText("Three-step website delivery for strategy, build, and launch handoff.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Milestone 3" })).toBeTruthy();

    await user.selectOptions(templateSelect, "content-campaign");
    expect(screen.getByText("Two-phase campaign production for planning and publication assets.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Milestone 3" })).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByRole("heading", { level: 3, name: "Milestone 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("blocks deploy while payload validation errors are present", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;

    render(<CreateDealForm />);

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);

    await user.type(screen.getByLabelText("Buyer address"), "0x2222222222222222222222222222222222222222");
    await user.type(screen.getByLabelText("Arbiter address"), "0x4444444444444444444444444444444444444444");

    expect(screen.getByText("Deal title is required.")).toBeTruthy();
    expect(screen.getByText("Deal summary is required.")).toBeTruthy();
    expect(deployButton.disabled).toBe(true);
  });

  it("writes createEscrow once form is valid and account/network are eligible", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<CreateDealForm />);

    await user.clear(screen.getByLabelText("Buyer address"));
    await user.type(screen.getByLabelText("Buyer address"), "0x2222222222222222222222222222222222222222");

    await user.clear(screen.getByLabelText("Arbiter address"));
    await user.type(screen.getByLabelText("Arbiter address"), "0x4444444444444444444444444444444444444444");

    await user.clear(screen.getByLabelText("Deal title"));
    await user.type(screen.getByLabelText("Deal title"), "Website redesign for ExampleCo");

    await user.clear(screen.getByLabelText("Deal summary"));
    await user.type(
      screen.getByLabelText("Deal summary"),
      "Deliver a redesigned marketing website and handoff package."
    );

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(false);

    await user.click(deployButton);

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const [payload] = writeContractMock.mock.calls[0] as Array<Record<string, unknown>>;
    expect(payload.functionName).toBe("createEscrow");
  });

  it("redirects to escrow route only when receipt parsing yields escrow address", async () => {
    writeState.hash = "0xabc123" as `0x${string}`;
    parseEventLogsMock.mockReturnValue([
      {
        args: {
          escrow: "0xdeafbeef00000000000000000000000000000000",
        },
      },
    ]);

    render(<CreateDealForm />);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/deals/0xdeafbeef00000000000000000000000000000000");
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("does not redirect when receipt exists but parser yields no escrow address", async () => {
    writeState.hash = "0xabc123" as `0x${string}`;
    parseEventLogsMock.mockReturnValue([]);

    render(<CreateDealForm />);

    await waitFor(() => {
      expect(parseEventLogsMock).toHaveBeenCalled();
    });

    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("extractEscrowAddressFromReceipt returns null when logs have no EscrowCreated args", () => {
    parseEventLogsMock.mockReturnValue([]);

    const address = extractEscrowAddressFromReceipt([
      {
        topics: ["0x1234"],
        data: "0x",
      },
    ] as unknown as readonly import("viem").Log[]);

    expect(address).toBeNull();
  });
});
