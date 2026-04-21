import { getDeploymentManifest } from "@/lib/deployment-manifest";

const manifest = getDeploymentManifest();
const requiredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? manifest.chain.chainId);

export const appEnv = {
  chainId: requiredChainId,
  defaultEscrowAddress: process.env.NEXT_PUBLIC_DEFAULT_ESCROW_ADDRESS,
  factoryAddress: process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? manifest.contracts.escrowFactory.address,
  defaultDealMetadataPath:
    process.env.NEXT_PUBLIC_DEFAULT_DEAL_METADATA_PATH ?? manifest.frontend?.defaultDealMetadataPath,
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
} as const;
