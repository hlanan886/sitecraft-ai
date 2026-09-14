import type { Locale } from "../site-model.ts";

export type TemplateRuntime = "astro-static" | "next-static" | "static-html";
export type TemplateUiSurface = "navigation" | "faq" | "form" | "footer";
export type TemplateContentTarget =
  | "hero.title"
  | "about.body"
  | "features.items"
  | "services.items"
  | "products"
  | "contact.title"
  | "contact.body"
  | "contact.email"
  | "contact.phone"
  | "contact.address";
export type TemplateSlotContentType = "text" | "collection";

export type TemplateSlotBinding = {
  target: TemplateContentTarget;
  selector: string;
  contentType: TemplateSlotContentType;
  semanticType: string;
  aliases: readonly string[];
  locales: readonly Locale[];
  required: boolean;
  editable: boolean;
  maxLength: number;
  demoFingerprints: readonly string[];
};

export type TemplateNonContentSlot =
  | {
      target: "brand.logo" | "hero.image";
      selector: string;
      slotType: "asset";
      coverage: "excluded";
      support: "template-owned";
    }
  | {
      target: "contact.formAction";
      selector: string;
      slotType: "behavior";
      coverage: "excluded";
      /**
       * 询盘提交的落点。`sitecraft-hosted` = 由本站接管（bridge 拦截 submit →
       * `sitecraft:lead-submit` → `/api/public/[siteKey]/leads` → lead-store），
       * **不再写模板自带的 mailto:/demo action**。
       * 2026-09-09 前此处标 `unsupported`，与实况不符（A8 已打通，P3.5 契约同步）。
       */
      support: "sitecraft-hosted";
    };

/**
 * 原生排版角色词表（PresentationRole）。
 *
 * 模板是"受控组合空间"：每个业务槽在模板里以某一种原生排版呈现。注入器与生成层
 * 都靠这份角色决定"内容该以什么形态进模板"，而不是退回跨模板统一的卡片网格。
 * 参考业界（Duda AI-ready 模板白名单 / Design2Code 结构冻结 / Astro content collections）：
 * 描述必须落到"该模板原生这一块长什么样、能装几条"，AI 只负责填内容不重建布局。
 */
export type PresentationRole =
  | "hero_split_image" // 左右图文首屏（标题+副文+按钮+图）
  | "hero_centered" // 居中首屏
  | "split_text_media" // 图文左右版块（about 类）
  | "image_banner" // 顶部整宽图横幅 + 下方案文/条目
  | "icon_row" // 无边框 icon+标题+正文 行（非卡片）
  | "logo_strip" // 客户 logo 条（无可靠客户时默认隐藏，防 demo 假数据）
  | "stats_bar" // 数字统计条（无可靠数据时默认隐藏，防造假）
  | "tabbed_showcase" // Tab 切换 + 大图
  | "testimonial_wall" // 头像 + 评价
  | "accordion_faq"
  | "pricing_columns"
  | "product_grid" // 产品/作品网格（参数化条目）
  | "card_grid"; // 该模板此处确实用卡片（唯一允许通用卡片渲染的角色；未手写模板的默认兜底）

/** 每个原生条目由什么内容元组成（决定注入器该写哪几个节点） */
export type PresentationItemShape = "title_body" | "metric_value_label" | "media_caption";

/**
 * 一个业务槽在模板里的原生呈现块。
 * slot 取 TemplateContentTarget 的业务段（about/features/services/products/contact）。
 * anchor 用"结构特征"（grid 类名/无 border/section 定位）而非 demo 英文文案，
 * 使注入器定位与生成层理解都不依赖会被替换的演示文字。
 */
export type TemplatePresentationBlock = {
  /**
   * 这是**业务段名**（裸名，如 "features"），不是 DOM 的 `data-sitecraft-slot` 点分路径。
   * 合法取值见 `getTemplatePresentation()` 的解析结果——手写模板 + `defaultPresentation()`
   * 的兜底，共含 `hero`（第七值，不属 `sectionKeys`）。
   * 此前这里手抄了一份枚举注释，漏了 `hero` **且**把第五节的段名写成 `contact`
   * 与模板实况不符（2026-09-12 登记 T-5，按附则 2 改为引用而非再抄一份）。
   */
  presentationSlot: string;
  role: PresentationRole;
  /** 一句话给 AI 看："该板块原生是图标+标题+正文的无边框行，至多 6 条" */
  presentAs: string;
  /** 原生能承载的项数（default 是生成层建议条数） */
  capacity: { min?: number; default?: number; max: number };
  itemShape: PresentationItemShape;
  /** 结构定位提示（供注入器 anchor；adapter 提供 findSection 函数时优先于它） */
  anchor: string;
  /** 演示块默认隐藏：logo_strip/stats_bar 等塞模板作者假数据的块 */
  hideUnlessFilled?: boolean;
  /**
   * 该槽的内容由谁承载（**显式声明，替代从 presentAs 文案正则提取**）：
   *  - "native"：模板有原生结构承载，走 generated 兜底 = 违规；
   *  - "generated"：模板本就没有该槽的原生位，由通用生成区承载 = 设计内行为（不违规）。
   * 未声明时回退到注册表 `requiresNative`（见 lib/template-fidelity-guard.ts）。
   */
  nativeFallbackHost?: "native" | "generated";
};

export type TemplateManifest = {
  templateId: string;
  displayName: string;
  manifestVersion: number;
  runtime: TemplateRuntime;
  nativeLocales: readonly Locale[];
  outputLocales: readonly Locale[];
  localizedUi: readonly TemplateUiSurface[];
  requiredVisibleTargets: readonly string[];
  slots: readonly TemplateSlotBinding[];
  nonContentSlots: readonly TemplateNonContentSlot[];
  /** 每业务槽的原生排版角色；缺省（未手写模板）= 全按 card_grid 的旧行为，零回归 */
  presentation?: readonly TemplatePresentationBlock[];
  recommendation: "eligible" | "isolated";
};
