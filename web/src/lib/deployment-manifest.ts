import localManifest from "../../../deployments/local/manifest.json";
import rehearsalLocalManifest from "../../../deployments/rehearsal-local/manifest.json";

type DeploymentManifest = typeof localManifest;

const manifests = {
  local: localManifest,
  "rehearsal-local": rehearsalLocalManifest,
} as const satisfies Record<string, DeploymentManifest>;

export type DeploymentEnvironment = keyof typeof manifests;

export function getDeploymentEnvironment(): DeploymentEnvironment {
  const environment = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "local";

  if (!(environment in manifests)) {
    const supported = Object.keys(manifests).join(", ");
    throw new Error(
      `Unsupported NEXT_PUBLIC_DEPLOYMENT_ENV \"${environment}\". Supported environments: ${supported}`
    );
  }

  return environment as DeploymentEnvironment;
}

export function getDeploymentManifest(): DeploymentManifest {
  const environment = getDeploymentEnvironment();
  return manifests[environment];
}
