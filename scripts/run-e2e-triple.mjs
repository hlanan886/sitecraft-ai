/**
 * 全套 e2e 3 连跑（0.6 关账标准动作），**每次运行保留独立现场**。
 *
 * ## 为什么不能用 `for i in 1 2 3; do npx playwright test; done`
 *
 * playwright 默认每次运行**开头清空 `test-results/`**（`preserveOutputDir: false`，
 * 见 `node_modules/playwright/lib/runner/index.js` 的 `createRemoveOutputDirsTask`）。
 * 后果：**只有最后一次运行的失败现场还在**——间歇失败（如本轮 RUN2 的
 * `templates.spec.ts:190`）的截图/trace/error-context 会被 RUN3 覆盖掉，
 * 事后再也查不了。**"复现不了"往往不是缺陷的性质，而是证据没保存。**
 *
 * 所以每轮用 `--output=<独立目录>`，并在轮间**不清空**：
 *
 * ```
 * node scripts/run-e2e-triple.mjs           # 3 轮，产物在 test-results/run-1..3/
 * node scripts/run-e2e-triple.mjs 5         # 轮数可覆盖
 * ```
 *
 * 每轮结束打印 `RUN n: passed/skipped/failed`，**总退出码 = 任一轮有 failed 则非零**。
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import net from "node:net";

const playwrightCli = resolve("node_modules/playwright/cli.js");
const runs = Number(process.argv[2] || 3);

/**
 * 开跑前先查 3210（2026-09-13 血的教训）。
 *
 * ## 为什么必须有这道预检
 *
 * 端口被第三方占着时，playwright 会**先跑完前 N 条用例**、跑到 `webServer` 启动
 * 那段才报 `… is already used`——而 reporter 把它记成**一堆用例失败**。
 * 于是"环境脏"被伪装成"代码坏"，白白定性一轮（本轮真事：RUN1 七条
 * `connect ECONNREFUSED` + RUN2/3 直接端口冲突，浪费一次 3 连跑）。
 *
 * ## 那个第三方进程通常是我自己留下的
 *
 * `serve.mjs` 是**两层结构**（node serve.mjs → node next start）。
 * `pkill -f serve.mjs` 只命中**外层的包装进程**，内层的 `next start`
 * 会变成孤儿继续 LISTEN 在 3210——这就是本轮脏环境的来源。
 * 正确清理：先 `taskkill` 内层（或按端口 pid），确认 3210 空了再跑。
 */
async function portInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1_500);
    socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
    socket.once("timeout", () => { socket.destroy(); resolvePromise(false); });
    socket.once("error", () => resolvePromise(false));
  });
}

if (await portInUse(3210)) {
  console.error(
    "[triple] 开跑前预检失败：3210 已被占用——环境是脏的，先清干净再跑。\n"
    + "[triple] 清法（Git Bash）：pid=$(netstat -ano | grep ':3210' | grep LISTENING | awk '{print $NF}') "
    + "&& cmd //c \"taskkill /PID $pid /F\"\n"
    + "[triple] ⚠️ `pkill -f serve.mjs` 不够：serve.mjs 派的 `next start` 会变孤儿继续占端口。\n"
    + "[triple] 不预检会怎样：playwright 先跑几十条用例、再在 webServer 处报错，"
    + "reporter 把它记成用例失败——**环境问题伪装成代码问题**。",
  );
  process.exit(2);
}

const results = [];
for (let i = 1; i <= runs; i++) {
  const outputDir = resolve(`test-results/run-${i}`);
  console.log(`\n===== RUN ${i}/${runs}（产物保留在 ${outputDir}）=====`);
  const code = await new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--reporter=list", `--output=${outputDir}`],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        // JSON 报告也落在该轮自己的目录里（见 playwright.config.ts 的 PW_OUTPUT_DIR）——
        // 否则 run-2 会覆盖 run-1 的 results.json，3 连跑就没法逐轮复算了。
        env: { ...process.env, PW_OUTPUT_DIR: outputDir },
      },
    );
    child.once("error", () => resolvePromise(2));
    child.once("exit", (c) => resolvePromise(c ?? 1));
  });
  results.push({ run: i, code, outputDir });
}

console.log("\n===== 3 连跑汇总 =====");
for (const r of results) {
  console.log(`RUN ${r.run}: exit=${r.code}  产物=${r.outputDir}`);
}
const failedRuns = results.filter((r) => r.code !== 0);
if (failedRuns.length > 0) {
  console.error(
    `\n[triple] ${failedRuns.length}/${runs} 轮有失败——**逐条定性，不许直接重跑蒙混**。\n`
    + `[triple] 失败现场在各轮独立目录下（截图/trace/error-context 都在），别在下一轮跑之前删。`,
  );
  process.exit(1);
}
console.log(`\n[triple] ${runs}/${runs} 轮 0 failed。`);
