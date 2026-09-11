import type { TemplateAdapter } from "./types.ts";

/**
 * MOON / Product Launch 专属适配。
 *
 * 原则：保留模板原生视觉（黑色星空 hero、宇航员、紫粉渐变标题、深色区块、灰蓝卡片、
 * 月面页脚），只把 Astro/SaaS demo 文案收敛为企业业务内容。所有企业信息从 bridge 的
 * activeDraft 读取（同一 IIFE 作用域），不在适配器里写死任何公司/品牌。
 *
 * 结构说明（已核对 vendor/open-source-templates/moon/dist/index.html）：
 *   #starfield canvas 星空 · #astronaut 宇航员 · .gradient-text 渐变标题 ·
 *   #intro(→about) · #features(原生灰蓝卡) · #compatibility / #showcase(demo,删) ·
 *   footer 月面背景。导航 #page-header，含 #theme-switcher/#open-nav-button/#menu-modal。
 */
const heroFn = `const resolveHeroByAdapter = () => {
  const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
  if (existing) return existing;
  return allVisible('body > section h2 .gradient-text, body > section .gradient-text')[0] || null;
}`;

const prepareFn = `const prepareTemplate = () => {
  // draft 来自 bridge 闭包 activeDraft（同一 IIFE 作用域内可访问；不挂 window，
  // 以免与宿主页同名全局冲突）。applyContent 收到 postMessage 后先设 activeDraft 再调本函数。
  const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
  const company = draft?.companyName || draft?.siteName || '';
  const contact = draft?.content?.contact || {};
  const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
  const brandName = company || '精密制造';
  const contactEmail = contact.email || '';
  const contactPhone = contact.phone || '';
  const addressText = localize(contact.address) || '';

  // MOON 的原生主题以深色为主；固定为深色才能保留模板的星空、紫粉渐变和灰蓝层次。
  document.documentElement.dataset.theme = 'dark';
  const header = document.querySelector('#page-header');
  const heroSection = document.querySelector('body > section');
  const intro = document.querySelector('#intro');
  const features = document.querySelector('#features');
  const compatibility = document.querySelector('#compatibility');
  const showcase = document.querySelector('#showcase');

  if (heroSection) {
    // Canvas 星尘在导出快照时可能刚好处于全黑帧，补一层静态星尘纹理保证离线文件可见。
    const starfield = heroSection.querySelector('#starfield');
    if (starfield && !heroSection.querySelector('[data-sitecraft-moon-stars]')) {
      starfield.style.zIndex = '1';
      starfield.style.opacity = '0.9';
      const overlay = document.createElement('div');
      overlay.dataset.sitecraftMoonStars = 'true';
      overlay.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(circle at 18% 22%,rgba(255,255,255,.72) 0 1px,transparent 1.5px),radial-gradient(circle at 74% 36%,rgba(196,181,253,.75) 0 1px,transparent 1.5px),radial-gradient(circle at 44% 78%,rgba(244,114,182,.55) 0 1px,transparent 1.5px),radial-gradient(circle at 88% 82%,rgba(255,255,255,.58) 0 1px,transparent 1.5px);background-size:180px 160px,240px 220px,210px 190px,300px 260px;opacity:.65';
      heroSection.insertBefore(overlay, heroSection.firstChild);
      heroSection.querySelector(':scope > .relative.grid')?.setAttribute('style', 'position:relative;z-index:2');
    }
  }

  // 导航：品牌 + 5 个锚点（从 draft 读导航文案，兜底中文）
  if (header) {
    const brand = header.querySelector('a[href="#"]');
    if (brand) {
      brand.innerHTML = '<span data-sitecraft-brand>' + brandName + '</span>';
      brand.setAttribute('href', '#top');
      brand.style.cssText = 'font-weight:800;letter-spacing:.08em;font-size:1.1rem';
    }
    const navCopy = draft?.navigation || {};
    const labelOf = (k, fallback) => localize(navCopy[k]) || fallback;
    const labels = [
      labelOf('about', '关于我们'), labelOf('features', '核心优势'),
      labelOf('services', '服务能力'), labelOf('products', '产品中心'), labelOf('contact', '联系我们'),
    ];
    const targets = ['#about', '#features', '#services', '#products', '#contact'];
    const navList = header.querySelector('nav ul');
    if (navList) {
      while (navList.children.length < labels.length) {
        const li = document.createElement('li');
        li.innerHTML = '<a class="text-sm"></a>';
        navList.append(li);
      }
    }
    const links = Array.from(header.querySelectorAll('nav a'));
    links.forEach((link, index) => {
      link.textContent = labels[index] || '联系我们';
      link.setAttribute('href', targets[index] || '#contact');
      link.dataset.sitecraftSlot = 'navigation.' + (['about', 'features', 'services', 'products', 'contact'][index] || 'contact') + '.zh';
    });
    header.querySelector('#theme-switcher')?.remove();
    header.querySelector('#open-nav-button')?.remove();
    header.querySelector('#menu-modal')?.remove();
  }

  if (heroSection) {
    heroSection.id = 'top';
    heroSection.querySelector('a[aria-label*="source"], a[href*="github.com"]')?.remove();
    const heroContent = heroSection.querySelector('h2');
    if (heroContent) {
      let subtitle = heroContent.querySelector('[data-sitecraft-hero-subtitle]');
      if (!subtitle) {
        subtitle = document.createElement('p');
        subtitle.dataset.sitecraftHeroSubtitle = 'true';
        subtitle.style.cssText = 'max-width:30rem;margin:1.25rem auto 0;text-align:center;color:rgba(255,255,255,.82);font-size:1rem;line-height:1.7';
        heroContent.append(subtitle);
      }
      let cta = heroContent.querySelector('[data-sitecraft-hero-cta]');
      if (!cta) {
        cta = document.createElement('a');
        cta.dataset.sitecraftHeroCta = 'true';
        cta.href = '#products';
        cta.textContent = '获取报价';
        cta.style.cssText = 'display:inline-flex;margin-top:1.25rem;padding:.7rem 1.2rem;border:2px solid currentColor;color:#fff;text-decoration:none;font-weight:700';
        heroContent.append(cta);
      }
    }
  }

  if (intro) {
    intro.id = 'about';
    intro.dataset.sitecraftScope = 'about';
    intro.classList.add('moon-business-section');
    intro.querySelectorAll('a').forEach((node) => node.remove());
    intro.querySelector('svg')?.remove();
    // #intro 的 <p class="max-w-xl ..."> 由共享注入承载 about.body：剥嵌在句中的强调 span，
    // 否则整段中文被 setText 覆盖时会残留 span 造成排版碎裂。
    Array.from(intro.children).filter((n) => n.tagName === 'P').forEach((p) => {
      p.querySelectorAll('span').forEach((s) => { const t = document.createTextNode(s.textContent || ''); s.replaceWith(t); });
    });
  }

  // features：保留 MOON 原生灰蓝卡骨架（不清空重建）。demo 文案由 applyContent 的
  // applyNativeContentFill（下方 nativeFillFn）按 draft.features.items 改写 li 内 p，
  // 只有明确属于生成的卡区才允许通用卡墙；打上原生标记让注入短路。
  if (features) {
    features.dataset.sitecraftScope = 'features';
    features.classList.add('moon-business-section');
    // 移除原生 features 里的 demo 结构（图标列头与 Astro 示例链接），保留 ul 卡片骨架
    features.querySelectorAll('a').forEach((node) => {
      if (!node.closest('ul')) node.remove();
    });
    // 剥 ul 前 <p> 简介内嵌强调 span：本地化整段重写需干净 p，避免嵌 span 碎裂
    Array.from(features.children).filter((n) => n.tagName === 'P').forEach((p) => {
      p.querySelectorAll('span').forEach((s) => { const t = document.createTextNode(s.textContent || ''); s.replaceWith(t); });
    });
  }

  [compatibility, showcase].forEach((section) => section?.remove());

  document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
  document.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') || '';
    if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) anchor.removeAttribute('href');
  });
  document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  let description = document.head.querySelector('meta[name="description"]');
  if (!description) {
    description = document.createElement('meta');
    description.setAttribute('name', 'description');
    document.head.append(description);
  }
  description.setAttribute('content', (company ? company + '：' : '') + localize(draft?.content?.about?.body) || '');

  const footer = document.querySelector('footer');
  if (footer) {
    const backdrop = footer.querySelector(':scope > div');
    if (backdrop) {
      backdrop.style.opacity = '0.78';
      const moonImage = backdrop.querySelector('img');
      moonImage?.setAttribute('alt', '');
      moonImage?.removeAttribute('loading');
    }
    footer.querySelector('ul')?.remove();
    footer.querySelector('[data-sitecraft-footer-content]')?.remove();
    const content = document.createElement('div');
    content.dataset.sitecraftFooterContent = 'true';
    content.style.cssText = 'position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:.45rem;text-align:center;color:#f9fafb;padding:1.5rem';
    const parts = ['<strong style="font-size:1.05rem;letter-spacing:.06em">' + brandName + '</strong>'];
    if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="font-size:.9rem;opacity:.82;color:#f9fafb;text-decoration:none">' + contactEmail + '</a>');
    if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="font-size:.82rem;opacity:.72;color:#f9fafb;text-decoration:none">' + contactPhone + '</a>');
    if (addressText) parts.push('<span style="font-size:.78rem;opacity:.6">' + addressText + '</span>');
    content.innerHTML = parts.join('');
    footer.append(content);
  }
};`;

// nativeFillFn：把 draft.features.items 填进 MOON 原生 #features 的 6 个 li（图标+标题+正文）。
// 每个 li 结构是 <div 图标> + <p.text-xl 标题> + <p.text-sm 正文>——标题不是 h3，通用 applyCards
// 的 h3/h2 选择器找不到，必须专属改写。改写后 li 内 p 带上 sitecraft-slot，使共享注入
// hasVisibleSlotPrefix('features.items') 短路，不再回退到通用卡片墙。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features;
    const items = (features && Array.isArray(features.items)) ? features.items : [];
    const section = document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    // 仅匹配 MOON 原生 6 卡（ul>li 内至少一个 p）；别误伤其它 ul
    const lis = Array.from(section.querySelectorAll('ul > li')).filter((li) => li.querySelector('p'));
    if (!items.length) {
      lis.forEach((li) => { li.hidden = true; li.style.setProperty('display', 'none', 'important'); });
      return;
    }
    // 原生 li 多于内容项时，多余的整卡隐藏（保持 3 列网格的视觉密度）
    lis.slice(items.length).forEach((li) => {
      li.hidden = true; li.style.setProperty('display', 'none', 'important'); li.setAttribute('aria-hidden', 'true');
    });
    lis.slice(0, items.length).forEach((li, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const ps = Array.from(li.querySelectorAll('p')).filter((p) => (p.textContent || '').trim());
      const titleP = ps.find((p) => /text-(?:xl|2xl|3xl)/.test(String(p.className || ''))) || ps[0];
      const bodyP = ps.find((p) => /text-(?:xs|sm|base)/.test(String(p.className || ''))) || ps[ps.length - 1];
      if (titleP && item && item.title) setText(titleP, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (bodyP && item && item.body) setText(bodyP, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      li.dataset.sitecraftNativeFeaturesItem = itemKey;
      li.dataset.sitecraftSection = 'features';
    });
  };
`;

const designTokenCss =
  'html,body{background:#111827!important}' +
  '#top{background:#05050a!important}' +
  '.moon-business-section{background:#111827!important;color:#f9fafb!important}' +
  '#features{background:#0f172a!important}' +
  '[data-sitecraft-generated-products],[data-sitecraft-generated-content="services"]{background:#1f2937!important;color:#f9fafb!important}' +
  '[data-sitecraft-generated-content="contact"]{background:linear-gradient(135deg,#111827,#1f2937)!important;color:#f9fafb!important}' +
  'h1,h2,h3{color:inherit!important}' +
  '.gradient-text,[data-sitecraft-generated-products] h2,[data-sitecraft-generated-content] h2{background-image:linear-gradient(to bottom right,#818cf8,#d946ef,#ec4899)!important;background-clip:text!important;-webkit-background-clip:text!important;color:transparent!important}' +
  '#features li,[data-sitecraft-generated-products] article,[data-sitecraft-generated-content] article{background:#1f2937!important;color:#f9fafb!important;border-color:rgba(129,140,248,.28)!important}' +
  '[data-sitecraft-generated-content="contact"] a{color:#86efac!important}' +
  'footer{background:#111827!important;color:#f9fafb!important}' +
  'footer:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(17,24,39,.08),rgba(17,24,39,.28));pointer-events:none}' +
  '@media (max-width:640px){#top h2 .gradient-text{font-size:2.5rem!important;line-height:1.12!important;letter-spacing:.01em!important}.moon-business-section,[data-sitecraft-generated-products],[data-sitecraft-generated-content]{padding-left:20px!important;padding-right:20px!important}}';

export const moonAdapter: TemplateAdapter = {
  templateId: "moon",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss,
};
