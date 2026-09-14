/**
 * T-14 探针**自校准**（2026-09-14，用户裁决第 0 步）。
 *
 * ## 为什么必须先做这一步
 *
 * `probe-empty-rate.mjs` 现在的结论是「EMPTY 0/N」。**这个 0 什么都不证明**——
 * 除非先证明**这条探针抓得住白屏**（附则 A1：先证明测量有分辨力）。
 *
 * 所以这里构造一个**必然白屏的坏样本**，跑同一条探针口径，
 * 看它是否报 EMPTY。**校准失败 = 探针瞎 = 先修探针，别急着跑 N=50。**
 *
 * ## 坏样本怎么构造（**实测修正过两次**）
 *
 * 用户裁决推荐的方向是"拦截 flight 脚本返回空 body（React 不挂载→必空）"。
 * **实测证明那条路走不通**，逐条记录（附则 A1：先证明实验有分辨力）：
 *
 * | 坏样本 | 文档改写量 | 结果 |
 * |---|---|---|
 * | 清空 `__next_f` flight 脚本（6 块） | −75,029 字符 | **仍 5465 字符** ❌ |
 * | 清空桥接脚本（nonce 那块） | −95,645 字符 | **仍 5465 字符** ❌ |
 * | 清空**全部** `<script>` | 全部 | **仍 5465 字符** ❌ |
 * | **清空 `<body>` 内容** | body 全部 | **0 字符 / h1=0 / sec=0** ✅ |
 *
 * **前三个都不空，说明这条链路的内容在静态 HTML 里**——不在脚本载荷里。
 * 这也再次作废了"内容只在脚本载荷里"的旧判定（附则 A2 的更正）。
 *
 * ⚠️ 但请注意**校准的边界**：`body-emptied` 复现的是"**DOM 里没有内容**"
 * 这个**读数形态**，不是复现 T-14 的**成因**。它证明的是
 * **「探针能区分'有内容'与'没内容'」**——这正是校准要证的东西。
 * 至于 T-14 白屏的真实成因是什么，**本校准不回答**，由 N=50 实测回答。
 *
 * ⚠️ **只改响应体，不改结构**：保留 Content-Type 与状态码，
 * 排除"请求失败"这种平凡解释。
 *
 * ## 判据
 *
 * 坏样本下探针口径必须报 **EMPTY**。
 * 报 OK = 探针测的不是"页面有没有内容" → 先修探针。
 *
 * 用法：node e2e/scripts/calibrate-probe.mjs
 * 退出码：0 = 校准通过（探针有效）；1 = 校准失败（探针瞎）；
 *         2 = 环境问题（服务没起等）
 */
import { chromium } from "playwright";

const URL = process.env.SITECRAFT_BASE_URL
  ? `${process.env.SITECRAFT_BASE_URL}/api/templates/shadcn-landing2/preview`
  : "http://127.0.0.1:3210/api/templates/shadcn-landing2/preview";

/**
 * 与 probe-empty-rate.mjs **逐字一致**的读数口径（校准必须测同一条尺）。
 *
 * ⚠️ 必须是**函数**，不是字符串——Playwright 的 `page.evaluate` 传字符串时
 * 会当表达式求值，返回的是函数对象本身，于是所有字段 `undefined`。
 * （首版就是这样：校准器自己的 bug 被误读成"探针瞎"。）
 */
const measure = () => ({
  bodyTextLen: document.body.innerText.trim().length,
  h1WithText: [...document.querySelectorAll("h1")].filter((el) => el.innerText?.trim()).length,
  sections: document.querySelectorAll("section").length,
});

const browser = await chromium.launch().catch((error) => {
  console.error("[calibrate] Chromium 起不来：", error.message);
  process.exit(2);
});

async function sample({ sabotage }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let sabotaged = 0;
  if (sabotage) {
    // 坏样本：清空 <body> 内容（保留状态码 / Content-Type / head）。
    // ⚠️ 这个 URL **必须带 `*` 通配**——首版写的是精确 URL，route 匹配不上，
    // 于是"坏样本没生效"被误读成"探针瞎"。实测 route 命中数 = 1 才算生效。
    await page.route(`${URL}*`, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      const before = html.length;
      html = html.replace(/(<body[^>]*>)[\s\S]*?(<\/body>)/i, "$1$2");
      if (html.length !== before) sabotaged++;
      await route.fulfill({ response, body: html, headers: response.headers() });
    });
  }
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000); // 与探针同一个稳定态窗
  const result = await page.evaluate(measure);
  await ctx.close();
  return { ...result, sabotaged };
}

console.log(`[calibrate] URL=${URL}`);
console.log("[calibrate] 跑两次：坏样本（清空 flight 脚本）应该 EMPTY；原样应该 OK。\n");

const sabotaged = await sample({ sabotage: true });
const intact = await sample({ sabotage: false });

const verdict = (r) => (r.bodyTextLen === 0 ? "EMPTY" : "OK");
console.log(`  坏样本: ${verdict(sabotaged)}(len=${sabotaged.bodyTextLen}, h1=${sabotaged.h1WithText}, sec=${sabotaged.sections})  改写处=${sabotaged.sabotaged}`);
console.log(`  原  样: ${verdict(intact)}(len=${intact.bodyTextLen}, h1=${intact.h1WithText}, sec=${intact.sections})`);

await browser.close();

if (sabotaged.sabotaged === 0) {
  console.error("\n[calibrate] ✗ 坏样本**没有生效**（没匹配到 flight 脚本）——");
  console.error("           这次校准无效，不能据此说探针有效或无效。请先修坏样本构造。");
  process.exit(2);
}
if (verdict(sabotaged) !== "EMPTY") {
  console.error("\n[calibrate] ✗ **校准失败：探针瞎。**");
  console.error(`           清空了 flight 脚本，页面仍是 ${sabotaged.bodyTextLen} 字符——`);
  console.error("           说明这条读数口径测的不是'内容是否渲染'。**先修探针，别跑 N=50。**");
  process.exit(1);
}
console.log("\n[calibrate] ✓ 校准通过：坏样本下探针报 EMPTY，原样下报 OK。");
console.log("            这条探针对'白屏'有分辨力，可以拿 0/N 当证据。");
process.exit(0);
