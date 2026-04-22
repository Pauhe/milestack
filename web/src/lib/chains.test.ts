import { describe, expect, it, vi } from "vitest";

const getDeploymentManifestMock = vi.hoisted(() =>
  vi.fn(() => ({
    chain: { chainId: 84532 },
    contracts: { escrowFactory: { address: "0x1111111111111111111111111111111111111111" } },
    frontend: { defaultDealMetadataPath: "/metadata/default.json" },
  }))
);

vi.mock("@/lib/deployment-manifest", () => ({
  getDeploymentManifest: getDeploymentManifestMock,
}));

describe("chains config", () => {
  it("returns configured chain when env chain id is supported and matches manifest", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

    const { getConfiguredChain, configuredChain } = await import("@/lib/chains");

    expect(getConfiguredChain().id).toBe(84532);
    expect(configuredChain.id).toBe(84532);
  });

  it("throws for unsupported NEXT_PUBLIC_CHAIN_ID", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "999999");

    await expect(import("@/lib/chains")).rejects.toThrow(/Unsupported NEXT_PUBLIC_CHAIN_ID/);
  });

  it("throws for chain mismatch against deployment manifest", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "8453");

    await expect(import("@/lib/chains")).rejects.toThrow(/NEXT_PUBLIC_CHAIN_ID mismatch/);
  });
});
