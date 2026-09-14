/**
 * B5 · 真机证据采集（证据脚本，不是测试）。
 *
 * ## 它采什么
 *
 * 用户要的「真机步骤叙事样张」——**真实浏览器**里跑一次生成，
 * 记录"当前动作"那一行在等待期的**全部文案变化**，并逐条截图。
 *
 * ## 它不是什么
 *
 * **不是回归网，不进 `npm test` / `npx playwright test` 的默认套件。**
 * 它是 `e2e/specs/*.spec.ts` 之外的独立脚本，因为它**故意依赖 mock**
 * （见下），把"证据采集"和"门禁"分开——混在一起就会出现
 * `coverage-probe` 那种"零断言却算门禁"的假门禁。
 *
 * ## 为什么用 mock 而不是真实模型
 *
 * 真实模型调用**要花钱、耗时长、结果不可复现**，而本脚本要证明的是
 * **「界面能不能逐事件把叙事渲染出来」**——这是前端行为，与模型输出质量无关。
 * mock 反而更严格：它**精确控制事件到达的节奏**（逐块 260ms），
 * 真实模型给不出这种确定性。
 *
 * ⚠️ 所以 **mock 模式**的样张证明的是"**前端叙事链路**"，**不是**"真实模型下的观感"。
 * 后者用**真实模式**跑（见下），会真实花钱，故**不自动执行**。
 *
 * ## 两种模式
 *
 * | 模式 | 命令 | 打真实模型？ | 花不花钱 |
 * |---|---|---|---|
 * | **mock（默认）** | `node e2e/scripts/capture-streaming-narrative.mjs` | 否 | 否 |
 * | **真实链路** | `SITECRAFT_REAL=1 node e2e/scripts/capture-streaming-narrative.mjs` | **是** | **是** |
 *
 * 真实模式**不打任何 mock**，直接走 `/api/sites/demo/generate` → 编排层 → 模型。
 * 前置（缺一不可）：
 *   1. `.env.local` 里配好模型密钥（`DEEPSEEK_API_KEY` 或 `DASHSCOPE_API_KEY`，以仓库现行为准）；
 *   2. 一个**不再被 mock 覆盖**的 base URL——脚本会跳过所有 `page.route`/`fetch` 覆写；
 *   3. 一个跑着的服务（`node e2e/scripts/serve.mjs`，它会保证构建新鲜）；
 *   4. **成本确认**：这会真实调用模型一次（约 30–120 秒、按 token 计费）。
 *
 * 真实模式的价值：证明"**真实模型的事件节奏下**，界面同样逐条叙事"——
 * mock 模式给不了这个（它的事件节奏是我写死的）。两者互补，别互相替代。
 *
 * 用法：node e2e/scripts/capture-streaming-narrative.mjs
 * 产物：test-results/b5-narrative/*.png + 控制台逐条叙事
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.SITECRAFT_BASE_URL ?? "http://127.0.0.1:3210";
const OUT = "test-results/b5-narrative";
const STEP_INTERVAL_MS = 700; // 比 e2e 慢一些，让样张更接近真实观感

const INTENT = {
  businessType: "manufacturing",
  companyName: "澄明工业",
  industry: "工业自动化",
  targetAudience: "overseasB2b",
  tone: "professional",
  coreSections: ["about", "features", "services", "products", "contact"],
  recommendedTemplateId: "forge",
  summary: "面向海外企业客户的工业自动化官网",
  status: "ready",
  notices: [], needsInfo: [], conflicts: [], limits: [],
};

/**
 * 逐块推送的 execute 事件序列。
 * 文案与真实 `lib/site-generator.ts` 的 `reportProgress` 口径一致
 * （见 `GenerationProgress`），让样张反映真实观感。
 */
const STREAM_STEPS = [
  { type: "status", value: "正在复用模板结构，并行填充首屏和板块内容…", phase: "content", completedSections: [], activeSections: ["hero", "about", "features", "services", "contact"], recoveringSections: [], failedSections: [] },
  { type: "status", value: "正在写首屏与「关于」…", phase: "content", completedSections: [], activeSections: ["hero", "about"], recoveringSections: [], failedSections: [] },
  { type: "status", value: "首屏已就位，正在写「优势」「服务」…", phase: "content", completedSections: ["hero"], activeSections: ["about", "features", "services"], recoveringSections: [], failedSections: [] },
  { type: "content_delta", chars: 412, sections: ["about"], preview: "公司成立于 2012 年，专注工业自动化" },
  { type: "status", value: "「关于」「优势」已完成，正在写「服务」「产品」…", phase: "content", completedSections: ["hero", "about", "features"], activeSections: ["services", "products"], recoveringSections: [], failedSections: [] },
  { type: "content_delta", chars: 986, sections: ["services", "products"], preview: "从方案设计到现场调试，交付周期约 6-8 周" },
  { type: "status", value: "正在校验内容并保存到模板草稿…", phase: "saving", completedSections: ["hero", "about", "features", "services", "products", "contact"], activeSections: [], recoveringSections: [], failedSections: [] },
  { type: "done", status: "applied", partial: false, missingSections: [], draft: { revision: 1 } },
];

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

const REAL = process.env.SITECRAFT_REAL === "1";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 采集器：两种模式都要（真实模式更需要——它的节奏不可预测）
  await page.addInitScript(() => {
    const observed = [];
    window.__observed = observed;
    let last = null;
    const sample = () => {
      const nodes = document.querySelectorAll(".generate-steps > .step");
      const el = nodes[nodes.length - 1];
      const t = el?.textContent?.trim();
      if (t && t !== last) { last = t; observed.push({ at: Date.now(), text: t }); }
    };
    const start = () => new MutationObserver(sample).observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start);
  });

  if (!REAL) {
  // ── mock 模式：analyze 一次性返回，execute 逐块推送 ──────────────────
  // analyze：一次性返回即可（本脚本只采 execute 的叙事）
  await page.route("**/api/sites/demo/generate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.step !== "analyze") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: sse([
        { type: "status", value: "正在理解你的需求…" },
        { type: "done", status: "ready", intent: INTENT, siteLanguage: "zh",
          template: { id: "forge", name: "Forge", category: "制造业", reason: "适合强调工业实力" },
          hiddenSections: [] },
      ]),
    });
  });

  // execute：逐块推送
  await page.addInitScript(({ steps, interval }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let body;
      try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { body = undefined; }
      if (!/\/api\/sites\/[^/]+\/generate$/.test(url) || body?.step !== "execute") return nativeFetch(input, init);
      const enc = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          steps.forEach((step, index) => {
            setTimeout(() => {
              try { controller.enqueue(enc.encode(`data: ${JSON.stringify(step)}\n\n`)); } catch { /* 已取消 */ }
              if (index === steps.length - 1) { try { controller.close(); } catch { /* 已关 */ } }
            }, interval * (index + 1));
          });
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    };
  }, { steps: STREAM_STEPS, interval: STEP_INTERVAL_MS });
  } // ── mock 模式结束；REAL 模式下不注册任何路由/覆写 ──

  await page.goto(`${BASE}/generate`);
  await page.locator(".generate-textarea").first().fill("工业自动化官网，面向海外客户");
  await page.locator(".generate-input .primary-button").click();
  await page.locator(".generate-confirm").waitFor({ timeout: REAL ? 90_000 : 30_000 });
  await page.getByRole("button", { name: /用此模板生成站点内容/ }).click();
  await page.getByRole("progressbar", { name: "建站进度" }).waitFor({ timeout: 30_000 });

  // 截图直到进度视图消失（真实模式给足 180s）
  const shots = [];
  const maxShots = REAL ? 120 : STREAM_STEPS.length + 4;
  for (let i = 0; i < maxShots; i += 1) {
    const visible = await page.locator(".generate-progress-view").isVisible().catch(() => false);
    if (!visible) break;
    const file = `${OUT}/narrative-${String(i + 1).padStart(2, "0")}.png`;
    await page.screenshot({ path: file });
    shots.push(file);
    await page.waitForTimeout(STEP_INTERVAL_MS);
  }
  await page.locator(".generate-progress-view").waitFor({ state: "detached", timeout: REAL ? 180_000 : 30_000 }).catch(() => {});

  const observed = await page.evaluate(() => window.__observed ?? []);
  const t0 = observed[0]?.at ?? 0;

  console.log(`\n=== B5 真机叙事样张（${REAL ? "真实模型事件源" : "mock 事件源"}，真实浏览器渲染）===\n`);
  observed.forEach((o, i) => {
    console.log(`  ${String(i + 1).padStart(2, "0")}  +${String(o.at - t0).padStart(5, " ")}ms  ${o.text}`);
  });
  console.log(`\n  文案变化次数: ${observed.length}（不同文案 ${new Set(observed.map((o) => o.text)).size} 种）`);
  console.log(`  截图: ${shots.length} 张 → ${OUT}/`);
  if (REAL) {
    console.log("  ✅ 真实模型事件源——这是 B5 验收的最后一项。\n");
  } else {
    console.log(`  ⚠️ 事件源是 mock（逐块 ${STEP_INTERVAL_MS}ms）；证明的是前端叙事链路，不是真实模型观感。`);
    console.log("    真实链路请跑：SITECRAFT_REAL=1 node e2e/scripts/capture-streaming-narrative.mjs\n");
  }

  await browser.close();
}

main().catch((error) => {
  console.error("采集失败:", error);
  process.exit(1);
});
