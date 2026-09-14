import type { TemplateAdapter } from "./types.ts";

/**
 * FRESH / SaaS Landing 专属适配 —— 企业官网形态。
 *
 * 原模板（Bulma CSS 浅色 SaaS 单页，已核对 vendor/open-source-templates/fresh/dist/index.html）：
 *   section.hero.is-grey.is-fullheight（内含双 navbar + hero-body 左右图文 + hero-foot 客户 logo 条）→
 *   section.is-medium「Great Power Comes」3 张 bordered mini icon 卡（h4+p+icon+CTA 按钮）→
 *   section.section-feature-grey「Awesome Features」2 组交替图文分栏（columns.is-vcentered.side-feature：
 *     文字 column(is-4 h3.title+p.subtitle) + 图 column(is-5 img feature-N.png)，左右交替）→
 *   另一 section.section-feature-grey「An intuitive app」1 组 app-side 分栏（第 3 组图+文）→
 *   「Wait, there's more」集成 logo 墙 /「Our clients love us」评价 /「Get Started」定价 /「Drop us a line」表单 →
 *   footer.footer-dark + 侧边 drawer(.sidebar) + auth-modal。
 *
 * 企业站编排：
 *   hero      ← 标题/副文/主 CTA（h1.subtitle 是 h2 非 p，findSubtitle 找不到 → prepare 里手动写副文槽）。
 *   features  ← Awesome Features 的 3 组交替图文分栏（把第 3 组 app-side 迁入同一 section），承载前 3 条 items。
 *   services  ← Great Power Comes 的 3 张 mini icon 卡承载 services.items（2 条填 2 张、隐藏第 3 张；删卡内 demo CTA）。
 *   products/about/contact ← 由共享引擎 generated（产品带图 6 卡 / about / contact），设计见 designTokenCss。
 *   footer    ← 清 demo 列重建企业联系。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('section.hero h1, h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const activeL = (typeof activeLocale !== 'undefined') ? (activeLocale || 'zh') : 'zh';
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const pick = (v) => (v && typeof v === 'object' ? (v[activeL] || v.zh || v.en) : v) || '';
    const brandName = company || '新能源科技';
    const heroDraft = draft?.content?.hero || {};
    const navCopy = draft?.navigation || {};
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = pick(contact.address) || '';

    // 1) 清整页级 demo UI：GTM、侧边 drawer、登录弹窗、返回顶部、菜单 morph 图标触发器
    document.querySelectorAll('script').forEach((s) => {
      if ((s.textContent || '').indexOf('googletagmanager') >= 0) s.remove();
    });
    document.querySelectorAll('iframe[src*="googletagmanager"], script[src*="googletagmanager"], .sidebar, #auth-modal, .modal, #backtotop').forEach((n) => n.remove());
    document.querySelectorAll('#menu-icon-wrapper, #cloned-menu-icon-wrapper').forEach((ic) => {
      const holder = ic.closest('a') || ic.closest('.navbar-item');
      holder?.remove();
    });

    // 2) demo 大区整节移除（heading 文本定位）：集成墙 / 评价 / 定价 / 联系表单
    const killHeadings = ['wait', 'clients love us', 'get started', 'drop us a line'];
    allVisible('h2, h3').forEach((h) => {
      const t = (h.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      if (killHeadings.some((k) => t.indexOf(k) >= 0)) h.closest('section')?.remove();
    });

    // 3) hero：id / 副文(h2 非 p) / CTA（主 CTA 本地化，副 CTA Discover 删，客户 logo 条删）
    const hero = allVisible('section.hero')[0] || document.querySelector('section.hero');
    if (hero) {
      hero.id = 'top';
      hero.querySelector('.hero-foot')?.remove();
      const caption = hero.querySelector('.landing-caption');
      const subtitle = caption?.querySelector('.subtitle') || hero.querySelector('h2.subtitle');
      if (subtitle) {
        const text = pick(heroDraft.subtitle) || '';
        if (text) {
          subtitle.dataset.sitecraftSlot = 'hero.subtitle.' + activeL;
          if (subtitle.textContent !== text) subtitle.textContent = text;
        }
      }
      const ctaLinks = caption ? Array.from(caption.querySelectorAll('.button, a.button')) : [];
      const primary = ctaLinks.find((a) => /primary-btn/.test(String(a.className || ''))) || ctaLinks[0];
      ctaLinks.forEach((a) => { if (a !== primary) a.remove(); });
      if (primary) {
        primary.setAttribute('href', '#products');
        const text = pick(heroDraft.cta) || '获取方案';
        primary.dataset.sitecraftSlot = 'hero.cta.' + activeL;
        if (primary.textContent !== text) primary.textContent = text;
      }
    }

    // 4) 双 navbar：品牌名（两处）+ 重建 5 个企业锚点导航
    document.querySelectorAll('nav.navbar').forEach((nav) => {
      const brand = nav.querySelector('.navbar-brand > a[href], .navbar-brand a.navbar-item[href]');
      if (brand) {
        brand.textContent = brandName;
        brand.setAttribute('href', '#top');
        brand.dataset.sitecraftBrand = 'true';
        brand.style.cssText = 'font-weight:800;letter-spacing:.04em;font-size:1.02rem;color:#363636';
      }
      const end = nav.querySelector('.navbar-end');
      if (!end) return;
      end.innerHTML = '';
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [
        pick(navCopy.about) || '关于我们', pick(navCopy.features) || '产品方案',
        pick(navCopy.products) || '产品中心', pick(navCopy.services) || '服务支持', pick(navCopy.contact) || '联系我们',
      ];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      labels.forEach((label, i) => {
        const a = document.createElement('a');
        a.className = 'navbar-item is-secondary';
        a.textContent = label;
        a.setAttribute('href', targets[i]);
        a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.' + activeL;
        end.append(a);
      });
    });

    // 5) features：Awesome Features section = 唯一 owner；把另一 section 的第 3 组 app-side 迁进来，删空壳 section
    const featureOwner = document.querySelector('.columns.is-vcentered.side-feature')?.closest('section') || null;
    if (featureOwner) {
      featureOwner.id = 'features';
      featureOwner.dataset.sitecraftScope = 'features';
      featureOwner.dataset.sitecraftSection = 'features';
      featureOwner.dataset.sitecraftNativeFeatures = 'true';
      const ownerContainer = featureOwner.querySelector('.container');
      const appSide = document.querySelector('.columns.is-vcentered.app-side');
      if (appSide) {
        const appOwner = appSide.closest('section');
        if (ownerContainer) ownerContainer.append(appSide);
        appOwner?.remove();
      }
    }

    // 6) services：Great Power 3 张 mini icon 卡（标题改写由 nativeFill 按槽做；这里删卡内 demo CTA 按钮）
    const serviceOwner = Array.from(document.querySelectorAll('section')).find((sec) => {
      const tw = sec.querySelector('.title-wrapper');
      return Boolean(tw && /Great Power/i.test((tw.textContent || '') + ' ' + (sec.textContent || '').slice(0, 80)));
    }) || null;
    if (serviceOwner) {
      serviceOwner.id = 'services';
      serviceOwner.dataset.sitecraftScope = 'services';
      serviceOwner.dataset.sitecraftSection = 'services';
      serviceOwner.dataset.sitecraftNativeServices = 'true';
      serviceOwner.querySelectorAll('.feature-card .card-action, .card-action').forEach((n) => n.remove());
    }

    // 7) footer：清 demo 列/品牌/social，重建企业联系
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      footer.style.cssText = 'padding:2.2rem 1rem';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;align-items:center;text-align:center;color:#eef1f6';
      const parts = ['<strong style="letter-spacing:.06em">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:inherit;opacity:.85;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:inherit;opacity:.85;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.7">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 8) 通用清理
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        if (/^https?:/i.test(href) || /^\\//.test(href)) anchor.removeAttribute('href');
      }
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 draft 槽内容填进 fresh 原生排版，打 slot 短路通用卡墙。
//   features ← Awesome Features 的 3 组交替图文分栏（.columns.is-vcentered：h3.title+p.subtitle+图）。
//   services ← Great Power 的 mini icon 卡（.feature-card：h4+p+icon）。
// nativeFill 由共享引擎在 scope/title 改写后调用（prepare 已定位 id=features/#services）。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const pick = (v) => (v && typeof v === 'object' ? (v[locale] || v.zh || v.en) : v) || '';
    const featureItems = (content.features && Array.isArray(content.features.items)) ? content.features.items : [];
    const serviceItems = (content.services && Array.isArray(content.services.items)) ? content.services.items : [];
    const hideNode = (node) => { node.hidden = true; node.style.setProperty('display', 'none', 'important'); node.setAttribute('aria-hidden', 'true'); };

    // === features 原生 3 组交替图文分栏 ===
    const featureOwner = document.querySelector('.columns.is-vcentered.side-feature')?.closest('section') || document.getElementById('features');
    if (featureOwner && featureItems.length) {
      featureOwner.dataset.sitecraftNativeFeatures = 'true';
      featureOwner.dataset.sitecraftSection = 'features';
      const tw = featureOwner.querySelector('.title-wrapper');
      const heading = tw?.querySelector('h2');
      const sub = tw?.querySelector('h3.subtitle, h3, .subtitle');
      if (content.features?.title && heading) setText(heading, pick(content.features.title), 'features.title.' + locale, applied);
      if (content.features?.intro && sub) setText(sub, pick(content.features.intro), 'features.intro.' + locale, applied);
      else if (sub) sub.style.setProperty('display', 'none', 'important');
      const groups = Array.from(featureOwner.querySelectorAll('.columns.is-vcentered')).filter((g) => g.querySelector('h3') && g.querySelector('p'));
      const useN = Math.min(groups.length, featureItems.length);
      groups.slice(useN).forEach(hideNode);
      groups.slice(0, useN).forEach((g, index) => {
        const item = featureItems[index];
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        const h3 = g.querySelector('h3');
        const body = g.querySelector('p.subtitle, p');
        if (h3 && item?.title) setText(h3, pick(item.title), 'features.items.' + itemKey + '.title.' + locale, applied);
        if (body && item?.body) setText(body, pick(item.body), 'features.items.' + itemKey + '.body.' + locale, applied);
        g.dataset.sitecraftItemId = itemKey;
        g.dataset.sitecraftSection = 'features';
      });
      applied.add('features.title.' + locale);
      applied.add('features.intro.' + locale);
      featureItems.slice(0, useN).forEach((item, index) => {
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        applied.add('features.items.' + itemKey + '.title.' + locale);
        applied.add('features.items.' + itemKey + '.body.' + locale);
      });
    }

    // === services 原生 3 张 mini icon 卡（Great Power） ===
    const serviceOwner = document.getElementById('services') || document.querySelector('[data-sitecraft-native-services]');
    if (serviceOwner && serviceItems.length) {
      serviceOwner.dataset.sitecraftNativeServices = 'true';
      serviceOwner.dataset.sitecraftSection = 'services';
      const tw = serviceOwner.querySelector('.title-wrapper');
      const heading = tw?.querySelector('h2');
      const sub = tw?.querySelector('h3.subtitle, h3, .subtitle');
      if (content.services?.title && heading) setText(heading, pick(content.services.title), 'services.title.' + locale, applied);
      if (content.services?.intro && sub) setText(sub, pick(content.services.intro), 'services.intro.' + locale, applied);
      else if (sub) sub.style.setProperty('display', 'none', 'important');
      const cards = Array.from(serviceOwner.querySelectorAll('.feature-card'));
      const useN = Math.min(cards.length, serviceItems.length);
      cards.slice(useN).forEach(hideNode);
      cards.slice(0, useN).forEach((card, index) => {
        const item = serviceItems[index];
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        const titleNode = card.querySelector('.card-title h4, h4');
        const body = card.querySelector('.card-text p, p');
        if (titleNode && item?.title) setText(titleNode, pick(item.title), 'services.items.' + itemKey + '.title.' + locale, applied);
        if (body && item?.body) setText(body, pick(item.body), 'services.items.' + itemKey + '.body.' + locale, applied);
        card.dataset.sitecraftItemId = itemKey;
        card.dataset.sitecraftSection = 'services';
      });
      applied.add('services.title.' + locale);
      applied.add('services.intro.' + locale);
      serviceItems.slice(0, useN).forEach((item, index) => {
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        applied.add('services.items.' + itemKey + '.title.' + locale);
        applied.add('services.items.' + itemKey + '.body.' + locale);
      });
    }
  };
`;

const designTokenCss =
  '#top,#features,#services{scroll-margin-top:80px}' +
  '[data-sitecraft-generated-content="about"],[data-sitecraft-generated-content="contact"]{background:#fff}' +
  '[data-sitecraft-generated-products]{background:#f5f7fa}' +
  '[data-sitecraft-generated-content] h2,[data-sitecraft-generated-products] h2{color:var(--sitecraft-primary)!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px}' +
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:18px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
  '[data-sitecraft-generated-products] img{border-radius:6px}' +
  '.hero .landing-caption .subtitle{max-width:30rem}' +
  '@media (max-width:768px){.columns.is-vcentered.side-feature img,.columns.is-vcentered.app-side img{margin:0 auto 18px;display:block;max-width:320px}}';

export const freshAdapter: TemplateAdapter = {
  templateId: "fresh",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss,
};
