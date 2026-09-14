/**
 * 拼装组件的基础样式（token 驱动层）。
 *
 * ## 与 `applyDesignTokens` 共用同一套变量
 *
 * 变量名与取值**必须**和 `lib/template-preview-bridge.ts` 里的
 * `applyDesignTokens` 一致——那边是运行时覆盖用户配色的地方。**变量名对不上，
 * 用户改配色时拼装出来的页面不会跟着变**（静默失效，最难排查）。
 *
 * | 变量 | 来源 | sharp/soft/rounded |
 * |---|---|---|
 * | `--sitecraft-radius` | `tokens.radius` | 2px / 8px / 18px |
 * | `--sitecraft-section-space` | `tokens.density` | 44px / 64px / 84px |
 * | `--sitecraft-font` | `tokens.fontStyle` | sans / editorial / technical |
 *
 * ## ⚠️ 禁止硬编码
 *
 * 组件里**不许出现写死的圆角、间距、颜色**。行业差异**不是组件差异，是参数差异**——
 * 同一个产品网格，机械行业要 `radius: sharp` + 深灰蓝，食品行业要 `rounded` + 暖橙。
 * **写死一个圆角，换 token 就失效。**
 *
 * ## 自包含
 *
 * 导出（`buildOfflineHtml`）会把整页样式内联。**不能依赖外部 CSS 文件或 CDN**。
 */

/** 兜底 token——`composeTemplate` 会在 `<style>` 里用真实值覆盖。 */
const FALLBACK_TOKENS = `
  --sitecraft-primary: #2e6b4f;
  --sitecraft-secondary: #506057;
  --sitecraft-accent: #b9f56b;
  --sitecraft-font: Manrope, "Noto Sans SC", system-ui, sans-serif;
  --sitecraft-radius: 8px;
  --sitecraft-section-space: 64px;
  --sitecraft-ink: #172019;
  --sitecraft-ink-soft: #506057;
  --sitecraft-line: #dfe7e1;
  --sitecraft-paper: #f6f8f5;
  --sitecraft-white: #ffffff;
`;

/**
 * 全部组件的样式。
 *
 * 类名前缀统一 `sc-`（sitecraft），避免与模板自带类冲突。
 */
export const COMPOSER_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    font-family: var(--sitecraft-font);
    color: var(--sitecraft-ink);
    background: var(--sitecraft-white);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  img { max-width: 100%; display: block; }
  a { color: inherit; text-decoration: none; }

  .sc-shell { width: min(100% - 40px, 1160px); margin-inline: auto; }

  /* ---------- 通用按钮（全走变量，含圆角） ---------- */
  .sc-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 12px 24px;
    border: 1px solid transparent;
    border-radius: var(--sitecraft-radius);
    background: var(--sitecraft-primary);
    color: #fff;
    font-size: 15px; font-weight: 600;
    cursor: pointer;
    transition: opacity .15s;
  }
  .sc-btn:hover { opacity: .88; }
  .sc-btn--ghost {
    background: transparent;
    border-color: var(--sitecraft-line);
    color: var(--sitecraft-ink);
  }

  /* ---------- navbar ---------- */
  .sc-nav {
    border-bottom: 1px solid var(--sitecraft-line);
    background: var(--sitecraft-white);
  }
  .sc-nav__inner {
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px;
    min-height: 68px;
    padding-block: 12px;
  }
  .sc-nav__brand {
    display: inline-flex; align-items: center; gap: 10px;
    font-size: 17px; font-weight: 700; letter-spacing: -.02em;
    color: var(--sitecraft-primary);
  }
  .sc-nav__mark {
    width: 26px; height: 26px; flex: 0 0 auto;
    border-radius: calc(var(--sitecraft-radius) / 2);
    background: var(--sitecraft-primary);
  }
  .sc-nav__links {
    display: flex; align-items: center; gap: 26px;
    list-style: none; margin: 0; padding: 0;
    font-size: 14px; color: var(--sitecraft-ink-soft);
  }
  .sc-nav__links a:hover { color: var(--sitecraft-primary); }
  .sc-nav__cta { font-size: 14px; padding: 9px 18px; }

  /* ---------- hero ---------- */
  .sc-hero { padding-block: var(--sitecraft-section-space); }
  .sc-hero__grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 56px; align-items: center;
  }
  .sc-hero__eyebrow {
    font-size: 13px; font-weight: 600; letter-spacing: .04em;
    color: var(--sitecraft-primary); margin: 0 0 14px;
  }
  .sc-hero__title {
    margin: 0;
    font-size: clamp(30px, 4.2vw, 52px);
    line-height: 1.14;
    letter-spacing: -.03em;
  }
  .sc-hero__subtitle {
    margin: 20px 0 0;
    font-size: 17px; line-height: 1.75;
    color: var(--sitecraft-ink-soft);
    max-width: 54ch;
  }
  .sc-hero__actions { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 12px; }
  .sc-hero__visual {
    border-radius: var(--sitecraft-radius);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--sitecraft-primary) 12%, #fff), color-mix(in srgb, var(--sitecraft-accent) 18%, #fff));
    min-height: 340px;
    display: grid; place-items: center;
    color: var(--sitecraft-primary);
  }
  /* cover 版式：大图背景 + 居中文字 */
  .sc-hero--cover { position: relative; text-align: center; color: #fff; }
  .sc-hero--cover .sc-hero__bg {
    position: absolute; inset: 0;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--sitecraft-primary) 82%, #000), var(--sitecraft-primary));
    z-index: 0;
  }
  .sc-hero--cover .sc-shell { position: relative; z-index: 1; }
  .sc-hero--cover .sc-hero__title { max-width: 20ch; margin-inline: auto; }
  .sc-hero--cover .sc-hero__subtitle { margin-inline: auto; color: rgba(255,255,255,.86); }
  .sc-hero--cover .sc-hero__actions { justify-content: center; }
  .sc-hero--cover .sc-hero__eyebrow { color: rgba(255,255,255,.8); }

  /* ---------- footer ---------- */
  .sc-footer {
    margin-top: var(--sitecraft-section-space);
    padding-block: calc(var(--sitecraft-section-space) * .7);
    border-top: 1px solid var(--sitecraft-line);
    background: var(--sitecraft-paper);
    font-size: 14px;
    color: var(--sitecraft-ink-soft);
  }
  .sc-footer__cols {
    display: grid; grid-template-columns: 1.6fr repeat(2, 1fr);
    gap: 40px;
  }
  .sc-footer__brand { color: var(--sitecraft-primary); font-weight: 700; font-size: 16px; }
  .sc-footer__desc { margin: 12px 0 0; max-width: 40ch; line-height: 1.75; }
  .sc-footer h4 { margin: 0 0 14px; font-size: 13px; color: var(--sitecraft-ink); }
  .sc-footer ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
  .sc-footer a:hover { color: var(--sitecraft-primary); }
  .sc-footer__base {
    margin-top: calc(var(--sitecraft-section-space) * .5);
    padding-top: 20px;
    border-top: 1px solid var(--sitecraft-line);
    font-size: 13px;
  }

  /* ---------- 通用节 ---------- */
  .sc-section { padding-block: var(--sitecraft-section-space); }
  .sc-section__head { margin-bottom: calc(var(--sitecraft-section-space) * .5); }
  .sc-section__head--center { text-align: center; }
  .sc-section__title {
    margin: 0;
    font-size: clamp(24px, 2.8vw, 34px);
    line-height: 1.2; letter-spacing: -.02em;
  }
  .sc-section__intro {
    margin: 14px 0 0;
    font-size: 16px; line-height: 1.75;
    color: var(--sitecraft-ink-soft);
    max-width: 62ch;
  }
  .sc-section__head--center .sc-section__intro { margin-inline: auto; }

  /* ---------- 栅格 ---------- */
  .sc-grid { display: grid; gap: 24px; }
  .sc-grid--3 { grid-template-columns: repeat(3, 1fr); }
  .sc-grid--4 { grid-template-columns: repeat(4, 1fr); }

  /* ---------- 卡片（features / services 共用） ---------- */
  .sc-card {
    padding: 26px;
    border: 1px solid var(--sitecraft-line);
    /* 圆角全走变量——写死会让 radius:sharp 的行业（机械/律所）失效 */
    border-radius: var(--sitecraft-radius);
    background: var(--sitecraft-white);
    transition: border-color .15s;
  }
  .sc-card:hover { border-color: var(--sitecraft-primary); }
  .sc-card__icon {
    display: block;
    width: 40px; height: 40px;
    margin-bottom: 16px;
    border-radius: calc(var(--sitecraft-radius) * .75);
    background: color-mix(in srgb, var(--sitecraft-primary) 14%, #fff);
  }
  .sc-card__title { margin: 0 0 10px; font-size: 17px; line-height: 1.35; }
  .sc-card__body { margin: 0; font-size: 14px; line-height: 1.75; color: var(--sitecraft-ink-soft); }

  /* ---------- alternating（左右交替图文） ---------- */
  .sc-alt { display: grid; gap: 40px; }
  .sc-alt__row {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 40px; align-items: center;
  }
  /* 偶数行翻转：奇数行图片在右、偶数行在左，形成交替节奏 */
  .sc-alt__row--flip .sc-alt__text { order: 2; }
  .sc-alt__text h3 { margin: 0 0 12px; font-size: 22px; letter-spacing: -.02em; }
  .sc-alt__text p { margin: 0; font-size: 15px; line-height: 1.8; color: var(--sitecraft-ink-soft); }
  .sc-alt__media {
    min-height: 240px;
    border-radius: var(--sitecraft-radius);
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--sitecraft-primary) 10%, #fff),
      color-mix(in srgb, var(--sitecraft-accent) 16%, #fff));
  }

  /* ---------- about ---------- */
  .sc-about { display: grid; grid-template-columns: 1.1fr 1fr; gap: 48px; align-items: center; }
  .sc-about__text h2 { margin: 0 0 16px; font-size: clamp(22px, 2.6vw, 32px); letter-spacing: -.02em; }
  .sc-about__text p { margin: 0; font-size: 15px; line-height: 1.85; color: var(--sitecraft-ink-soft); }
  .sc-about__media {
    min-height: 300px;
    border-radius: var(--sitecraft-radius);
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--sitecraft-secondary) 14%, #fff),
      color-mix(in srgb, var(--sitecraft-primary) 10%, #fff));
  }

  /* ---------- products ---------- */
  .sc-product {
    border: 1px solid var(--sitecraft-line);
    border-radius: var(--sitecraft-radius);
    background: var(--sitecraft-white);
    overflow: hidden;
    transition: border-color .15s;
  }
  .sc-product:hover { border-color: var(--sitecraft-primary); }
  /*
   * 媒体区高度随内容走——**有图才占大位**。
   *
   * 早先固定 aspect-ratio 4/3，8 个产品排下来是一片空白（实测：比卡片本身还高），
   * 看起来像"页面坏了"而不是"图片待补"。无图时改用矮色带，视觉上像"占位"而不像"空洞"。
   *
   * ## 图框策略：固定 4:3 + contain 完整显示
   *
   * cover（裁切填满）对产品图是**错**的——工厂产品图经常是竖拍的，
   * cover 会把产品裁掉一半。改用 contain 完整显示，两边留白。
   *
   * ## 底色用主色的极淡版，不用固定灰
   *
   * 固定灰（#f8f9fa 之类）是**冷色**，跟红/绿/藏青主题都冲突，看着脏。
   * 用 color-mix(主色 6%, 白) 则每个模板自动协调——**底色也跟着行业变**。
   * 它的真正作用是**让"没图"看起来是"图位"而不是"坏了"**。
   */
  .sc-product__media {
    background: color-mix(in srgb, var(--sitecraft-primary) 6%, #fff);
  }
  .sc-product__img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: contain;
    display: block;
  }
  /* 无图：矮色带，不是 4:3 大空洞 */
  .sc-product__ph {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 84px;
    color: rgba(255, 255, 255, .92);
    font-size: 12px; letter-spacing: .06em;
    background: color-mix(in srgb, var(--sitecraft-primary) 22%, #fff) !important;
  }
  .sc-product__name { margin: 16px 16px 8px; font-size: 15px; line-height: 1.4; }
  .sc-product__summary {
    margin: 0 16px 12px; font-size: 13px; line-height: 1.7;
    color: var(--sitecraft-ink-soft);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .sc-product__sku {
    display: block; margin: 0 16px 16px;
    font-size: 12px; letter-spacing: .04em;
    color: var(--sitecraft-primary);
  }

  /* ---------- contact ---------- */
  .sc-contact { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
  .sc-contact__info h2 { margin: 0 0 14px; font-size: clamp(22px, 2.6vw, 30px); letter-spacing: -.02em; }
  .sc-contact__info p { margin: 0 0 20px; font-size: 15px; line-height: 1.8; color: var(--sitecraft-ink-soft); }
  .sc-contact__channels { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 15px; }
  .sc-contact__channels address { font-style: normal; }
  .sc-contact__channels a:hover { color: var(--sitecraft-primary); }
  .sc-contact__form { display: grid; gap: 14px; }
  .sc-contact__form label { display: grid; gap: 6px; font-size: 13px; color: var(--sitecraft-ink-soft); }
  .sc-contact__form input,
  .sc-contact__form textarea {
    padding: 11px 13px;
    border: 1px solid var(--sitecraft-line);
    border-radius: calc(var(--sitecraft-radius) * .75);
    font: inherit; font-size: 14px; color: var(--sitecraft-ink);
    background: var(--sitecraft-white);
  }
  .sc-contact__form input:focus,
  .sc-contact__form textarea:focus { outline: 2px solid color-mix(in srgb, var(--sitecraft-primary) 35%, #fff); outline-offset: 1px; }
  .sc-contact--centered { text-align: center; }
  .sc-contact--centered .sc-contact__form { max-width: 520px; margin-inline: auto; text-align: left; }
  .sc-contact--centered .sc-contact__channels { justify-items: center; }

  /* ---------- CTA 条 ---------- */
  .sc-cta {
    padding-block: calc(var(--sitecraft-section-space) * .8);
    background: var(--sitecraft-primary);
    color: #fff;
  }
  .sc-cta .sc-shell {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px;
  }
  .sc-cta__title { margin: 0; font-size: clamp(20px, 2.4vw, 28px); letter-spacing: -.02em; max-width: 34ch; }
  .sc-btn--invert { background: #fff; color: var(--sitecraft-primary); }

  /* ---------- 客户 Logo 墙（2026-09-11，④） ---------- */
  .sc-logos { padding-block: calc(var(--sitecraft-section-space) * .6); }
  .sc-logos__label {
    margin: 0 0 22px; text-align: center;
    font-size: 13px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--sitecraft-ink-soft);
  }
  .sc-logos__row {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 16px 40px;
  }
  .sc-logos__item { display: flex; align-items: center; justify-content: center; min-height: 40px; }
  .sc-logos__img { max-height: 40px; width: auto; opacity: .8; }
  /* 没图时渲染公司名——**不是空框**：一排灰格子会让访客以为页面坏了 */
  .sc-logos__name {
    font-size: 16px; font-weight: 600; letter-spacing: -.01em;
    color: var(--sitecraft-ink-soft);
  }

  /* ---------- 常见问题（2026-09-11，④） ---------- */
  .sc-faq__list { display: grid; gap: 0; border-top: 1px solid var(--sitecraft-line); }
  .sc-faq__list--narrow { max-width: 780px; margin-inline: auto; }
  .sc-faq__grid { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(0, 2fr); gap: 40px; align-items: start; }
  .sc-faq__item { border-bottom: 1px solid var(--sitecraft-line); }
  .sc-faq__q {
    cursor: pointer; list-style: none;
    padding: 18px 30px 18px 0; position: relative;
    font-size: 16px; font-weight: 600; line-height: 1.5;
  }
  /* 去掉各浏览器默认的三角，换成自己的加号——默认三角在不同浏览器位置不一 */
  .sc-faq__q::-webkit-details-marker { display: none; }
  .sc-faq__q::after {
    content: "+"; position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    font-size: 20px; font-weight: 400; color: var(--sitecraft-primary);
  }
  .sc-faq__item[open] .sc-faq__q::after { content: "−"; }
  .sc-faq__q:hover { color: var(--sitecraft-primary); }
  .sc-faq__a {
    margin: 0 0 18px; padding-right: 30px;
    font-size: 14px; line-height: 1.8; color: var(--sitecraft-ink-soft);
  }

  /* ---------- 客户评价（2026-09-11，④） ---------- */
  .sc-quotes__list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .sc-quotes__list--one { grid-template-columns: minmax(0, 720px); justify-content: center; }
  .sc-quote {
    margin: 0; padding: 26px;
    border: 1px solid var(--sitecraft-line); border-radius: var(--sitecraft-radius);
    background: var(--sitecraft-paper);
  }
  .sc-quote__text { margin: 0; font-size: 15px; line-height: 1.8; }
  .sc-quote__text::before { content: "“"; }
  .sc-quote__text::after { content: "”"; }
  .sc-quotes--single .sc-quote { border: 0; background: transparent; text-align: center; }
  .sc-quotes--single .sc-quote__text { font-size: clamp(18px, 2.2vw, 24px); line-height: 1.6; letter-spacing: -.01em; }
  .sc-quote__meta { margin-top: 16px; display: flex; flex-direction: column; gap: 2px; }
  .sc-quotes--single .sc-quote__meta { align-items: center; }
  .sc-quote__author { font-style: normal; font-weight: 600; font-size: 14px; }
  .sc-quote__role { font-size: 13px; color: var(--sitecraft-ink-soft); }

  /* ---------- 导航顶部联系条（navbar 的 contact-bar 版式） ---------- */
  .sc-nav__bar { background: var(--sitecraft-primary); color: #fff; font-size: 13px; }
  .sc-nav__bar-inner { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 20px; padding-block: 7px; }

  /* ---------- 响应式（工厂站大量用手机看） ---------- */
  @media (max-width: 1024px) {
    .sc-grid--4 { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 860px) {
    .sc-hero__grid { grid-template-columns: 1fr; gap: 32px; }
    .sc-hero__visual { min-height: 220px; order: -1; }
    .sc-footer__cols { grid-template-columns: 1fr; gap: 28px; }
    .sc-nav__links { display: none; }
    .sc-grid--3 { grid-template-columns: 1fr; }
    .sc-alt__row { grid-template-columns: 1fr; gap: 24px; }
    .sc-alt__row--flip .sc-alt__text { order: 0; }
    .sc-about { grid-template-columns: 1fr; gap: 28px; }
    /* 左标题右问答在窄屏并排会挤成一列窄条，直接叠起来 */
    .sc-faq__grid { grid-template-columns: 1fr; gap: 24px; }
    .sc-quotes__list { grid-template-columns: 1fr; }
    .sc-contact { grid-template-columns: 1fr; gap: 32px; }
    .sc-cta .sc-shell { flex-direction: column; align-items: flex-start; }
  }
  @media (max-width: 560px) {
    .sc-grid--4 { grid-template-columns: 1fr; }
  }
`;

/**
 * 把 tokens 渲染成 CSS 变量覆盖。
 *
 * 取值表与 `applyDesignTokens` **逐字一致**——两边漂移会让"用户改配色"在
 * 预览与导出两条路径上表现不同。
 */
export function tokenOverrideCss(tokens: {
  primary: string;
  secondary: string;
  accent: string;
  fontStyle: "sans" | "editorial" | "technical";
  radius: "sharp" | "soft" | "rounded";
  density: "compact" | "balanced" | "spacious";
}): string {
  const fonts: Record<typeof tokens.fontStyle, string> = {
    sans: 'Manrope, "Noto Sans SC", system-ui, sans-serif',
    editorial: 'Georgia, "Songti SC", "Times New Roman", serif',
    technical: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
  };
  const radii: Record<typeof tokens.radius, string> = { sharp: "2px", soft: "8px", rounded: "18px" };
  const spaces: Record<typeof tokens.density, string> = { compact: "44px", balanced: "64px", spacious: "84px" };

  return `:root{
  --sitecraft-primary: ${tokens.primary};
  --sitecraft-secondary: ${tokens.secondary};
  --sitecraft-accent: ${tokens.accent};
  --sitecraft-font: ${fonts[tokens.fontStyle]};
  --sitecraft-radius: ${radii[tokens.radius]};
  --sitecraft-section-space: ${spaces[tokens.density]};
}`;
}

/** 组装完整样式表：兜底变量 + token 覆盖 + 组件样式。 */
export function composeStyleSheet(tokens: Parameters<typeof tokenOverrideCss>[0]): string {
  return `${tokenOverrideCss(tokens)}\n${COMPOSER_CSS}`;
}

export { FALLBACK_TOKENS };
