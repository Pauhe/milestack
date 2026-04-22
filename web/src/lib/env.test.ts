import { describe, expect, it, vi } from "vitest";

describe("app env", () => {
  it("uses manifest defaults when NEXT_PUBLIC vars are unset", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doMock("@/lib/deployment-manifest", () => ({
      getDeploymentManifest: () => ({
        chain: { chainId: 84532 },
        contracts: { escrowFactory: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
        frontend: { defaultDealMetadataPath: "/metadata/default.json" },
      }),
    }));

    const { appEnv } = await import("@/lib/env");

    expect(appEnv.chainId).toBe(84532);
    expect(appEnv.factoryAddress).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(appEnv.defaultDealMetadataPath).toBe("/metadata/default.json");
  });

  it("honors explicit NEXT_PUBLIC env overrides", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "31337");
    vi.stubEnv("NEXT_PUBLIC_FACTORY_ADDRESS", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_DEAL_METADATA_PATH", "/metadata/override.json");
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_ESCROW_ADDRESS", "0xcccccccccccccccccccccccccccccccccccccccc");
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "wc-project");

    vi.doMock("@/lib/deployment-manifest", () => ({
      getDeploymentManifest: () => ({
        chain: { chainId: 84532 },
        contracts: { escrowFactory: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
        frontend: { defaultDealMetadataPath: "/metadata/default.json" },
      }),
    }));

    const { appEnv } = await import("@/lib/env");

    expect(appEnv.chainId).toBe(31337);
    expect(appEnv.factoryAddress).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(appEnv.defaultDealMetadataPath).toBe("/metadata/override.json");
    expect(appEnv.defaultEscrowAddress).toBe("0xcccccccccccccccccccccccccccccccccccccccc");
    expect(appEnv.walletConnectProjectId).toBe("wc-project");
  });
});
