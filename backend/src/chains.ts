import { anvil, base, baseSepolia, type Chain } from "viem/chains";

import { backendConfig } from "./config.js";

const supportedChains = [anvil, base, baseSepolia] as const;

export function getConfiguredChain(): Chain {
  return (
    supportedChains.find((chain) => chain.id === backendConfig.deploymentManifest.chain.chainId) ??
    baseSepolia
  );
}

export const configuredChain = getConfiguredChain();
