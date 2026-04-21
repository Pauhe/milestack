import localManifest from "../../deployments/local/manifest.json" with { type: "json" };

export type DeploymentManifest = typeof localManifest;

const manifests = {
  local: localManifest,
} as const satisfies Record<string, DeploymentManifest>;

export function getDeploymentEnvironment() {
  return process.env.DEPLOYMENT_ENV ?? "local";
}

export function getDeploymentManifest(): DeploymentManifest {
  const environment = getDeploymentEnvironment();
  return manifests[environment as keyof typeof manifests] ?? localManifest;
}

export const deploymentManifest = getDeploymentManifest();

export const backendConfig = {
  port: Number(process.env.PORT ?? 4000),
  rpcUrl: process.env.RPC_URL,
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 30000),
  deploymentManifest,
} as const;
