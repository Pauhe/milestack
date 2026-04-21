import localManifest from "../../../deployments/local/manifest.json";

type DeploymentManifest = typeof localManifest;

const manifests = {
  local: localManifest,
} as const satisfies Record<string, DeploymentManifest>;

export function getDeploymentEnvironment() {
  return process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "local";
}

export function getDeploymentManifest(): DeploymentManifest {
  const environment = getDeploymentEnvironment();
  return manifests[environment as keyof typeof manifests] ?? localManifest;
}
