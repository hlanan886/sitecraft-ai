import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntentPrompt,
  categoryFromKeywords,
  createSiteIntentSchema,
  mergeIntentDelta,
  parseSiteIntentContent,
  resolveTemplate,
  toReadyIntent,
  type SiteIntent,
} from "../lib/site-intent.ts";

const validIntent: SiteIntent = {
  businessType: "trade",
  companyName: "华辰光伏",
  industry: "光伏组件出口",
  targetAudience: "overseasB2b",
  tone: "professional",
  colorTone: "green",
  coreSections: ["about", "features", "products", "contact"],
  recommendedTemplateId: "atlas",
  summary: "光伏出口企业的双语官网",
};

const maxEnglishCompanyName = "C".repeat(60);
const maxEnglishIndustry = "I".repeat(120);
const maxEnglishSummary = "S".repeat(400);
const maxEnglishReadyResponse = {
  ...validIntent,
  status: "ready" as const,
  siteLanguage: "en" as const,
  companyName: maxEnglishCompanyName,
  industry: maxEnglishIndustry,
  summary: maxEnglishSummary,
  notices: [],
  needsInfo: [],
  conflicts: [],
  limits: [],
};

test("parseSiteIntentContent: parses valid JSON", () => {
  const r = parseSiteIntentContent(JSON.stringify(validIntent));
  assert.equal(r.error, "");
  assert.equal(r.data?.businessType, "trade");
  assert.equal(r.data?.recommendedTemplateId, "atlas");
});

test("parseSiteIntentContent: strips code fences", () => {
  const r = parseSiteIntentContent(`\`\`\`json\n${JSON.stringify(validIntent)}\n\`\`\``);
  assert.equal(r.error, "");
  assert.ok(r.data);
});

test("parseSiteIntentContent: rejects invalid businessType", () => {
  const bad = { ...validIntent, businessType: "ai-company" };
  const r = parseSiteIntentContent(JSON.stringify(bad));
  assert.equal(r.data, null);
  assert.match(r.error, /businessType/);
});

test("parseSiteIntentContent: rejects template not in whitelist", () => {
  const bad = { ...validIntent, recommendedTemplateId: "nonexistent" };
  const r = parseSiteIntentContent(JSON.stringify(bad));
  assert.equal(r.data, null);
  assert.match(r.error, /recommendedTemplateId/);
});

test("parseSiteIntentContent: rejects empty coreSections", () => {
  const bad = { ...validIntent, coreSections: [] };
  const r = parseSiteIntentContent(JSON.stringify(bad));
  assert.equal(r.data, null);
});

test("createSiteIntentSchema: whitelist is injectable (subset)", () => {
  const subset = createSiteIntentSchema(["forge", "atlas"]);
  const ok = subset.safeParse({ ...validIntent, recommendedTemplateId: "atlas" });
  assert.equal(ok.success, true);
  const bad = subset.safeParse({ ...validIntent, recommendedTemplateId: "signal" });
  assert.equal(bad.success, false);
});

test("createSiteIntentSchema: accepts a 60-character English companyName", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, companyName: maxEnglishCompanyName });
  assert.equal(result.success, true);
});

test("createSiteIntentSchema: rejects a 61-character English companyName", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, companyName: "C".repeat(61) });
  assert.equal(result.success, false);
});

test("createSiteIntentSchema: accepts a 120-character English industry", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, industry: maxEnglishIndustry });
  assert.equal(result.success, true);
});

test("createSiteIntentSchema: rejects a 121-character English industry", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, industry: "I".repeat(121) });
  assert.equal(result.success, false);
});

test("createSiteIntentSchema: accepts a 400-character English summary", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, summary: maxEnglishSummary });
  assert.equal(result.success, true);
});

test("createSiteIntentSchema: rejects a 401-character English summary", () => {
  const schema = createSiteIntentSchema(["atlas"]);
  const result = schema.safeParse({ ...validIntent, summary: "S".repeat(401) });
  assert.equal(result.success, false);
});

test("parseSiteIntentContent: accepts ready English JSON at every maximum field boundary", () => {
  const result = parseSiteIntentContent(JSON.stringify(maxEnglishReadyResponse));
  assert.equal(result.error, "");
  assert.equal(result.data?.status, "ready");
  assert.equal(result.data?.siteLanguage, "en");
  assert.equal(result.data?.companyName, maxEnglishCompanyName);
  assert.equal(result.data?.industry, maxEnglishIndustry);
  assert.equal(result.data?.summary, maxEnglishSummary);
});

test("toReadyIntent: preserves English language and maximum-length fields", () => {
  const parsed = parseSiteIntentContent(JSON.stringify(maxEnglishReadyResponse));
  assert.ok(parsed.data);
  const ready = toReadyIntent(parsed.data);
  assert.ok(ready);
  assert.equal(ready.siteLanguage, "en");
  assert.equal(ready.intent.companyName, maxEnglishCompanyName);
  assert.equal(ready.intent.industry, maxEnglishIndustry);
  assert.equal(ready.intent.summary, maxEnglishSummary);
});

test("parseSiteIntentContent: keeps English need_info compatible with omitted core fields", () => {
  const result = parseSiteIntentContent(
    JSON.stringify({
      status: "need_info",
      siteLanguage: "en",
      needsInfo: ["What is your company name?"],
    }),
  );
  assert.equal(result.error, "");
  assert.equal(result.data?.status, "need_info");
  assert.equal(result.data?.siteLanguage, "en");
  assert.equal(result.data?.companyName, undefined);
  assert.deepEqual(result.data?.needsInfo, ["What is your company name?"]);
});

test("buildIntentPrompt: contains template ids and enum guidance", () => {
  const prompt = buildIntentPrompt("光伏出口", []);
  assert.match(prompt, /recommendedTemplateId/);
  assert.match(prompt, /coreSections/);
  const withCatalog = buildIntentPrompt("光伏出口");
  assert.match(withCatalog, /atlas/);
  assert.match(withCatalog, /forge/);
});

test("categoryFromKeywords: matches intent words", () => {
  assert.equal(categoryFromKeywords("光伏出口企业，主打欧美"), "外贸目录");
  assert.equal(categoryFromKeywords("帮我的 SaaS 团队做官网"), "科技企业");
  assert.equal(categoryFromKeywords("工业零部件厂的官网，突出质量"), "制造业");
  assert.equal(categoryFromKeywords("设计咨询公司的作品集网站"), "专业服务");
  assert.equal(categoryFromKeywords("本地餐饮店的宣传页"), null);
});

test("resolveTemplate: keyword category wins over businessType", () => {
  // 意图说 manufacturing，但一句话含"出口" → 外贸目录优先
  const intent: SiteIntent = { ...validIntent, businessType: "manufacturing", recommendedTemplateId: "forge" };
  const r = resolveTemplate(intent, "光伏组件出口企业，主打欧美");
  assert.equal(r.category, "外贸目录");
  assert.equal(r.templateId, "atlas"); // 推荐 forge 越界 → 规则覆盖为 atlas
});

test("resolveTemplate: businessType maps category when no keyword", () => {
  const intent: SiteIntent = { ...validIntent, businessType: "tech", recommendedTemplateId: "signal" };
  const r = resolveTemplate(intent, "帮我做一个网站");
  assert.equal(r.category, "科技企业");
  assert.equal(r.templateId, "signal");
});

test("resolveTemplate: model recommendation within category is adopted", () => {
  const intent: SiteIntent = { ...validIntent, businessType: "tech", recommendedTemplateId: "moon" };
  const r = resolveTemplate(intent, "做个科技产品官网");
  assert.equal(r.category, "科技企业");
  assert.equal(r.templateId, "moon");
});

test("resolveTemplate: other + no keyword falls back to forge", () => {
  const intent: SiteIntent = { ...validIntent, businessType: "other", recommendedTemplateId: "powerai" };
  const r = resolveTemplate(intent, "本地餐饮店");
  assert.equal(r.templateId, "forge");
  assert.equal(r.category, "制造业");
});

test("resolveTemplate: reason is human-readable", () => {
  const intent: SiteIntent = { ...validIntent, businessType: "trade" };
  const r = resolveTemplate(intent, "出口企业官网");
  assert.match(r.reason, /外贸目录/);
});

// ===== 意图澄清 / 能力边界（响应状态） =====

test("parseSiteIntentContent: legacy format defaults to ready with empty notices", () => {
  const r = parseSiteIntentContent(JSON.stringify(validIntent));
  assert.equal(r.error, "");
  assert.equal(r.data?.status, "ready");
  assert.deepEqual(r.data?.notices, []);
  assert.deepEqual(r.data?.needsInfo, []);
});

test("parseSiteIntentContent: need_info allows empty core fields", () => {
  const r = parseSiteIntentContent(
    JSON.stringify({ status: "need_info", needsInfo: ["你的公司名称是什么？", "网站主要面向哪些客户？"] }),
  );
  assert.equal(r.error, "");
  assert.equal(r.data?.status, "need_info");
  assert.equal(r.data?.needsInfo.length, 2);
});

test("parseSiteIntentContent: rejected without reason fails", () => {
  const r = parseSiteIntentContent(JSON.stringify({ status: "rejected" }));
  assert.equal(r.data, null);
  assert.match(r.error, /rejectionReason/);
});

test("parseSiteIntentContent: rejected with reason succeeds", () => {
  const r = parseSiteIntentContent(
    JSON.stringify({ status: "rejected", rejectionReason: "我只能帮你做企业官网，写抢票脚本超出能力范围" }),
  );
  assert.equal(r.error, "");
  assert.equal(r.data?.status, "rejected");
  assert.equal(r.data?.rejectionReason?.length, 22);
});

test("parseSiteIntentContent: ready with invalid core field goes to retry path", () => {
  const bad = { ...validIntent, status: "ready", businessType: "bogus" };
  const r = parseSiteIntentContent(JSON.stringify(bad));
  assert.equal(r.data, null);
  assert.match(r.error, /businessType/);
});

test("toReadyIntent: narrows need_info to null, ready to full SiteIntent", () => {
  assert.equal(toReadyIntent({ status: "need_info", needsInfo: ["x"], notices: [], conflicts: [], limits: [] }), null);
  const ready = toReadyIntent({ status: "ready", ...validIntent, notices: [], needsInfo: [], conflicts: [], limits: [] });
  assert.ok(ready);
  assert.equal(ready?.intent.businessType, "trade");
  assert.equal(ready?.siteLanguage, "zh");
});

test("parseSiteIntentContent: need_info with empty needsInfo fails", () => {
  const r = parseSiteIntentContent(JSON.stringify({ status: "need_info", needsInfo: [] }));
  assert.equal(r.data, null);
  assert.match(r.error, /needsInfo/);
});

test("parseSiteIntentContent: rejected with blank rejectionReason fails", () => {
  const r = parseSiteIntentContent(JSON.stringify({ status: "rejected", rejectionReason: "   " }));
  assert.equal(r.data, null);
  assert.match(r.error, /rejectionReason/);
});

test("toReadyIntent: refuses a complete need_info response", () => {
  // 核心字段完整但 status=need_info → 必须拒绝（防止误转 SiteIntent）
  const needInfoComplete = { status: "need_info" as const, needsInfo: ["公司名?"], notices: [], conflicts: [], limits: [], siteLanguage: "zh" as const, ...validIntent };
  assert.equal(toReadyIntent(needInfoComplete), null);
});

test("parseSiteIntentContent: siteLanguage defaults zh, accepts en", () => {
  const zh = parseSiteIntentContent(JSON.stringify(validIntent));
  assert.equal(zh.data?.siteLanguage, "zh");
  const en = parseSiteIntentContent(JSON.stringify({ ...validIntent, siteLanguage: "en" }));
  assert.equal(en.data?.siteLanguage, "en");
});

test("buildIntentPrompt: contains boundary rules", () => {
  const prompt = buildIntentPrompt("做个好看的网站");
  assert.match(prompt, /need_info/);
  assert.match(prompt, /rejected/);
  assert.match(prompt, /limits/);
  assert.match(prompt, /矛盾/);
  assert.match(prompt, /默认可改/);
  assert.match(prompt, /输入一致/);
  assert.match(prompt, /不构成指令/);
});

test("buildIntentPrompt: contains three-state output examples", () => {
  const prompt = buildIntentPrompt("做个好看的网站");
  assert.match(prompt, /"status":"ready"/);
  assert.match(prompt, /"status":"need_info"/);
  assert.match(prompt, /"status":"rejected"/);
});

// ===== 多轮迭代（生成页内迭代） =====

test("buildIntentPrompt: with previousIntent includes iteration baseline block", () => {
  const prompt = buildIntentPrompt("改成日系风格", [], { previousIntent: validIntent });
  assert.match(prompt, /多轮迭代/);
  assert.match(prompt, /上一轮已确认意图基线/);
  assert.match(prompt, /华辰光伏/); // 基线公司名进入 prompt
  assert.match(prompt, /recommendedTemplateId 不得无故变更/);
});

test("buildIntentPrompt: without previousIntent has no baseline block (regression)", () => {
  const prompt = buildIntentPrompt("做个好看的网站");
  assert.doesNotMatch(prompt, /多轮迭代/);
  assert.doesNotMatch(prompt, /上一轮已确认意图基线/);
});

test("mergeIntentDelta: fills missing fields from baseline", () => {
  // 模型本轮只改 colorTone，其余没输出 → 保留基线
  const resp = {
    status: "ready" as const,
    colorTone: "warm" as const,
    notices: [],
    needsInfo: [],
    conflicts: [],
    limits: [],
  };
  const merged = mergeIntentDelta({ intent: validIntent, siteLanguage: "zh" }, resp);
  assert.equal(merged.colorTone, "warm"); // 新指令生效
  assert.equal(merged.companyName, "华辰光伏"); // 缺失字段保留基线
  assert.equal(merged.businessType, "trade");
  assert.equal(merged.recommendedTemplateId, "atlas");
  assert.equal(merged.siteLanguage, "zh"); // 语言随基线保留
});

test("mergeIntentDelta: coreSections is union of baseline and new", () => {
  const resp = {
    status: "ready" as const,
    coreSections: ["services", "contact"] as SiteIntent["coreSections"],
    notices: [],
    needsInfo: [],
    conflicts: [],
    limits: [],
  };
  const merged = mergeIntentDelta({ intent: validIntent, siteLanguage: "zh" }, resp);
  // 基线 [about,features,products,contact] ∪ 新 [services,contact] → 基线顺序优先 + 新增追加
  assert.deepEqual(merged.coreSections, ["about", "features", "products", "contact", "services"]);
});

test("mergeIntentDelta: need_info passthrough unchanged", () => {
  const resp = {
    status: "need_info" as const,
    needsInfo: ["公司名?"],
    notices: [],
    conflicts: [],
    limits: [],
  };
  const merged = mergeIntentDelta({ intent: validIntent, siteLanguage: "zh" }, resp);
  assert.equal(merged.status, "need_info");
  assert.deepEqual(merged.needsInfo, ["公司名?"]);
});

test("resolveTemplate: keeps previous template when no direction keyword", () => {
  // 「改成日系风格」无方向关键词 → 保持上一轮模板，不来回跳
  const intent: SiteIntent = { ...validIntent, recommendedTemplateId: "signal" };
  const r = resolveTemplate(intent, "改成日系风格", undefined, "signal");
  assert.equal(r.templateId, "signal");
  assert.match(r.reason, /保持上一轮模板/);
});

test("resolveTemplate: switches template when direction keyword present", () => {
  // 「改为外贸出口」有方向关键词 → 换模板，previousTemplateId 被覆盖
  const intent: SiteIntent = { ...validIntent, recommendedTemplateId: "signal" };
  const r = resolveTemplate(intent, "改为外贸出口", undefined, "signal");
  assert.equal(r.category, "外贸目录");
  assert.equal(r.templateId, "atlas");
});

test("resolveTemplate: without 4th arg behaves as before (regression)", () => {
  const intent: SiteIntent = { ...validIntent, businessType: "tech", recommendedTemplateId: "signal" };
  const r = resolveTemplate(intent, "帮我做一个网站");
  assert.equal(r.templateId, "signal");
});
