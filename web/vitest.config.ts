import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**", "node_modules/**", "dist/**", ".next/**", "coverage/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "node_modules/**",
        "dist/**",
        ".next/**",
      ],
      all: true,
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
