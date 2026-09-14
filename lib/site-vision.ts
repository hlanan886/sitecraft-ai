/**
 * 「看图 → 拼装说明书」的**纯逻辑层**。
 *
 * ## 这个模块负责三段里最难debug的一段
 *
 * ```
 * ① 告诉模型"能选什么、怎么填"      ← 本模块 buildVisionPrompt
 * ② 调模型                          ← ai-provider.ts 的 requestVisionDsl
 * ③ 把模型吐的 JSON 拧成合法 DSL     ← 本模块 coerceVisionDsl
 * ```
 *
 * 第 ③ 段是**唯一的防线**。实测约束（都不是猜测）：
 *
 * | 实测事实 | 后果 | 本模块怎么兜 |
 * |---|---|---|
 * | 关推理时 16000 token 打满被截断 | 产出是**残页** | 截断单独判，不当作"格式错"重试 |
 * | 模型会把 `<script>` 写进文案 | 存储型 XSS | 全部字符串过 `stripDangerous` 再转义（`esc` 在拼装器里） |
 * | 模型爱填 `example.com` / "待补充" | 触发内容策略阻断，站**发不出去** | `sanitizeFact` 抹掉，退回缺口标记 |
 * | `products.0.name` 之类的槽位不存在 | 就地编辑**静默失效** | 只产出 `products[].sku`，槽位由拼装器按真实 SKU 刻 |
 * | 模型给的 id 带中文/空格 | 目录名非法，落盘直接被拒 | `coerceTemplateId` 归一 |
 *
 * ## 纯函数，不碰 node:fs、不碰网络
 *
 * 与其他模块同一分工：纯逻辑与重依赖分开，否则 `node:fs` / `playwright`
 * 进客户端 bundle，Turbopack 报 `does not support external modules` 而**构建失败**（实测）。
 */
import { DRAFT_FIELD_MAX_LENGTH } from "./draft-field-limits.ts";
import { readabilityHint } from "./content-policy.ts";
import type { DesignTokens, EditableItem, LocalizedText, LogoItem, NavItem, Product, SiteDraft, Testimonial } from "./site-document.ts";
import { defaultDraft, MAX_NAV_ITEMS, siteDraftSchema } from "./site-document.ts";
import { COMPONENT_TYPES, COMPONENT_VARIANTS, MAX_COLLECTION_ITEMS, MAX_LOGO_ITEMS, type ComponentType } from "./template-composer-dsl.ts";
import { MAX_CAPTURE_EDGE, MAX_CAPTURE_PIXELS, MIN_ACCEPTABLE_WIDTH } from "./site-capture.ts";

// ---------------------------------------------------------------------------
// 输入闸：截图能不能喂给模型
// ---------------------------------------------------------------------------

/**
 * 为什么在这里再判一次尺寸（`site-capture.ts` 里已经判过）。
 *
 * 因为**输入来源不止一个**：链接走 capture（已判并已缩放），
 * 而**用户直接传的那张图**没有经过任何处理就到这里。两处都判，
 * 是为了让"这张图能不能用"的答案**只由本模块给出**——上层不必知道调用方是谁。
 */
export type ScreenshotVerdict = { ok: true; width: number; height: number } | { ok: false; message: string };

export function judgeScreenshot(width: number, height: number): ScreenshotVerdict {
  if (width <= 0 || height <= 0) {
    return { ok: false, message: "这张图读不出尺寸，可能文件坏了。换一张试试。" };
  }
  if (width < MIN_ACCEPTABLE_WIDTH) {
    return {
      ok: false,
      message: `这张图太窄了（${width}px 宽），放大后字会糊，读不准。建议传宽度 ${MIN_ACCEPTABLE_WIDTH}px 以上的整页截图。`,
    };
  }
  if (width * height > MAX_CAPTURE_PIXELS) {
    return {
      ok: false,
      message: `这张图太大了（${((width * height) / 1e6).toFixed(1)}MP），模型读不了。系统会自动缩小后重试。`,
    };
  }
  // 单边超限是**另一条独立限制**（实测：967x8260 像素没超却被拒）
  if (Math.max(width, height) > MAX_CAPTURE_EDGE) {
    return {
      ok: false,
      message: `这张图太长了（最长边 ${Math.max(width, height)}px），模型读不了。系统会自动缩小后重试。`,
    };
  }
  return { ok: true, width, height };
}

/** 把一张图交给模型时，必须用真正的 MIME。 */
export const ALLOWED_SCREENSHOT_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * data URL 前缀。
 *
 * 🔴 **`data:jpeg;base64,` 是错的**——实测被模型以 400 拒绝，且报错信息看不出原因。
 * 必须是 `data:image/jpeg;base64,`。这条踩过一次，写在这里防复发。
 */
export function toDataUrl(base64: string, mime: string): string {
  const safeMime = (ALLOWED_SCREENSHOT_MIME as readonly string[]).includes(mime) ? mime : "image/jpeg";
  return `data:${safeMime};base64,${base64.replace(/\s/g, "")}`;
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

/**
 * 提示词里**必须**出现的约束，测试逐条断言。
 *
 * 这些不是"写了更好"，每一条都对应一个实测过的失败模式（见文件顶部表格）。
 * 测试锁住它们，是为了防止后人"精简提示词"时把防线删掉。
 */
export const PROMPT_CONTRACT = [
  "组件", // 组件清单必须给全，且明说不能自创，否则模型会造出 "pricing" 这种名字
  "variant", // 版式必须列可选值，否则模型自创 "hero-split-left"
  "sku", // 产品必须带真实 SKU，否则槽位对不上
  "data-sitecraft-slot", // 明确告诉它槽位不用管（我们拼）
  "待补充", // 缺口标记的准确写法，避免它写"此处应填写电话"
] as const;

/** 组件与版式的中文说明——模型据此选型。 */
const COMPONENT_GUIDE: Record<ComponentType, string> = {
  navbar: "顶部导航（固定，内容取 companyName 与 navigation）。simple=普通；contact-bar=顶部多一条细联系方式栏",
  hero: "首屏。split=左文右图；cover=背景大图居中",
  features: "优势/特性区。grid=三列图标卡；alternating=左右交替图文",
  services: "服务/能力区（三列卡）",
  about: "关于我们（左文右图）",
  products: "产品中心（四列 SKU 网格）",
  logos: "客户/合作方 Logo 墙（一行排列的小格子）",
  faq: "常见问题。accordion=可折叠列表；two-column=左标题右问答",
  testimonials: "客户评价。grid=多列卡片；quote=居中大段引用",
  contact: "联系方式（split=左信息右表单；centered=居中）",
  cta: "行动号召条（内容取首屏标语，不单独填）",
  footer: "页脚（固定，内容取导航与联系方式）",
};

export type VisionPromptOptions = {
  /** 站点形态（企业官网/作品集/博客）——影响措辞，不影响结构 */
  siteModel?: "corporate" | "portfolio" | "blog";
  /** 用户补充的话（可为空）。**图里读不出的信息只有这里能给** */
  note?: string;
  /**
   * 页面标题（只有"网址来源"能给）。
   *
   * 这是**不花模型钱就能拿到的站点信息**——`document.title` 是原站自己写的，
   * 比模型从图上读公司名可靠。给了它，模型在公司名那一项就不必猜。
   */
  titleHint?: string;
};

/**
 * 构建"看图出 DSL"的提示词。
 *
 * 两段：system 放**契约**（不变的规则），user 放**这次的任务**（图 + 补充信息）。
 * 分开是因为契约要能被单独测试、单独演进，而任务段会随图像数变化。
 */
export function buildVisionSystemPrompt(): string {
  const componentList = COMPONENT_TYPES.map((type) => {
    const variants = COMPONENT_VARIANTS[type];
    return `- ${type}: ${COMPONENT_GUIDE[type]}（variant 可选：${variants.join(" | ")}）`;
  }).join("\n");

  return `你是企业官网的**版面分析器**。给你一张网站截图，你输出一份 JSON「拼装说明书」——由我们的代码据此拼出真实网页。

## 你的输出会怎么被使用（决定了你必须遵守什么）

我们不让你写 HTML/CSS。你只输出 JSON。**你可以被替换**——同一张图换个人来分析，产出的网页应该一样。
所以：**不要发明组件、不要发明字段、不要输出空想的内容**。

## 输出格式（严格 JSON，不要 Markdown 代码块）

{
  "templateId": "英文小写短横线，如 dingli-fan",
  "name": "模板显示名，如 鼎力风机 · 工业制造",
  "category": "制造业 | 外贸目录 | 科技企业 | 专业服务 | 其他（九选一）",
  "description": "一句话说明这个模板的行业与气质，40 字以内",
  "siteName": "站点名（通常是公司名）",
  "companyName": "公司名——从截图里读，读不到写 待补充",
  "industry": "行业，如 工业制造",
  "goal": "这个站的目的，一句话",
  "tokens": {
    "primary": "#rrggbb 主色（从截图里取，通常是 logo/按钮/大标题的颜色）",
    "secondary": "#rrggbb 次要色",
    "accent": "#rrggbb 强调色",
    "fontStyle": "sans | editorial | technical",
    "radius": "sharp | soft | rounded",
    "density": "compact | balanced | spacious"
  },
  "blocks": [ { "type": "组件名", "variant": "版式名（可省略）" } ],
  "content": {
    "hero": { "title": "首屏大标题", "subtitle": "副标题", "cta": "按钮文字" },
    "about": { "title": "关于我们标题", "body": "关于我们正文" },
    "features": { "title": "节标题", "intro": "节的引导语", "items": [ { "title": "小标题", "body": "说明" } ] },
    "services": { "title": "节标题", "intro": "引导语", "items": [ { "title": "小标题", "body": "说明" } ] },
    "products": { "title": "产品中心标题", "intro": "产品区引导语" },
    "faq": { "title": "节标题", "intro": "引导语", "items": [ { "title": "问题", "body": "回答" } ] },
    "testimonials": { "title": "节标题", "intro": "引导语", "items": [ { "quote": "客户原话", "author": "客户名或 待补充", "role": "身份，读不到写空字符串" } ] },
    "contact": { "title": "联系区标题", "body": "联系区正文", "phone": "电话或 待补充", "email": "邮箱或 待补充", "address": "地址或 待补充" },
    "navigation": { "about": "导航词", "features": "导航词", "services": "导航词", "products": "导航词", "contact": "导航词" }
  },
  "products": [ { "sku": "型号", "name": "产品名", "summary": "一句话说明", "category": "分类" } ],
  "logos": [ { "name": "客户公司名（读不出公司名就不要这条）" } ],
  "confidence": "high | medium | low（见下方说明）"
}

## confidence 是什么、为什么它重要

- \`high\`：这是一张**企业官网的整页截图**，公司是自己的、产品是自己的、结构清楚；
- \`medium\`：像企业官网，但有些地方不确定（图被裁过、有弹窗遮挡、结构不典型）；
- \`low\`：**这不是一张企业官网截图**——比如它是资源下载站的模板展示页、
  是设计稿、是后台截图、或图里明显混着别的东西（广告、别人的站）。

这个字段决定我们要不要**自动从图里裁产品图**。
\`low\` 时我们不会裁——因为那种页面里"产品区"放的可能根本不是产品
（实测：资源站的模板展示页，产品位置上是它自己的模板推荐卡）。
**如实回答比答得好看重要**：你说 low，我们只是少配几张图；
你说 high 而其实不是，我们会把广告当成产品放进客户的站里。

## 可选组件（**只能用这些**，按截图里的实际顺序排列）

你只能从下面这张清单里挑组件，**不允许自创任何组件或版式**——
换个人来看同一张图，应该选出同一组组件。清单外的名字会被直接丢掉。

${componentList}

## 铁律

1. **只写你从图里真正看到的内容。** 图里没有的公司信息、认证、产能、价格、客户——**一个都不许编**。
   缺失的企业事实（电话/邮箱/地址/成立年份/产能）**统一写「待补充」这三个字**，
   不要写成「此处应填写电话」「请补充地址」这类句子（访客会看到）。
2. **电话号码/邮箱/地址：图里有就照抄，没有就写 待补充**。绝不使用 example.com、13800138000
   这类示例值——它们会当成真信息显示给访客。
3. **产品只列图里真的出现的**，并且**必须给 sku**（截图里的型号，如 TDS-48RD）。
   看不出型号时用产品名的英文短横线形式，**不要用 "1" "2" "3" 这种数字当 SKU**。
   图里没有产品区就把 products 写成 []，并在 blocks 里不要放 products。
4. **blocks 里 hero 必须有**（其余按截图来）。截图里没有的板块就不要放进去，
   不要为了"完整"补一个图里没有的板块。
5. 每个集合（features.items / services.items / faq.items / testimonials.items）**最多 ${MAX_COLLECTION_ITEMS} 条**。
   图里有更多时，合并成最接近的条数。
6. **客户 Logo 墙里读不出公司名就整条不要**——我们不靠猜名字。宁可有五个位置的墙只写三个，
   也不要凑数。「客户 Logo」只在图里**真的有**一排客户/合作方标志时才有。
7. 文案长度：${readabilityHint()}。**照抄截图时优先保留原话**，超长就精简。
8. 全部文案用**截图里的语言**（中文站写中文）。英文名保留英文。
9. **导航词必须互不相同**——五个（about/features/services/products/contact）各给一个不同的词。
   截图里如果有两项叫同一个名字，用该板块的另一个叫法区分（如"服务支持"vs"产品展示"），
   不要留两个一模一样的入口。
10. **不要输出 HTML、CSS、<script>、以及任何 data-sitecraft-slot 属性**——槽位由我们的拼装器负责。`;
}

/**
 * 构建任务段（user 消息的文字部分）。
 *
 * 图**不带**在这里——它作为 `image_url` 内容块单独传（见 `ai-provider.ts`）。
 */
export function buildVisionUserPrompt(options: VisionPromptOptions = {}): string {
  const lines = [
    "这是一张网站截图。请按 system 里的 JSON 格式输出这份网站的「拼装说明书」。",
    "从上到下依次分析：① 首屏（标题/副标题/按钮）② 各板块的顺序与版式 ③ 产品区的型号与名称 ④ 联系方式 ⑤ 配色。",
  ];
  if (options.siteModel === "portfolio") lines.push("注意：这是一个个人作品集，不是企业官网——导航与板块措辞按作品集来。");
  if (options.siteModel === "blog") lines.push("注意：这是一个内容/博客站，不是企业官网——板块以文章列表为主。");
  if (options.titleHint?.trim()) {
    // 明确说这是**从原站拿的事实**而不是猜测——否则模型会把它当成又一条要判断的信息
    lines.push(`这个页面的原始标题是「${options.titleHint.trim()}」（从原站直接读到的，公司名/站点名优先从这里取）。`);
  }
  if (options.note?.trim()) lines.push(`用户补充说明：${options.note.trim()}`);
  lines.push("只输出 JSON。");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 清洗
// ---------------------------------------------------------------------------

/** 缺口标记——与 `site-document.ts` 的约定一字不差，否则内容策略的 fact_gap 规则认不出。 */
export const GAP_MARKER = "待补充";

const MAX_TITLE = 60;
const MAX_BODY = 200;
const MAX_SUMMARY = 120;

/**
 * 抹掉危险字符。
 *
 * 模型偶尔会在文案里带 `<script>` 或 `javascript:`——那是**存储型 XSS**
 * （内容会进模板 HTML、被发布出去）。转义在拼装器里做（`esc`），
 * ⚠️ 只删**危险标签**，不删其余 HTML。
 * 第一版图省事把 `<img src=x onerror=…>` 整条抹掉，结果连删除都做不到——
 * 正则的 `[^>]*` 在 `onerror=` 被删之后跨不过剩下的 `>`。
 * 删掉危险的部分（事件处理器、`javascript:`、危险标签）就够了，
 * 剩下的裸标签会被 `esc()` 转义成纯文本，没有执行面。
 */
export function stripDangerous(value: string): string {
  return value
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style|link|meta)\b[^>]*>/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\bon[a-z]+\s*=/gi, "")
    // 零宽字符：模型偶尔从网页复制出 U+200B/U+FEFF，肉眼看不见但会破坏长度校验与搜索匹配
    .replace(/[​-‍﻿]/g, "");
}

/**
 * 事实值清洗。
 *
 * 三层处理，顺序不能换：
 *  ① 删危险字符
 *  ② 示例值（example.com / 13800138000 / 400-000-0000 之类）**换成缺口标记**——
 *     它们是内容策略的 `fabricated` 规则（block 级），命中会让站**发不出去**
 *  ③ 说明性语句（"此处应填写电话"）**换成缺口标记**——`meta_commentary` 规则（block 级）
 */
export function sanitizeFact(value: string): string {
  let out = stripDangerous(value).trim();
  if (!out) return GAP_MARKER;

  // 示例/占位域（fabricated 规则）
  if (/example\.(com|org|net)|lorem\s*ipsum|placeholder/i.test(out)) return GAP_MARKER;

  // 明显编造的电话：400-000-0000、13800138000、400-123-4567 这类全零/顺序假号。
  // 实测（2026-09-11）：模板演示数据里就是 400-123-4567，模型如实抄了回来——
  // 它没错，是我们的清洗没覆盖这种。**假电话对访客是最坏的一种"看起来对"**。
  if (/^[\s()+-]*(\d[\s()-]*){7,}$/.test(out)) {
    const digits = out.replace(/\D/g, "");
    if (/^(\d)\1+$/.test(digits) || /0000|1234567|2345678|3456789|13800138000/.test(digits)) return GAP_MARKER;
  }

  // 元说明（meta_commentary 规则）：把缺口写成了句子
  if (/^(待补充|请补充|此处|这里|（?空缺）?|to be (completed|added|filled))/i.test(out) && out.length > GAP_MARKER.length) {
    // 含"待补充"但更长 = 说明句；纯"待补充"保持原样
    if (/^待补充[，,。.；;：:\s]|请补充|此处|这里/.test(out)) return GAP_MARKER;
  }

  return out;
}

/** 去掉缺口标记本身（用于判断"这条内容是不是等于没写"）。 */
function isGap(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === GAP_MARKER || /^待补充[，,。.；;：:\s]/.test(trimmed);
}

/** 纯概念标签——不值得渲染的短词。 */
const LABEL_TITLES = new Set(["公司简介", "关于", "关于我们", "联系方式", "联系我们", "产品", "产品中心", "服务", "优势", "核心优势", "about", "contact", "products", "services", "features", "company", "our company"]);

/**
 * 节标题兜底：模型用概念标签（"联系方式"）当标题时一律置空。
 *
 * 理由不是审美，是**真实模板都这么做**：实测截图里联系区就是「联系我们」几个字 +
 * 一句正文，硬撑一个重复大标题反而与原站不像。
 */
function coerceSectionTitle(value: string, fallback: string, locale: "zh" | "en"): string {
  const out = stripDangerous(value).trim();
  const safeFallback = stripDangerous(fallback).trim();
  // 缺口标记或空白 → 用兜底标题（节标题为空不影响渲染，但兜底更好看）
  if (isGap(out)) return safeFallback;
  // 去重：模型把标题读成"联系"这类概念标签时，会与导航构成重复。
  // 这条只对中文站生效——英文站的标签集完全不同，套用会误伤。
  if (locale === "zh" && LABEL_TITLES.has(out)) return safeFallback;
  return out.slice(0, MAX_TITLE);
}

/**
 * 节标题 → `LocalizedText`。
 *
 * ⚠️ 必须包成对象，不能直接给字符串：`siteDraftSchema` 里每个 `title` 都是
 * `{ zh, en }`（`localizedTextSchema`）。第一版这里直接赋的字符串，
 * 被 schema 在最后一道拦下来了——**兜底写得再多，也不该省掉最后那次权威校验**。
 */
function titleFor(value: string, fallback: string, locale: "zh" | "en"): LocalizedText {
  const text = coerceSectionTitle(value, fallback, locale);
  return locale === "en" ? { zh: "", en: text } : { zh: text, en: "" };
}

/** 本地化文案：zh 必填，en 尽量保留（模型常给中英混排）。 */
function coerceLocalized(value: unknown, locale: "zh" | "en" = "zh"): LocalizedText {
  if (typeof value === "string") {
    const cleaned = stripDangerous(value).trim().slice(0, 1000);
    return locale === "en" ? { zh: "", en: cleaned } : { zh: cleaned, en: "" };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      zh: typeof record.zh === "string" ? stripDangerous(record.zh).trim().slice(0, 1000) : "",
      en: typeof record.en === "string" ? stripDangerous(record.en).trim().slice(0, 1000) : "",
    };
  }
  return { zh: "", en: "" };
}

/** 把本地化文案折成单语言字符串（模型的 items 通常是平的）。 */
function textOf(value: unknown): string {
  const localized = coerceLocalized(value);
  return localized.zh || localized.en;
}

/** 把一个值数组转成去重、限量的字符串数组。 */
function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? stripDangerous(item).trim() : "";
    if (!text || out.includes(text)) continue;
    out.push(text.slice(0, MAX_TITLE));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 模板 id：模型给中文/空格/大写时归一成合法目录名。
 *
 * ⚠️ `candidate` 剥空之后**可能什么都不剩**（模型给了纯中文名）。此时要退回
 * 调用方给的 `fallbackSeed`，而不是接一个空串——空串会派生出 `tpl-` 这种
 * 以短横线结尾的残id，虽然截断后仍合法，但它对用户毫无意义，
 * 而"毫无意义的名字"正是客户会来问的那种问题。
 */
export function coerceTemplateId(raw: string, fallbackSeed: string): string {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  const fromRaw = normalize(raw);
  const base = fromRaw || normalize(fallbackSeed);
  // 必须以字母或数字开头（目录名规则）
  return /^[a-z0-9]/.test(base) ? base : `tpl-${base}`.slice(0, 40);
}

// ---------------------------------------------------------------------------
// 主转换
// ---------------------------------------------------------------------------

export type CoerceOptions = {
  /** 提示词里是否要它产出 products（false 时忽略模型给的产品） */
  allowProducts?: boolean;
  /** 站点语言 */
  locale?: "zh" | "en";
};

export type CoerceResult =
  | { ok: true; dsl: DslFromVision; warnings: string[] }
  | { ok: false; issues: string[] };

/** 本模块产出的 DSL 形状——**故意不从 `template-composer-dsl.ts` import `ComposerDsl`**。
 *
 * 因为 `ComposerDsl` 的 `content` 是**完整合法的 `SiteDraft`**，而模型永远给不全
 * （它不知道 schemaVersion 是 2、不知道 sectionOrder 有五项）。在这里补全成 SiteDraft，
 * 拼装器就只需要吃一种输入，不必在渲染路径上做兜底——**兜底放在数据边界，不放在渲染路径**。
 */
export type DslFromVision = {
  templateId: string;
  name: string;
  siteName: string;
  tokens: DesignTokens;
  blocks: Array<{ type: ComponentType; variant?: string }>;
  content: SiteDraft;
  /**
   * 模型对"这是一张企业官网截图"的把握。
   *
   * **它决定要不要自动裁产品图**——`low` 时不裁。理由：我们试过三种启发式
   * （按面积最大 / 按同尺寸成组 / 按落进产品区），在资源站页面上**三种都失败**，
   * 因为那个页面的"产品区"里放的是模板推荐卡。**没有哪个公式能兜住这种情况**，
   * 唯一的信号是"这张图到底是不是企业官网"——那只有看过图的模型知道。
   *
   * 缺省 `medium`：模型没给时不额外冒险，但也不完全放弃（仍按位置粗筛）。
   */
  confidence: "high" | "medium" | "low";
};

/**
 * 解析模型给的把握度。**认不出的一律当 `medium`。**
 *
 * 不做"认不出就当 high"——那等于把一次格式失误变成"往客户站里放广告"。
 * 也不做"认不出就当 low"——那会让一次格式失误白丢所有配图。
 */
export function parseConfidence(raw: unknown): "high" | "medium" | "low" {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value.startsWith("high") || value === "高") return "high";
  if (value.startsWith("low") || value === "低") return "low";
  return "medium";
}

/**
 * 把模型吐的任意 JSON 拧成一份合法 DSL。
 *
 * **永不抛异常**：模型输出的形态不可控（少字段、类型错、只给一半），
 * 用 zod/手写解析各自都会在某个分支上抛。这里全部走"取值 → 兜底 → 再校验"，
 * 失败面收在 `issues` 里，调用方直接拿去当重试反馈或用户提示。
 */
export function coerceVisionDsl(raw: unknown, options: CoerceOptions = {}): CoerceResult {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, issues: ["模型没有返回 JSON 对象"] };
  }
  const input = raw as Record<string, unknown>;

  // ---- 站点身份 ----
  const companyName = sanitizeFact(typeof input.companyName === "string" ? input.companyName : "");
  const rawSiteName = typeof input.siteName === "string" ? stripDangerous(input.siteName).trim() : "";
  const siteName = (rawSiteName || (isGap(companyName) ? "" : companyName)).slice(0, DRAFT_FIELD_MAX_LENGTH.siteName);
  if (!siteName) {
    // 站点名是 schema 的必填项，没有它整份草稿都建不出来
    return { ok: false, issues: ["截图里读不出公司名/站点名，也没能从其他信息推断出来"] };
  }

  const base = structuredClone(defaultDraft) as unknown as Record<string, unknown>;
  const content = base.content as Record<string, Record<string, unknown>>;
  const modelContent = (typeof input.content === "object" && input.content ? input.content : {}) as Record<string, Record<string, unknown>>;
  const locale = options.locale ?? "zh";

  // ---- 首屏 ----
  const heroIn = modelContent.hero ?? {};
  const heroTitle = textOf(heroIn.title).slice(0, MAX_TITLE);
  if (!heroTitle) {
    return { ok: false, issues: ["截图里的首屏大标题没读出来——它是必填项，缺了整个站建不起来"] };
  }
  content.hero = {
    title: { zh: heroTitle, en: textOf(heroIn.title) },
    subtitle: { zh: textOf(heroIn.subtitle).slice(0, MAX_BODY), en: "" },
    cta: { zh: textOf(heroIn.cta).slice(0, MAX_TITLE) || "联系我们", en: "" },
  };

  // ---- 关于 ----
  const aboutIn = modelContent.about ?? {};
  content.about = {
    title: titleFor(textOf(aboutIn.title), "关于我们", locale),
    body: { zh: textOf(aboutIn.body).slice(0, MAX_BODY), en: "" },
  };

  // ---- 特性 / 服务（集合槽） ----
  for (const key of ["features", "services"] as const) {
    const sectionIn = modelContent[key] ?? {};
    const rawItems = Array.isArray(sectionIn.items) ? sectionIn.items : [];
    const items: EditableItem[] = [];
    for (const [index, item] of rawItems.entries()) {
      if (items.length >= MAX_COLLECTION_ITEMS) break;
      const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
      const title = textOf(record.title).slice(0, MAX_TITLE);
      const body = textOf(record.body ?? record.summary).slice(0, MAX_BODY);
      // 标题与正文都空 = 模型凑数，跳过（**两张都空的卡在页面上是个空洞**）
      if (!title && !body) continue;
      items.push({
        // id 只用 ASCII——它会进槽位路径与就地编辑映射
        id: `item-${index + 1}`,
        title: { zh: title, en: "" },
        body: { zh: body, en: "" },
      });
    }
    if (rawItems.length > MAX_COLLECTION_ITEMS) {
      warnings.push(`${key} 原本给了 ${rawItems.length} 条，超出上限已保留前 ${MAX_COLLECTION_ITEMS} 条`);
    }
    content[key] = {
      title: titleFor(textOf(sectionIn.title), key === "features" ? "核心优势" : "服务支持", locale),
      intro: { zh: textOf(sectionIn.intro).slice(0, MAX_BODY), en: "" },
      items,
    };
  }

  // ---- 产品区标题 ----
  const productsIn = modelContent.products ?? {};
  content.products = {
    title: titleFor(textOf(productsIn.title), "产品中心", locale),
    intro: { zh: textOf(productsIn.intro).slice(0, MAX_BODY), en: "" },
  };

  // ---- FAQ / 客户评价（2026-09-11，④） ----
  //
  // 两者**不存在时保持 undefined**（不写空壳）——`defaultDraft.content` 里本就没有
  // 这两个键，`content.faq = {...items: []}` 会让"这个站没有 FAQ"变成
  // "有一个空的 FAQ"，拼装器虽然不会渲染空集合，但**草稿里多了一个假事实**。
  for (const key of ["faq", "testimonials"] as const) {
    const sectionIn = modelContent[key];
    if (!sectionIn || typeof sectionIn !== "object") continue;
    const rawItems = Array.isArray((sectionIn as Record<string, unknown>).items)
      ? ((sectionIn as Record<string, unknown>).items as unknown[])
      : [];

    if (key === "faq") {
      const items: EditableItem[] = [];
      for (const [index, item] of rawItems.entries()) {
        if (items.length >= MAX_COLLECTION_ITEMS) break;
        const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
        const title = textOf(record.title).slice(0, MAX_TITLE);
        const body = textOf(record.body ?? record.answer).slice(0, MAX_BODY);
        // 没有问题的条目在折叠面板里是打不开的空行 —— 跳过
        if (!title) continue;
        items.push({ id: `faq-${index + 1}`, title: { zh: title, en: "" }, body: { zh: body, en: "" } });
      }
      if (items.length === 0) continue;
      content.faq = {
        title: titleFor(textOf((sectionIn as Record<string, unknown>).title), "常见问题", locale),
        intro: { zh: textOf((sectionIn as Record<string, unknown>).intro).slice(0, MAX_BODY), en: "" },
        items,
      };
      continue;
    }

    const items: Testimonial[] = [];
    for (const [index, item] of rawItems.entries()) {
      if (items.length >= MAX_COLLECTION_ITEMS) break;
      const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
      const quote = textOf(record.quote ?? record.body).slice(0, MAX_BODY);
      // 没有正文的"评价"没有意义 —— 整条丢掉
      if (!quote) continue;
      /**
       * 署名与身份**不走 `sanitizeFact`**。
       *
       * `sanitizeFact` 把缺失值归一成「待补充」——那是给电话/邮箱设计的
       * （缺口标记会被质检识别、发布时隐藏）。但一个 `<cite>待补充</cite>`
       * 会**当成真名字渲染出来**，而评价的署名恰恰是最容易被模型编的部分。
       * 读不到就留空，渲染层会整行不显示。
       */
      const authorText = textOf(record.author).trim();
      const roleText = textOf(record.role).trim();
      items.push({
        id: `quote-${index + 1}`,
        quote: { zh: quote, en: "" },
        author: { zh: isGap(authorText) ? "" : authorText.slice(0, MAX_TITLE), en: "" },
        role: { zh: isGap(roleText) ? "" : roleText.slice(0, MAX_TITLE), en: "" },
      });
    }
    if (items.length === 0) continue;
    content.testimonials = {
      title: titleFor(textOf((sectionIn as Record<string, unknown>).title), "客户评价", locale),
      intro: { zh: textOf((sectionIn as Record<string, unknown>).intro).slice(0, MAX_BODY), en: "" },
      items,
    };
  }

  // ---- 客户 Logo 墙（2026-09-11，④） ----
  //
  // **只收有名字的**。从截图里读公司名可能不准，但"读不出名字的一个格子"
  // 在页面上无法表达任何东西（一排无名图片），所以宁可不放。
  // 模型也拿不出真实的 logo 图片 URL——`logo` 字段留给用户之后上传。
  const logos: LogoItem[] = [];
  if (Array.isArray(input.logos)) {
    for (const item of input.logos) {
      if (logos.length >= MAX_LOGO_ITEMS) break;
      const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
      const name = textOf(record.name).trim();
      if (!name || isGap(name)) continue;
      logos.push({ id: `logo-${logos.length + 1}`, name: name.slice(0, MAX_TITLE) });
    }
  }

  // ---- 联系 ----
  const contactIn = modelContent.contact ?? {};
  const phone = sanitizeFact(textOf(contactIn.phone)).slice(0, DRAFT_FIELD_MAX_LENGTH["contact.phone"]);
  const email = sanitizeFact(textOf(contactIn.email)).slice(0, DRAFT_FIELD_MAX_LENGTH["contact.email"]);
  const address = sanitizeFact(textOf(contactIn.address));
  content.contact = {
    title: titleFor(textOf(contactIn.title), "联系我们", locale),
    body: { zh: textOf(contactIn.body).slice(0, MAX_BODY), en: "" },
    email,
    phone,
    address: { zh: address, en: "" },
  };

  // ---- 导航 ----
  //
  // ⚠️ 导航词必须**互不相同**。实测（2026-09-11）：模型把 `services` 也写成了"产品展示"
  // （截图里那家确实把服务叫产品展示），于是导航栏出现了两个一模一样的入口。
  // 那是原站的问题，但**照抄它等于把别人的毛病搬进新站**——用户会当成我们的 bug。
  // 处理：重复的按先后保留第一个，后面的退回该项默认词（若默认词也被占了就清空，
  // 拼装器的导航会跳过空标签）。
  //
  // ⑥ 数组化（2026-09-11）：导航项现在带 `id` 与 `target`。
  // `id` 用**板块名**（about/features/…）——这样 `navigation.<id>` 这个槽位路径
  // 与板块的 `#锚点` 天然对齐，拼装产物里的导航也就能就地编辑了。
  // 模型给的 `navigation` 里若带了别的键，**一概不收**：一个模型自创的 id
  // 会生成一个指向不存在锚点的链接（点了没反应的那种坏链）。
  const navIn = (modelContent.navigation ?? {}) as Record<string, unknown>;
  const navDefaults = defaultDraft.navigation;
  const navUsed = new Set<string>();
  const navigation: NavItem[] = [];
  for (const fallback of navDefaults.slice(0, MAX_NAV_ITEMS)) {
    const wanted = textOf(navIn[fallback.id]).slice(0, MAX_TITLE);
    const fallbackText = textOf(fallback.label);
    const chosen = wanted && !navUsed.has(wanted) ? wanted : !navUsed.has(fallbackText) ? fallbackText : "";
    if (chosen) navUsed.add(chosen);
    navigation.push({ id: fallback.id, label: { zh: chosen, en: "" }, target: fallback.target });
  }
  base.navigation = navigation;

  // ---- 产品（真实 SKU 是硬要求，见文件顶部表格） ----
  const products: Product[] = [];
  if (options.allowProducts !== false) {
    const rawProducts = Array.isArray(input.products) ? input.products : [];
    for (const [index, item] of rawProducts.entries()) {
      const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
      const name = textOf(record.name).slice(0, MAX_TITLE);
      const summary = textOf(record.summary).slice(0, MAX_SUMMARY);
      let sku = typeof record.sku === "string" ? stripDangerous(record.sku).trim().slice(0, 120) : "";
      // 纯数字 SKU = 模型在凑数（实测它会给 "1" "2" "3"）——
      // 这种 sku 会变成 products.1.name 这种没人认得出的槽位，就地编辑直接失效。
      if (/^\d+$/.test(sku)) sku = "";
      // 看不出型号时用产品名推 SKU——比 "P-001" 有用得多，而且**同名的产品会自然分到同一组**，
      // 让编排层的去重能认出"这几张其实是同一个产品"。
      if (!sku) {
        const seed = textOf(record.name) || textOf(record.title);
        const slug = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        sku = slug ? `P-${slug}` : "";
      }
      if (!sku) sku = `P-${String(index + 1).padStart(3, "0")}`;
      if (!name && !summary) continue;
      products.push({
        sku,
        name: { zh: name || sku, en: "" },
        summary: { zh: summary, en: "" },
        category: (typeof record.category === "string" ? stripDangerous(record.category).trim() : "").slice(0, 120) || "产品",
        status: "published",
        // 图占位色由 primary 派生（拼装器在无图时用它画色块）
        imageColor: "#e8ece9",
      });
    }
  }

  // ---- 版式块 ----
  const blocks = coerceBlocks(input.blocks, warnings);
  if (blocks.length === 0) {
    return { ok: false, issues: ["模型给出的板块列表是空的，拼不出页面"] };
  }

  // ---- token ----
  const tokens = coerceTokens(input.tokens, warnings);

  // ---- 一次性过正式 schema ----
  // 这是**唯一**的权威校验：前面所有兜底都只是为了让这一步能过。
  const candidate = {
    ...base,
    schemaVersion: 2 as const,
    siteName,
    companyName: isGap(companyName) ? siteName : companyName,
    templateId: coerceTemplateId(typeof input.templateId === "string" ? input.templateId : "", siteName),
    locale: options.locale ?? "zh",
    revision: 1,
    lastChange: "由截图生成",
    industry: (typeof input.industry === "string" ? stripDangerous(input.industry).trim() : "").slice(0, DRAFT_FIELD_MAX_LENGTH.industry) || "企业服务",
    goal: (typeof input.goal === "string" ? stripDangerous(input.goal).trim() : "").slice(0, DRAFT_FIELD_MAX_LENGTH.goal) || "展示主营业务并获取客户询盘",
    navigation: base.navigation,
    content,
    sectionOrder: [...defaultDraft.sectionOrder],
    hiddenSections: [],
    designTokens: tokens,
    assets: {},
    products,
    logos,
  };

  const parsed = siteDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    // 报出具体哪几个字段——模型据此重试，也让我们一眼看出是哪条兜底没兜住
    const issues = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
    return { ok: false, issues };
  }

  return {
    ok: true,
    warnings,
    dsl: {
      templateId: parsed.data.templateId,
      name: (typeof input.name === "string" ? stripDangerous(input.name).trim() : "").slice(0, 120) || parsed.data.siteName,
      siteName: parsed.data.siteName,
      tokens: parsed.data.designTokens ?? tokens,
      blocks,
      content: parsed.data,
      confidence: parseConfidence(input.confidence),
    },
  };
}

/** 板块列表：过滤未知组件、纠正非法版式、去重、强制 hero 在最前。 */
function coerceBlocks(value: unknown, warnings: string[]): Array<{ type: ComponentType; variant?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ type: ComponentType; variant?: string }> = [];
  const seen = new Set<ComponentType>();
  for (const item of value) {
    const record = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
    if (!(COMPONENT_TYPES as readonly string[]).includes(type)) {
      if (type) warnings.push(`忽略了不存在的组件「${type}」`);
      continue;
    }
    const componentType = type as ComponentType;
    if (seen.has(componentType)) {
      warnings.push(`组件「${type}」重复出现，已合并`);
      continue;
    }
    seen.add(componentType);
    const variants = COMPONENT_VARIANTS[componentType];
    const rawVariant = typeof record.variant === "string" ? record.variant.trim().toLowerCase() : "";
    const variant = variants.includes(rawVariant) ? rawVariant : undefined;
    if (rawVariant && !variant) warnings.push(`组件「${type}」不支持版式「${rawVariant}」，已改用默认版式`);
    out.push(variant ? { type: componentType, variant } : { type: componentType });
  }
  // hero 是门禁硬要求：模型漏了就直接补在最前，而不是让整次生成失败
  if (!seen.has("hero")) {
    out.unshift({ type: "hero" });
    warnings.push("模型没有给首屏，已自动补上");
  }
  return out;
}

/** token：非法色值按灰度兜底，枚举给默认值。**不因为一个色值就整次失败。** */
function coerceTokens(value: unknown, warnings: string[]): DesignTokens {
  const input = (typeof value === "object" && value ? value : {}) as Record<string, unknown>;
  const hex = (key: keyof DesignTokens, fallback: string): string => {
    const raw = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.toLowerCase();
    if (raw) warnings.push(`配色 ${key} 的值「${raw}」不是 #rrggbb，已用默认色`);
    return fallback;
  };
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const raw = typeof input[key] === "string" ? (input[key] as string).trim().toLowerCase() : "";
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  };
  return {
    primary: hex("primary", "#2e6b4f"),
    secondary: hex("secondary", "#4a6b8a"),
    accent: hex("accent", "#c8102e"),
    fontStyle: pick("fontStyle", ["sans", "editorial", "technical"] as const, "sans"),
    radius: pick("radius", ["sharp", "soft", "rounded"] as const, "soft"),
    density: pick("density", ["compact", "balanced", "spacious"] as const, "balanced"),
  };
}

// ---------------------------------------------------------------------------
// 生图指引（B 路径的配图，见 lib/site-screenshot.ts）
// ---------------------------------------------------------------------------

/**
 * 估算某个板块在页面上的纵向范围。
 *
 * ## 依据
 *
 * 模型给的 `blocks` 就是**从上到下的顺序**（提示词里明确要求它按截图顺序排），
 * 所以按板块数等分页面高度，取目标板块那一格。
 *
 * ## 为什么这个粗估够用
 *
 * 它只用于**粗筛**——"哪些图可能落在产品区里"。真实误差在几十像素量级，
 * 而产品区通常占页面 15%–30%（几百像素），不会因为估算误差把广告算进来。
 * 想要更准就得让模型输出每个板块的像素范围，那是**另一层成本**，
 * 而当前的错误率已经低到不值得付。
 *
 * 返回 `null` 表示**这个板块不在页面上**——调用方据此放弃裁图，
 * 而不是给一个假的默认范围。
 */
export function estimateSectionRange(
  blockOrder: readonly string[],
  target: string,
  pageHeight: number,
): { top: number; bottom: number } | null {
  const index = blockOrder.indexOf(target);
  if (index < 0 || blockOrder.length === 0 || pageHeight <= 0) return null;
  const slice = pageHeight / blockOrder.length;
  return {
    // 上下各留 10% 余量——板块边界本来就是估的，收得太紧容易把边上的产品图漏掉
    top: Math.max(0, Math.floor(index * slice - slice * 0.1)),
    bottom: Math.min(pageHeight, Math.ceil((index + 1) * slice + slice * 0.1)),
  };
}

/**
 * 图里没带原图时，用截图里那几张产品图来配。
 *
 * ## 判据（三次修正后定型，2026-09-11）
 *
 * 第一版**按面积取最大的几张**——在资源站上裁出来的是广告横幅（实测被截图当场暴露）。
 * 第二版改成**"同尺寸重复出现的图"**——命中了资源站自己的"模板推荐卡"（尺寸也一致），
 * 第三次实测仍然错。
 *
 * 结论：**光看图片本身永远分不清"产品图"和"恰好一致的别的东西"**。
 * 唯一可靠的约束是**位置**——模型已经在标注产品区在哪一段了，
 * 产品图必然落在那一段里。
 *
 * 所以现在的判据是两条同时成立：
 *  ① 落在 `productsRange`（模型标出的产品区的纵向范围）内；
 *  ② 与同区内其他图**尺寸成组**（真实产品网格的稳定特征）。
 *
 * **两条缺一就不裁。** 宁可让产品卡用色块占位——色块是诚实的"这里没有图"，
 * 而放错图是"看起来对但其实错"。
 */
export function planProductShots(args: {
  /** 可用图片（含自然尺寸与页面坐标） */
  available: Array<{ url: string; width: number; height: number; y?: number }>;
  /** 需要配几张（通常 = 模型给的产品数） */
  needed: number;
  /**
   * 产品区的纵向范围（页面坐标，来自模型对截图的标注）。
   *
   * 不给就**不裁**——没有位置约束时我们分不清产品图和广告，
   * 而"猜错的图"比"没有图"糟得多。
   */
  productsRange?: { top: number; bottom: number } | null;
}): Array<{ url: string; rank: number }> {
  const { available, needed, productsRange } = args;
  if (needed <= 0) return [];
  // 没有产品区标注 → 不裁。这是刻意的，不是遗漏（见上方说明）。
  if (!productsRange) return [];
  if (available.length < 2) return [];

  const MIN_EDGE = 200;
  const inRange = available
    .filter((item) => item.width >= MIN_EDGE && item.height >= MIN_EDGE)
    .filter((item) => typeof item.y === "number" && item.y >= productsRange.top && item.y <= productsRange.bottom);
  if (inRange.length < 2) return [];

  // 按尺寸相似度分组：真实网格里的产品图会有几个像素的差异（边框、hover 态），
  // 但不会差一个量级。15% 容差。
  const groups: Array<Array<{ url: string; width: number; height: number; y?: number }>> = [];
  for (const item of inRange) {
    const group = groups.find((members) => {
      const ref = members[0];
      return (
        Math.abs(item.width - ref.width) / ref.width <= 0.15 &&
        Math.abs(item.height - ref.height) / ref.height <= 0.15
      );
    });
    if (group) group.push(item);
    else groups.push([item]);
  }

  // 取成员最多的一组；**至少要 2 张**才算"一组产品图"
  const best = groups.filter((group) => group.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!best) return [];

  // 按页面纵向顺序——与产品在页面上的排列一致
  return [...best]
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))
    .slice(0, needed)
    .map((item, index) => ({ url: item.url, rank: index }));
}

// ---------------------------------------------------------------------------
// 产品去重（导出给编排层用，因为"保留几个"是产品决策）
// ---------------------------------------------------------------------------

/**
 * 同一型号出现多次时保留几个。
 *
 * ## 为什么不是"直接去重成一个"
 *
 * 实测（2026-09-11，真实风机模板截图）：原站 8 张产品卡的型号**全是 `TDS-48RD`**
 * ——那是模板作者的演示数据，他没填满。模型如实读了 8 个回来。
 *
 * 第一版这里直接按 SKU 去重，结果成品站的产品区**只剩 1 个产品**，
 * 而截图里明明有 8 张卡。**那比重复型号更不像原站**。
 *
 * 所以策略是：同名型号最多保留 `MAX_PER_SKU` 个。既不会 8 张卡挤成 1 张，
 * 也不会让槽位命名冲突（拼装器给后几个加 `-2` 后缀，见 `template-composer.ts`）。
 *
 * ## 什么时候该只留 1 个
 *
 * 当型号是**我们兜底生成的**（`P-001` 这种，说明模型看不出型号）时——
 * 那意味着它连产品名都没读准，凑数量没意义。由 `generated` 标记区分。
 */
export const MAX_PER_SKU = 4;

export type DedupeResult = {
  /** 去重后的产品（保持原顺序） */
  products: Product[];
  /** 合并掉的个数——要如实告诉用户，不能静默丢 */
  merged: number;
  /** 被合并的型号（用于生成"已合并 N 个同型号"的提示） */
  mergedSkus: string[];
};

export function dedupeProducts(products: readonly Product[], options: { allowRepeat?: boolean } = {}): DedupeResult {
  const allowRepeat = options.allowRepeat ?? true;
  const counts = new Map<string, number>();
  const out: Product[] = [];
  const mergedSkus = new Set<string>();
  let merged = 0;

  for (const product of products) {
    const seen = counts.get(product.sku) ?? 0;
    const limit = allowRepeat ? MAX_PER_SKU : 1;
    if (seen >= limit) {
      merged += 1;
      mergedSkus.add(product.sku);
      continue;
    }
    counts.set(product.sku, seen + 1);
    out.push(product);
  }

  return { products: out, merged, mergedSkus: [...mergedSkus] };
}

/** 给界面/日志用的一句话：这张图读出来了什么。 */
export function describeVisionResult(dsl: DslFromVision): string {
  const sectionLabels: Record<ComponentType, string> = {
    navbar: "导航",
    hero: "首屏",
    features: "优势",
    services: "服务",
    about: "关于",
    products: "产品",
    logos: "客户",
    faq: "常见问题",
    testimonials: "客户评价",
    contact: "联系",
    cta: "行动号召",
    footer: "页脚",
  };
  const sections = dsl.blocks.map((block) => sectionLabels[block.type]).join(" · ");
  const products = dsl.content.products.length;
  return [
    dsl.siteName,
    `${sections}（${dsl.blocks.length} 个板块）`,
    products > 0 ? `${products} 个产品` : "无产品区",
  ].filter(Boolean).join(" · ");
}
