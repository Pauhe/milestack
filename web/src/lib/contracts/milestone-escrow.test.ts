import { describe, expect, it, vi } from "vitest";

const readContractMock = vi.hoisted(() => vi.fn());
const getAddressMock = vi.hoisted(() => vi.fn((value: string) => `normalized:${value}`));

vi.mock("viem", () => ({
  getAddress: getAddressMock,
  createPublicClient: vi.fn(() => ({
    readContract: readContractMock,
  })),
  http: vi.fn(() => ({})),
}));

vi.mock("@/lib/chains", () => ({
  configuredChain: { id: 84532, name: "Base Sepolia" },
}));

vi.mock("@/lib/env", () => ({
  appEnv: {
    defaultEscrowAddress: "0xabc",
    chainId: 84532,
  },
}));

describe("milestone escrow read helpers", () => {
  it("normalizes addresses through viem getAddress", async () => {
    const { normalizeAddress } = await import("@/lib/contracts/milestone-escrow");
    expect(normalizeAddress("0x123")).toBe("normalized:0x123");
  });

  it("returns null default escrow for invalid env address", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      appEnv: { defaultEscrowAddress: "bad" },
    }));
    vi.doMock("viem", () => ({
      getAddress: vi.fn(() => {
        throw new Error("invalid");
      }),
      createPublicClient: vi.fn(() => ({ readContract: readContractMock })),
      http: vi.fn(() => ({})),
    }));
    vi.doMock("@/lib/chains", () => ({ configuredChain: { id: 84532, name: "Base Sepolia" } }));

    const { getDefaultEscrowAddress } = await import("@/lib/contracts/milestone-escrow");
    expect(getDefaultEscrowAddress()).toBeNull();
  });

  it("reads overview and current milestone when current index is in range", async () => {
    vi.resetModules();
    const readContract = vi.fn()
      .mockResolvedValueOnce("0xbuyer")
      .mockResolvedValueOnce("0xseller")
      .mockResolvedValueOnce("0xarbiter")
      .mockResolvedValueOnce("0xtoken")
      .mockResolvedValueOnce("0xhash")
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(100n)
      .mockResolvedValueOnce(10n)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce({
        amount: 50n,
        status: 0,
        reviewWindowSeconds: 86400,
        submittedAt: 0n,
        reviewDeadline: 0n,
        evidenceHash: "0x0",
        disputeHash: "0x0",
        buyerAward: 0n,
        sellerAward: 0n,
      });

    vi.doMock("viem", () => ({
      getAddress: vi.fn((value: string) => value),
      createPublicClient: vi.fn(() => ({ readContract })),
      http: vi.fn(() => ({})),
    }));
    vi.doMock("@/lib/chains", () => ({ configuredChain: { id: 84532, name: "Base Sepolia" } }));
    vi.doMock("@/lib/env", () => ({ appEnv: { defaultEscrowAddress: null } }));

    const { readEscrowOverview } = await import("@/lib/contracts/milestone-escrow");
    const result = await readEscrowOverview("0xescrow" as `0x${string}`);

    expect(result.buyer).toBe("0xbuyer");
    expect(result.currentMilestone).not.toBeNull();
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getMilestone", args: [0n] })
    );
  });

  it("skips current milestone read when current index is out of range", async () => {
    vi.resetModules();
    const readContract = vi.fn()
      .mockResolvedValueOnce("0xbuyer")
      .mockResolvedValueOnce("0xseller")
      .mockResolvedValueOnce("0xarbiter")
      .mockResolvedValueOnce("0xtoken")
      .mockResolvedValueOnce("0xhash")
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(3n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(100n)
      .mockResolvedValueOnce(10n)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(2n);

    vi.doMock("viem", () => ({
      getAddress: vi.fn((value: string) => value),
      createPublicClient: vi.fn(() => ({ readContract })),
      http: vi.fn(() => ({})),
    }));
    vi.doMock("@/lib/chains", () => ({ configuredChain: { id: 84532, name: "Base Sepolia" } }));
    vi.doMock("@/lib/env", () => ({ appEnv: { defaultEscrowAddress: null } }));

    const { readEscrowOverview } = await import("@/lib/contracts/milestone-escrow");
    const result = await readEscrowOverview("0xescrow" as `0x${string}`);

    expect(result.currentMilestone).toBeNull();
    expect(readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getMilestone" })
    );
  });

  it("reads a specific milestone", async () => {
    vi.resetModules();
    const readContract = vi.fn().mockResolvedValue({
      amount: 99n,
      status: 2,
      reviewWindowSeconds: 500,
      submittedAt: 10n,
      reviewDeadline: 20n,
      evidenceHash: "0xe",
      disputeHash: "0xd",
      buyerAward: 1n,
      sellerAward: 2n,
    });

    vi.doMock("viem", () => ({
      getAddress: vi.fn((value: string) => value),
      createPublicClient: vi.fn(() => ({ readContract })),
      http: vi.fn(() => ({})),
    }));
    vi.doMock("@/lib/chains", () => ({ configuredChain: { id: 84532, name: "Base Sepolia" } }));
    vi.doMock("@/lib/env", () => ({ appEnv: { defaultEscrowAddress: null } }));

    const { readEscrowMilestone } = await import("@/lib/contracts/milestone-escrow");
    const milestone = await readEscrowMilestone("0xescrow" as `0x${string}`, 2n);

    expect(milestone.amount).toBe(99n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "getMilestone", args: [2n] })
    );
  });
});
