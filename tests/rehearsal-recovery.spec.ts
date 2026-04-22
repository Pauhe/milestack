import { test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";

test("delegates rehearsal recovery spec to web Playwright project", () => {
  const webDir = path.resolve(process.cwd(), "web");
  const result = spawnSync("npx", ["playwright", "test", "tests/rehearsal-recovery.spec.ts"], {
    cwd: webDir,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
    },
  });

  if (result.status !== 0) {
    throw new Error(`delegated web playwright run failed with exit code ${result.status ?? -1}`);
  }
});
