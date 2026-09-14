import type { TemplateAdapter } from "./types.ts";

/**
 * shadcn-landing 专属适配（leoMirandaa/shadcn-landing-page，Vite + React SPA）。
 *
 * **与其他模板的本质差异**：`dist/index.html` 只有 2KB，内容是一个空挂载点
 * `<div id="root">` + 407KB 的 React bundle。真实 DOM 由客户端渲染，所以：
 *  - 适配器必须等 React 挂载后才能工作（bridge 在 load 后注入，天然满足）；
 *  - `document.querySelectorAll` 的静态分析在 HTML 源码上无效，选择器必须按**渲染后**结构写。
 *
 * 渲染后结构（scripts/dump-dom.mjs 实测）：
 *   header.sticky(导航) → section.container.grid(hero: main 内 h1/h2 带渐变 span + p + 两个按钮
 *   + 右侧 4 张 demo 卡) → section#sponsors(demo) → section#about(图 + 标题正文 + #statistics)
 *   → section#howItWorks(4 张能力卡) → section#features(特性标签 + 3 卡) → section(无 id，h2=Services，
 *   3 张卡 + 右图) → section#cta(标题 + 说明 + 两个按钮) → section#testimonials(demo)
 *   → section#team(demo) → section#pricing(定价卡) → section#newsletter(订阅表单)
 *   → section#faq(手风琴) → footer#footer(链接列 + 版权)
 *
 * 适配前实测（probe-template-coverage.mjs）：about/features/services 三节走通用卡片墙，
 * 且 `residualDemo: about.body`（英文 demo 残留）。
 *
 * 编排：
 *   hero     ← 首屏 section 的 main + p + 首个按钮
 *   about    ← section#about（标题 + 正文 + 保留统计块）
 *   features ← section#howItWorks（4 张能力卡：h3←item.title，p←item.body）
 *   services ← 无 id 的 Services 区（3 张卡）
 *   products ← section#pricing（标题/说明落在原生 h2/h3；产品条目由通用生成区承载）
 *   contact  ← section#cta（标题/说明/电话按钮）+ footer（邮箱/地址）
 *
 * 隐藏：demo 区 #sponsors / #testimonials / #team / #faq（模板演示内容，企业站无对应语义）。
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    // React 渲染后首屏标题在 <main>（内含 h1/h2 + 渐变 span）
    return allVisible('main h1, main')[0] || allVisible('h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '企业';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const nav = draft?.navigation || {};
    const navLabel = (k, fb) => localize(nav[k]) || fb;

    // ---- 隐藏 demo 区（模板演示内容，企业站无对应语义）----
    // #sponsors/#testimonials/#team/#faq 是模板演示；#howItWorks 是 SaaS「四步上手」；
    // #pricing 是套餐定价（产品改由通用生成区承载）；#newsletter 是订阅表单（React 组件，企业站无用）。
    ['#sponsors', '#testimonials', '#team', '#faq', '#howItWorks', '#pricing', '#newsletter'].forEach((sel) => {
      const sec = document.querySelector(sel);
      if (sec) { sec.hidden = true; sec.style.setProperty('display', 'none', 'important'); }
    });
    // #about 内的统计数字（2.7K+ Users 等 demo 数据）
    const statistics = document.querySelector('#statistics');
    if (statistics) { statistics.hidden = true; statistics.style.setProperty('display', 'none', 'important'); }

    // ---- 导航：品牌 + 5 个企业锚点 ----
    const header = document.querySelector('header');
    if (header) {
      const brandLink = header.querySelector('a[href], a');
      if (brandLink) {
        brandLink.textContent = company;
        brandLink.dataset.sitecraftSlot = 'companyName.zh';
      }
      const navLinks = Array.from(header.querySelectorAll('nav a, ul a')).filter((a) => a !== brandLink);
      const keys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = keys.map((k, i) => navLabel(k, ['关于我们', '核心优势', '产品中心', '服务支持', '联系我们'][i]));
      navLinks.forEach((a, i) => {
        if (i < labels.length) {
          a.textContent = labels[i];
          a.setAttribute('href', '#' + keys[i]);
          a.dataset.sitecraftSlot = 'navigation.' + keys[i] + '.zh';
        } else {
          (a.closest('li') || a).remove();
        }
      });
      // 导航右侧的 demo 按钮（Get Started / Github）
      header.querySelectorAll('button, a[href*="github"]').forEach((el) => {
        if (el !== brandLink && !el.closest('li')) el.remove();
      });
    }

    // ---- 打节标记，供 nativeFill 与通用引擎定位 ----
    const sections = Array.from(document.querySelectorAll('body > div#root > section, #root > section, section'));
    const byId = (id) => document.querySelector('#' + id);
    // services 区没有 id，靠 h2 文案识别（实测为 "Client-Centric Services"，故用包含匹配而非前缀）
    const servicesSection = sections.find((sec) => !sec.id && /services/i.test((sec.querySelector('h2')?.textContent || '').trim()));
    const mark = (sec, key) => {
      if (!sec) return;
      sec.id = key;
      sec.dataset.sitecraftSection = key;
      sec.dataset.sitecraftScope = key;
    };
    mark(sections[0], 'hero');
    mark(byId('about'), 'about');
    // features = #features（"Many Great Features" 卡网格）；#howItWorks 是 SaaS 四步引导，已隐藏
    mark(byId('features'), 'features');
    mark(servicesSection, 'services');
    mark(byId('cta'), 'contact');

    // hero 右侧的 demo 卡组（4 张 SaaS 看板卡）无企业语义，隐藏
    const heroSec = sections[0];
    if (heroSec) {
      const demoCards = Array.from(heroSec.querySelectorAll('.rounded-lg.border'));
      demoCards.forEach((card) => { card.style.setProperty('display', 'none', 'important'); });
    }

    // ---- footer：清 demo 链接列与版权行，补企业联系 ----
    // 注意：不能用 el.closest('div') 上溯删除——React SPA 的整个应用挂在 div#root 上，
    // 上溯会一路删到根节点，导致整站消失（2026-09-09 实测踩过）。只删最近的「footer 内且非 #root」容器。
    const footer = document.querySelector('footer');
    if (footer) {
      const removeClosestWithinFooter = (node) => {
        let target = node;
        while (target && target.parentElement && target.parentElement !== footer && target.parentElement.id !== 'root') target = target.parentElement;
        (target && target !== document.body && target.id !== 'root' ? target : node).remove();
      };
      footer.querySelectorAll('a[href*="github"], a[href*="twitter"], a[href*="dribbble"], a[href*="youtube"], a[href*="discord"], a[href*="twitch"]').forEach(removeClosestWithinFooter);
      footer.querySelectorAll('h3').forEach((h) => {
        const t = (h.textContent || '').trim();
        // 版权行 "© 2024 Landing page made by Leo Miranda" 也是 h3
        if (/^(Follow US|Platforms|About|Community)$/i.test(t) || /©|made by|landing page/i.test(t)) removeClosestWithinFooter(h);
      });
      // demo 品牌锚点 "ShadcnUI/React"（正则里的 / 必须写成 \\/ 否则序列化后 flags 非法）
      footer.querySelectorAll('a').forEach((a) => {
        if (/shadcnui\\/react/i.test((a.textContent || '').trim())) a.remove();
      });
      const holder = footer.querySelector('section.container') || footer;
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;justify-content:center;padding:1rem;color:#6b7280;font-size:.875rem';
      band.innerHTML = '<span style="font-weight:600;color:#374151">' + company + '</span>';
      holder.append(band);
    }

    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((n) => n.remove());
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const contact = content.contact || {};

    /**
     * 卡片网格填充（features/services 共用）。
     * 卡片正文是 div.p-6.pt-0（不是 <p>），且卡内还有 img 插图与 "About xxx" demo 链接——
     * 三者都必须处理，否则截图里会看到英文 demo 残留（2026-09-09 实测）。
     */
    const fillCardGrid = (section, items, sectionKey) => {
      const list = items || [];
      const cards = Array.from(section.querySelectorAll('.rounded-lg.border')).filter((card) => card.querySelector('h3'));
      cards.forEach((card, index) => {
        const item = list[index];
        if (!item) {
          card.style.setProperty('display', 'none', 'important');
          card.setAttribute('aria-hidden', 'true');
          return;
        }
        const itemKey = (item && item.id) ? item.id : String(index);
        const cardTitle = card.querySelector('h3');
        if (cardTitle) setText(cardTitle, localize(item.title, locale), sectionKey + '.items.' + itemKey + '.title.' + locale, applied);
        // 正文：卡内除标题外的第一个块级文本容器（实测为 div.p-6.pt-0）
        const bodyNode = Array.from(card.querySelectorAll('div.p-6, p')).find((n) => n !== cardTitle && !n.querySelector('h3'));
        if (bodyNode) setText(bodyNode, localize(item.body, locale), sectionKey + '.items.' + itemKey + '.body.' + locale, applied);
        // 卡内 demo 插图与 "About feature/services" 链接：企业站无对应内容，隐藏
        card.querySelectorAll('img').forEach((img) => { img.hidden = true; img.style.setProperty('display', 'none', 'important'); });
        card.querySelectorAll('a').forEach((a) => {
          if (/^about\\s/i.test((a.textContent || '').trim())) { a.hidden = true; a.style.setProperty('display', 'none', 'important'); }
        });
      });
    };

    // ---- hero 副文与 CTA：共享引擎的 findSubtitle/ctaCandidates 在此模板命中不稳，
    //      首屏 <p> 与首个按钮直接落位（否则截图里残留英文 demo 副文与 Get Started）----
    const heroSec0 = document.querySelector('[data-sitecraft-section="hero"]');
    if (heroSec0) {
      const heroP = heroSec0.querySelector('p');
      if (heroP) setText(heroP, localize(content.hero?.subtitle, locale), 'hero.subtitle.' + locale, applied);
      const heroButtons = Array.from(heroSec0.querySelectorAll('button, a')).filter((el) => !el.querySelector('img, svg') || el.textContent.trim());
      const cta = heroButtons[0];
      if (cta) {
        setText(cta, localize(content.hero?.cta, locale), 'hero.cta.' + locale, applied);
        heroButtons.slice(1).forEach((b) => { b.hidden = true; b.style.setProperty('display', 'none', 'important'); });
      }
    }

    // ---- about：section#about（图 + 标题正文 + 统计块）----
    const aboutSec = document.querySelector('[data-sitecraft-section="about"]');
    if (aboutSec) {
      const titleEl = aboutSec.querySelector('h2, h3');
      const bodyEl = aboutSec.querySelector('p');
      if (titleEl) setText(titleEl, localize(content.about?.title, locale), 'about.title.' + locale, applied);
      if (bodyEl) setText(bodyEl, localize(content.about?.body, locale), 'about.body.' + locale, applied);
    }

    // ---- features：section#features（"Many Great Features" 卡网格，卡片带 img 插图）----
    const featureSec = document.querySelector('[data-sitecraft-section="features"]');
    if (featureSec) {
      const heading = featureSec.querySelector('h2');
      const intro = featureSec.querySelector('p');
      if (heading) setText(heading, localize(content.features?.title, locale), 'features.title.' + locale, applied);
      if (intro) setText(intro, localize(content.features?.intro, locale), 'features.intro.' + locale, applied);
      // 特性标签 pill 行（Dark/Light theme、Reviews…）是模板演示，整行隐藏
      const pillRow = Array.from(featureSec.querySelectorAll('div')).find((d) => d.querySelector('.rounded-full') && d.children.length >= 3);
      if (pillRow) { pillRow.hidden = true; pillRow.style.setProperty('display', 'none', 'important'); }
      fillCardGrid(featureSec, content.features?.items, 'features');
    }

    // ---- services：无 id 的 Services 区（3 张卡 + 右图）----
    const serviceSec = document.querySelector('[data-sitecraft-section="services"]');
    if (serviceSec) {
      const heading = serviceSec.querySelector('h2');
      const intro = serviceSec.querySelector('p');
      if (heading) setText(heading, localize(content.services?.title, locale), 'services.title.' + locale, applied);
      if (intro) setText(intro, localize(content.services?.intro, locale), 'services.intro.' + locale, applied);
      fillCardGrid(serviceSec, content.services?.items, 'services');
    }

    // ---- products：定价区已隐藏，产品标题/条目由通用生成区承载（此处不再映射，避免写入隐藏节点）----

    // ---- contact：section#cta（标题/说明/电话）+ footer（邮箱/地址）----
    const contactSec = document.querySelector('[data-sitecraft-section="contact"]');
    if (contactSec) {
      const h2 = contactSec.querySelector('h2');
      const p = contactSec.querySelector('p');
      const button = contactSec.querySelector('button, a');
      if (h2) setText(h2, localize(contact.title, locale), 'contact.title.' + locale, applied);
      if (p) setText(p, localize(contact.body, locale), 'contact.body.' + locale, applied);
      if (button && contact.phone) {
        button.textContent = contact.phone;
        button.setAttribute('data-sitecraft-slot', 'contact.phone.' + locale);
        applied.add('contact.phone.' + locale);
      }
      // 多余的第二个按钮（View all features）隐藏
      const buttons = Array.from(contactSec.querySelectorAll('button, a'));
      buttons.slice(1).forEach((b) => b.style.setProperty('display', 'none', 'important'));
    }
    // footer 联系带：邮箱与地址（contact 节被接管后通用引擎不再生成联系区）
    const footerBand = document.querySelector('[data-sitecraft-footer-content]');
    if (footerBand) {
      const ensureNode = (slot, tag) => {
        let node = footerBand.querySelector('[data-sitecraft-slot^="' + slot + '."]');
        if (!node) {
          node = document.createElement(tag || 'span');
          node.style.cssText = tag === 'a' ? 'color:#6b7280' : 'opacity:.85';
          footerBand.append(node);
        }
        return node;
      };
      const email = String(contact.email || '').trim();
      if (email) {
        const a = ensureNode('contact.email', 'a');
        a.setAttribute('href', 'mailto:' + email);
        setText(a, email, 'contact.email.' + locale, applied);
      }
      const address = localize(contact.address);
      if (address) setText(ensureNode('contact.address', 'span'), address, 'contact.address.' + locale, applied);
    }
  };
`;

export const shadcnLandingAdapter: TemplateAdapter = {
  templateId: "shadcn-landing",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    // 产品生成区贴合模板卡片风格（白卡 + 细边框 + 圆角，与 #pricing 一致）
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
    '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '[data-sitecraft-generated-products] article{background:#fff!important;border:1px solid #e5e7eb!important;border-radius:8px;padding:20px}' +
    '[data-sitecraft-generated-products] article h3{color:#111827!important}' +
    '[data-sitecraft-generated-products] article p{color:#6b7280!important;opacity:1!important}' +
    '[data-sitecraft-generated-products] article small{color:#9ca3af!important;opacity:1!important}',
};
