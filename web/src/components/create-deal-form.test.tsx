// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  isConfirming: false,
  receiptLogs: null as Array<{ topics: string[]; data: string }> | null,
}));

const envState = vi.hoisted(() => ({
  chainId: 84532,
  factoryAddress: "0x1234567890abcdef1234567890abcdef12345678",
  defaultEscrowAddress: undefined,
  defaultDealMetadataPath: undefined,
  walletConnectProjectId: undefined,
}));

const connectMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const writeContractMock = vi.hoisted(() => vi.fn());
const parseEventLogsMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/env", () => ({
  appEnv: envState,
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
    isLoading: writeState.isConfirming,
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
    writeState.isConfirming = false;
    writeState.receiptLogs = null;

    envState.factoryAddress = "0x1234567890abcdef1234567890abcdef12345678";
  });

  it("keeps deploy blocked when wallet is disconnected and allows connect action", async () => {
    const user = userEvent.setup();
    render(<CreateDealForm />);

    expect(screen.getByText("Connect the seller wallet to create and deploy a deal.")).toBeTruthy();
    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Connect Injected" }));
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("shows connected wallet details and supports disconnect action", async () => {
    const user = userEvent.setup();
    accountState.address = "0xa11ce00000000000000000000000000000000000";
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<CreateDealForm />);

    expect(screen.getByText("Wallet: 0xa11ce00000000000000000000000000000000000")).toBeTruthy();
    expect(screen.getByText("Chain: Base Sepolia")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectMock).toHaveBeenCalledTimes(1);
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

  it("surfaces missing factory guidance and keeps deploy disabled", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    envState.factoryAddress = "";

    render(<CreateDealForm />);
    await makeFormValid(user);

    expect(screen.getByText("Set `NEXT_PUBLIC_FACTORY_ADDRESS` to enable live escrow deployment.")).toBeTruthy();
    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);

    await user.click(deployButton);
    expect(writeContractMock).not.toHaveBeenCalled();
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

  it("shows unavailable funding guidance when milestone inputs are invalid", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;

    render(<CreateDealForm />);

    await user.clear(screen.getByLabelText("Amount (USDC)"));

    expect(
      screen.getByText("Funding summary unavailable until each milestone has a valid USDC amount and review window.")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Review-window guidance is unavailable until each milestone has a review window greater than zero days."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Funding actions stay milestone-based after deployment. Buyers can fund the current milestone or batch fund remaining pending milestones when available."
      )
    ).toBeTruthy();
  });

  it("supports milestone add, edit, and remove boundaries", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;

    render(<CreateDealForm />);

    await user.click(screen.getByRole("button", { name: "Add milestone" }));
    expect(screen.getByRole("heading", { level: 3, name: "Milestone 2" })).toBeTruthy();

    const milestoneTitles = screen.getAllByPlaceholderText("Discovery and wireframes");
    fireEvent.change(milestoneTitles[1] as HTMLInputElement, { target: { value: "QA and launch handoff" } });

    const allAmounts = screen.getAllByLabelText("Amount (USDC)");
    await user.clear(allAmounts[1] as HTMLInputElement);
    await user.type(allAmounts[1] as HTMLInputElement, "2500");

    expect((milestoneTitles[1] as HTMLInputElement).value).toBe("QA and launch handoff");
    expect((allAmounts[1] as HTMLInputElement).value).toBe("2500");

    const removeButtons = screen.getAllByRole("button", { name: "Remove" });
    await user.click(removeButtons[1] as HTMLButtonElement);

    expect(screen.queryByRole("heading", { level: 3, name: "Milestone 2" })).toBeNull();
    expect(screen.queryByDisplayValue("2500")).toBeNull();
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

    await user.selectOptions(templateSelect, "custom");
    expect(screen.queryByText("Two-phase campaign production for planning and publication assets.")).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.getByRole("heading", { level: 3, name: "Milestone 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("shows valid funding guidance summary once form state is valid", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;

    render(<CreateDealForm />);
    await makeFormValid(user);

    expect(screen.getByText("Metadata hash:", { exact: false })).toBeTruthy();
    expect(screen.getByText("Total escrow commitment: 1000 USDC")).toBeTruthy();
    expect(
      screen.getByText("Current milestone exposure: 1000 USDC; remaining pending milestones: 0 USDC.")
    ).toBeTruthy();
    expect(screen.getByText("M1: 1000 USDC")).toBeTruthy();
    expect(screen.getByText("Each milestone uses a 5-day buyer review window after seller submission.")).toBeTruthy();
    expect(
      screen.getByText(
        "This deal has one milestone. Funding the current milestone (1000 USDC) covers the full escrow amount."
      )
    ).toBeTruthy();
    expect(
      screen.getByText("The form is valid and ready to deploy through the escrow factory on Base Sepolia.")
    ).toBeTruthy();

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(false);
  });

  it("writes createEscrow once form is valid and account/network are eligible", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<CreateDealForm />);
    await makeFormValid(user);

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(false);

    await user.click(deployButton);

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const [payload] = writeContractMock.mock.calls[0] as Array<Record<string, unknown>>;
    expect(payload.functionName).toBe("createEscrow");
  });

  it("surfaces deployment tx hash and write error diagnostics", () => {
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    writeState.hash = "0xabc123" as `0x${string}`;
    writeState.error = new Error("wallet rejected request");

    render(<CreateDealForm />);

    expect(screen.getByText("Deployment tx: 0xabc123")).toBeTruthy();
    expect(screen.getByText("Deployment error: wallet rejected request")).toBeTruthy();
  });

  it("keeps deploy disabled while write is pending", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    writeState.isPending = true;

    render(<CreateDealForm />);
    await makeFormValid(user);

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);

    await user.click(deployButton);
    expect(writeContractMock).not.toHaveBeenCalled();
  });

  it("keeps deploy disabled while receipt confirmation is in progress", async () => {
    const user = userEvent.setup();
    accountState.address = "0x3333333333333333333333333333333333333333";
    accountState.isConnected = true;
    writeState.hash = "0xabc123" as `0x${string}`;
    writeState.isConfirming = true;

    render(<CreateDealForm />);
    await makeFormValid(user);

    const deployButton = screen.getByRole("button", { name: "Deploy escrow" }) as HTMLButtonElement;
    expect(deployButton.disabled).toBe(true);

    await user.click(deployButton);
    expect(writeContractMock).not.toHaveBeenCalled();
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

  it("does not redirect when parser throws for malformed logs", async () => {
    writeState.hash = "0xabc123" as `0x${string}`;
    parseEventLogsMock.mockImplementation(() => {
      throw new Error("malformed logs");
    });

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

  it("extractEscrowAddressFromReceipt returns null when parser throws", () => {
    parseEventLogsMock.mockImplementation(() => {
      throw new Error("bad abi decode");
    });

    const address = extractEscrowAddressFromReceipt([
      {
        topics: ["0x1234"],
        data: "0x",
      },
    ] as unknown as readonly import("viem").Log[]);

    expect(address).toBeNull();
  });
});

async function makeFormValid(user: ReturnType<typeof userEvent.setup>) {
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
}
