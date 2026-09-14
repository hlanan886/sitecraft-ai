import assert from "node:assert/strict";
import test from "node:test";
import {
  describeRecipe,
  isUsableRecipe,
  matchRecipe,
  normalizeBlockOrder,
  type TemplateRecipe,
} from "../lib/template-recipe.ts";
import { CATEGORY_SYNONYMS, categoryFromUserText } from "../lib/template-recipe-keywords.ts";

/**
 * 配方的契约测试。
 *
 * 每条断言对应一个**实测过的失败**（2026-09-11 提 22 份配方时撞到的），
 * 不是"写写看"。
 */

function recipe(overrides: Partial<TemplateRecipe> = {}): TemplateRecipe {
  return {
    id: "test",
    name: "测试模板",
    category: "制造业",
    matchKeywords: [],
    blocks: [{ type: "navbar" }, { type: "hero" }, { type: "footer" }],
    tokens: { primary: "#111111", secondary: "#222222", accent: "#333333", fontStyle: "sans", radius: "soft", density: "balanced" },
    confidence: "medium",
    warnings: [],
    extracted: { at: "2026-09-11T00:00:00.000Z", from: "test", model: "test" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 板块顺序归一
// ---------------------------------------------------------------------------

test("navbar 与 footer 被归位——这两条是 HTML 语义定的，不该由模型判断", () => {
  // 实测：moon 被读成 hero→navbar→…，导航跑到了首屏后面。
  // 屏幕阅读器与 Tab 顺序都会因此乱掉，拼出来是错误的页面结构。
  const fixed = normalizeBlockOrder([{ type: "hero" }, { type: "navbar" }, { type: "features" }, { type: "footer" }]);
  assert.deepEqual(fixed.map((block) => block.type), ["navbar", "hero", "features", "footer"]);
});

test("中间板块的相对顺序不动", () => {
  const fixed = normalizeBlockOrder([
    { type: "navbar" },
    { type: "hero" },
    { type: "products" },
    { type: "about" },
    { type: "services" },
    { type: "footer" },
  ]);
  assert.deepEqual(fixed.map((block) => block.type), ["navbar", "hero", "products", "about", "services", "footer"]);
});

test("本来就没有 navbar/footer 时不做无中生有", () => {
  const fixed = normalizeBlockOrder([{ type: "hero" }, { type: "features" }]);
  assert.deepEqual(fixed.map((block) => block.type), ["hero", "features"]);
});

// ---------------------------------------------------------------------------
// 可用性判定
// ---------------------------------------------------------------------------

test("没有 hero 的配方不可用——拼出来过不了入库门禁", () => {
  assert.equal(isUsableRecipe(recipe({ blocks: [{ type: "navbar" }, { type: "features" }, { type: "footer" }] })), false);
});

test("板块太少的配方不可用", () => {
  assert.equal(isUsableRecipe(recipe({ blocks: [{ type: "hero" }, { type: "footer" }] })), false);
});

test("正常配方可用", () => {
  assert.equal(isUsableRecipe(recipe()), true);
});

// ---------------------------------------------------------------------------
// 行业归类（匹配的真正入口）
// ---------------------------------------------------------------------------

test("用户的话归到分类——**用户不会说「我是个制造业」**", () => {
  // 实测：拿模板自带的分类词（"制造业"/"科技企业"）直接匹配，
  // 五个真实表述一个都命中不了。所以需要的是「人怎么说话 → 属于哪一类」。
  assert.equal(categoryFromUserText("工业零部件厂的官网"), "制造业");
  assert.equal(categoryFromUserText("做个风机厂的网站"), "制造业");
  assert.equal(categoryFromUserText("包装印刷厂"), "制造业");
  assert.equal(categoryFromUserText("我的 SaaS 团队需要官网"), "科技企业");
  assert.equal(categoryFromUserText("做个光伏出口企业的官网，主打欧美"), "外贸目录");
  assert.equal(categoryFromUserText("开个咖啡店的网站"), "专业服务");
  assert.equal(categoryFromUserText("律师事务所官网"), "专业服务");
});

test("认不出来的话返回 null——不硬猜一个分类", () => {
  assert.equal(categoryFromUserText("随便看看"), null);
  assert.equal(categoryFromUserText(""), null);
});

test("每个分类都至少有一个真实说法能命中（防词表写偏）", () => {
  const samples: Record<string, string> = {
    制造业: "我们做机械设备的",
    外贸目录: "做出口生意要个英文站",
    科技企业: "开发了一个软件系统",
    专业服务: "我们是设计工作室",
  };
  for (const [expected, text] of Object.entries(samples)) {
    assert.equal(categoryFromUserText(text), expected, `「${text}」应归到 ${expected}`);
  }
  // 五个分类都要在词表里（防止后来加分类时漏配词）
  for (const category of ["制造业", "外贸目录", "科技企业", "专业服务"]) {
    assert.ok(CATEGORY_SYNONYMS[category]?.length > 0, `${category} 没有配任何词`);
  }
});

// ---------------------------------------------------------------------------
// 匹配
// ---------------------------------------------------------------------------

test("不同行业匹配到**不同**的模板——第一版四个问题全撞同一个", () => {
  const recipes = [
    recipe({ id: "mfg", category: "制造业" }),
    recipe({ id: "tech", category: "科技企业" }),
    recipe({ id: "svc", category: "专业服务" }),
  ];
  const ids = ["工厂", "软件", "设计"].map((word) => matchRecipe(recipes, `做个${word}公司`)?.id);
  assert.equal(new Set(ids).size, 3, `三个行业该给三个不同结果，实际：${ids.join(",")}`);
});

test("同类里优先把握度高的", () => {
  const recipes = [
    recipe({ id: "aaa", category: "制造业", confidence: "low" }),
    recipe({ id: "zzz", category: "制造业", confidence: "high" }),
  ];
  assert.equal(matchRecipe(recipes, "机械厂")?.id, "zzz");
});

test("同类同分时按 id 排序——**同一个输入永远给同一个结果**", () => {
  const recipes = [
    recipe({ id: "bbb", category: "制造业", confidence: "high" }),
    recipe({ id: "aaa", category: "制造业", confidence: "high" }),
  ];
  assert.equal(matchRecipe(recipes, "机械厂")?.id, "aaa");
  // 换个顺序传，结果不变
  assert.equal(matchRecipe([...recipes].reverse(), "机械厂")?.id, "aaa");
});

test("归类不出来时返回 null，交给模型——不硬选一个不太像的", () => {
  assert.equal(matchRecipe([recipe()], "随便看看"), null);
  assert.equal(matchRecipe([recipe()], ""), null);
});

test("没有任何可用配方时返回 null，不抛异常", () => {
  assert.equal(matchRecipe([], "机械厂"), null);
  assert.equal(matchRecipe([recipe({ blocks: [{ type: "hero" }] })], "机械厂"), null);
});

test("describeRecipe 给出一句人话", () => {
  const text = describeRecipe(recipe({ name: "鼎力风机", category: "制造业" }));
  assert.ok(text.includes("鼎力风机"));
  assert.ok(text.includes("制造业"));
  assert.ok(text.includes("navbar → hero → footer"));
});
