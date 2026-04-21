import { anvil, base, baseSepolia, type Chain } from "viem/chains";

import { backendConfig } from "./config.js";

const supportedChains = [anvil, base, baseSepolia] as const;

export function getConfiguredChain(): Chain {
  const chainId = backendConfig.deploymentManifest.chain.chainId;
  const chain = supportedChains.find((candidate) => candidate.id === chainId);

  if (!chain) {
    const supported = supportedChains.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `Unsupported manifest chain id ${chainId}. Supported chain ids for backend runtime: ${supported}`
    );
  }

  return chain;
}

export const configuredChain = getConfiguredChain();
