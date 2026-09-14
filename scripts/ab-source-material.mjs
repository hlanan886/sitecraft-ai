/**
 * 对照实验：短需求 vs 短需求+丰富素材，产出差多少。
 *
 * 背景：用户质疑「待补充/空白」是因为测试输入太短不清晰，
 * 而非产品缺陷。此脚本用同一句短需求跑两次，
 * 唯一变量是 execute 是否带 sourceMaterial（= UI 里那个折叠的「粘贴公司简介」）。
 *
 * 为什么重要：UI 把该字段默认折叠且标「选填」，
 * 若默认路径产出差、而该字段是唯一解药，那是**产品引导问题**，不是用户输入问题。
 *
 * 用法：node --experimental-strip-types scripts/ab-source-material.mjs
 */
const BASE = "http://localhost:3000";

// 同一句短需求 —— 模拟「一句话建站」楔子下的真实用户
const MSG = "我们是做精密五金件的工厂，想做外贸网站接海外询盘";

// 选填素材（模拟愿意展开那个折叠框的用户）
const MATERIAL = `恒固精工成立于 2008 年，位于江苏常州，员工 180 人，厂房 12000 平方米。
主营：传动轴、法兰盘、联轴器、非标 CNC 加工件。
材质：45# 钢、40Cr、304/316 不锈钢、铝合金 6061。
精度：常规公差 ±0.02mm，精密件可达 ±0.005mm。
表面处理：发黑、镀锌、阳极氧化、喷砂。
认证：ISO 9001:2015、IATF 16949、RoHS、CE（部分产品）。
产能：月产 80 万件，常规交期 15-20 天，样品 5-7 天。
起订量：标准件 500 件起，非标件按图纸评估。
主要客户：德国、意大利、越南的工程机械与自动化设备厂。`;

const parseSSE = (t) => t.split("\n\n")
  .map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6))
  .filter(Boolean)
  .map((s) => { try { return JSON.parse(s); } catch { return null; } })
  .filter(Boolean);

async function run(label, withMaterial) {
  const r = await fetch(`${BASE}/api/sites`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `AB-${label}`, templateId: "forge", locales: ["zh", "en"] }),
  });
  const site = await r.json();
  const siteId = site.id;
  const draft0 = await fetch(`${BASE}/api/sites/${siteId}/draft`, { cache: "no-store" }).then((x) => x.json());

  const t0 = Date.now();
  const resp = await fetch(`${BASE}/api/sites/${siteId}/generate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      step: "execute", message: MSG,
      // analyze 也带上素材，模拟真实 UI（analyze 与 execute 都发 extraContext）
      intent: INTENT,
      templateId: "forge", siteLanguage: "zh", hiddenSections: [],
      baseRevision: draft0.draft?.revision ?? 1,
      sessionId: crypto.randomUUID(),
      ...(withMaterial ? { sourceMaterial: MATERIAL } : {}),
    }),
  });
  const done = parseSSE(await resp.text()).find((e) => e.type === "done");
  const secs = Math.round((Date.now() - t0) / 1000);

  const d = await fetch(`${BASE}/api/sites/${siteId}/draft`, { cache: "no-store" }).then((x) => x.json());
  const dd = d.draft ?? {};
  return {
    label, secs, status: done?.status, siteId,
    coverage: done?.coverage ?? {},
    hero: dd.content?.hero?.title?.zh,
    heroSub: dd.content?.hero?.subtitle?.zh,
    about: dd.content?.about?.body?.zh,
    feat: (dd.content?.features?.items ?? []).map((i) => i.title?.zh),
    hidden: dd.hiddenSections,
    products: dd.products?.length,
  };
}

// 固定的 intent，避免 analyze 随机性污染对照
const INTENT = {
  businessType: "manufacturing",
  companyName: "恒固精工",
  industry: "精密机械零部件制造",
  targetAudience: "globalB2b",
  tone: "professional",
  coreSections: ["about", "features", "services", "products", "contact"],
  recommendedTemplateId: "forge",
  summary: "精密五金件制造商官网，面向海外采购商。",
};

console.log("跑 A（短需求，无素材）…");
const A = await run("A", false);
console.log("跑 B（同需求 + 丰富素材）…");
const B = await run("B", true);

const PLACEHOLDER = /^(待补充|暂无|敬请期待|TBD|-+|)$/i;
const blank = (v) => v == null || PLACEHOLDER.test(String(v).trim());
const row = (k, a, b) => console.log(`  ${k.padEnd(14)} A=${JSON.stringify(a)?.slice(0, 46)?.padEnd(48)} B=${JSON.stringify(b)?.slice(0, 46)}`);

console.log("\n══════════ 对照结果 ══════════");
console.log(`耗时        A=${A.secs}s  B=${B.secs}s`);
console.log(`状态        A=${A.status}  B=${B.status}`);
row("hero.title", A.hero, B.hero);
row("hero.subtitle", A.heroSub, B.heroSub);
row("about.body", A.about, B.about);
row("features", A.feat, B.feat);
console.log(`hiddenSections A=${JSON.stringify(A.hidden)}  B=${JSON.stringify(B.hidden)}`);
console.log(`products       A=${A.products}  B=${B.products}`);
console.log(`残留demo A=${(A.coverage.residualDemoSlots ?? []).length}  B=${(B.coverage.residualDemoSlots ?? []).length}`);
console.log(`待补全A=${(A.coverage.pendingTargets ?? []).length}  B=${(B.coverage.pendingTargets ?? []).length}`);

console.log("\n──────── 判定 ────────");
const checks = [
  ["hero.title 空白/待补充", blank(A.hero), blank(B.hero)],
  ["about 空白/待补充", blank(A.about), blank(B.about)],
  ["features 为空", (A.feat ?? []).length === 0, (B.feat ?? []).length === 0],
  ["产品板块被隐藏", (A.hidden ?? []).includes("products"), (B.hidden ?? []).includes("products")],
];
for (const [name, aBad, bBad] of checks) {
  console.log(`${name.padEnd(22)} A坏=${aBad ? "是" : "否"}  B坏=${bBad ? "是" : "否"}  ${!aBad && bBad ? "⚠ 素材反而更差" : aBad && !bBad ? "✅ 素材修复了它" : aBad && bBad ? "两者都坏" : "两者都好"}`);
}
console.log(`\nA siteId=${A.siteId}\nB siteId=${B.siteId}`);
