/**
 * F1 探针：跑一次真实生成，看 demo 残留到底是什么样。
 *
 * 为什么写这个：F1 的严重度此前只来自用户口述「经常看到」，
 * 没有亲自跑过。用真实链路（建站→生成→读草稿）取证，
 * 数据来自 SSE done 事件里已有的 coverage，不自己造统计。
 *
 * 用法：node --experimental-strip-types scripts/probe-demo-residue.mjs
 */
const BASE = "http://localhost:3000";

// 真实场景：长三角精密零部件制造商，外贸导向（贴合用户定位）
const MSG =
  "恒固精工是一家位于江苏的精密机械零部件制造商，做传动轴、法兰、联轴器和非标 CNC 加工件，" +
  "主要卖给设备 OEM 和工程机械厂，出口德国和东南亚。";
const INTENT = {
  businessType: "manufacturing",
  companyName: "恒固精工",
  industry: "精密机械零部件制造",
  targetAudience: "globalB2b",
  tone: "professional",
  coreSections: ["about", "features", "services", "products", "contact"],
  recommendedTemplateId: "forge",
  summary: "精密机械零部件制造商官网，面向设备 OEM 与工程机械客户。",
};

const j = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log("① 建站…");
const created = await j(`${BASE}/api/sites`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: INTENT.companyName, templateId: "forge", locales: ["zh", "en"] }),
});
const siteId = created.body?.id;
if (!siteId) {
  console.error("建站失败:", created.status, JSON.stringify(created.body)?.slice(0, 300));
  process.exit(1);
}
console.log("   siteId =", siteId);

console.log("② 取 baseRevision…");
const draft = await j(`${BASE}/api/sites/${siteId}/draft`);
const baseRevision = draft.body?.draft?.revision ?? 1;
console.log("   revision =", baseRevision);

console.log("③ 生成中（可能要 20-60s）…");
const t0 = Date.now();
const resp = await fetch(`${BASE}/api/sites/${siteId}/generate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    step: "execute",
    message: MSG,
    intent: INTENT,
    templateId: "forge",
    siteLanguage: "zh",
    hiddenSections: [],
    baseRevision,
    sessionId: crypto.randomUUID(),
  }),
});
const text = await resp.text();
const events = text
  .split("\n\n")
  .map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
  .filter(Boolean)
  .map((s) => { try { return JSON.parse(s); } catch { return null; } })
  .filter(Boolean);
const done = events.find((e) => e.type === "done");
console.log(`   耗时 ${Math.round((Date.now() - t0) / 1000)}s | status=${done?.status}`);

if (done?.status !== "applied" && done?.status !== "no_change") {
  console.error("生成未成功:", JSON.stringify(done)?.slice(0, 500));
  process.exit(1);
}

const c = done.coverage ?? {};
const sectionOf = (t) => String(t).split(".")[0];
const group = (arr) => {
  const m = {};
  for (const t of arr ?? []) (m[sectionOf(t)] ??= []).push(t);
  return m;
};

console.log("\n══════ 结果 ══════");
console.log("partial:", done.partial, "| missingSections:", JSON.stringify(done.missingSections ?? []));
console.log("operations:", done.changeSet?.operations?.length ?? 0);

const rows = [
  ["★ residualDemoSlots  demo残留", c.residualDemoSlots],
  ["  pendingTargets     该写没写", c.pendingTargets],
  ["  fabricatedTargets  伪造事实", c.fabricatedTargets],
  ["  placeholderTargets 诚实缺口", c.placeholderTargets],
  ["  unmappedRequired  无法质检", c.unmappedRequiredTargets],
];
for (const [label, arr] of rows) {
  const g = group(arr);
  console.log(`\n${label}: ${arr?.length ?? 0}`);
  for (const [sec, list] of Object.entries(g)) console.log(`   ${sec}: ${list.join(", ")}`);
}

console.log("\nSITE_ID=" + siteId);
console.log("PREVIEW=http://localhost:3000/templates/forge/preview?siteId=" + siteId);
if (done.outputTruncated) console.log("⚠ 输出被截断");
