import { anvil, base, baseSepolia, type Chain } from "viem/chains";

import { backendConfig, listSupportedManifestChainIds } from "./config.js";

const runtimeSupportedChains = [anvil, base, baseSepolia] as const;

function getRuntimeChainById(chainId: number): Chain | null {
  return runtimeSupportedChains.find((candidate) => candidate.id === chainId) ?? null;
}

function assertManifestChainsSupportedByRuntime() {
  const unsupported = listSupportedManifestChainIds().filter((chainId) => !getRuntimeChainById(chainId));

  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported manifest chain ids ${unsupported.join(", ")}. Supported chain ids for backend runtime: ${runtimeSupportedChains
        .map((candidate) => candidate.id)
        .join(", ")}`
    );
  }
}

assertManifestChainsSupportedByRuntime();

export function getConfiguredChain(): Chain {
  const chainId = backendConfig.deploymentManifest.chain.chainId;
  const chain = getRuntimeChainById(chainId);

  if (!chain) {
    const supported = runtimeSupportedChains.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `Unsupported manifest chain id ${chainId}. Supported chain ids for backend runtime: ${supported}`
    );
  }

  return chain;
}

export function assertRuntimeChainSupported(chainId: number) {
  const chain = getRuntimeChainById(chainId);

  if (!chain) {
    const manifestSupported = listSupportedManifestChainIds().join(", ");
    const runtimeSupported = runtimeSupportedChains.map((candidate) => candidate.id).join(", ");
    throw new Error(
      `Unsupported runtime chain id ${chainId}. Manifest chain ids: ${manifestSupported}; backend runtime chain ids: ${runtimeSupported}`
    );
  }

  return chain;
}

export const configuredChain = getConfiguredChain();
