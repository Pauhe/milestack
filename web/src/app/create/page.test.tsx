// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  createConfig: vi.fn(() => ({ mocked: true })),
  http: vi.fn(() => ({})),
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
          logs: [{ topics: ["0x1"], data: "0x" }],
        }
      : null,
  }),
}));

vi.mock("wagmi/connectors", () => ({
  injected: vi.fn(() => ({ id: "injected" })),
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CreateDealPage from "@/app/create/page";
import { CreateDealForm, extractEscrowAddressFromReceipt } from "@/components/create-deal-form";
import { MilestoneActions } from "@/components/milestone-actions";

const overview = {
  address: "0x1111111111111111111111111111111111111111",
  buyer: "0x2222222222222222222222222222222222222222",
  seller: "0x3333333333333333333333333333333333333333",
  arbiter: "0x4444444444444444444444444444444444444444",
  token: "0x5555555555555555555555555555555555555555",
  metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  dealStatus: 1,
  currentMilestoneIndex: 0n,
  activeDisputeMilestoneId: null,
  totalFunded: 1_000_000n,
  totalReleasedToSeller: 0n,
  totalRefundedToBuyer: 0n,
  totalFeesCollected: 0n,
  milestoneCount: 2n,
} as const;

const milestone = {
  amount: 1_000_000n,
  status: 1,
  reviewWindowSeconds: 86400,
  submittedAt: 0n,
  reviewDeadline: 0n,
  evidenceHash: "0x0",
  disputeHash: "0x0",
  buyerAward: 0n,
  sellerAward: 0n,
} as const;

describe("create deal route", () => {
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
  });

  it("renders seller-led page copy and form marker", () => {
    const { container } = render(<CreateDealPage />);
    const html = container.innerHTML;

    expect(html).toContain("Create Deal");
    expect(html).toContain("Seller-led deal setup");
    expect(html).toContain("multi-step create-deal flow");
    expect(html).toContain("Create a milestone escrow");
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

  it("allows template selection and protects against deleting the final milestone", async () => {
    const user = userEvent.setup();
    accountState.address = "0xa11ce00000000000000000000000000000000000";
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<CreateDealForm />);

    const templateSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await user.selectOptions(templateSelect, "website-refresh");

    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toContain("Milestone 3");

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    expect(screen.getByRole("heading", { level: 3, name: "Milestone 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Milestone 2" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "Milestone 3" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("redirects to newly created escrow when receipt includes EscrowCreated", async () => {
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

  it("keeps submit milestone blocked until submission payload is valid", async () => {
    accountState.address = overview.seller;
    accountState.isConnected = true;
    accountState.chainId = 84532;

    render(<MilestoneActions overview={overview} milestoneId={0n} milestone={milestone} />);

    expect(screen.getByText("Canonical submission hash preview: Unavailable until payload is valid.")).toBeTruthy();
    expect(screen.getByText("Public note is required.")).toBeTruthy();
    expect(screen.getByText("Reference 1 label is required.")).toBeTruthy();
    expect(screen.getByText("Reference 1 URL is required.")).toBeTruthy();

    const submitButton = screen.getByRole("button", { name: "Submit milestone" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Public submission note"), "Submission evidence package");
    await user.type(screen.getByLabelText("Reference label"), "QA Report");
    await user.type(screen.getByLabelText("Reference URL"), "https://example.com/qa");

    expect(screen.queryByText("Public note is required.")).toBeNull();
    expect(screen.queryByText("Reference 1 label is required.")).toBeNull();
    expect(screen.queryByText("Reference 1 URL is required.")).toBeNull();
    expect((screen.getByRole("button", { name: "Submit milestone" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("extracts escrow address from receipt logs when parser returns EscrowCreated args", () => {
    parseEventLogsMock.mockReturnValue([
      {
        args: {
          escrow: "0xdeafbeef00000000000000000000000000000000",
        },
      },
    ]);

    const address = extractEscrowAddressFromReceipt([
      {
        topics: ["0x1234"],
        data: "0x",
      },
    ] as unknown as readonly import("viem").Log[]);

    expect(address).toBe("0xdeafbeef00000000000000000000000000000000");
  });

  it("returns null for logs when parser finds no EscrowCreated event", () => {
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
