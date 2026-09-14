/**
 * T-14 间歇率探针（复审方 2026-09-13 建，用户裁决收编进 strict 入口）。
 *
 * ## 它解决什么问题
 *
 * T-14 是**间歇缺陷**（实测冷加载 EMPTY 1/20），用 `test.fail` 会随机报
 * unexpected pass、用一次性读数又测不出来。本探针把"稳定性"变成**可复算的数字**：
 * N 次全新 context 冷加载，逐次记录 EMPTY/OK。
 *
 * ## 判定口径（与 spec 对齐）
 *
 * 稳定等待后读 `body.innerText`：长度 0 = EMPTY（真白屏），非 0 = OK。
 * 用 innerText/节点数，不用标签名（附则 A2）。
 *
 * ## 退出码（收编后的契约）
 *
 * - `EMPTY ≥ 1` → **退出码 1**（T-14 仍在 ⇒ strict 入口失败，隔离不许摘）
 * - 全 OK → 退出码 0（才允许走"探针归零 → 摘 skip"的恢复流程）
 * - 服务不在场 / 探针自身异常 → 退出码 2（区别于"有 EMPTY"，不静默当通过）
 *
 * ⚠️ **禁止用"全套 e2e 绿"反推 T-14 已修**——104 条里 5% 空页大概率撞不上，
 * 绿是幸存者偏差。这里才是判据。
 *
 * 用法: node e2e/scripts/probe-empty-rate.mjs [次数] [URL]
 *   次数默认 10；URL 默认 3210 的生产口径预览页。
 */
import { chromium } from "playwright";

const N = Number(process.argv[2] || 10);
const URL = process.argv[3] || "http://127.0.0.1:3210/api/templates/shadcn-landing2/preview";

let b;
try {
  b = await chromium.launch();
} catch (error) {
  console.error("[probe-empty-rate] Chromium 起不来：", error.message);
  process.exit(2);
}

const rows = [];
try {
  for (let i = 0; i < N; i++) {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    let violations = 0;
    p.on("console", (m) => { if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations++; });
    try {
      await p.goto(URL);
      await p.waitForTimeout(3000); // 稳定态窗：等确定性信号（paint 不再增长）而非消息到达
      const r = await p.evaluate(() => ({
        bodyTextLen: document.body.innerText.trim().length,
        h1WithText: [...document.querySelectorAll("h1")].filter((el) => el.innerText?.trim()).length,
        sections: document.querySelectorAll("section").length,
      }));
      rows.push({ i: i + 1, v: violations, ...r, verdict: r.bodyTextLen === 0 ? "EMPTY" : "OK" });
    } catch (error) {
      rows.push({ i: i + 1, v: violations, error: String(error).slice(0, 80), verdict: "ERROR" });
    } finally {
      await ctx.close();
    }
  }
} finally {
  await b.close();
}

console.log("[probe-empty-rate]", rows.map((r) =>
  `${r.i}:${r.verdict}(v=${r.v},len=${r.bodyTextLen ?? "-"})`).join("  "));

const empty = rows.filter((r) => r.verdict === "EMPTY").length;
const errors = rows.filter((r) => r.verdict === "ERROR").length;
console.log(`[probe-empty-rate] URL=${URL}  EMPTY ${empty}/${rows.length}  ERROR ${errors}/${rows.length}`);

if (errors > 0) {
  console.error("[probe-empty-rate] 探针自身有失败样本——结果不可用作判据。");
  process.exit(2);
}
if (empty > 0) {
  console.error(`[probe-empty-rate] T-14 复现：${empty}/${rows.length} 冷加载白屏。隔离必须保留。`);
  process.exit(1);
}
console.log("[probe-empty-rate] 本轮全 OK——T-14 可能已修。仍需在 T-13 修复提交上复测（建议 N≥50）后才可摘 skip。");
process.exit(0);
