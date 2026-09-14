import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 让**测试进程**拿到与**被测服务**同一份环境（T-7 最小修，2026-09-12）。
 *
 * ## 为什么必须在 config 里做，而不是各 spec 里做
 *
 * Playwright 会**先加载 config、再加载每个 spec**，所以在 config 顶部加载一次，
 * 之后所有 spec（以及它们 import 的 `lib/*`）看到的 `process.env` 都是这一份。
 * 放在 spec 里则会**晚于** spec 顶部的 `import`——而 ESM 的 import 求值在前，
 * 那正是本轮踩过的坑（见 `tests/site-store-op-rename.test.ts` 的注释）。
 *
 * ## 修的是什么
 *
 * e2e 里有 spec **直接 import `lib/site-store`** 并在测试进程里调用
 * （`workspace.spec.ts` 的 `commitOperations`）。此前测试进程没加载 `.env`：
 *
 * ```
 * NODE_ENV = production          ← Playwright 会设
 * SITE_STORE = undefined         ← .env 没被加载
 * DATABASE_URL 端口 = (未设置)
 * → getSite 直接抛：DATABASE_URL 未配置，生产环境不会退回本地文件存储。
 * ```
 *
 * 于是测试进程连不上任何库，`await commitOperations(...)` **从未生效**——
 * 而失败伪装成 UI 问题（页面说"没有可撤销的 AI 修改"）。**登记为 T-7。**
 *
 * ## 为什么按 `.env.local` → `.env` 这个顺序
 *
 * 与 Next 的**加载顺序**一致（`.env.local` 优先于 `.env`）。
 * ⚠️ `process.loadEnvFile` **不覆盖已存在的变量**，所以：
 *  - CLI 显式传的 `E2E_STORE` / `DATABASE_URL` 仍然是最高优先级（不会被文件盖掉）；
 *  - 两个文件**同值的键**（如 `DATABASE_SSL=false`）不会因顺序产生差异；
 *  - `serve.mjs` 给被测进程的显式注入在**子进程**里做，也不受影响。
 * 将来若出现两文件**不同值**的键，这里的顺序就是错的——所以 `DATABASE_URL` 的
 * 一致性由下面那条断言钉住（**断言失败即红，不静默**）。
 */
const repoRoot = __dirname;

/**
 * ① 先记住 CLI 显式传的值（`process.loadEnvFile` **不覆盖**已存在变量，
 *    所以 CLI 传的本来就是最高优先级）。
 */
const cliDatabaseUrl = process.env.DATABASE_URL?.trim();

/** ② 加载 `.env.local` → `.env`（与 Next 的顺序一致），补齐池大小等非连接类配置。 */
for (const file of [".env.local", ".env"]) {
  const full = path.join(repoRoot, file);
  if (existsSync(full)) process.loadEnvFile(full);
}

/**
 * ③ **覆盖**连接串，让它与 `serve.mjs` 给被测进程的那一份**同源**。
 *
 * 这一步是本修的核心，也是唯一能让两边一致的做法：
 *
 * - 被测服务（`next start`）的连接串由 `serve.mjs` 用 `resolveServerEnv()` 注入
 *   → 指向 `resolvePostgresPort()`；
 * - 而 `.env.local` 里的 `DATABASE_URL` 指向 **5432**，它**不等同于** compose 实际
 *   映射的 5433（本机 5432 还拒连）。第一次修只加载了 `.env`，于是测试进程
 *   连 5432、被测服务连 5433——**修完仍然不同库**，实测报
 *   `connect ECONNREFUSED 127.0.0.1:5432`。
 *
 * 只加载文件是不够的：**连接串必须由"e2e 实际起了哪个库"来定，而不是由 `.env` 定。**
 * （这也是 `pg-target.mjs` 里那条"端口不读 DATABASE_URL"的同一条原则。）
 */
/**
 * ⚠️ 用 CJS `require` 而不是 `import()`：Playwright 把本文件当 **CJS** 加载
 * （实测 `SyntaxError: await is only valid in async functions`），顶层 await 不可用；
 * 而 `createRequire` 能同步加载那个 ESM 文件（Node 24 支持 require(esm)）。
 */
const { createRequire } = require("node:module");
const requireEsm = createRequire(__filename);
const { resolveServerEnv, resolvePostgresPort } = requireEsm("./e2e/scripts/pg-target.mjs");

if (!cliDatabaseUrl) {
  const serverEnv = resolveServerEnv(process.env);
  if (serverEnv.DATABASE_URL) {
    process.env.DATABASE_URL = serverEnv.DATABASE_URL;
    process.env.SITE_STORE = serverEnv.SITE_STORE;
  } else {
    // 文件后端模式：把连接串清掉，让 store 判定落到文件（否则会去连那个不通的 5432）。
    delete process.env.DATABASE_URL;
    process.env.SITE_STORE = "file";
  }
}

/**
 * ④ 同库断言：测试进程与被测服务必须连同一个库。
 * 不一致就**当场报错**——否则断言会以 UI 症状失败（本轮就是这么被藏了一整轮）。
 */
if (process.env.E2E_STORE !== "file") {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "e2e 需要 DATABASE_URL（文件后端请设 E2E_STORE=file）。见 glossary T-7。",
    );
  }
  const actualPort = Number(new URL(url).port || 5432);
  const expectedPort = resolvePostgresPort();
  if (actualPort !== expectedPort) {
    throw new Error(
      `测试进程的库端口(${actualPort}) 与 compose 映射(${expectedPort}) 不一致——`
      + "两边会连不同的库，断言将以 UI 症状失败。见 glossary T-7。",
    );
  }
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // 诊断/探针类 spec 不参与默认回归（需显式指定文件或 --grep 运行）：
  // coverage-probe 只打印证据无断言；real-template-export 依赖外网上游。
  //
  // 注意：`coverage-scan.spec.ts` **不再**排除（2026-09-09）——它此前既零断言又被
  // testIgnore 排除，等于「模板门禁」根本不存在，却让 P2.5/P4 的「过门禁」看起来成立。
  // 现在它有真断言（必需槽位全覆盖 + 零 demo 残留），必须跑。
  //
  // ---------------------------------------------------------------------------
  // ⚠️ **零断言探针 → 不进验收分母**（2026-09-13）
  //
  // 下面这些 spec **一条 `expect()` 都没有**，只 `console.log` 证据。
  // 它们留在仓库里是有价值的（排查/复验要用），但**不能进全套的分母**——
  // 否则 N 条 `passed` 里混着 N 条"什么都没断言"，正是本项目反复吃亏的
  // "假门禁 / 看似在测实则没测"家族的入口。
  //
  // | spec | 手工运行 | 服务哪个 T 号 |
  // |---|---|---|
  // | `coverage-probe.spec.ts` | `npx playwright test e2e/specs/coverage-probe.spec.ts` | 槽位覆盖诊断 |
  // | `clickable-asset-probe.spec.ts` | 同上（换文件名） | **T-15**（主视觉可点比例） |
  // | `shadcn-diag2.spec.ts` | 同上 | **T-14**（CSP 白屏：顶层 vs iframe） |
  // | `shadcn-diag3.spec.ts` | 同上 | **T-14**（iframe body 实况） |
  // | `flash-diag.spec.ts` | 同上 | 预览重挂载时序 |
  // | `dev-diff.spec.ts` | 同上 | 开发态差异诊断 |
  //
  // 手工运行都**需要服务在场**（`node e2e/scripts/serve.mjs`，或让 playwright
  // 自己起 `webServer`——直接用 `npx playwright test <file>` 即可）。
  // ---------------------------------------------------------------------------
  //
  // ---------------------------------------------------------------------------
  // ⚠️ 下面两条是 **strict 专属** spec（2026-09-13 移出默认全套）
  //
  // **它们在哪跑**（用户 2026-09-13 裁决的强制护栏：挪出默认全套必须交代去向）：
  //
  //     入口：`npm run test:e2e:strict`（→ `scripts/run-strict-e2e.mjs`）
  //     命令：`npm run test:e2e:strict`
  //     机制：该脚本以 `SITECRAFT_ACCESS_MODE=strict` 起 playwright，
  //           `serve.mjs` 现在**尊重外部显式给的模式**（否则按 relaxed），
  //           于是被测服务真跑在 strict 下。
  //
  // **为什么必须移出**：一个 `next start` 进程只能是 strict **或** relaxed。
  // 默认全套为了不带访问头的普通 spec 跑 relaxed，而这两条断言的是
  // 「strict 下缺头必须 401」——**在 relaxed 服务上必然失败**。
  // 它们此前混在默认全套里长期红着，被当成"环境噪声"（同族第 6 次：
  // 看似在测、实则测不了）。移出**不等于**不跑，见上面的入口与命令。
  //
  // ⚠️ **条件化排除（2026-09-13 实测补丁）**：`testIgnore` **不会被 CLI 的
  //    文件名参数穿透**——`npx playwright test strict-smoke.spec.ts` 在排除生效时
  //    仍然 "No tests found"（本轮实测：strict 入口此前**从未真正跑起来过**，
  //    队列里那句"8 passed"无法复现）。
  //    所以当这次运行**显式声明 strict** 时，排除的条件就不成立了（排除的理由
  //    是"relaxed 服务上必红"）——这正是 `serve.mjs` 同一条「外部显式给了就尊重」
  //    原则的延伸。默认（未声明 strict）仍然排除。
  // ---------------------------------------------------------------------------
  testIgnore: [
    "**/coverage-probe.spec.ts",
    "**/clickable-asset-probe.spec.ts", // T-15：主视觉可点比例
    "**/shadcn-diag2.spec.ts", // T-14：CSP 白屏（顶层 vs iframe）
    "**/shadcn-diag3.spec.ts", // T-14：iframe body 实况
    "**/flash-diag.spec.ts", // 预览重挂载时序
    "**/dev-diff.spec.ts", // 开发态差异诊断
    "**/real-template-export.spec.ts", // 依赖外网上游
    ...(process.env.SITECRAFT_ACCESS_MODE === "strict" ? [] : [
      "**/strict-smoke.spec.ts", // → npm run test:e2e:strict
      "**/access-isolation.spec.ts", // → npm run test:e2e:strict
    ]),
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    // 每轮独立产物目录时 results.json 也跟着进去（run-1/2/3 各自一份），
    // 否则第二轮会覆盖第一轮——"3 连跑"的可审计性就没了（2026-09-13）。
    ["json", { outputFile: `${process.env.PW_OUTPUT_DIR ?? "test-results"}/results.json` }],
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
    //
    // ⚠️ **唯一的例外通道（2026-09-13）**：`scripts/run-strict-e2e.mjs` 需要
    // **自己先起服务**（它要在 playwright 之前跑 T-14 间歇率探针，探针必须有
    // 服务在场），于是 playwright 会发现 3210 已被占。它通过显式环境变量
    // `PW_REUSE_EXISTING_SERVER=1` 打开复用——**默认永远是 false**，
    // 因为那条通道的风险（跑到别的代码上）由调用方显式承担，不静默发生。
    reuseExistingServer: process.env.PW_REUSE_EXISTING_SERVER === "1",
    env: { ...process.env, PORT: "3210" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
