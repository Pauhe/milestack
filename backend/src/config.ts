import localManifest from "../../deployments/local/manifest.json" with { type: "json" };
import rehearsalLocalManifest from "../../deployments/rehearsal-local/manifest.json" with { type: "json" };
import { getAddress } from "viem";

export type DeploymentManifest = typeof localManifest;

const manifests = {
  local: localManifest,
  "rehearsal-local": rehearsalLocalManifest,
} as const satisfies Record<string, DeploymentManifest>;

export type DeploymentEnvironment = keyof typeof manifests;

function bounded(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 512);
}

function assertManifest(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(bounded(`Invalid deployment manifest: ${message}`));
  }
}

function assertAddress(value: unknown, field: string) {
  assertManifest(typeof value === "string" && value.length > 0, `${field} must be a non-empty address string`);

  try {
    return getAddress(value);
  } catch {
    throw new Error(bounded(`Invalid deployment manifest: ${field} must be a valid EVM address`));
  }
}

function assertNonEmptyString(value: unknown, field: string) {
  assertManifest(typeof value === "string" && value.trim().length > 0, `${field} must be a non-empty string`);
}

function assertInteger(value: unknown, field: string) {
  assertManifest(typeof value === "number" && Number.isInteger(value), `${field} must be an integer`);
}

function assertTxHash(value: unknown, field: string) {
  assertManifest(typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value), `${field} must be a 32-byte hex hash`);
}

export function validateDeploymentManifest(manifest: DeploymentManifest, expectedEnvironment: DeploymentEnvironment) {
  assertManifest(typeof manifest === "object" && manifest !== null, "manifest must be an object");

  assertInteger(manifest.version, "version");
  assertManifest(manifest.version > 0, "version must be >= 1");

  assertNonEmptyString(manifest.environment, "environment");
  assertManifest(
    manifest.environment === expectedEnvironment,
    `environment mismatch: DEPLOYMENT_ENV="${expectedEnvironment}" but manifest.environment="${manifest.environment}"`
  );

  assertInteger(manifest.chain.chainId, "chain.chainId");
  assertManifest(manifest.chain.chainId > 0, "chain.chainId must be > 0");
  assertNonEmptyString(manifest.chain.name, "chain.name");

  assertInteger(manifest.deployedAt.blockNumber, "deployedAt.blockNumber");
  assertManifest(manifest.deployedAt.blockNumber >= 0, "deployedAt.blockNumber must be >= 0");
  assertNonEmptyString(manifest.deployedAt.timestamp, "deployedAt.timestamp");
  assertTxHash(manifest.deployedAt.txHash, "deployedAt.txHash");

  assertAddress(manifest.contracts.escrowFactory.address, "contracts.escrowFactory.address");
  assertTxHash(manifest.contracts.escrowFactory.deploymentTxHash, "contracts.escrowFactory.deploymentTxHash");
  assertManifest(
    typeof manifest.contracts.escrowFactory.verified === "boolean",
    "contracts.escrowFactory.verified must be a boolean"
  );

  assertAddress(manifest.config.usdc, "config.usdc");
  assertAddress(manifest.config.feeRecipient, "config.feeRecipient");
  assertInteger(manifest.config.protocolFeeBps, "config.protocolFeeBps");
  assertManifest(
    manifest.config.protocolFeeBps >= 0 && manifest.config.protocolFeeBps <= 10_000,
    "config.protocolFeeBps must be between 0 and 10000"
  );
  assertManifest(
    typeof manifest.config.creationPauseSupported === "boolean",
    "config.creationPauseSupported must be a boolean"
  );

  if (manifest.config.defaultReviewWindowSeconds !== undefined) {
    assertInteger(manifest.config.defaultReviewWindowSeconds, "config.defaultReviewWindowSeconds");
    assertManifest(
      manifest.config.defaultReviewWindowSeconds >= 0,
      "config.defaultReviewWindowSeconds must be >= 0"
    );
  }

  if (manifest.config.metadataVisibility !== undefined) {
    assertManifest(
      manifest.config.metadataVisibility === "public",
      'config.metadataVisibility must be "public" for MVP'
    );
  }

  assertNonEmptyString(manifest.artifacts.commitSha, "artifacts.commitSha");
  assertNonEmptyString(manifest.artifacts.contractBuildId, "artifacts.contractBuildId");

  return {
    ...manifest,
    contracts: {
      ...manifest.contracts,
      escrowFactory: {
        ...manifest.contracts.escrowFactory,
        address: getAddress(manifest.contracts.escrowFactory.address),
      },
    },
    config: {
      ...manifest.config,
      usdc: getAddress(manifest.config.usdc),
      feeRecipient: getAddress(manifest.config.feeRecipient),
    },
  } as DeploymentManifest;
}

function validateTrackedManifests() {
  const entries = Object.entries(manifests) as Array<[DeploymentEnvironment, DeploymentManifest]>;
  return Object.fromEntries(
    entries.map(([environment, manifest]) => [environment, validateDeploymentManifest(manifest, environment)])
  ) as Record<DeploymentEnvironment, DeploymentManifest>;
}

export const validatedDeploymentManifests = validateTrackedManifests();

export function listSupportedDeploymentEnvironments(): DeploymentEnvironment[] {
  return Object.keys(validatedDeploymentManifests) as DeploymentEnvironment[];
}

export function listSupportedManifestChainIds(): number[] {
  return [...new Set(Object.values(validatedDeploymentManifests).map((manifest) => manifest.chain.chainId))].sort(
    (left, right) => left - right
  );
}

export function getDeploymentEnvironment(): DeploymentEnvironment {
  const environment = process.env.DEPLOYMENT_ENV ?? "local";

  if (!(environment in validatedDeploymentManifests)) {
    const supported = listSupportedDeploymentEnvironments().join(", ");
    throw new Error(`Unsupported DEPLOYMENT_ENV "${environment}". Supported environments: ${supported}`);
  }

  return environment as DeploymentEnvironment;
}

export const deploymentEnvironment = getDeploymentEnvironment();

export function getDeploymentManifest(): DeploymentManifest {
  return validatedDeploymentManifests[deploymentEnvironment];
}

export const deploymentManifest = getDeploymentManifest();

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: "${rawValue}"`);
  }

  return parsed;
}

export const backendConfig = {
  port: parsePositiveIntegerEnv("PORT", 4000),
  rpcUrl: process.env.RPC_URL,
  syncIntervalMs: parsePositiveIntegerEnv("SYNC_INTERVAL_MS", 30000),
  deploymentManifest,
} as const;
