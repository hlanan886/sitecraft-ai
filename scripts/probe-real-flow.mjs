/**
 * 验证：真实流程（analyze → execute）会不会撞上 "features item N does not exist"。
 *
 * 与 probe-demo-residue.mjs 的区别：那个脚本手搓 intent 直接灌 execute，
 * 跳过了 analyze。本脚本走完整链路，验证「真实用户会不会撞到」。
 *
 * 用法：node --experimental-strip-types scripts/probe-real-flow.mjs "一句话需求"
 */
const BASE = "http://localhost:3000";
const MSG = process.argv[2] || "我们是做精密五金件的工厂，想做外贸网站接海外询盘";

const j = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const parseSSE = (text) =>
  text.split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
    .filter(Boolean)
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean);

// ───── 第一步：analyze（真实用户走的路） ─────
console.log("① analyze…");
const site = await j(`${BASE}/api/sites`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "探针站点", templateId: "forge", locales: ["zh", "en"] }),
});
const siteId = site.body?.id;
if (!siteId) { console.error("建站失败", site.status); process.exit(1); }

const analyzeResp = await fetch(`${BASE}/api/sites/${siteId}/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ step: "analyze", message: MSG, history: [] }),
});
const analyzeEvents = parseSSE(await analyzeResp.text());
const analyzeDone = analyzeEvents.find((e) => e.type === "done");
console.log("   status =", analyzeDone?.status);
if (analyzeDone?.status !== "ready") {
  console.log("   HTTP =", analyzeResp.status);
  console.log("   原始 done 事件 =", JSON.stringify(analyzeDone)?.slice(0, 600));
  console.log("   事件总数 =", analyzeEvents.length,
    "| 类型 =", analyzeEvents.map((e) => e.type).join(","));
  const statuses = analyzeEvents.filter((e) => e.type === "status").map((e) => e.value);
  if (statuses.length) console.log("   进度 =", statuses.join(" → "));
  process.exit(0);
}

const intent = analyzeDone.intent;
console.log("   intent.coreSections =", JSON.stringify(intent.coreSections));
console.log("   recommendedTemplateId =", intent.recommendedTemplateId);
console.log("   companyName =", intent.companyName);

// 注意：analyze 返回的 recommendedTemplateId 可能不是 forge——用真实的值
const templateId = intent.recommendedTemplateId || analyzeDone.template?.id || "forge";
console.log("   实际将使用的模板 =", templateId);

// ───── 第二步：execute ─────
console.log("\n② execute（这可能要 60s）…");
const draft = await j(`${BASE}/api/sites/${siteId}/draft`);
const baseRevision = draft.body?.draft?.revision ?? 1;

const t0 = Date.now();
const genResp = await fetch(`${BASE}/api/sites/${siteId}/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    step: "execute", message: MSG, intent,
    templateId,
    siteLanguage: intent.siteLanguage ?? "zh",
    hiddenSections: [], baseRevision, sessionId: crypto.randomUUID(),
  }),
});
const done = parseSSE(await genResp.text()).find((e) => e.type === "done");
console.log(`   耗时 ${Math.round((Date.now() - t0) / 1000)}s | status = ${done?.status}`);

if (done?.status === "error") {
  console.log("\n❌ 真实流程同样失败");
  console.log("   code   =", done.code);
  console.log("   error  =", done.error);
} else {
  const c = done?.coverage ?? {};
  console.log("\n✅ 真实流程成功");
  console.log("   operations =", done.changeSet?.operations?.length ?? 0);
  for (const k of ["residualDemoSlots", "pendingTargets", "fabricatedTargets", "placeholderTargets"]) {
    console.log(`   ${k} = ${(c[k] ?? []).length}`);
  }
  if (c.residualDemoSlots?.length) console.log("   残留示例:", c.residualDemoSlots.slice(0, 12).join(", "));
}
console.log("\nSITE_ID=" + siteId);
