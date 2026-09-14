import type { TemplateAdapter } from "./types.ts";

/**
 * atlas（ASTROPLATE / astroplate）适配 —— 企业官网原生图文分栏编排。
 *
 * 原模板（已核对 vendor/open-source-templates/astroplate/dist/index.html）结构：
 *   header(logo + Home/About/Elements/Pages 下拉 + Github) →
 *   main>section：hero(h1 居中大标题 + 说明 + Fork 外链 CTA + banner 图)
 *   → 3 组 section-sm 原生图文分栏（图列 + md:col-7 的 h2+p+ul>li>(svg+span) 勾选列）：
 *      2) What's Included in Astroplate (6 点)   3) Discover the Key Features Of Astro (3 点, 镜像)
 *      4) The Top Reasons to Choose Astro (4 点)
 *   → 评价 Swiper(5) → CTA(6) → footer(logo + Elements/Privacy + 社交外链)。
 *
 * 企业站编排：只保留 hero + 前两组原生图文分栏。分栏是非卡片排版（图+h2+简介+勾选列），
 * 正适合承载企业 features/services 而不退回通用卡墙：
 *   分栏 0(features)：h2←features.title，p←features.intro，ul 勾选 span←features.items.title（≤6）
 *   分栏 1(services)：h2←services.title，p←services.intro，ul 勾选 span←services.items.title（≤3）
 *   item.body 在勾选列无处安放故省略（同 landwind 取舍）；多余 demo li 隐藏，demo 外链删。
 *   多余分栏 2(Top Reasons…) 与评价/CTA section 隐藏。products/about/contact 无原生区，
 *   由共享引擎 generated（产品带图 6 卡、关于、联系区），本适配不手动建。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('main h1, header h1, h1')[0] || null;
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

    // ---- header：品牌 → 企业名 + 5 个锚点导航 + 删 SaaS/demo 控件 ----
    const header = document.querySelector('header');
    if (header) {
      const brandLink = header.querySelector('.navbar-brand');
      if (brandLink) {
        brandLink.querySelectorAll('img').forEach((img) => img.remove());
        brandLink.innerHTML = '<span data-sitecraft-brand style="font-weight:800;font-size:1.15rem;line-height:1;color:inherit">' + brandName + '</span>';
        brandLink.setAttribute('href', '#');
      }
      const navMenu = header.querySelector('#nav-menu, .navbar-nav');
      const navCopy = draft?.navigation || {};
      const labelOf = (k, fb) => localize(navCopy[k]) || fb;
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [
        labelOf('about', '关于我们'), labelOf('features', '产品方案'),
        labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们'),
      ];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      if (navMenu) {
        navMenu.innerHTML = '';
        labels.forEach((label, i) => {
          const li = document.createElement('li');
          li.className = 'nav-item';
          const a = document.createElement('a');
          a.className = 'nav-link block';
          a.setAttribute('href', targets[i]);
          a.textContent = label;
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          li.append(a);
          navMenu.append(li);
        });
      }
      // 删 search / theme 切换 / GitHub 外链（SaaS demo 控件；mobile GitHub 项已被 navMenu 清空）
      header.querySelectorAll('[data-search-trigger], .theme-switcher, a[href*="github.com"]').forEach((n) => n.remove());
    }

    // 顶层 client-only 组件岛（Announcement / SearchModal）可能异步注入 demo UI，直接移除
    document.querySelectorAll('astro-island').forEach((n) => n.remove());

    // ---- 结构识别：hero 与原生图文分栏（含 h2 + img + ul>li>span 的 section）----
    const main = document.querySelector('main') || document.body;
    const allSections = Array.from(main.querySelectorAll(':scope > section'));
    const hero = allSections.find((s) => s.querySelector('h1')) || allSections[0];
    const splits = allSections.filter((s) => s.querySelector('h2') && s.querySelector('img') && s.querySelector('ul > li > span'));
    splits.forEach((s, index) => { s.dataset.sitecraftNativeSplit = String(index); });

    // hero：首屏 id=top；Fork/Deploy 主 CTA 由共享 hero.cta 注入文本，重指内部报价锚点防出站
    if (hero) {
      hero.id = 'top';
      const heroCta = hero.querySelector('a[class*="btn"]');
      if (heroCta) heroCta.setAttribute('href', '#contact');
    }

    // 前两组分栏分别打 features/services 业务 scope（共享引擎会把 title/intro 写进 h2/p，
    // 通用槽位扫描也能识别该区；同时防止它被 about/products 等兜底误认）。
    const featureSplit = splits[0];
    const serviceSplit = splits[1];
    if (featureSplit) {
      featureSplit.dataset.sitecraftScope = 'features';
      featureSplit.dataset.sitecraftSection = 'features';
      featureSplit.dataset.sitecraftNativeFeatures = 'true';
      featureSplit.id = 'features';
    }
    if (serviceSplit) {
      serviceSplit.dataset.sitecraftScope = 'services';
      serviceSplit.dataset.sitecraftSection = 'services';
      serviceSplit.dataset.sitecraftNativeSplitServices = 'true';
      serviceSplit.id = 'services';
    }

    // 多余原生分栏（The Top Reasons… demo）整节隐藏；评价区 / CTA 整节隐藏
    splits.slice(2).forEach((s) => {
      s.hidden = true;
      s.style.setProperty('display', 'none', 'important');
    });
    const killHeadings = [/What Users Are Saying About Astroplate|Don'?t just take our word|Ready to build your next project with Astro/i];
    allVisible('h1,h2,h3').forEach((heading) => {
      const t = (heading.textContent || '').trim();
      if (killHeadings.some((re) => re.test(t))) {
        const sec = heading.closest('section');
        if (sec && sec !== hero && !sec.hasAttribute('data-sitecraft-native-split')) {
          sec.hidden = true;
          sec.style.setProperty('display', 'none', 'important');
        }
      }
    });
    // 原生分栏内 demo 外链（Get Started Now 等点去 github）删除
    splits.forEach((s) => {
      s.querySelectorAll('a[href*="github.com"], a[href^="http"]').forEach((a) => a.remove());
    });

    // ---- footer：清 demo 列/品牌/社交外链，重建企业联系 ----
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;justify-content:center;align-items:center;padding:1.8rem 1rem;color:inherit;font-size:.9rem';
      const parts = ['<strong style="font-weight:700">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:inherit;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/[^0-9+]/g, '') + '" style="color:inherit;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.72">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // ---- 通用清理：剔除所有出站/根相对锚点（含隐藏 demo 区的 Fork 等外链），meta 收敛 ----
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = a.getAttribute('href') || '';
      if (/^https?:/i.test(h) || (h.startsWith('/') && h !== '#')) a.remove();
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 draft 内容逐条填进原生图文分栏（非卡墙，防 demo 残留与卡墙叠加）。
// 分栏 0 = features、分栏 1 = services：h2/p 由共享引擎 scopeBy 预写，这里主要改写勾选
// li 内 span（保留模板 svg 勾图标），多余 demo li display:none；无数据则整栏隐藏。
// 写上的 data-sitecraft-slot 会自动短路共享 hasVisibleSlotPrefix → 不再生成 features/services 卡墙。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const fillSplit = (sec, sectionKey) => {
      if (!sec) return;
      const block = content[sectionKey] || {};
      const items = Array.isArray(block.items) ? block.items : [];
      const titleText = localize(block.title, locale);
      const introText = localize(block.intro, locale);
      if (!titleText && !introText && !items.length) {
        sec.hidden = true;
        sec.style.setProperty('display', 'none', 'important');
        return;
      }
      const h2 = sec.querySelector('h2');
      const introP = sec.querySelector('p');
      if (h2 && titleText) setText(h2, titleText, sectionKey + '.title.' + locale, applied);
      if (h2 && !titleText) h2.textContent = '';
      if (introP && introText) setText(introP, introText, sectionKey + '.intro.' + locale, applied);
      if (introP && !introText) introP.textContent = '';
      // 勾选列改写规则：模板每列原生 N 条 li（svg 勾 + span），items 可能比原生 li 少
      // （如 services 只有 2 条、原生 3 li）。凡 li 无匹配 item（越界或缺本地化标题）的
      // 多余 demo li → display:none + aria-hidden；有匹配条目的 li 恢复可见（幂等：重复
      // applyContent / locale 切换 / 修订 items 增多时不残留隐藏）。
      const hideLi = (li) => {
        li.hidden = true;
        li.style.setProperty('display', 'none', 'important');
        li.setAttribute('aria-hidden', 'true');
      };
      const showLi = (li) => {
        li.hidden = false;
        li.style.removeProperty('display');
        li.removeAttribute('aria-hidden');
      };
      const lis = Array.from(sec.querySelectorAll('ul > li')).filter((li) => li.querySelector('span'));
      lis.forEach((li, index) => {
        const item = items[index];
        const title = item && localize(item.title, locale);
        if (!title) {
          hideLi(li);
          return;
        }
        showLi(li);
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        const span = li.querySelector('span');
        if (span) setText(span, title, sectionKey + '.items.' + itemKey + '.title.' + locale, applied);
      });
      if (sectionKey === 'features') sec.dataset.sitecraftNativeFeatures = 'true';
      else sec.dataset.sitecraftNativeSplitServices = 'true';
    };
    const main = document.querySelector('main') || document.body;
    const splits = Array.from(main.querySelectorAll('section[data-sitecraft-native-split]')).sort((a, b) => Number(a.dataset.sitecraftNativeSplit) - Number(b.dataset.sitecraftNativeSplit));
    fillSplit(splits[0], 'features');
    fillSplit(splits[1], 'services');
  };
`;

const designTokenCss =
  'h1,h2{color:var(--sitecraft-primary)!important}' +
  'button,a[class*="btn"],a[class*="button"]{background-color:var(--sitecraft-primary)!important;color:#fff!important}' +
  // 产品中心生成区在浅色模板下固定 3 列成 2 行，避免 auto-fit 失衡；白卡带细边框贴近原生分栏密度
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:22px!important}' +
  '@media(max-width:980px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
  '@media(max-width:620px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
  '[data-sitecraft-generated-products] article{background:#fff;border:1px solid rgba(125,125,125,.18);border-radius:14px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.05)}' +
  'footer .sitecraft-footer-content, [data-sitecraft-footer-content]{color:inherit}';

const sanitize: TemplateAdapter["sanitize"] = {
  sections: [
    "Top Reasons to Choose Astro",
    "What Users Are Saying About Astroplate",
    "Ready to build your next project with Astro",
    "What's Included in Astroplate",
    "Discover the Key Features Of Astro",
  ],
  leafPatterns: [
    "Fork Deploy and Edit Online",
    "Get Started Now",
    "Lorem ipsum",
    "Marvin McKinney",
    "Web Designer",
    "Zero JS, by default",
    "UI-agnostic",
    "10[+] Pre-build pages",
    "Google Pagespeed",
    "SEO-optimized for better search engine rankings",
    "Fully responsive on all devices",
    "Zeon Studio",
    "Designed And Developed by",
  ],
};

export const atlasAdapter: TemplateAdapter = {
  templateId: "atlas",
  heroFn,
  prepareFn,
  nativeFillFn,
  designTokenCss,
  sanitize,
};
