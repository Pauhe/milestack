import path from "node:path";
import { defineConfig } from "@playwright/test";

const artifactsRoot = process.env.REHEARSAL_ARTIFACTS_DIR ?? path.resolve("..", "deployments", "rehearsal-local", "browser-evidence");

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.REHEARSAL_WEB_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on",
    screenshot: "off",
    video: "off",
  },
  outputDir: path.join(artifactsRoot, "playwright-output"),
});
