import { afterEach, describe, expect, it } from "vitest";

import localManifest from "../../../deployments/local/manifest.json";
import rehearsalManifest from "../../../deployments/rehearsal-local/manifest.json";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;
const manifestModulePath = "@/lib/deployment-manifest.ts";

function restoreEnv() {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;
    return;
  }

  process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = ORIGINAL_ENV;
}

afterEach(() => {
  restoreEnv();
});

describe("deployment manifest loader", () => {
  it("defaults to local manifest", async () => {
    delete process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;

    const loader = await import(manifestModulePath);

    expect(loader.getDeploymentEnvironment()).toBe("local");
    expect(loader.getDeploymentManifest()).toEqual(localManifest);
  });

  it("loads rehearsal-local manifest when requested", async () => {
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = "rehearsal-local";

    const loader = await import(manifestModulePath);

    expect(loader.getDeploymentEnvironment()).toBe("rehearsal-local");
    expect(loader.getDeploymentManifest()).toEqual(rehearsalManifest);
  });

  it("throws for unsupported deployment environments", async () => {
    process.env.NEXT_PUBLIC_DEPLOYMENT_ENV = "staging-base-sepolia";

    const loader = await import(manifestModulePath);

    expect(() => loader.getDeploymentManifest()).toThrowError(/Unsupported NEXT_PUBLIC_DEPLOYMENT_ENV/);
  });
});
