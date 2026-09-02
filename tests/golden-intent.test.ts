import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryFromKeywords,
  resolveTemplate,
  type SiteIntent,
} from "../lib/site-intent.ts";

/**
 * B3 意图 golden 用例（回归基线）：
 * 覆盖各行业 + 语气/受众/色系组合，任何意图 prompt/模板规则改动都不能破坏这些核心映射。
 * 纯逻辑断言（mock，不触网）：resolveTemplate 的确定性映射 + categoryFromKeywords 关键词。
 */

const baseIntent = (partial: Partial<SiteIntent>): SiteIntent => ({
  businessType: "trade",
  companyName: "占位",
  industry: "占位行业",
  targetAudience: "globalB2b",
  tone: "professional",
  coreSections: ["about", "features", "products", "contact"],
  recommendedTemplateId: "atlas",
  summary: "占位",
  ...partial,
});

// 行业 → 模板映射 golden 表
// 注意：期望值严格对齐现有 CATEGORY_KEYWORDS 实际规则（咖啡无专属关键词，命中"专业服务"的 /品牌/）
const GOLDEN_CASES: Array<{ name: string; text: string; expectCategory: string; expectTemplate: string }> = [
  { name: "光伏出口欧美", text: "做个光伏出口企业的官网，主打欧美，要专业可靠", expectCategory: "外贸目录", expectTemplate: "atlas" },
  { name: "咖啡品牌", text: "帮我做个咖啡品牌的网站，要温馨", expectCategory: "专业服务", expectTemplate: "kindred" },
  // SaaS + 海外开发者：CATEGORY_KEYWORDS 顺序外贸目录在前（/海外/ 先命中）→ 外贸目录优先（确定性规则）
  { name: "SaaS 海外开发者", text: "帮我的 SaaS 团队做官网，用户是海外开发者", expectCategory: "外贸目录", expectTemplate: "atlas" },
  { name: "设计咨询公司", text: "设计咨询公司的作品集网站", expectCategory: "专业服务", expectTemplate: "kindred" },
  { name: "工业零部件厂", text: "工业零部件厂的官网，突出质量和服务", expectCategory: "制造业", expectTemplate: "forge" },
];

test("golden: categoryFromKeywords covers all industries", () => {
  for (const c of GOLDEN_CASES) {
    assert.equal(categoryFromKeywords(c.text), c.expectCategory, `关键词分类失败: ${c.name}`);
  }
});

test("golden: resolveTemplate maps to expected template per industry", () => {
  for (const c of GOLDEN_CASES) {
    const intent = baseIntent({ recommendedTemplateId: c.expectTemplate });
    const r = resolveTemplate(intent, c.text);
    assert.equal(r.category, c.expectCategory, `category 不符: ${c.name}`);
    assert.equal(r.templateId, c.expectTemplate, `template 不符: ${c.name}`);
  }
});

test("golden: audience/tone combinations resolve correctly", () => {
  // 海外 B2B + 专业 → 外贸目录
  const overseas = resolveTemplate(
    baseIntent({ businessType: "trade", targetAudience: "overseasB2b", recommendedTemplateId: "atlas" }),
    "光伏组件出口企业，主打欧美",
  );
  assert.equal(overseas.category, "外贸目录");

  // 终端用户 + 友好 → 无行业关键词（"本地咖啡店"无命中），businessType services → 专业服务兜底
  const endUser = resolveTemplate(
    baseIntent({ businessType: "services", targetAudience: "endUsers", tone: "friendly", recommendedTemplateId: "kindred" }),
    "本地咖啡店宣传页",
  );
  assert.equal(endUser.templateId, "kindred");

  // 科技 + 极简 → 科技企业模板（signal 默认）
  const techMinimal = resolveTemplate(
    baseIntent({ businessType: "tech", tone: "minimal", recommendedTemplateId: "signal" }),
    "科技产品官网",
  );
  assert.equal(techMinimal.category, "科技企业");
  assert.equal(techMinimal.templateId, "signal");
});

test("golden: colorTone preserved through intent (no drift)", () => {
  // colorTone 是可选字段，resolveTemplate 不应受其影响改变模板
  const warm = resolveTemplate(
    baseIntent({ businessType: "services", colorTone: "warm", recommendedTemplateId: "kindred" }),
    "咨询公司官网",
  );
  assert.equal(warm.templateId, "kindred");
  const dark = resolveTemplate(
    baseIntent({ businessType: "tech", colorTone: "dark", recommendedTemplateId: "signal" }),
    "极客风格科技站",
  );
  assert.equal(dark.templateId, "signal");
});
