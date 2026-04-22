import assert from "node:assert/strict";
import test from "node:test";

import localManifest from "../../deployments/local/manifest.json" with { type: "json" };
import rehearsalManifest from "../../deployments/rehearsal-local/manifest.json" with { type: "json" };

import { validateDeploymentManifest } from "./config.js";

const ORIGINAL_ENV = process.env.DEPLOYMENT_ENV;

function restoreEnv() {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.DEPLOYMENT_ENV;
    return;
  }

  process.env.DEPLOYMENT_ENV = ORIGINAL_ENV;
}

test.afterEach(async () => {
  restoreEnv();
});

test("getDeploymentManifest defaults to local manifest", async () => {
  delete process.env.DEPLOYMENT_ENV;

  const config = await import(`./config.js?case=default-${Date.now()}`);

  assert.equal(config.getDeploymentEnvironment(), "local");
  assert.deepEqual(config.getDeploymentManifest(), localManifest);
});

test("getDeploymentManifest resolves rehearsal-local manifest explicitly", async () => {
  process.env.DEPLOYMENT_ENV = "rehearsal-local";

  const config = await import(`./config.js?case=rehearsal-${Date.now()}`);

  assert.equal(config.getDeploymentEnvironment(), "rehearsal-local");
  assert.deepEqual(
    config.getDeploymentManifest(),
    validateDeploymentManifest(rehearsalManifest as typeof localManifest, "rehearsal-local")
  );
});

test("getDeploymentManifest rejects unsupported deployment environment", async () => {
  process.env.DEPLOYMENT_ENV = "staging-base-sepolia";

  await assert.rejects(
    () => import(`./config.js?unsupported=${Date.now()}`),
    /Unsupported DEPLOYMENT_ENV/
  );
});

test("backendConfig rejects non-positive integer env overrides", async () => {
  process.env.SYNC_INTERVAL_MS = "0";

  await assert.rejects(
    () => import(`./config.js?bad-sync-interval=${Date.now()}`),
    /SYNC_INTERVAL_MS must be a positive integer/
  );

  delete process.env.SYNC_INTERVAL_MS;
  process.env.PORT = "not-a-number";

  await assert.rejects(
    () => import(`./config.js?bad-port=${Date.now()}`),
    /PORT must be a positive integer/
  );

  delete process.env.PORT;
});

test("validateDeploymentManifest rejects manifest/environment mismatch", () => {
  assert.throws(
    () => validateDeploymentManifest(localManifest, "rehearsal-local"),
    /environment mismatch/
  );
});

test("validateDeploymentManifest rejects malformed critical fields", () => {
  const malformed = {
    ...localManifest,
    contracts: {
      ...localManifest.contracts,
      escrowFactory: {
        ...localManifest.contracts.escrowFactory,
        address: "not-an-address",
      },
    },
  };

  assert.throws(
    () => validateDeploymentManifest(malformed as typeof localManifest, "local"),
    /contracts\.escrowFactory\.address/
  );
});
