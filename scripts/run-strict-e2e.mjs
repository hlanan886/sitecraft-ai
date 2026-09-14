/**
 * strict 生产形态的 e2e 入口（0.6 第 5 项）。
 *
 * ## 为什么需要单独一个入口
 *
 * 一个 `next start` 进程只能是 strict **或** relaxed——没法在同一服务里两样都测。
 * 而默认全套 e2e 跑 relaxed（e2e helper 不带访问头），所以 strict 的两条
 * spec（`strict-smoke` 与 `access-isolation`）必须**共用一个 strict 服务**跑。
 *
 * ## 与 `run-strict-access.mjs` 的关系
 *
 * 那个脚本先于本文件存在，只跑 `access-isolation.spec.ts`。本脚本把它一起带上
 * ——**两条 spec 都是 strict 专属**，分成两个入口只会让"该跑哪条"变成需要记的事。
 * 旧脚本保留（可能有外部习惯引用），但行为上已被本脚本覆盖。
 *
 * ## 关键：`SITECRAFT_ACCESS_MODE` 必须传进 playwright 进程
 *
 * `playwright.config.ts` 的 `webServer.env` 是 `{ ...process.env, PORT }`，
 * 而 `serve.mjs` 现在**尊重外部显式给的** `SITECRAFT_ACCESS_MODE`
 * （此前它写死 relaxed，把这里传的 strict 无声覆盖掉——见 0.6-1）。
 * 所以本脚本设的 env 会一路到被测服务。
 *
 * ## 顺序（**服务必须由本脚本先起**，2026-09-13 修正）
 *
 * ```
 * 1. 起 strict 服务（复用 e2e/scripts/serve.mjs —— 它就是 playwright 的 webServer）
 * 2. 等服务就绪（curl http://127.0.0.1:3210/）
 * 3. 跑 T-14 间歇率探针 —— EMPTY ≥ 1 即失败退出（**不跑 spec**）
 * 4. 探针通过 → 跑两条 strict spec（`--reuse-existing-server`，接第 1 步那个服务）
 * ```
 *
 * ⚠️ **为什么探针不能放在 playwright 之后**：探针跑的是"冷加载是否白屏"，
 * 它要有一个**已经就绪**的服务；而 playwright 是在它自己启动 webServer 之后
 * 才跑 spec 的——把探针放在 spec 之后，探针就没服务可用（实测：`fetch failed`）。
 *
 * ## T-14 间歇率探针（2026-09-13 用户裁决收编）
 *
 * T-14 是**间歇白屏**（复审实测冷加载 EMPTY 1/20；本脚本实测 2/10），
 * 两条 shadcn-landing2 实例已用 `test.skip` 隔离——而 `test.skip`
 * **失去了"修好自动转红"的拉力**，本探针就是补上的那根绳：
 *
 * - **EMPTY ≥ 1 → 非零退出**：strict 入口失败，且**不启动 playwright**。
 * - 全 OK → 才允许走"探针归零 → 摘 skip"的恢复流程。
 *
 * 次数默认 10（`PROBE_RUNS` 可覆盖）。T-13 修复批做机理调研时用大 N
 * （`PROBE_RUNS=50`）——**一次 10 连的全 OK 不足以摘隔离**。
 *
 * **覆盖开关**：`PROBE_OVERRIDE_REASON="<理由>"` 可越过探针继续跑 spec
 * （T-13 批需要 spec 结果时用）。它**必须写明理由**、会**原样打印**、
 * 且**不表示 T-14 已修**——默认行为永远是"EMPTY≥1 → 失败"。
 *
 * ⚠️ **禁止用"全套 e2e 绿"反推 T-14 已修**：104 条里 5% 空页大概率撞不上，
 * 绿是幸存者偏差。这里才是判据。
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const playwrightCli = resolve("node_modules/playwright/cli.js");
const serveScript = resolve("e2e/scripts/serve.mjs");
const probeScript = resolve("e2e/scripts/probe-empty-rate.mjs");
const READY_URL = "http://127.0.0.1:3210/";

/**
 * ⚠️ **spec 参数的匹配方式**（2026-09-13 两轮实测更正）。
 *
 * playwright 把 CLI 参数当**正则**去匹配测试文件路径，但匹配串是**相对
 * `testDir`** 的（本仓库 `testDir: "./e2e"`，所以是 `specs\strict-smoke.spec.ts`）。
 *
 * 试过并**否决**的写法：
 *
 * | 写法 | 结果 |
 * |---|---|
 * | `e2e/specs/strict-smoke.spec.ts`（仓库根相对） | 包成 `**\/e2e/specs/...` → 匹配不到（旧脚本的写法，**从未真正跑起来过**） |
 * | `specs/strict-smoke.spec.ts`（testDir 相对，cwd 在根） | 包成 `**\/specs/...`，分隔符对不上 `\` → 匹配不到 |
 * | `cwd: e2e/` + `specs/...` | 能匹配到，但 `playwright.config.ts` 在仓库根找不到了 → baseURL/webServer 全丢，报 `Invalid URL` |
 * | `strict-smoke\.spec\.ts`（带转义的反斜杠） | 直接传能命中，但**经 npm/环境变量传参时反斜杠被吞** → 匹配不到 |
 * | ✅ **`strict-smoke.spec`（纯文件名子串，无反斜杠）** | `**\/strict-smoke.spec` 匹配 `specs\strict-smoke.spec.ts` → 稳定命中，config 也在 |
 *
 * **最终用纯文件名子串**：不含任何路径分隔符与转义字符，
 * 从命令行、npm script、环境变量哪条路传都不变形——这是实测踩了四轮后的选择。
 */
const specs = ["strict-smoke.spec", "access-isolation.spec"];

/** 1. 起 strict 服务——与 playwright 的 webServer 是同一条 `serve.mjs`，行为一致。 */
const server = spawn(process.execPath, [serveScript], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...process.env, SITECRAFT_ACCESS_MODE: "strict" },
});
server.once("error", (error) => {
  console.error("[strict] 被测服务起不来：", error.message);
  process.exit(2);
});

let serverExited = false;
server.once("exit", (code) => {
  serverExited = true;
  if (code !== 0 && code !== null) {
    console.error(`[strict] 被测服务提前退出（code=${code}）`);
    process.exit(code);
  }
});

/** 2. 等服务就绪：轮询 ≤120s（`serve.mjs` 内部已含 postgres/构建/启动）。 */
async function waitForReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverExited) return false;
    try {
      const response = await fetch(READY_URL, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return true;
    } catch {
      // 服务还没起来，继续等。
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

/** 收工：把服务关掉，别留 3210 残进程（复审踩过：残留进程会让下一次测量测错对象）。 */
function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
  setTimeout(() => { if (!server.killed) server.kill("SIGKILL"); }, 5_000).unref?.();
}

if (!await waitForReady()) {
  console.error(`[strict] 被测服务 ${READY_URL} 未在 120s 内就绪。`);
  stopServer();
  process.exit(2);
}
console.log("[strict] 被测服务已就绪（strict）。");

/** 3. 探针：需要服务在场——所以必须在 playwright **之前**跑。 */
const probeCode = await new Promise((resolvePromise) => {
  const runs = process.env.PROBE_RUNS || "10";
  console.log(`[strict] T-14 间歇率探针：${runs} 次冷加载（EMPTY ≥ 1 即失败）`);
  const probe = spawn(process.execPath, [probeScript, runs], { cwd: process.cwd(), stdio: "inherit" });
  probe.once("error", (error) => {
    console.error("[strict] 探针进程起不来：", error.message);
    resolvePromise(2);
  });
  probe.once("exit", (code) => resolvePromise(code ?? 2));
});

if (probeCode !== 0) {
  /**
   * ⚠️ **覆盖开关**（2026-09-13 用户裁决保留，附三道护栏）：
   *
   * T-13 修复批（机理调研）需要 strict spec 本身的结果，而 T-14 未修的当下
   * 探针按设计必红。设 `PROBE_OVERRIDE_REASON="…"` 可越过探针。
   *
   * **三道护栏（缺一不可）**：
   *
   * 1. **理由必填且原样打印**——空值/纯空白一律**拒绝**（不是"默认通过"），
   *    理由连同时刻、探针退出码一起写进运行日志，事后可查是谁、为什么越过。
   * 2. **开关存在期以 T-13 为限**——T-13 修复（探针能归零）之后，
   *    **本开关连同这段分支一并撤销**，不留"习惯性覆盖"的口子。
   * 3. **注释即警示**：它是 T-13 批的临时取证通道，**不是默认操作路径**——
   *    任何"跑不过就加个 reason"的用法都与设立它的目的相反。
   *
   * 覆盖**不改变**探针自己的退出码语义，也**不表示 T-14 已修**。
   */
  const reason = process.env.PROBE_OVERRIDE_REASON?.trim();
  if (!reason) {
    console.error(
      `[strict] T-14 探针未通过（退出码 ${probeCode}）——隔离是**有意的**，`
      + "本入口按设计失败，不跑 spec（跑 spec 也测不出间歇）。\n"
      + "[strict] 修复流程：T-13 修好 → `PROBE_RUNS=50 npm run test:e2e:strict` "
      + "探针归零 → 再摘 skip。\n"
      + "[strict] 仅当你是 T-13 批、确实需要 spec 本身的结果时，才可用 "
      + "`PROBE_OVERRIDE_REASON=\"<理由>\"` 显式越过（理由必填，会原样记录）。",
    );
    stopServer();
    process.exit(probeCode === 2 ? 2 : 1);
  }
  // 护栏 1：留痕——理由 + 时刻 + 探针码，一行可 grep（OVERRIDE-AUDIT）。
  console.warn(
    `[strict] OVERRIDE-AUDIT ts=${new Date().toISOString()} probeExit=${probeCode} `
    + `reason=${JSON.stringify(reason)}`,
  );
  console.warn(
    "[strict] ⚠️ 已越过 T-14 探针——**人工覆盖，不表示 T-14 已修**；隔离仍在，摘 skip 前必须探针归零。\n"
    + "[strict] ⚠️ 本开关仅限 T-13 批取证用（修复后即撤销），**不得作为默认操作路径**。",
  );
}

/** 4. 探针通过才跑 spec——复用第 1 步的服务（否则 playwright 会因 3210 被占而拒绝起新服务）。 */
console.log(`[strict] 跑 spec：cwd=${process.cwd()} args=${JSON.stringify(specs)}`);
const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...specs],
  {
    // cwd 必须是**仓库根**：`playwright.config.ts` 在这里，
    // 换目录会让 baseURL/webServer 全部丢失（实测报 `Invalid URL`）。
    cwd: process.cwd(),
    stdio: "inherit",
    // SITECRAFT_ACCESS_MODE=strict：
    //   - `serve.mjs` 据此起 strict 服务；
    //   - `playwright.config.ts` 据此**条件放行** testIgnore 里的两条 strict spec
    //     （CLI 文件名参数不会穿透 testIgnore——实测）。
    // PW_REUSE_EXISTING_SERVER=1：复用本脚本第 1 步起的服务
    // （默认配置仍是 false——端口被占就失败，见 playwright.config.ts 注释）。
    env: { ...process.env, SITECRAFT_ACCESS_MODE: "strict", PW_REUSE_EXISTING_SERVER: "1" },
  },
);
child.once("exit", (code) => {
  stopServer();
  process.exit(code ?? 1);
});
