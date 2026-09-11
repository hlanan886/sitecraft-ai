import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // 诊断/探针类 spec 不参与默认回归（需显式指定文件或 --grep 运行）：
  // coverage-probe / coverage-scan 只打印证据无断言；real-template-export 依赖外网上游。
  testIgnore: [
    "**/coverage-probe.spec.ts",
    "**/coverage-scan.spec.ts",
    "**/real-template-export.spec.ts",
  ],
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
    // 复用旧服务会让验收跑到另一份代码；端口被占用时应直接失败。
    reuseExistingServer: false,
    env: { ...process.env, PORT: "3210" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
