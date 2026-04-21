import { anvil, base, baseSepolia, type Chain } from "wagmi/chains";

import { appEnv } from "@/lib/env";

const anvilWithMulticall = {
  ...anvil,
  contracts: {
    ...anvil.contracts,
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
      blockCreated: 0,
    },
  },
} as const satisfies Chain;

const supportedChains = [anvilWithMulticall, base, baseSepolia] as const;

export function getConfiguredChain(): Chain {
  return supportedChains.find((chain) => chain.id === appEnv.chainId) ?? base;
}

export const configuredChain = getConfiguredChain();
