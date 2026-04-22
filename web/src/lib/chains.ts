import { anvil, base, baseSepolia, type Chain } from "wagmi/chains";

import { appEnv } from "@/lib/env";
import { getDeploymentManifest } from "@/lib/deployment-manifest";

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

const deploymentManifest = getDeploymentManifest();

function getChainById(chainId: number) {
  return supportedChains.find((chain) => chain.id === chainId) ?? null;
}

export function getConfiguredChain(): Chain {
  const configured = getChainById(appEnv.chainId);
  if (!configured) {
    const supported = supportedChains.map((chain) => chain.id).join(", ");
    throw new Error(`Unsupported NEXT_PUBLIC_CHAIN_ID ${appEnv.chainId}. Supported chain ids: ${supported}`);
  }

  if (configured.id !== deploymentManifest.chain.chainId) {
    throw new Error(
      `NEXT_PUBLIC_CHAIN_ID mismatch: configured ${configured.id} but deployment manifest ${deploymentManifest.chain.chainId}`
    );
  }

  return configured;
}

export const configuredChain = getConfiguredChain();
