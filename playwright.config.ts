const config = {
  testDir: "./tests",
  testMatch: ["**/*.spec.ts"],
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
  outputDir: "./test-results/playwright-root-output",
};

export default config;
