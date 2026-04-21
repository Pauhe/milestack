import { base, baseSepolia, type Chain } from "wagmi/chains";

import { appEnv } from "@/lib/env";

const supportedChains = [base, baseSepolia] as const;

export function getConfiguredChain(): Chain {
  return supportedChains.find((chain) => chain.id === appEnv.chainId) ?? base;
}

export const configuredChain = getConfiguredChain();
