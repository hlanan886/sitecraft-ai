import type { TemplateAdapter } from "./types.ts";

/**
 * foxi 专属适配 —— 企业官网形态。
 *
 * 原模板（Foxi SaaS 套件落地页）结构：
 *   header(logo + Home/Pricing/Features/... 菜单) →
 *   #intro(居中 hero：avatar chip "30K+ customers" + h1 + p + 按钮 + 产品大图) →
 *   #features("Innovative tools" 5 张 SVG 卡) →
 *   #testimonial(评价) →
 *   #highlight-0..3(4 组交替图文横幅 text-image__content>h2.text-image__heading+p) →
 *   CTA("Join Over 30,000" 深色块) → footer。
 *
 * 企业站只保留：#intro(hero) + 4 组 #highlight 图文横幅(承载 features)。
 * 删 SaaS demo：#features 卡区 / testimonial / CTA / hero 的 avatar+30K chip / 外链。
 * products/services/contact 由共享引擎 generated（带图产品卡，鑫力/MOON 同款）。
 * 原生资产 = 4 组 image_banner（图+标题+说明），对应 4 条 features 一对一。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('#intro h1, h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || '企业';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';

    // header：品牌替换 + 导航锚点化 + 删 Pricing/Features demo
    const header = document.querySelector('header');
    if (header) {
      const logo = header.querySelector('.header__logo');
      if (logo) {
        const span = logo.querySelector('span');
        if (span && !span.dataset.sitecraftBrand) { span.dataset.sitecraftBrand = 'true'; span.textContent = brandName; }
      }
      const menu = header.querySelector('.header__menu, ul[role="menubar"]');
      const navCopy = draft?.navigation || {};
      const labelOf = (k, fb) => localize(navCopy[k]) || fb;
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [labelOf('about', '关于我们'), labelOf('features', '产品方案'), labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们')];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      if (menu) {
        // 清空重建为 5 项企业锚点导航（避免原生下拉子菜单 Resources>Blog/FAQ/Terms 残留）
        menu.innerHTML = '';
        labels.forEach((label, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'none');
          li.className = 'header__menu-item';
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.className = 'header__menu-link';
          a.textContent = label;
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          li.append(a);
          menu.append(li);
        });
      }
      // 删主题切换 + "Try it now" 等 SaaS 行动按钮
      header.querySelectorAll('#theme-selector, [data-modal], .header__actions button').forEach((n) => n.remove());
    }

    // hero：删 avatar/30K chip；h1 保留（标题由共享注入），副文/CTA 保留给共享引擎
    const intro = document.getElementById('intro');
    if (intro) {
      intro.id = 'top';
      const chip = intro.querySelector('.chip');
      chip?.remove();
      // 大图 alt 含模板名 → 改企业名（保留图片作为产品/场景示意）
      const heroImg = intro.querySelector('img[src*="hero-01"]');
      if (heroImg) heroImg.alt = brandName;
    }

    // 删除 SaaS demo section：#features(Innovative tools) / #testimonial / CTA(Join Over)
    const killIds = ['features', 'testimonial'];
    killIds.forEach((id) => {
      const sec = document.getElementById(id);
      // #features 是 demo 卡区，删；注意 highlight 的父别误删
      if (sec && !sec.id.startsWith('highlight')) { sec.hidden = true; sec.style.setProperty('display', 'none', 'important'); }
    });
    // 删除 Sign up 弹窗与作者推广 toast（模板自带的隐藏注册/升级 UI）
    document.querySelectorAll('.modal, [id="signup"], [data-modal], #foxi-toast, .toast').forEach((n) => n.remove());
    // CTA 区：含 "Join Over" 的 section（深色注册引导），删
    allVisible('h2,h3').forEach((heading) => {
      const t = (heading.textContent || '').trim();
      if (/Join Over|Satisfied Users|Get started now|30,000/i.test(t)) {
        const sec = heading.closest('section');
        if (sec) { sec.hidden = true; sec.style.setProperty('display', 'none', 'important'); }
      }
    });

    // highlight-0..3 打 features 标记，供 nativeFill 精确定位
    const hl = Array.from(document.querySelectorAll('section[id^="highlight-"]'));
    if (hl.length) {
      hl.forEach((sec) => { sec.dataset.sitecraftNativeFeaturesItem = 'true'; });
      const owner = hl[0].closest('main') || hl[0].parentElement;
      hl[0].dataset.sitecraftNativeFeatures = 'true';
    }

    // footer：清空 demo 列/品牌/链接，重建企业联系
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;justify-content:center;align-items:center;padding:1.6rem 1rem;color:inherit;font-size:.9rem';
      const parts = ['<strong>' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:inherit;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:inherit;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.7">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 通用清理
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('a[href^="http"], a[href^="/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^http/i.test(href) || (href.startsWith('/') && href !== '/' && !href.startsWith('#') && !href.startsWith('/api/'))) {
        const txt = (a.textContent || '').trim();
        if (/twitter|facebook|github|pricing|features|blog|sign|log/i.test(txt)) a.remove();
      }
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 features.items 逐条写进 4 组 #highlight 图文横幅（h2 标题 + p 说明）。
// 原生 strong 内嵌标题改写为整句；4 组正好承载 4 条。超 4 条由共享引擎 generated 兜底。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const hls = Array.from(document.querySelectorAll('section[id^="highlight-"]'));
    if (!hls.length) return;
    const section = hls[0].parentElement;
    if (section) { section.dataset.sitecraftScope = 'features'; section.dataset.sitecraftSection = 'features'; }
    // 标题/简介若原生无承载区则不动（4 组横幅本身无板块大标题，简介可放第 1 组前？无，保持简洁）
    hls.slice(items.length).forEach((sec) => {
      sec.hidden = true;
      sec.style.setProperty('display', 'none', 'important');
    });
    hls.slice(0, items.length).forEach((sec, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const contentBox = sec.querySelector('.text-image__content');
      const h2 = contentBox ? contentBox.querySelector('h2') : sec.querySelector('h2');
      const body = contentBox ? contentBox.querySelector('p') : sec.querySelector('p');
      // 改写标题：清 demo 的 <strong> 高亮，setText 会整体替换文本节点
      if (h2 && item?.title) setText(h2, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item?.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      sec.dataset.sitecraftItemId = itemKey;
      sec.dataset.sitecraftSection = 'features';
    });
  };
`;

export const foxiAdapter: TemplateAdapter = {
  templateId: "foxi",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '#highlight-0,#highlight-1,#highlight-2,#highlight-3{background:#fff}' +
    '[data-sitecraft-generated-content="services"]{background:#f8fafc}' +
    '[data-sitecraft-generated-content="contact"]{background:#0f172a;color:#e2e8f0}' +
    '[data-sitecraft-generated-content="contact"] h2{color:#f8fafc!important}' +
    '[data-sitecraft-generated-content="contact"] a{color:#7dd3fc!important}',
};
