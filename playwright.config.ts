import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:3210",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "node e2e/scripts/serve.mjs",
    url: "http://127.0.0.1:3210/",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { ...process.env, PORT: "3210" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
