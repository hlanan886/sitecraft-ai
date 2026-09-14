import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVisionSystemPrompt,
  buildVisionUserPrompt,
  coerceTemplateId,
  coerceVisionDsl,
  dedupeProducts,
  describeVisionResult,
  estimateSectionRange,
  judgeScreenshot,
  planProductShots,
  PROMPT_CONTRACT,
  sanitizeFact,
  stripDangerous,
  toDataUrl,
  MAX_PER_SKU,
} from "../lib/site-vision.ts";
import { MAX_CAPTURE_EDGE, MAX_CAPTURE_PIXELS, MIN_ACCEPTABLE_WIDTH, MIN_CAPTURE_WIDTH, planCaptureSize } from "../lib/site-capture.ts";
import { COMPONENT_TYPES, COMPONENT_VARIANTS, MAX_COLLECTION_ITEMS } from "../lib/template-composer-dsl.ts";
import { siteDraftSchema } from "../lib/site-document.ts";

/**
 * 视觉理解层的契约测试。
 *
 * 每条断言对应一个**实测过的失败**，不是"写写看"。改动这层之前先读注释里的实测记录——
 * 那些兜底看着多余，删掉之后是**静默**失效（页面能出、只是内容错或改不了），最难排查。
 */

// ---------------------------------------------------------------------------
// 尺寸闸
// ---------------------------------------------------------------------------

test("截图尺寸闸：太窄拒绝，理由是给人看的中文", () => {
  const verdict = judgeScreenshot(450, 2000);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  // 实测：同一条内容 1010 宽能读准配色（#c8102e），450 宽把主色读成了蓝色
  assert.match(verdict.message, /太窄/);
  assert.ok(verdict.message.includes(String(MIN_ACCEPTABLE_WIDTH)), "理由里要写出具体宽度")
});

test("截图尺寸闸：超过模型像素上限时拒绝（实测边界 14~19MP 被 400）", () => {
  const verdict = judgeScreenshot(2000, 9632);
  assert.equal(verdict.ok, false);
  if (verdict.ok) return;
  assert.match(verdict.message, /太大/);
});

test("尺寸闸查的是**产物尺寸**，所以单边超限的图在拍照阶段就已被缩放", () => {
  // 967x8260 是实测撞到的真实尺寸：7.99MP 没超像素，却因单边 8260 > 8192 被模型拒收。
  // 修法是 `planCaptureSize` 同时看两条限制——缩放之后这里就该放行。
  const plan = planCaptureSize(967, 8260);
  assert.equal(plan.needsResize, true);
  assert.ok(Math.max(plan.width, plan.height) <= MAX_CAPTURE_EDGE, `${plan.width}x${plan.height} 单边还是超了`);
  assert.ok(plan.width * plan.height <= MAX_CAPTURE_PIXELS);
  assert.equal(judgeScreenshot(plan.width, plan.height).ok, true);
});

test("截图尺寸闸：合法尺寸放行", () => {
  const verdict = judgeScreenshot(1009, 3091);
  assert.equal(verdict.ok, true);
  assert.equal(judgeScreenshot(MIN_ACCEPTABLE_WIDTH, 1).ok, true);
  // 取图偏好（1000）与收图底线（800）是两个数——前者管视口，后者管放行
  assert.ok(MIN_CAPTURE_WIDTH > MIN_ACCEPTABLE_WIDTH);
});

test("data URL 必须带 image/ 前缀（少写实测被 400 拒绝）", () => {
  const url = toDataUrl("AAAA", "image/jpeg");
  assert.ok(url.startsWith("data:image/jpeg;base64,"));
  // 已知的错误写法：data:jpeg;base64, —— 这条断言就是为了让它不能再出现
  assert.ok(!url.startsWith("data:jpeg"));
});

test("未知 MIME 退到 jpeg，不把畸形 MIME 传给模型", () => {
  assert.ok(toDataUrl("AAAA", "image/tiff").startsWith("data:image/jpeg;base64,"));
  assert.ok(toDataUrl("AAAA", "").startsWith("data:image/jpeg;base64,"));
});

// ---------------------------------------------------------------------------
// 提示词契约
// ---------------------------------------------------------------------------

test("提示词包含全部契约要点（缺一条就会实测过的那个失败复现）", () => {
  const system = buildVisionSystemPrompt();
  for (const key of PROMPT_CONTRACT) {
    assert.ok(system.includes(key), `提示词缺少契约要点：${key}`);
  }
  // 九个组件必须全列——少一个，模型就会自创组件名，然后被 coerceBlocks 丢掉
  for (const type of COMPONENT_TYPES) {
    assert.ok(system.includes(type), `提示词没有列出组件：${type}`);
  }
  // 版式枚举必须全列，否则模型会写 "hero-split-left" 这种不存在的版式
  for (const [type, variants] of Object.entries(COMPONENT_VARIANTS)) {
    for (const variant of variants) {
      assert.ok(system.includes(variant), `提示词没有列出 ${type} 的版式：${variant}`);
    }
  }
  assert.ok(system.includes(String(MAX_COLLECTION_ITEMS)), "提示词必须写明集合条数上限");
});

test("任务段带上用户的补充信息，且明确要求只输出 JSON", () => {
  const user = buildVisionUserPrompt({ note: "这是我们公司自己的旧站" });
  assert.ok(user.includes("这是我们公司自己的旧站"));
  assert.ok(user.includes("只输出 JSON"));
  // 空备注不该产生一行空的"用户补充说明："
  assert.ok(!buildVisionUserPrompt({}).includes("用户补充说明"));
});

// ---------------------------------------------------------------------------
// 清洗（防存储型 XSS 与内容策略阻断）
// ---------------------------------------------------------------------------

test("stripDangerous 删掉事件处理器与 javascript:，不留给转义显示成乱码", () => {
  assert.equal(stripDangerous("<script>alert(1)</script>你好"), "alert(1)你好");
  assert.equal(stripDangerous("<iframe src=//evil></iframe>"), "");
  assert.equal(stripDangerous("javascript:alert(1)"), "alert(1)");
  // ⚠️ 这里**故意保留**裸标签：只删危险的那部分（onerror=）就够了。
  // 第一版想连标签一起删，结果 `[^>]*` 在 onerror= 被删之后跨不过剩下的 `>`，
  // 反而什么都没删掉——这条断言就是这个教训的存档。
  // 剩下的裸标签会被拼装器的 `esc()` 转义成纯文本，没有执行面。
  assert.equal(stripDangerous("<img src=x onerror=alert(1)>"), "<img src=x alert(1)>");
  // 事件处理器不论大小写都要删
  assert.equal(stripDangerous("<div OnMouseOver=alert(1)>x</div>"), "<div alert(1)>x</div>");
});

test("sanitizeFact 把示例值换成缺口标记（fabricated 是 block 级规则，命中站就发不出去）", () => {
  assert.equal(sanitizeFact("sales@example.com"), "待补充");
  assert.equal(sanitizeFact("lorem ipsum dolor"), "待补充");
  assert.equal(sanitizeFact(""), "待补充");
});

test("sanitizeFact 认出模板演示数据的假电话（实测 400-123-4567 被模型如实抄回）", () => {
  assert.equal(sanitizeFact("400-123-4567"), "待补充");
  assert.equal(sanitizeFact("13800138000"), "待补充");
  assert.equal(sanitizeFact("000-000-0000"), "待补充");
  // 真实号码要保留原样
  assert.equal(sanitizeFact("0371-8888 6666"), "0371-8888 6666");
});

test("sanitizeFact 把'缺口写成了句子'收回成缺口标记本身（meta_commentary 是 block 级）", () => {
  assert.equal(sanitizeFact("此处应填写联系电话"), "待补充");
  assert.equal(sanitizeFact("请补充邮箱"), "待补充");
  // 纯缺口标记保持原样，不要变成"待补充待补充"
  assert.equal(sanitizeFact("待补充"), "待补充");
});

// ---------------------------------------------------------------------------
// 模型输出归一
// ---------------------------------------------------------------------------

/** 一份最小可用的模型输出（真实实测的形态，去掉营销数字）。 */
function rawModelOutput(overrides: Record<string, unknown> = {}) {
  return {
    templateId: "Fengji Industrial 风机",
    name: "风机工业",
    companyName: "鼎力风机设备有限公司",
    siteName: "鼎力风机设备",
    industry: "工业制造",
    goal: "展示产品并获取询盘",
    tokens: { primary: "#c8102e", secondary: "#1a1a1a", accent: "#e63946", fontStyle: "sans", radius: "sharp", density: "compact" },
    blocks: [{ type: "navbar" }, { type: "hero", variant: "cover" }, { type: "products" }, { type: "footer" }],
    content: {
      hero: { title: "某机械 风机工业", subtitle: "让您满意，是我们不懈的追求。", cta: "查看更多" },
      about: { title: "关于我们", body: "专注工业风机。" },
      features: { title: "核心优势", intro: "", items: [{ title: "质量", body: "可追溯" }] },
      services: { title: "服务", intro: "", items: [] },
      products: { title: "产品展示", intro: "" },
      contact: { title: "联系我们", body: "", phone: "400-123-4567", email: "sales@example.com", address: "待补充" },
      navigation: { about: "关于我们", products: "产品展示", contact: "联系我们" },
    },
    products: [
      { sku: "TDS-48RD", name: "单吸离心风机", summary: "适配除尘系统", category: "离心风机" },
    ],
    ...overrides,
  };
}

test("正常输出能被归一成一份**通过正式 schema** 的草稿", () => {
  const result = coerceVisionDsl(rawModelOutput());
  assert.equal(result.ok, true, result.ok ? "" : result.issues.join("；"));
  if (!result.ok) return;
  // 最后那道权威校验必须真的过——兜底写得再多都不能省掉它
  assert.equal(siteDraftSchema.safeParse(result.dsl.content).success, true);
  assert.equal(result.dsl.content.content.hero.title.zh, "某机械 风机工业");
  assert.equal(result.dsl.tokens.primary, "#c8102e");
});

test("节标题被包成 LocalizedText（第一版这里直接给了字符串，被 schema 拦下）", () => {
  const result = coerceVisionDsl(rawModelOutput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const sections = result.dsl.content.content;
  for (const key of ["about", "features", "services", "products", "contact"] as const) {
    const title = sections[key].title as { zh?: unknown; en?: unknown } | undefined;
    assert.equal(typeof title, "object", `${key}.title 必须是 { zh, en }`);
    assert.equal(typeof title?.zh, "string");
  }
});

test("导航词去重：模型把两项写成同一个名字时不留两个一样的入口", () => {
  // 实测（2026-09-11）：模型把 services 也写成"产品展示"，导航栏出现两个相同入口
  const result = coerceVisionDsl(rawModelOutput({
    content: {
      ...rawModelOutput().content,
      navigation: { about: "关于我们", services: "产品展示", products: "产品展示", contact: "联系我们" },
    },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const labels = result.dsl.content.navigation.map((item) => item.label.zh).filter(Boolean);
  assert.equal(new Set(labels).size, labels.length, `导航词必须互不相同，实际：${labels.join(" / ")}`);
  // 先声明的那一项保留原词，后面重复的退回自己的默认词
  const byId = (id: string) => result.dsl.content.navigation.find((item) => item.id === id);
  assert.equal(byId("services")?.label.zh, "产品展示");
  assert.equal(byId("products")?.label.zh, "产品");
});

test("导航词全部缺失时回落到默认词，不留空入口", () => {
  const result = coerceVisionDsl(rawModelOutput({
    content: { ...rawModelOutput().content, navigation: {} },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const key of ["about", "features", "services", "products", "contact"]) {
    const item = result.dsl.content.navigation.find((nav) => nav.id === key);
    assert.ok(item, `导航缺了 ${key} 这一项`);
    assert.ok(item.label.zh.length > 0, `${key} 的导航词不能为空`);
  }
});

test("导航项都带 target——否则是点了没反应的坏链", () => {
  // ⑥ 数组化后 `target` 是数据。模型自创的 id 会指向一个不存在的锚点，
  // 所以归一化**只收默认那几项**，target 一律取默认值。
  const result = coerceVisionDsl(rawModelOutput({
    content: {
      ...rawModelOutput().content,
      // 模型编了两个不存在的导航项，想制造指向空锚点的链接
      navigation: { about: "关于我们", contact: "联系我们", pricing: "价格", blog: "博客" },
    },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.dsl.content.navigation.map((item) => item.id),
    ["about", "features", "services", "products", "contact"],
    "只应保留锚点真实存在的那几项",
  );
  for (const item of result.dsl.content.navigation) {
    assert.equal(item.target, `#${item.id}`, "target 必须指向自己那个板块的锚点");
  }
});

test("模板 id 被归一成合法目录名（模型爱给中文或空格）", () => {
  const result = coerceVisionDsl(rawModelOutput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.dsl.templateId, /^[a-z0-9][a-z0-9-]{0,39}$/);
  assert.equal(coerceTemplateId("鼎力风机", "seed"), "seed");
  assert.equal(coerceTemplateId("Fengji Fan", "seed"), "fengji-fan");
  assert.equal(coerceTemplateId("--", "seed"), "seed");
});

test("不存在的组件被丢掉并留 warning，不静默产出空 section", () => {
  // 2026-09-11（④）：`faq` 从"不存在的组件"变成了真组件（拼装器现在能拼它），
  // 所以这条断言改成只丢 `pricing`。**用 `faq` 当反例不再成立**——
  // 它现在是合法组件名，再用它测"未知组件"就是在测错误的东西。
  const result = coerceVisionDsl(rawModelOutput({
    blocks: [{ type: "hero" }, { type: "pricing" }],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dsl.blocks.map((block) => block.type), ["hero"]);
  assert.equal(result.warnings.some((warning) => warning.includes("pricing")), true);
});

// ---------------------------------------------------------------------------
// ④ 组件扩充：FAQ / 评价 / Logo 墙（2026-09-11）
// ---------------------------------------------------------------------------

test("FAQ 与评价进得了草稿，且没有时**保持 undefined**而不是空壳", () => {
  // 图里没有 FAQ 的时候，`content.faq = {items: []}` 会让"这个站没有 FAQ"
  // 变成"有一个空的 FAQ"——草稿里多一个假事实，AI 之后就会以为那里有东西可改。
  const without = coerceVisionDsl(rawModelOutput());
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.equal(without.dsl.content.content.faq, undefined);
  assert.equal(without.dsl.content.content.testimonials, undefined);
  assert.deepEqual(without.dsl.content.logos, []);

  const withSections = coerceVisionDsl(rawModelOutput({
    content: {
      ...rawModelOutput().content,
      faq: {
        title: "常见问题",
        intro: "",
        items: [{ title: "交期多久？", body: "常规型号 15 天。" }, { title: "", body: "没有问题只有回答" }],
      },
      testimonials: {
        title: "客户评价",
        intro: "",
        items: [{ quote: "交付很稳。", author: "某集团采购部", role: "采购总监" }, { quote: "", author: "没内容" }],
      },
    },
    blocks: [{ type: "navbar" }, { type: "hero" }, { type: "faq" }, { type: "testimonials" }, { type: "footer" }],
  }));
  assert.equal(withSections.ok, true, withSections.ok ? "" : withSections.issues.join("；"));
  if (!withSections.ok) return;
  // 没有问题的条目在折叠面板里是打不开的空行 —— 必须在归一化时丢掉
  assert.equal(withSections.dsl.content.content.faq?.items.length, 1);
  // 没有正文的"评价"没有意义
  assert.equal(withSections.dsl.content.content.testimonials?.items.length, 1);
});

test("评价的署名读不到时留空——**不许写「待补充」**", () => {
  // `sanitizeFact` 会把缺失值归一成「待补充」，那是给电话/邮箱设计的
  // （缺口标记会被质检识别、发布时隐藏）。但一个 `<cite>待补充</cite>`
  // 会当成真名字渲染出来——而署名恰恰是最容易被模型编的部分。
  const result = coerceVisionDsl(rawModelOutput({
    content: {
      ...rawModelOutput().content,
      testimonials: {
        title: "客户评价",
        intro: "",
        items: [{ quote: "交付很稳。", author: "待补充", role: "待补充" }],
      },
    },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = result.dsl.content.content.testimonials?.items[0];
  assert.ok(item, "评价应保留（正文是有的）");
  assert.equal(item.author.zh, "", "读不到署名就留空，不能写待补充");
  assert.equal(item.role.zh, "", "读不到身份就留空");
});

test("Logo 墙只收有名字的——读不出名字的格子不渲染", () => {
  // 从截图里读公司名可能不准，但"一个没有名字的格子"在页面上无法表达任何东西
  // （一排无名图片，读屏也念不出来）。宁可不放。
  const result = coerceVisionDsl(rawModelOutput({
    logos: [{ name: "某集团" }, { name: "" }, { name: "待补充" }, { name: "另一家" }],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dsl.content.logos.map((item) => item.name), ["某集团", "另一家"]);
});

test("提示词里写全了新增组件的名字与铁律（否则模型会自创名字）", () => {
  const system = buildVisionSystemPrompt();
  for (const type of ["faq", "testimonials", "logos"]) {
    assert.ok(system.includes(`- ${type}:`), `组件清单缺 ${type}`);
    assert.ok(system.includes(`"${type}"`), `输出格式里缺 ${type} 的内容形状`);
  }
});

test("非法版式回退默认值（不自作主张丢组件）", () => {
  const result = coerceVisionDsl(rawModelOutput({
    blocks: [{ type: "hero", variant: "hero-split-left" }],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.dsl.blocks.length, 1);
  assert.equal(result.dsl.blocks[0].variant, undefined);
  assert.equal(result.warnings.some((warning) => warning.includes("hero-split-left")), true);
});

test("漏掉 hero 时自动补在最前（它是门禁硬要求，缺了整站过不了入库）", () => {
  const result = coerceVisionDsl(rawModelOutput({
    blocks: [{ type: "navbar" }, { type: "footer" }],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.dsl.blocks[0].type, "hero");
});

test("模型给的纯数字 SKU 被替换（'1' 会变成没人认得出的槽位）", () => {
  const result = coerceVisionDsl(rawModelOutput({
    products: [
      { sku: "1", name: "离心风机", summary: "A" },
      { sku: "2", name: "轴流风机", summary: "B" },
    ],
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const product of result.dsl.content.products) {
    assert.ok(!/^\d+$/.test(product.sku), `SKU 不该是纯数字：${product.sku}`);
  }
  // 名称不同 → 派生出的 SKU 也必须不同，否则槽位会撞车
  const skus = result.dsl.content.products.map((product) => product.sku);
  assert.equal(new Set(skus).size, skus.length);
});

test("集合条数超上限时截断并如实告知（schema 硬上限 12）", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ title: `标题${index}`, body: `说明${index}` }));
  const result = coerceVisionDsl(rawModelOutput({
    content: { ...rawModelOutput().content, features: { title: "优势", intro: "", items } },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.dsl.content.content.features.items.length, MAX_COLLECTION_ITEMS);
  assert.equal(result.warnings.some((warning) => warning.includes("超出上限")), true);
});

test("首屏标题读不出来 = 明确失败，不硬造一个标题糊过去", () => {
  const result = coerceVisionDsl(rawModelOutput({
    content: { ...rawModelOutput().content, hero: { title: "", subtitle: "有副标题", cta: "按钮" } },
  }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.issues.some((issue) => issue.includes("首屏大标题")), true);
});

test("公司名读不出来时用站点名兜底，而不是让整次生成失败", () => {
  const result = coerceVisionDsl(rawModelOutput({ companyName: "待补充", siteName: "某机械" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.dsl.content.companyName, "某机械");
});

test("非法色值回退默认色并留 warning，不因一个色值废掉整次生成", () => {
  const result = coerceVisionDsl(rawModelOutput({
    tokens: { primary: "red", secondary: "#1a1a1a", accent: "#e63946", fontStyle: "weird", radius: "sharp", density: "compact" },
  }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.dsl.tokens.primary, /^#[0-9a-f]{6}$/);
  assert.equal(result.dsl.tokens.fontStyle, "sans");
  assert.equal(result.warnings.some((warning) => warning.includes("primary")), true);
});

test("模型完全不给内容时也能产出一份合法草稿（但首屏标题除外——它是硬要求）", () => {
  // 首屏标题读不出来是**必须失败**的：门禁硬性要求 hero.title，硬造一个标题
  // 等于把"我没读懂这张图"伪装成"我读懂了"。宁可当场告诉用户换张图。
  const noHero = coerceVisionDsl({
    companyName: "鼎力风机",
    siteName: "鼎力风机",
    blocks: [{ type: "hero" }],
    tokens: {},
    content: {},
  });
  assert.equal(noHero.ok, false);

  // 给上首屏标题、其余全缺——这时候所有节才该走兜底并产出一份合法草稿
  const result = coerceVisionDsl({
    companyName: "鼎力风机",
    siteName: "鼎力风机",
    blocks: [{ type: "hero" }],
    tokens: {},
    content: { hero: { title: "工业风机整体解决方案" } },
  });
  assert.equal(result.ok, true, result.ok ? "" : result.issues.join("；"));
  if (!result.ok) return;
  assert.equal(siteDraftSchema.safeParse(result.dsl.content).success, true);
  // 缺的节标题走兜底而不是留空
  assert.equal(result.dsl.content.content.about.title.zh, "关于我们");
  assert.equal(result.dsl.content.content.products.title.zh, "产品中心");
});

test("非对象输入直接失败，不抛异常", () => {
  assert.equal(coerceVisionDsl(null).ok, false);
  assert.equal(coerceVisionDsl("字符串").ok, false);
  assert.equal(coerceVisionDsl([]).ok, false);
});

// ---------------------------------------------------------------------------
// 产品去重与配图规划
// ---------------------------------------------------------------------------

test("同型号的多个产品不会只剩一个（实测：8 张卡全是 TDS-48RD 时全去重会让产品区只剩 1 个）", () => {
  const products = Array.from({ length: 8 }, () => ({
    sku: "TDS-48RD",
    name: { zh: "单吸离心风机", en: "" },
    summary: { zh: "说明", en: "" },
    category: "离心风机",
    status: "published" as const,
    imageColor: "#e8ece9",
  }));
  const result = dedupeProducts(products);
  assert.equal(result.products.length, MAX_PER_SKU);
  assert.equal(result.merged, 8 - MAX_PER_SKU);
  assert.deepEqual(result.mergedSkus, ["TDS-48RD"]);
});

test("型号各不相同时一个都不合并", () => {
  const products = ["A", "B", "C"].map((sku) => ({
    sku,
    name: { zh: sku, en: "" },
    summary: { zh: "", en: "" },
    category: "产品",
    status: "published" as const,
    imageColor: "#e8ece9",
  }));
  const result = dedupeProducts(products);
  assert.equal(result.products.length, 3);
  assert.equal(result.merged, 0);
});

test("配图规划：用**重复出现的同尺寸图 + 落在产品区内**两条同时成立来认产品", () => {
  // 实测（2026-09-11，资源站的模板展示页）：只用面积会裁到广告；
  // 只用"同尺寸成组"会裁到资源站自己的模板推荐卡（它们尺寸也一致）。
  // **位置是唯一可靠的区分**——产品图必然落在模型标出的产品区那一段。
  const available = [
    { url: "ad-banner.jpg", width: 1200, height: 900, y: 600 }, // 在产品区外
    { url: "p1.jpg", width: 600, height: 400, y: 2000 },
    { url: "p2.jpg", width: 604, height: 398, y: 2300 }, // 尺寸几乎一致 → 一组
    { url: "p3.jpg", width: 598, height: 402, y: 2600 },
    { url: "card.jpg", width: 600, height: 400, y: 3400 }, // 尺寸一样但**在产品区外**
  ];
  const plan = planProductShots({ available, needed: 3, productsRange: { top: 1800, bottom: 3000 } });
  assert.deepEqual(plan.map((item) => item.url), ["p1.jpg", "p2.jpg", "p3.jpg"]);
  assert.equal(plan.some((item) => item.url === "ad-banner.jpg"), false);
  assert.equal(plan.some((item) => item.url === "card.jpg"), false, "产品区外的同尺寸图也不能要");
});

test("配图规划：**没有产品区标注就不裁**——宁可留空也不猜", () => {
  const available = [
    { url: "a.jpg", width: 600, height: 400, y: 2000 },
    { url: "b.jpg", width: 600, height: 400, y: 2300 },
  ];
  assert.deepEqual(planProductShots({ available, needed: 2 }), []);
  assert.deepEqual(planProductShots({ available, needed: 2, productsRange: null }), []);
});

test("配图规划：产品区内凑不成一组就不裁", () => {
  const available = [
    { url: "a.jpg", width: 400, height: 400, y: 2000 },
    { url: "b.jpg", width: 900, height: 200, y: 2300 }, // 尺寸各不相同
  ];
  assert.deepEqual(planProductShots({ available, needed: 2, productsRange: { top: 1800, bottom: 3000 } }), []);
});

test("配图规划：按页面纵向顺序返回，与产品在页面上的排列一致", () => {
  const available = [
    { url: "3.jpg", width: 500, height: 500, y: 2600 },
    { url: "1.jpg", width: 500, height: 500, y: 2000 },
    { url: "2.jpg", width: 500, height: 500, y: 2300 },
  ];
  const plan = planProductShots({ available, needed: 3, productsRange: { top: 1800, bottom: 3000 } });
  assert.deepEqual(plan.map((item) => item.url), ["1.jpg", "2.jpg", "3.jpg"]);
});

test("配图规划：图太少时返回空，不返回 undefined 让调用方炸", () => {
  const range = { top: 0, bottom: 5000 };
  assert.deepEqual(planProductShots({ available: [], needed: 3, productsRange: range }), []);
  assert.deepEqual(planProductShots({ available: [{ url: "only.jpg", width: 500, height: 500, y: 100 }], needed: 3, productsRange: range }), []);
  assert.deepEqual(planProductShots({ available: [{ url: "a.jpg", width: 500, height: 500, y: 100 }], needed: 0, productsRange: range }), []);
});

test("板块纵向范围：按块序等分页面，返回目标板块那一格", () => {
  const range = estimateSectionRange(["navbar", "hero", "products", "about", "footer"], "products", 1000);
  assert.ok(range);
  // 5 块、页高 1000 → 每块 200px。products 是第 3 块（index 2）→ 400~600，上下各留 10% 余量
  assert.equal(range.top, 380);
  assert.equal(range.bottom, 620);
});

test("板块纵向范围：板块不在页面上时返回 null——不给假范围", () => {
  assert.equal(estimateSectionRange(["navbar", "hero", "footer"], "products", 1000), null);
  assert.equal(estimateSectionRange([], "products", 1000), null);
  assert.equal(estimateSectionRange(["products"], "products", 0), null);
});

test("describeVisionResult 给出一句人话", () => {
  const result = coerceVisionDsl(rawModelOutput());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const text = describeVisionResult(result.dsl);
  assert.ok(text.includes("鼎力风机设备"));
  assert.ok(text.includes("板块"));
});
