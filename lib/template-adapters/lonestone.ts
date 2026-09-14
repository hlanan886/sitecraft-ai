import type { TemplateAdapter } from "./types.ts";

/**
 * lonestone (= ASTROWIND) 专属适配 —— 企业官网形态。
 *
 * 模板(astrowind/dist/index.html)结构(已核)：
 *   顶部 Astro 公告条(深底, 含 github star 外链) → header#header(品牌🚀AstroWind +
 *   多级 dropdown 导航 Homes/Pages/Landing/Blog + 主题切换/RSS/Download) →
 *   main: hero(h1 大标题+副文+双 CTA+hero 大图) →
 *         "What you get with AstroWind"(id=features, 核心资产: sm:grid-cols-2 无边框
 *         icon_row, 每行 div.flex.flex-row = 圆角方形 svg 图标 + h3 + p, 共 6 行) →
 *         Blueprint 三节交替图文分栏 / 竖向统计+图 / "Most used widgets" 组件带 /
 *         Blog 卡 4 / FAQ / 数字带 / 收尾 CTA("Get your dream website") → footer 大列网格。
 *
 * 企业站只保留 hero + #features 原生 icon_row 带；删全部其余 demo section 与 demo 导航。
 * 编排:
 *   hero     ← 引擎改写 h1/副文/CTA(清 GitHub "Get template" 外链, 保深色渐变首屏视觉)
 *   features ← 引擎写 features.title/intro；nativeFill 把 6 条 items 逐条写进原生 icon_row 的
 *              h3(标题)+p(说明), svg 图标保留 —— astrowind 版 screwfast icon_row。
 *              行打 sitecraft-slot → 短路通用卡墙(不生成 [data-sitecraft-generated-content=features])。
 *   about/services/products/contact ← 共享引擎 generated(产品带图 6 卡)。designTokenCss 配深色面板。
 *
 * 模板默认 light；这里强制 .dark，使用模板自带的成熟深色变体，视觉统一贴合"深色渐变营销模板"。
 * 转义铁律: adapter 源码字符串禁反引号；含冒号(:)类名不用 CSS 选择器, 一律 className contains。
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('main section h1, main h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || '新能源';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';

    // ASTROWIND 深色变体成熟完整：固定 .dark，让 header/features/footer 走 dark: 分支，视觉统一。
    document.documentElement.classList.add('dark');

    // 1) 顶部 Astro 公告条(NEW + Astro v7 外链 + GitHub star 徽章, 深底条)：整条移除
    const stripAnchor = document.querySelector('a[href*="astro.build"], a[href*="github.com"]');
    const stripHost = stripAnchor ? stripAnchor.closest('div') : null;
    if (stripHost && !stripHost.closest('header, main, footer, nav')) stripHost.remove();

    // 2) main 里的 demo section 全部删掉, 只留 hero + #features(原生资产)
    const main = document.querySelector('main') || document.body;
    const sections = Array.from(main.querySelectorAll(':scope > section'));
    const heroSection = sections.find((s) => s.querySelector('h1')) || null;
    const featuresSection = sections.find((s) => s.id === 'features') || null;

    // hero: 删 GitHub "Get template" 主按钮(连同其 flex 壳), 保副按钮并指向 #contact
    if (heroSection) {
      heroSection.id = 'top';
      Array.from(heroSection.querySelectorAll('a[href^="http"], a[href*="github.com"]')).forEach((a) => {
        const shell = a.parentElement;
        if (shell && /flex w-full sm:w-auto/.test(' ' + String(shell.className || '') + ' ')) shell.remove();
        else a.remove();
      });
      const learn = heroSection.querySelector('a[href="#features"]');
      if (learn) learn.setAttribute('href', '#contact');
    }
    // 其余 demo section 整节删除(Blueprint 分栏/竖向统计/widgets/Blog/FAQ/数字带/CTA/Philosophy 条)
    sections.forEach((sec) => { if (sec !== heroSection && sec !== featuresSection) sec.remove(); });

    // 3) features 原生带标记 + 清 section 头上小大写英文标签(eyebrow 如 "Features")。
    //    引擎 features.intro 会写"首个可见 p", 不清 eyebrow 会把中文 intro 写进小标签、正文 p 残留英文。
    if (featuresSection) {
      featuresSection.dataset.sitecraftScope = 'features';
      featuresSection.dataset.sitecraftSection = 'features';
      featuresSection.dataset.sitecraftNativeFeatures = 'true';
      Array.from(featuresSection.querySelectorAll('p')).forEach((p) => {
        const c = String(p.className || '');
        if (c.indexOf('uppercase') >= 0 && c.indexOf('text-secondary') >= 0 && !p.querySelector('a')) p.remove();
      });
    }

    // 4) header: 品牌 → 企业名；导航清空重建 5 锚点；删主题切换/RSS/Download 操作栏
    const header = document.querySelector('header, #header');
    if (header) {
      const brandLink = header.querySelector('a[href="/"]');
      if (brandLink) {
        brandLink.innerHTML = '';
        brandLink.setAttribute('href', '#top');
        const span = document.createElement('span');
        span.dataset.sitecraftBrand = 'true';
        span.style.cssText = 'color:#f1f5f9;font-weight:700;letter-spacing:.02em;white-space:nowrap;font-size:1.05rem;display:inline-block';
        span.textContent = brandName;
        brandLink.append(span);
      }
      const nav = header.querySelector('nav');
      const menu = nav ? nav.querySelector('ul') : null;
      const navCopy = draft?.navigation || {};
      const labelOf = (k, fb) => localize(navCopy[k]) || fb;
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [
        labelOf('about', '关于我们'), labelOf('features', '产品方案'),
        labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们'),
      ];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      if (menu) {
        menu.innerHTML = '';
        labels.forEach((label, i) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.style.cssText = 'display:inline-block;padding:.55rem .7rem;color:#e2e8f0;white-space:nowrap;font-size:.95rem;text-decoration:none';
          a.textContent = label;
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          li.append(a);
          menu.append(li);
        });
      }
      const themeToggle = header.querySelector('[data-aw-toggle-color-scheme], aw-theme-toggle');
      const actionBar = themeToggle ? themeToggle.closest('div[class*="items-center"]') : null;
      if (actionBar) actionBar.remove(); else if (themeToggle) themeToggle.remove();
    }

    // 5) footer: 清 demo 大列网格, 重建企业联系
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;align-items:center;padding:2.2rem 1.2rem;color:#cbd5e1;font-size:.92rem;text-align:center';
      const parts = ['<strong style="color:#f8fafc;font-weight:700">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#7dd3fc;text-decoration:none">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#7dd3fc;text-decoration:none">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.72">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 6) 通用清理: 外链锚点 / srcset / canonical / prefetch-preconnect-preload(unsplash 等) / og-twitter meta
    document.querySelectorAll('a[href^="http"]').forEach((a) => a.remove());
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('link[rel="canonical"], link[rel="alternate"], link[rel="preconnect"], link[rel="preload"], link[rel="prefetch"]').forEach((n) => n.remove());
    document.querySelectorAll('link[href^="http"]').forEach((n) => n.remove());
    // AstroWind 首屏/区块用 IntersectionObserver 滚动动画(motion-safe:*:opacity-0/intersect-*)：
    // 无交互 JS 或截图时未触发 → 文字可能停在 opacity 0 不可见。清除这些动画类，保证内容恒可见。
    document.querySelectorAll('.intersect-once, .intersect-quarter, .intersect, [class*="intersect"]').forEach((el) => {
      el.classList.remove('intersect-once', 'intersect-quarter', 'intersect');
      const cls = (el.className || '').toString().split(' ').filter((c) => c.indexOf('intersect') < 0 && c.indexOf('opacity-0') < 0 && c.indexOf('animate-fade') < 0);
      el.className = cls.join(' ');
      el.removeAttribute('data-animated');
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.append(description);
    }
    description.setAttribute('content', (company ? company + '：' : '') + localize(draft?.content?.about?.body) || '');
  };
`;

// nativeFillFn：把 draft.features.items 写进 ASTROWIND 原生 #features icon_row
// (sm:grid-cols-2 无边框；每行 div.flex.flex-row = 圆角方形 svg 图标 + h3 + p)。
// 保留 svg 图标；改写后行内 h3/p 打 sitecraft-slot，hasVisibleSlotPrefix('features.items') 短路通用卡墙。
// 仅用 className contains / 结构匹配，不用含冒号(:) 类名当 CSS 选择器。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const section = document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    const rows = Array.from(section.querySelectorAll('div')).filter((row) => {
      const c = String(row.className || '');
      return c.indexOf('flex-row') >= 0 && row.querySelector('h3') && row.querySelector('p');
    });
    if (!items.length) {
      rows.forEach((row) => { row.style.setProperty('display', 'none', 'important'); row.setAttribute('aria-hidden', 'true'); });
      return;
    }
    rows.slice(items.length).forEach((row) => {
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    });
    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = row.querySelector('h3');
      const body = row.querySelector('p');
      if (h3 && item && item.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item && item.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
    });
  };
`;

const designTokenCss =
  'html,body{background:#030617!important}' +
  // 首屏滚动动画兜底：任何时刻内容恒可见（清除 opacity-0/动画帧残留）
  '#top, #top h1, #top p, #top a, #features, #features h2, #features h3, #features p{opacity:1!important;transform:none!important;animation:none!important}' +
  'main > section:first-of-type{background:linear-gradient(180deg,#0b1133 0%,#060a20 52%,#02040f 100%)!important}' +
  '#features{color:#e2e8f0!important}' +
  '#features h2{color:#f8fafc!important}' +
  '#features h3{color:#f1f5f9!important}' +
  '#features p{color:#cbd5e1!important}' +
  'header nav ul a{color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content="about"]{background:#070b21!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content="services"]{background:#0a0f2a!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-products]{background:#0d132e!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content="contact"]{background:linear-gradient(160deg,#0b1127,#151c41)!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content] h2,[data-sitecraft-generated-products] h2{color:#f8fafc!important}' +
  '[data-sitecraft-generated-content] h3,[data-sitecraft-generated-products] h3{color:#f1f5f9!important}' +
  '[data-sitecraft-generated-content] p{opacity:.86!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#182140!important;border-color:rgba(148,163,184,.3)!important}' +
  '[data-sitecraft-generated-content="contact"] a,[data-sitecraft-generated-content="contact"] address{color:#7dd3fc!important}' +
  'footer{background:#02040f!important;color:#cbd5e1!important}' +
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}';

export const lonestoneAdapter: TemplateAdapter = {
  templateId: "lonestone",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss,
};
