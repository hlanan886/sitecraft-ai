/**
 * 拼装器：把 DSL 拼成真实 HTML。
 *
 * ## 为什么是"拼"而不是"生成"
 *
 * 实测：让模型直接写 HTML，开推理时 16000 tokens 打满、代码截断、`data-sitecraft-slot` **0 个**；
 * 关推理才勉强够用。**稳定性系于模型的临时状态，这不叫产品。**
 * 改成"模型出 DSL、我们拼装"之后，**产出物由这份代码决定**，不由模型决定。
 *
 * ## 槽位由这里打上去（这是关键收益）
 *
 * 以前槽位靠提示词"求模型记得写"；现在**是我们 `slot()` 一个个刻进 HTML 的**。
 * 而槽位是就地编辑、覆盖统计、质量门禁、忠实度校验的**硬契约**——
 * 缺了它，页面看着对，但**所有字段一个字都改不了**（静默失效，最难查）。
 *
 * ## 纯函数，不碰 node:fs
 *
 * 与其他模块的分工一致：纯逻辑与 fs 操作分开。
 * 否则 `node:fs` 会进客户端 bundle，Turbopack 报
 * `does not support external modules` 而**构建直接失败**（实测）。
 */
import type { LocalizedText, SiteDraft } from "./site-document.ts";
import {
  type ComposerBlock,
  type ComposerDsl,
  type ComponentType,
  resolveVariant,
  validateDsl,
} from "./template-composer-dsl.ts";
import { composeStyleSheet } from "./template-composer-styles.ts";

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

/** 取本地化文案（默认中文；英文站用 `en`）。 */
function t(text: LocalizedText, locale: "zh" | "en"): string {
  return (locale === "en" ? text.en || text.zh : text.zh) || "";
}

/**
 * HTML 转义。
 *
 * 用户/模型给的内容会直接进 HTML——不转义等于把 `<script>` 的注入面开到最大，
 * 而且这类站点是要发布出去的。**宁可多转义，不可少。**
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 打槽位属性。
 *
 * `target` 必须是 `KNOWN_TARGETS` 里的 13 个之一，或 `products.<sku>.<name|summary>`。
 * 写错名字的后果：**系统认不出来 → 该字段永远填不进去，且不报错**。
 */
function slot(target: string): string {
  return ` data-sitecraft-slot="${esc(target)}"`;
}

/** 打节归属属性（供渲染引擎/覆盖统计识别业务节）。 */
function scope(section: string): string {
  return ` data-sitecraft-scope="${esc(section)}"`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

type RenderContext = {
  draft: SiteDraft;
  locale: "zh" | "en";
};

/**
 * 导航栏。
 *
 * ## 导航项**现在是可编辑的**（2026-09-11，⑥）
 *
 * 这里曾经**刻意不打槽位**——因为 `navigation.*` 不在 `KNOWN_TARGETS` 白名单里，
 * 打了会被装载器**静默丢弃**，"看着能改、一点没用"。
 * 数组化时把 `navigation` 加进了白名单（`normalizeSlotTarget` 里有专门一条），
 * 所以现在打上去了，改导航词能就地保存。
 */
function renderNavbar(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const contact = draft.content.contact;
  // 空标签的项跳过（生成过程中会短暂出现），而不是渲染一个点不动的空链接
  const links = draft.navigation.filter((item) => t(item.label, ctx.locale).trim().length > 0);

  // `contact-bar`：顶上多一条细的联系方式栏（实测多个开源模板的写法）。
  // 电话/邮箱都能缺——两个都缺就整条不渲染，**不留一条空栏**。
  const contacts = [contact.phone.trim(), contact.email.trim()].filter(Boolean);
  const topBar = variant === "contact-bar" && contacts.length > 0
    ? `
  <div class="sc-nav__bar">
    <div class="sc-shell sc-nav__bar-inner">
      ${contacts.map((value) => `<span>${esc(value)}</span>`).join("")}
    </div>
  </div>`
    : "";

  return `
<header class="sc-nav">
  ${topBar}
  <div class="sc-shell sc-nav__inner">
    <a class="sc-nav__brand" href="#top">
      <span class="sc-nav__mark" aria-hidden="true"></span>
      <span>${esc(draft.companyName)}</span>
    </a>
    <nav aria-label="主导航">
      <ul class="sc-nav__links">
        ${links
          .map(
            (item) =>
              `<li><a href="${esc(item.target)}"${slot(`navigation.${item.id}.${ctx.locale}`)}>${esc(t(item.label, ctx.locale))}</a></li>`,
          )
          .join("\n        ")}
      </ul>
    </nav>
    <a class="sc-btn sc-nav__cta" href="#contact">${esc(t(contact.title, ctx.locale) || "联系我们")}</a>
  </div>
</header>`.trim();
}

/** 首屏。`split` = 左文右图；`cover` = 背景大图居中。 */
function renderHero(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const hero = draft.content.hero;
  const title = t(hero.title, ctx.locale);
  const subtitle = t(hero.subtitle, ctx.locale);
  const cta = t(hero.cta, ctx.locale);

  // 首屏标题是全系统唯一的硬性必填槽。模型漏写时用企业名兜底——
  // 否则站点会残留占位标题，且"能不能发布"取决于模型当次发挥。
  const safeTitle = title.trim() || draft.companyName;

  const heading = `<h1 class="sc-hero__title"${slot("hero.title")}>${esc(safeTitle)}</h1>`;
  const sub = subtitle.trim()
    ? `<p class="sc-hero__subtitle"${slot("hero.subtitle")}>${esc(subtitle)}</p>`
    : `<p class="sc-hero__subtitle"${slot("hero.subtitle")}></p>`;
  const button = cta.trim()
    ? `<div class="sc-hero__actions"><a class="sc-btn" href="#contact"${slot("hero.cta")}>${esc(cta)}</a></div>`
    : "";

  if (variant === "cover") {
    return `
<section class="sc-hero sc-hero--cover" id="top"${scope("hero")}>
  <div class="sc-hero__bg" aria-hidden="true"></div>
  <div class="sc-shell">
    <p class="sc-hero__eyebrow">${esc(draft.industry || draft.companyName)}</p>
    ${heading}
    ${sub}
    ${button}
  </div>
</section>`.trim();
  }

  return `
<section class="sc-hero" id="top"${scope("hero")}>
  <div class="sc-shell sc-hero__grid">
    <div>
      <p class="sc-hero__eyebrow">${esc(draft.industry || draft.companyName)}</p>
      ${heading}
      ${sub}
      ${button}
    </div>
    <div class="sc-hero__visual" aria-hidden="true">
      <span>${esc(draft.companyName)}</span>
    </div>
  </div>
</section>`.trim();
}

/**
 * 节标题（多数板块共用）。
 *
 * ⚠️ **刻意不打槽位**。`features.title` / `services.title` 都在 `KNOWN_TARGETS`
 * 白名单里，打上去装载器也认得——但这条路径的**写回是断的**：
 * `update_item` 只管条目，节标题要走 `set_text`，而就地编辑映射里
 * 既没有 `set_text` 的目标集含 `faq.title`/`testimonials.title`，
 * 写回侧也没有对应的字段（`content.faq.title` 不在 `textTargets` 里）。
 *
 * 打上一个"点了改不动"的槽位，比不打更糟：用户会以为能改。
 * 等 ⑥ 扩 `site-operations` 的契约时，这里再补 `target` 参数一起打通。
 */
function sectionHead(title: string, intro: string, align = "left"): string {
  if (!title.trim() && !intro.trim()) return "";
  return `<div class="sc-section__head${align === "center" ? " sc-section__head--center" : ""}">
      ${title.trim() ? `<h2 class="sc-section__title">${esc(title)}</h2>` : ""}
      ${intro.trim() ? `<p class="sc-section__intro">${esc(intro)}</p>` : ""}
    </div>`;
}

/**
 * 特性区。`grid` = 三列图标卡；`alternating` = 左右交替图文。
 *
 * 槽位规则（**做错就填不进去**）：`features.items.N.title` 与 `.body` 必须成对，
 * 且 N 从 0 连续编号。
 */
function renderFeatures(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const section = draft.content.features;
  const title = t(section.title, ctx.locale);
  const intro = t(section.intro, ctx.locale);
  const items = section.items;

  // 无条目就整节不渲染——同 `renderServices`：只有标题的空板块看着像坏掉。
  // 原先这里保留一个"只有标题"的空节是为了保住标题槽位，但标题槽位
  // 本来也不在 `KNOWN_TARGETS` 里（见 `lib/template-runtime.ts` 的白名单），
  // 保它没有意义，反而在页面上留了个空洞。
  if (items.length === 0) return "";

  const cards = items
    .map(
      (item, index) => `
      <article class="sc-card">
        <span class="sc-card__icon" aria-hidden="true"></span>
        <h3 class="sc-card__title"${slot(`features.items.${index}.title`)}>${esc(t(item.title, ctx.locale))}</h3>
        <p class="sc-card__body"${slot(`features.items.${index}.body`)}>${esc(t(item.body, ctx.locale))}</p>
      </article>`,
    )
    .join("");

  if (variant === "alternating") {
    return `
<section class="sc-section" id="features"${scope("features")}>
  <div class="sc-shell">
    ${sectionHead(title, intro)}
    <div class="sc-alt">
      ${items
        .map(
          (item, index) => `
      <div class="sc-alt__row${index % 2 === 1 ? " sc-alt__row--flip" : ""}">
        <div class="sc-alt__text">
          <h3${slot(`features.items.${index}.title`)}>${esc(t(item.title, ctx.locale))}</h3>
          <p${slot(`features.items.${index}.body`)}>${esc(t(item.body, ctx.locale))}</p>
        </div>
        <div class="sc-alt__media" aria-hidden="true"></div>
      </div>`,
        )
        .join("")}
    </div>
  </div>
</section>`.trim();
  }

  return `
<section class="sc-section" id="features"${scope("features")}>
  <div class="sc-shell">
    ${sectionHead(title, intro)}
    <div class="sc-grid sc-grid--3">${cards}</div>
  </div>
</section>`.trim();
}

/** 服务区。三列服务卡，结构与 features 类似但语义独立（槽位是 `services.*`）。 */
function renderServices(ctx: RenderContext): string {
  const { draft } = ctx;
  const section = draft.content.services;
  const items = section.items;

  // 无条目就整节不渲染。实测（2026-09-11）：模型给了 services 板块但 items 为空，
  // 结果是页面上出现一个**光秃秃的标题**（"推荐产品"下面什么都没有）——
  // 看着像坏掉，比少一节还糟。图里没有的内容不该凭空多出一节。
  if (items.length === 0) return "";

  const cards = items
    .map(
      (item, index) => `
      <article class="sc-card sc-card--service">
        <span class="sc-card__icon" aria-hidden="true"></span>
        <h3 class="sc-card__title"${slot(`services.items.${index}.title`)}>${esc(t(item.title, ctx.locale))}</h3>
        <p class="sc-card__body"${slot(`services.items.${index}.body`)}>${esc(t(item.body, ctx.locale))}</p>
      </article>`,
    )
    .join("");

  return `
<section class="sc-section" id="services"${scope("services")}>
  <div class="sc-shell">
    ${sectionHead(t(section.title, ctx.locale), t(section.intro, ctx.locale))}
    <div class="sc-grid sc-grid--3">${cards}</div>
  </div>
</section>`.trim();
}

/** 关于区。左文右图 + 可选图标卡（图标卡走 features 槽位，与真实模板一致）。 */
function renderAbout(ctx: RenderContext): string {
  const { draft } = ctx;
  const about = draft.content.about;

  return `
<section class="sc-section" id="about"${scope("about")}>
  <div class="sc-shell sc-about">
    <div class="sc-about__text">
      <h2${slot("about.title")}>${esc(t(about.title, ctx.locale))}</h2>
      <p${slot("about.body")}>${esc(t(about.body, ctx.locale))}</p>
    </div>
    <div class="sc-about__media" aria-hidden="true"></div>
  </div>
</section>`.trim();
}

/**
 * 客户 Logo 墙（2026-09-11，④）。
 *
 * ## 为什么没图也是"字"不是"空框"
 *
 * `logos[].logo` 是**可选**的（见 `logoSchema` 的说明：从截图里读公司名可靠、
 * 读 logo 像素不可靠）。没图时渲染公司名文字标——**空框比不渲染还糟**：
 * 访客看到一排灰格子会以为页面坏了。
 *
 * ## 没名字的格子直接丢掉
 *
 * 名字是这格的**事实**（读屏要念、用户要知道这格是谁），图只是装饰。
 * 没名字的格子即使有图也不渲染——否则读屏用户拿到一排无名图片。
 */
function renderLogos(ctx: RenderContext): string {
  const { draft } = ctx;
  const items = draft.logos.filter((item) => item.name.trim().length > 0);
  if (items.length === 0) return "";

  const cells = items
    .map((item, index) => {
      const logo = typeof item.logo === "string" ? item.logo.trim() : "";
      const media = logo
        ? `<img class="sc-logos__img" src="${esc(logo)}" alt="${esc(item.name)}" loading="lazy">`
        : `<span class="sc-logos__name">${esc(item.name)}</span>`;
      return `<li class="sc-logos__item"${slot(`logos.${index}.name`)}>${media}</li>`;
    })
    .join("");

  return `
<section class="sc-section sc-logos" id="clients"${scope("logos")}>
  <div class="sc-shell">
    <p class="sc-logos__label">合作客户</p>
    <ul class="sc-logos__row">${cells}</ul>
  </div>
</section>`.trim();
}

/**
 * 常见问题（2026-09-11，④）。
 *
 * ## 用原生 `<details>/<summary>`，不写 JS
 *
 * 项目实测过的取舍（`scripts/mirror-template-assets.mjs` 的 A 路径同理）：
 * 产物是**自包含 HTML**，多一段脚本就多一个失败面。`<details>` 是浏览器原生的
 * 折叠语义，键盘、读屏、打印全都免费拿到；自己写 accordion 三样都要补。
 *
 * ## 槽位打在 `<summary>` 上、不打在 `<details>` 上
 *
 * `features.items.N.title` 的先例是打在标题节点上。`<details>` 携带 open 状态，
 * 就地编辑替换的是文本，打在它上面会连折叠状态一起被覆盖。
 */
function renderFaq(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const section = draft.content.faq;
  if (!section || section.items.length === 0) return "";

  const title = t(section.title, ctx.locale);
  const intro = t(section.intro, ctx.locale);

  const rows = section.items
    .map(
      (item, index) => `
      <details class="sc-faq__item">
        <summary class="sc-faq__q"${slot(`faq.items.${index}.title`)}>${esc(t(item.title, ctx.locale))}</summary>
        <p class="sc-faq__a"${slot(`faq.items.${index}.body`)}>${esc(t(item.body, ctx.locale))}</p>
      </details>`,
    )
    .join("");

  if (variant === "two-column") {
    return `
<section class="sc-section sc-faq sc-faq--two" id="faq"${scope("faq")}>
  <div class="sc-shell sc-faq__grid">
    ${sectionHead(title, intro)}
    <div class="sc-faq__list">${rows}</div>
  </div>
</section>`.trim();
  }

  return `
<section class="sc-section sc-faq" id="faq"${scope("faq")}>
  <div class="sc-shell">
    ${sectionHead(title, intro, "center")}
    <div class="sc-faq__list sc-faq__list--narrow">${rows}</div>
  </div>
</section>`.trim();
}

/**
 * 客户评价（2026-09-11，④）。
 *
 * ## 引用语义用 `<blockquote>` + `<cite>`
 *
 * 与 `faq` 同理：原生标签把"这是别人说的话"这件事交给读屏与搜索引擎，
 * 用 `<div>` 拼出来在视觉上一样，在语义上是空的。
 *
 * ## `role` 空着就不渲染那一行
 *
 * 模型从截图里读不出"采购总监"时会给空串或缺口标记——**宁可不显示，
 * 也不要凭空补一个身份**。编造职衔是在替客户说他没说过的话。
 */
function renderTestimonials(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const section = draft.content.testimonials;
  if (!section || section.items.length === 0) return "";

  const title = t(section.title, ctx.locale);
  const intro = t(section.intro, ctx.locale);

  const cards = section.items
    .map((item, index) => {
      const author = t(item.author, ctx.locale);
      const role = t(item.role, ctx.locale);
      const meta = [
        author.trim() ? `<cite class="sc-quote__author"${slot(`testimonials.items.${index}.author`)}>${esc(author)}</cite>` : "",
        role.trim() ? `<span class="sc-quote__role"${slot(`testimonials.items.${index}.role`)}>${esc(role)}</span>` : "",
      ]
        .filter(Boolean)
        .join("");
      return `
      <figure class="sc-quote">
        <blockquote class="sc-quote__text"${slot(`testimonials.items.${index}.quote`)}>${esc(t(item.quote, ctx.locale))}</blockquote>
        ${meta ? `<figcaption class="sc-quote__meta">${meta}</figcaption>` : ""}
      </figure>`;
    })
    .join("");

  // `quote` 版式 = 居中大段引用，一次只突出**第一条**——
  // 图里那种"整屏一句话"的版式放三条会互相抢注意力。
  if (variant === "quote") {
    return `
<section class="sc-section sc-quotes sc-quotes--single" id="testimonials"${scope("testimonials")}>
  <div class="sc-shell">
    ${sectionHead(title, intro, "center")}
    <div class="sc-quotes__list sc-quotes__list--one">${cards}</div>
  </div>
</section>`.trim();
  }

  return `
<section class="sc-section sc-quotes" id="testimonials"${scope("testimonials")}>
  <div class="sc-shell">
    ${sectionHead(title, intro, "center")}
    <div class="sc-quotes__list">${cards}</div>
  </div>
</section>`.trim();
}

/**
 * 产品区。四列 SKU 卡片网格。
 *
 * ⚠️ **产品槽位必须用真实 SKU**（`products.<sku>.name`）——写成 `products.0.name`
 * 会被当成 sku="0"，就地编辑静默失效。
 *
 * 产品数据在 `draft.products`（数组），不在 `draft.content.products`（只有标题与引言）。
 */
function renderProducts(ctx: RenderContext): string {
  const { draft } = ctx;
  const section = draft.content.products;
  // 只渲染已发布的商品（草稿态的不该出现在成品站上）
  const items = draft.products.filter((product) => product.status !== "draft");

  const cards = items
    .map((product) => {
      const sku = esc(product.sku);
      const image = typeof product.image === "string" ? product.image.trim() : "";
      // 有图就渲染 <img>，没图退回色块——与 preview 注入逻辑（`product.image` 存在则插
      // `<img>`，否则用 imageColor）保持一致，否则"拼装产物"和"工作台预览"会长得不一样。
      const media = image
        ? `<img class="sc-product__img" src="${esc(image)}" alt="${esc(t(product.name, ctx.locale))}" loading="lazy">`
        : `<div class="sc-product__ph" style="background:${esc(product.imageColor || "#e8ece9")}"><span>${sku}</span></div>`;
      return `
      <article class="sc-product">
        <div class="sc-product__media">
          ${media}
        </div>
        <h3 class="sc-product__name"${slot(`products.${product.sku}.name`)}>${esc(t(product.name, ctx.locale))}</h3>
        <p class="sc-product__summary"${slot(`products.${product.sku}.summary`)}>${esc(t(product.summary, ctx.locale))}</p>
        <span class="sc-product__sku">${sku}</span>
      </article>`;
    })
    .join("");

  return `
<section class="sc-section" id="products"${scope("products")}>
  <div class="sc-shell">
    ${sectionHead(t(section.title, ctx.locale), t(section.intro, ctx.locale), "center")}
    ${items.length > 0 ? `<div class="sc-grid sc-grid--4">${cards}</div>` : ""}
  </div>
</section>`.trim();
}

/** 联系区。`split` = 左信息右表单；`centered` = 居中。 */
function renderContact(ctx: RenderContext, variant: string): string {
  const { draft } = ctx;
  const contact = draft.content.contact;

  // email/phone 打在 <a href="mailto:/tel:"> 上、address 打在 <address> 上——
  // 与 `lib/template-slot-injection.ts` 的补全规则对齐，否则同一套槽位两条路径行为不同。
  const channels = [
    contact.phone.trim()
      ? `<li><a href="tel:${esc(contact.phone.replace(/\s/g, ""))}"${slot("contact.phone")}>${esc(contact.phone)}</a></li>`
      : "",
    contact.email.trim()
      ? `<li><a href="mailto:${esc(contact.email)}"${slot("contact.email")}>${esc(contact.email)}</a></li>`
      : "",
    t(contact.address, ctx.locale).trim()
      ? `<li><address${slot("contact.address")}>${esc(t(contact.address, ctx.locale))}</address></li>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const info = `
    <div class="sc-contact__info">
      <h2${slot("contact.title")}>${esc(t(contact.title, ctx.locale))}</h2>
      <p${slot("contact.body")}>${esc(t(contact.body, ctx.locale))}</p>
      ${channels ? `<ul class="sc-contact__channels">${channels}</ul>` : ""}
    </div>`;

  // 表单是纯前端占位——真实询盘链路走项目既有的 form 机制，不在这里实现。
  const form = `
    <form class="sc-contact__form" onsubmit="return false">
      <label>您的称呼<input type="text" name="name" autocomplete="name"></label>
      <label>联系方式<input type="text" name="contact" autocomplete="tel"></label>
      <label>需求描述<textarea name="message" rows="4"></textarea></label>
      <button class="sc-btn" type="submit">提交需求</button>
    </form>`;

  if (variant === "centered") {
    return `
<section class="sc-section sc-contact--centered" id="contact"${scope("contact")}>
  <div class="sc-shell">
    ${info}
    ${form}
  </div>
</section>`.trim();
  }

  return `
<section class="sc-section" id="contact"${scope("contact")}>
  <div class="sc-shell sc-contact">
    ${info}
    ${form}
  </div>
</section>`.trim();
}

/** CTA 条。内容取首屏的标语与按钮，不单独设字段。 */
function renderCta(ctx: RenderContext): string {
  const { draft } = ctx;
  const hero = draft.content.hero;
  const cta = t(hero.cta, ctx.locale);

  return `
<section class="sc-cta">
  <div class="sc-shell">
    <h2 class="sc-cta__title">${esc(t(hero.title, ctx.locale) || draft.companyName)}</h2>
    ${cta.trim() ? `<a class="sc-btn sc-btn--invert" href="#contact">${esc(cta)}</a>` : ""}
  </div>
</section>`.trim();
}

/** 页脚。静态组件，内容取导航与联系信息。 */
function renderFooter(ctx: RenderContext): string {
  const { draft } = ctx;
  const contact = draft.content.contact;
  const year = new Date().getFullYear();

  /**
   * 页脚导航。
   *
   * **不照抄整个导航栏**：页脚是收尾区，把"联系我们"再列一遍与右侧联系方式重复，
   * 而原代码也刻意只取前四项。数组化后改用 `target` 判断——**按"指向哪里"筛，
   * 而不是按"第几个"筛**。这样导航顺序变了页脚也跟着对，
   * 而固定的 `slice(0, 4)` 会在用户调整顺序后悄悄改变页脚内容。
   */
  const navLinks = draft.navigation
    .filter((item) => item.target !== "#contact" && t(item.label, ctx.locale).trim().length > 0)
    .map((item) => `<li><a href="${esc(item.target)}">${esc(t(item.label, ctx.locale))}</a></li>`)
    .join("");

  const contactLines = [contact.phone, contact.email]
    .filter((value) => value.trim().length > 0)
    .map((value) => `<li>${esc(value)}</li>`)
    .join("");

  return `
<footer class="sc-footer">
  <div class="sc-shell">
    <div class="sc-footer__cols">
      <div>
        <div class="sc-footer__brand">${esc(draft.companyName)}</div>
        <p class="sc-footer__desc">${esc(t(contact.body, ctx.locale))}</p>
      </div>
      <div>
        <h4>快速导航</h4>
        <ul>${navLinks}</ul>
      </div>
      <div>
        <h4>联系方式</h4>
        <ul>${contactLines}</ul>
      </div>
    </div>
    <div class="sc-footer__base">© ${year} ${esc(draft.companyName)}</div>
  </div>
</footer>`.trim();
}

/** 组件分发。未实现的组件类型在此显式短路，避免"静默产出空 section"。 */
function renderBlock(block: ComposerBlock, ctx: RenderContext): string {
  const variant = resolveVariant(block);
  switch (block.type) {
    case "navbar":
      return renderNavbar(ctx, variant);
    case "hero":
      return renderHero(ctx, variant);
    case "features":
      return renderFeatures(ctx, variant);
    case "services":
      return renderServices(ctx);
    case "about":
      return renderAbout(ctx);
    case "products":
      return renderProducts(ctx);
    case "logos":
      return renderLogos(ctx);
    case "faq":
      return renderFaq(ctx, variant);
    case "testimonials":
      return renderTestimonials(ctx, variant);
    case "contact":
      return renderContact(ctx, variant);
    case "cta":
      return renderCta(ctx);
    case "footer":
      return renderFooter(ctx);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 已实现的组件——`composeTemplate` 靠它给未实现项发 warning。 */
const IMPLEMENTED: readonly ComponentType[] = [
  "navbar",
  "hero",
  "features",
  "services",
  "about",
  "products",
  "logos",
  "faq",
  "testimonials",
  "contact",
  "cta",
  "footer",
];

export type ComposeResult =
  | { ok: true; html: string; css: string; warnings: string[] }
  | { ok: false; issues: Array<{ path: string; message: string }> };

/**
 * 把 DSL 拼成完整的、带槽位契约的自包含 HTML。
 *
 * **不抛异常**——把校验失败与"组件未实现"都收进返回值，调用方（重试循环 / 门禁）
 * 不必用 try/catch 包住，也能拿到结构化的失败原因喂回模型。
 */
export function composeTemplate(dsl: ComposerDsl): ComposeResult {
  const issues = validateDsl(dsl);
  const blockers = issues.filter((issue) => issue.level === "blocker");
  if (blockers.length > 0) {
    return { ok: false, issues: blockers.map(({ path, message }) => ({ path, message })) };
  }

  const warnings: string[] = [];
  const ctx: RenderContext = { draft: dsl.content, locale: dsl.content.locale };

  const body = dsl.blocks
    .map((block) => {
      if (!IMPLEMENTED.includes(block.type)) {
        warnings.push(`组件「${block.type}」尚未实现（M1 只做 navbar/hero/footer），已跳过`);
      }
      return renderBlock(block, ctx);
    })
    .filter((section) => section.length > 0)
    .join("\n");

  if (!body.includes("data-sitecraft-slot=\"hero.title\"")) {
    return {
      ok: false,
      issues: [{ path: "blocks", message: "产出里没有首屏标题槽位——它被门禁硬性要求，站点无法通过入库检查" }],
    };
  }

  const css = composeStyleSheet(dsl.tokens);
  const html = `<!doctype html>
<html lang="${dsl.content.locale === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dsl.siteName)}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
</body>
</html>`;

  return { ok: true, html, css, warnings };
}
