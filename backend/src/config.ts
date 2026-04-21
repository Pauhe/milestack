import localManifest from "../../deployments/local/manifest.json" with { type: "json" };
import rehearsalLocalManifest from "../../deployments/rehearsal-local/manifest.json" with { type: "json" };

export type DeploymentManifest = typeof localManifest;

const manifests = {
  local: localManifest,
  "rehearsal-local": rehearsalLocalManifest,
} as const satisfies Record<string, DeploymentManifest>;

export type DeploymentEnvironment = keyof typeof manifests;

export function getDeploymentEnvironment(): DeploymentEnvironment {
  const environment = process.env.DEPLOYMENT_ENV ?? "local";

  if (!(environment in manifests)) {
    const supported = Object.keys(manifests).join(", ");
    throw new Error(
      `Unsupported DEPLOYMENT_ENV \"${environment}\". Supported environments: ${supported}`
    );
  }

  return environment as DeploymentEnvironment;
}

export function getDeploymentManifest(): DeploymentManifest {
  const environment = getDeploymentEnvironment();
  return manifests[environment];
}

export const deploymentManifest = getDeploymentManifest();

export const backendConfig = {
  port: Number(process.env.PORT ?? 4000),
  rpcUrl: process.env.RPC_URL,
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 30000),
  deploymentManifest,
} as const;
