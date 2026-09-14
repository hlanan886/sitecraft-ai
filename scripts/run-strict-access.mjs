// E-021 验收：strict 访问上下文（Playwright 服务需在 strict 模式下启动）
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const playwrightCli = resolve("node_modules/playwright/cli.js");
const child = spawn(process.execPath, [playwrightCli, "test", "e2e/specs/access-isolation.spec.ts"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...process.env, SITECRAFT_ACCESS_MODE: "strict" },
});
child.once("exit", (code) => process.exit(code ?? 1));
