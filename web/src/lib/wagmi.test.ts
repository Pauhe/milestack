import { describe, expect, it, vi } from "vitest";

const createConfigMock = vi.hoisted(() => vi.fn((cfg) => cfg));
const injectedMock = vi.hoisted(() => vi.fn(() => ({ id: "injected" })));
const httpMock = vi.hoisted(() => vi.fn(() => ({ type: "http-transport" })));

vi.mock("@/lib/chains", () => ({
  configuredChain: { id: 84532, name: "Base Sepolia" },
}));

vi.mock("wagmi", () => ({
  createConfig: createConfigMock,
  http: httpMock,
}));

vi.mock("wagmi/connectors", () => ({
  injected: injectedMock,
}));

describe("wagmi config", () => {
  it("creates config with configured chain, injected connector, and http transport", async () => {
    const { wagmiConfig } = await import("@/lib/wagmi");

    expect(injectedMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(createConfigMock).toHaveBeenCalledTimes(1);

    expect(wagmiConfig.chains).toEqual([{ id: 84532, name: "Base Sepolia" }]);
    expect(wagmiConfig.ssr).toBe(true);
    expect(wagmiConfig.transports[84532]).toEqual({ type: "http-transport" });
    expect(wagmiConfig.connectors).toEqual([{ id: "injected" }]);
  });
});
