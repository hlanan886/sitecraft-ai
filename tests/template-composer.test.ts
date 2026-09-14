import assert from "node:assert/strict";
import test from "node:test";
import { composeTemplate } from "../lib/template-composer.ts";
import {
  COMPONENT_FIELDS,
  COMPONENT_SECTION,
  COMPONENT_VARIANTS,
  type ComposerDsl,
  validateDsl,
} from "../lib/template-composer-dsl.ts";
import { collectSlotTargetsFromHtmlString } from "../lib/template-runtime-loader.ts";
import { slotToDraftOperation } from "../lib/inline-edit-mapping.ts";
import { applySiteOperations } from "../lib/site-operations.ts";
import { defaultDraft } from "../lib/site-model.ts";

/**
 * 拼装器的契约测试。
 *
 * 重点不是"拼出来好看"，而是**槽位契约**——缺槽位的页面看着正常，
 * 但所有字段一个字都改不了，且**不报错**（最难排查的一类失效）。
 */

function baseDsl(overrides: Partial<ComposerDsl> = {}): ComposerDsl {
  const draft = structuredClone(defaultDraft);
  draft.companyName = "鼎力风机设备有限公司";
  draft.siteName = "鼎力风机设备";
  draft.navigation = [
    { id: "about", label: { zh: "关于我们", en: "About" }, target: "#about" },
    { id: "features", label: { zh: "核心优势", en: "Features" }, target: "#features" },
    { id: "services", label: { zh: "服务支持", en: "Services" }, target: "#services" },
    { id: "products", label: { zh: "产品中心", en: "Products" }, target: "#products" },
    { id: "contact", label: { zh: "联系我们", en: "Contact" }, target: "#contact" },
  ];
  draft.content.hero = {
    title: { zh: "为工业场景而生的大风量风机", en: "Industrial Fans" },
    subtitle: { zh: "专注离心风机制造二十余年。", en: "Two decades." },
    cta: { zh: "获取选型方案", en: "Get a Quote" },
  };
  draft.content.contact.phone = "0371-8888 6666";
  draft.content.contact.email = "sales@dingli-fan.com";

  return {
    templateId: "craft-test",
    name: "测试模板",
    siteName: "鼎力风机设备",
    tokens: {
      primary: "#1f3a5f",
      secondary: "#4a6b8a",
      accent: "#e8a33d",
      fontStyle: "technical" as const,
      radius: "sharp" as const,
      density: "compact" as const,
    },
    blocks: [
      { type: "navbar" as const },
      { type: "hero" as const, variant: "split" },
      { type: "footer" as const },
    ],
    content: draft,
    ...overrides,
  };
}

test("composeTemplate: 产出带槽位契约的自包含 HTML", () => {
  const result = composeTemplate(baseDsl());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // 槽位是就地编辑/覆盖统计/门禁的硬契约——缺了它页面能看但改不了
  assert.ok(result.html.includes('data-sitecraft-slot="hero.title"'), "缺 hero.title 槽位");
  assert.ok(result.html.includes('data-sitecraft-slot="hero.subtitle"'), "缺 hero.subtitle 槽位");
  assert.ok(result.html.includes('data-sitecraft-scope="hero"'), "缺 hero 节归属");

  // 自包含：导出时样式会被内联，不能依赖外部文件
  assert.ok(result.html.includes('href="styles.css"'), "应引用同目录的 styles.css");
  assert.ok(result.css.includes("--sitecraft-radius"), "CSS 未走 token 变量");
  assert.ok(result.html.startsWith("<!doctype html>"), "应以 doctype 开头");
});

test("composeTemplate: 模型漏写首屏标题时用企业名兜底（否则残留占位标题且卡发布）", () => {
  const dsl = baseDsl();
  dsl.content.content.hero.title = { zh: "", en: "" };
  const result = composeTemplate(dsl);
  // 空标题被 validateDsl 拦下——比"产出一个占位标题的站"更早暴露问题
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.path.includes("hero.title")));
  }
});

test("composeTemplate: token 真的进到了 CSS 变量（否则行业差异失效）", () => {
  const result = composeTemplate(baseDsl());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.css.includes("--sitecraft-primary: #1f3a5f"), "primary 未写入");
  assert.ok(result.css.includes("--sitecraft-radius: 2px"), "sharp 应映射为 2px");
  assert.ok(result.css.includes("--sitecraft-section-space: 44px"), "compact 应映射为 44px");
});

test("composeTemplate: 换 token 会改变产出（同一份 DSL 的不同气质）", () => {
  const a = composeTemplate(baseDsl());
  const b = composeTemplate(
    baseDsl({
      tokens: {
        primary: "#7a3b1f",
        secondary: "#a8853f",
        accent: "#f0c04a",
        fontStyle: "editorial",
        radius: "rounded",
        density: "spacious",
      },
    }),
  );
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.css, b.css, "换 token 后 CSS 应不同");
  assert.ok(b.css.includes("--sitecraft-radius: 18px"), "rounded 应映射为 18px");
});

test("composeTemplate: 十二个组件全部实现，不再有「未实现」警告", () => {
  const dsl: ComposerDsl = baseDsl();
  dsl.content.content.faq = {
    title: { zh: "常见问题", en: "" },
    intro: { zh: "", en: "" },
    items: [{ id: "faq-1", title: { zh: "交期多久？", en: "" }, body: { zh: "常规型号 15 天。", en: "" } }],
  };
  dsl.content.content.testimonials = {
    title: { zh: "客户评价", en: "" },
    intro: { zh: "", en: "" },
    items: [{ id: "q-1", quote: { zh: "交付很稳。", en: "" }, author: { zh: "某集团采购部", en: "" }, role: { zh: "", en: "" } }],
  };
  dsl.content.logos = [{ id: "logo-1", name: "某集团" }];
  dsl.blocks = [
    { type: "navbar", variant: "contact-bar" },
    { type: "hero", variant: "split" },
    { type: "features", variant: "grid" },
    { type: "services" },
    { type: "about" },
    { type: "products" },
    { type: "logos", variant: "row" },
    { type: "faq", variant: "accordion" },
    { type: "testimonials", variant: "grid" },
    { type: "contact", variant: "split" },
    { type: "cta" },
    { type: "footer" },
  ];
  const result = composeTemplate(dsl);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.warnings, [], "十二个组件都已实现，不应再有警告");
  // 每个组件都要产出真实的 DOM，不能是空字符串
  for (const id of ["top", "features", "services", "about", "products", "clients", "faq", "testimonials", "contact"]) {
    assert.ok(result.html.includes(`id="${id}"`), `缺少 ${id} 节的产出`);
  }
});

test("composeTemplate: FAQ / 评价 / Logo 的槽位成对且连续编号（做错就填不进去）", () => {
  const dsl = baseDsl();
  dsl.content.content.faq = {
    title: { zh: "常见问题", en: "" },
    intro: { zh: "", en: "" },
    items: [
      { id: "faq-1", title: { zh: "问题一", en: "" }, body: { zh: "回答一", en: "" } },
      { id: "faq-2", title: { zh: "问题二", en: "" }, body: { zh: "回答二", en: "" } },
    ],
  };
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "faq", variant: "accordion" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 用 `<details>/<summary>` 而不是 div —— 折叠、键盘、读屏都是浏览器免费给的
  assert.ok(result.html.includes("<details"), "FAQ 应该用原生 details 折叠");
  assert.ok(result.html.includes("<summary"), "FAQ 应该用原生 summary");
  for (const i of [0, 1]) {
    assert.ok(result.html.includes(`data-sitecraft-slot="faq.items.${i}.title"`), `缺 faq.items.${i}.title`);
    assert.ok(result.html.includes(`data-sitecraft-slot="faq.items.${i}.body"`), `缺 faq.items.${i}.body`);
  }
});

test("composeTemplate: 评价用 blockquote/cite，且读不出署名时不编造", () => {
  const dsl = baseDsl();
  dsl.content.content.testimonials = {
    title: { zh: "客户评价", en: "" },
    intro: { zh: "", en: "" },
    items: [
      { id: "q-1", quote: { zh: "交付很稳。", en: "" }, author: { zh: "某集团采购部", en: "" }, role: { zh: "", en: "" } },
      { id: "q-2", quote: { zh: "售后响应快。", en: "" }, author: { zh: "", en: "" }, role: { zh: "", en: "" } },
    ],
  };
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "testimonials", variant: "grid" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.html.includes("<blockquote"), "评价正文应该是 blockquote");
  assert.ok(result.html.includes("<cite"), "署名应该是 cite");
  assert.ok(result.html.includes('data-sitecraft-slot="testimonials.items.0.quote"'));
  // 第二条没有署名——不该凭空补一个身份出来，那是在替客户说没说过的话
  assert.ok(!result.html.includes('testimonials.items.1.author"'), "没有署名时不该渲染 cite 槽位");
});

test("composeTemplate: Logo 墙没图时渲染公司名，不是空框", () => {
  const dsl = baseDsl();
  dsl.content.logos = [
    { id: "logo-1", name: "某集团" },
    { id: "logo-2", name: "另一家" },
  ];
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "logos", variant: "row" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.html.includes("某集团"), "没有 logo 图时应该渲染公司名——一排灰格子会让访客以为页面坏了");
  assert.ok(result.html.includes('data-sitecraft-slot="logos.0.name"'));
});

test("composeTemplate: 空集合的 FAQ/评价/Logo 整节不渲染（不能留一个光标题）", () => {
  const dsl = baseDsl();
  dsl.content.content.faq = { title: { zh: "常见问题", en: "" }, intro: { zh: "", en: "" }, items: [] };
  dsl.content.content.testimonials = { title: { zh: "客户评价", en: "" }, intro: { zh: "", en: "" }, items: [] };
  dsl.content.logos = [];
  const result = composeTemplate({
    ...dsl,
    blocks: [{ type: "hero", variant: "split" }, { type: "faq" }, { type: "testimonials" }, { type: "logos" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const id of ["faq", "testimonials", "clients"]) {
    assert.ok(!result.html.includes(`id="${id}"`), `${id} 没有内容时不该渲染出空节`);
  }
});

test("composeTemplate: features.items 的槽位成对且连续编号（做错就填不进去）", () => {
  const dsl = baseDsl();
  dsl.content.content.features.items = [
    { id: "a", title: { zh: "优势一", en: "" }, body: { zh: "说明一", en: "" } },
    { id: "b", title: { zh: "优势二", en: "" }, body: { zh: "说明二", en: "" } },
  ];
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "features", variant: "grid" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const i of [0, 1]) {
    assert.ok(result.html.includes(`data-sitecraft-slot="features.items.${i}.title"`), `缺 items.${i}.title`);
    assert.ok(result.html.includes(`data-sitecraft-slot="features.items.${i}.body"`), `缺 items.${i}.body`);
  }
});

test("composeTemplate: 产品槽用真实 SKU（写 products.0.name 会被当成 sku=0）", () => {
  const dsl = baseDsl();
  dsl.content.products = [
    {
      sku: "TDS-48RD",
      name: { zh: "TDS-48RD 离心风机", en: "Centrifugal Fan" },
      summary: { zh: "风量 4800m³/h", en: "4800 m3/h" },
      category: "离心风机",
      status: "published",
      imageColor: "#cccccc",
    },
  ];
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "products" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.html.includes('data-sitecraft-slot="products.TDS-48RD.name"'), "产品槽没用真实 SKU");
  assert.ok(result.html.includes('data-sitecraft-slot="products.TDS-48RD.summary"'), "产品 summary 槽缺失");
  assert.ok(!result.html.includes("products.0."), "不该出现数字索引的产品槽");
});

test("composeTemplate: 联系区槽位打在正确的元素上（对齐 slot-injection 规则）", () => {
  const dsl = baseDsl();
  dsl.content.content.contact.address = { zh: "河南省郑州市高新区", en: "" };
  const result = composeTemplate({ ...dsl, blocks: [{ type: "hero", variant: "split" }, { type: "contact", variant: "split" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // email/phone 在 <a href="mailto:/tel:"> 上，address 在 <address> 上
  assert.ok(/<a[^>]*href="tel:[^"]*"[^>]*data-sitecraft-slot="contact.phone"/.test(result.html), "phone 槽应打在 tel 链接上");
  assert.ok(/<a[^>]*href="mailto:[^"]*"[^>]*data-sitecraft-slot="contact.email"/.test(result.html), "email 槽应打在 mailto 链接上");
  assert.ok(/<address[^>]*data-sitecraft-slot="contact.address"/.test(result.html), "address 槽应打在 <address> 上");
});

test("composeTemplate: 内容被 HTML 转义（防注入——站点是要发布出去的）", () => {
  const dsl = baseDsl();
  dsl.content.content.hero.subtitle = { zh: '<script>alert(1)</script>', en: "" };
  const result = composeTemplate(dsl);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(!result.html.includes("<script>alert"), "脚本标签未被转义");
  assert.ok(result.html.includes("&lt;script&gt;"), "应转义为实体");
});

test("composeTemplate: 缺 hero 直接失败（它是门禁唯一硬性要求的板块）", () => {
  const dsl = baseDsl();
  dsl.blocks = [{ type: "navbar" }, { type: "footer" }];
  const result = composeTemplate(dsl);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.message.includes("首屏")));
  }
});

test("validateDsl: 拦住未知组件、未知版式、超量集合", () => {
  const dsl = baseDsl();
  // @ts-expect-error 故意传非法值，验证运行时校验
  dsl.blocks = [{ type: "navbar" }, { type: "hero", variant: "split" }, { type: "unknown-widget" }];
  const issues = validateDsl(dsl);
  assert.ok(issues.some((issue) => issue.message.includes("未知组件")), "应拦住未知组件");

  const badVariant = baseDsl();
  badVariant.blocks = [{ type: "hero", variant: "nonexistent" }];
  assert.ok(
    validateDsl(badVariant).some((issue) => issue.message.includes("不支持版式")),
    "应拦住未知版式",
  );

  const tooMany = baseDsl();
  tooMany.content.content.features.items = Array.from({ length: 13 }, (_, i) => ({
    id: `item-${i}`,
    title: { zh: `优势 ${i}`, en: "" },
    body: { zh: "说明", en: "" },
  }));
  assert.ok(
    validateDsl(tooMany).some((issue) => issue.message.includes("最多 12 条")),
    "应拦住超量集合（schema 硬约束）",
  );
});

test("导航槽位能被装载器认出来，且能就地编辑（⑥ 的完整闭环）", () => {
  /**
   * 这条把**四个部件**串起来验一遍：
   *   拼装器打槽位 → 装载器认得回 → 就地编辑映射得出操作 → set_text 的 schema 收得下
   *
   * 为什么要串起来：⑥ 之前导航**压根没有槽位**（打了也会被白名单丢），
   * 而"打了但没人认"正是这个项目已经踩过四次的坑
   * （hero.cta / products / logos / 现在的 navigation）。
   * 分成四条单测是发现不了"两头对不上"的——每条自己都过。
   */
  const result = composeTemplate(baseDsl());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // ① 拼装器确实打上了，形态是 `navigation.<id>.<locale>`
  for (const id of ["about", "features", "services", "products", "contact"]) {
    assert.ok(
      result.html.includes(`data-sitecraft-slot="navigation.${id}.zh"`),
      `拼装器没打 navigation.${id}.zh`,
    );
  }

  // ② 装载器认得出（不带这条，槽位会被静默丢弃，页面上点了没反应）
  const targets = collectSlotTargetsFromHtmlString(result.html);
  assert.ok(targets.includes("navigation"), "装载器把 navigation 槽位丢了——导航会变成点不动的死文字");

  // ③ 就地编辑能把它变成一条 set_text
  const draft = baseDsl().content;
  const edit = slotToDraftOperation({
    slot: "navigation.about.zh",
    value: "关于启衡",
    originalValue: "关于我们",
    draft,
    uiLocale: "zh",
  });
  assert.equal(edit.ok, true, edit.ok ? "" : edit.message);
  if (!edit.ok) return;
  assert.equal((edit.operation as { target: string }).target, "navigation.about");

  // ④ 那条 set_text 真的能被写回（用真实 apply 跑一遍，不是只看类型）
  const after = applySiteOperations(draft, [edit.operation], {
    templateIds: new Set(["craft-test"]),
    lastChange: "test",
  });
  assert.equal(after.draft.navigation.find((item) => item.id === "about")?.label.zh, "关于启衡");
  // 只动了这一项，别的导航项不受影响
  assert.equal(after.draft.navigation.find((item) => item.id === "features")?.label.zh, "核心优势");
});

test("写一个草稿里不存在的导航 id：**不崩，只是这一条不生效**", () => {
  /**
   * 模型完全可能输出 `navigation.foo`（它只看得见提示词里列的 id，看不见实际有哪些）。
   * 旧代码 `localizedValue(draft, target)[locale] = value` 会在这里
   * `TypeError: Cannot set properties of undefined`——**整批操作全崩**，
   * 用户改的其它内容一起丢。
   */
  const draft = baseDsl().content;
  const after = applySiteOperations(
    draft,
    [
      { op: "set_text", target: "navigation.does-not-exist", locale: "zh", value: "幽灵" } as never,
      { op: "set_text", target: "hero.title", locale: "zh", value: "改好了", expectedValue: "为工业场景而生的大风量风机" },
    ],
    { templateIds: new Set(["craft-test"]), lastChange: "test" },
  );
  assert.equal(after.draft.content.hero.title.zh, "改好了", "一条幽灵导航不该连累同一批里的其它操作");
});

test("新组件的槽位能被装载器认出来（不被白名单静默丢弃）", () => {  // 实测教训（2026-09-11，④）：`logos.0.name` 第一次上线时被**静默丢弃**了——
  // `normalizeSlotTarget` 用 `startsWith("logos.name.")` 匹配，而真实槽位值中段是数字。
  // 同类问题在这个文件里已经出现三次（hero.cta / products / logos），
  // 所以这里把它钉死：**拼装器写出去的槽位，装载器必须认得回来**。
  const dsl = baseDsl();
  dsl.content.content.faq = {
    title: { zh: "常见问题", en: "" },
    intro: { zh: "", en: "" },
    items: [{ id: "faq-1", title: { zh: "问题一", en: "" }, body: { zh: "回答一", en: "" } }],
  };
  dsl.content.content.testimonials = {
    title: { zh: "客户评价", en: "" },
    intro: { zh: "", en: "" },
    items: [{ id: "q-1", quote: { zh: "很稳。", en: "" }, author: { zh: "某集团", en: "" }, role: { zh: "", en: "" } }],
  };
  dsl.content.logos = [{ id: "logo-1", name: "某集团" }];
  const result = composeTemplate({
    ...dsl,
    blocks: [
      { type: "hero", variant: "split" },
      { type: "logos", variant: "row" },
      { type: "faq", variant: "accordion" },
      { type: "testimonials", variant: "grid" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const targets = collectSlotTargetsFromHtmlString(result.html);
  for (const expected of ["faq.items", "testimonials.items", "logos"]) {
    assert.ok(targets.includes(expected), `${expected} 被白名单丢了——页面看着对，但这些字段一个字都改不了`);
  }
});

test("组件定义完整：每个组件都有 section 映射与可编辑字段（编辑面板 M6 依赖它）", () => {
  for (const [type, variants] of Object.entries(COMPONENT_VARIANTS)) {
    assert.ok(variants.length > 0, `${type} 至少要有一个版式`);
    assert.ok(type in COMPONENT_SECTION, `${type} 缺 section 映射`);
    assert.ok(type in COMPONENT_FIELDS, `${type} 缺可编辑字段定义`);
  }
  // 有内容的组件必须能映射到 SiteDraft 的某一节——否则编辑面板无处可改
  assert.equal(COMPONENT_SECTION.hero, "hero");
  assert.equal(COMPONENT_SECTION.products, "products");
  assert.equal(COMPONENT_SECTION.faq, "faq");
  assert.equal(COMPONENT_SECTION.testimonials, "testimonials");
  assert.equal(COMPONENT_SECTION.logos, "logos");
  // 静态组件的映射应为 null
  assert.equal(COMPONENT_SECTION.navbar, null);
  assert.equal(COMPONENT_SECTION.footer, null);
});
