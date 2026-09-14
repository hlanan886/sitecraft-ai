import type { TemplateAdapter } from "./types.ts";

/**
 * nextjs-landing 专属适配（NEXT LANDING / Corporate，手写静态 HTML + template.css）。
 *
 * 该模板是本项目 22 个里**语义结构最规整**的一个：每个业务节都有独立 class/id，
 * 且卡片统一为 `article > span(序号) + h3 + p`。因此适配器只做「填槽 + 清 demo 文案」，
 * 不需要 DOM 重建。
 *
 * 结构（vendor/open-source-templates/nextjs-landing/dist/index.html）：
 *   header.site-header（a.brand + nav×4 + a.button-small）
 *   main#top
 *     section.hero（.eyebrow + h1 + p + .hero-actions[a.button + a.text-link] + .hero-panel[装饰面板]）
 *     section.about#about（.section-number + .eyebrow + h2 + p）
 *     section.section#features（.section-heading + .card-grid[3×article span+h3+p]）
 *     section.section.services#services（.section-heading + .service-list[3×article span+h3+p]）
 *     section.section#work（.section-heading + .work-grid[2×article span+h3]）
 *     section.contact#contact（.eyebrow + h2 + p + a.button-light[mailto demo]）
 *   footer（a.brand + span）
 *
 * 适配前实测（probe-template-coverage.mjs）：features/services 两节走通用卡片墙。
 *
 * 编排：
 *   hero     ← h1 / p / 首个按钮；hero-panel 的 demo 文案隐藏（保留装饰外壳）
 *   about    ← #about 的 h2 / p
 *   features ← #features 的 .card-grid（3 条）
 *   services ← #services 的 .service-list（3 条）
 *   products ← #work 的 .work-grid（2 条：h3←产品名，span←分类/简介）
 *   contact  ← #contact 的 h2 / p / 按钮（写电话）
 *   footer   ← 品牌 + 邮箱/地址
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('.hero h1, main h1, h1')[0] || null;
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

    // ---- 导航：品牌 + 5 个企业锚点（模板原生 4 项，补第 5 项）----
    const header = document.querySelector('header.site-header, header');
    if (header) {
      const brand = header.querySelector('a.brand');
      if (brand) {
        brand.textContent = company;
        brand.dataset.sitecraftSlot = 'companyName.zh';
      }
      const navEl = header.querySelector('nav');
      if (navEl) {
        const keys = ['about', 'features', 'products', 'services', 'contact'];
        const labels = keys.map((k, i) => navLabel(k, ['关于我们', '核心优势', '产品中心', '服务支持', '联系我们'][i]));
        const links = Array.from(navEl.querySelectorAll('a'));
        while (navEl.querySelectorAll('a').length < labels.length && links.length) navEl.append(links[0].cloneNode(true));
        Array.from(navEl.querySelectorAll('a')).forEach((a, i) => {
          if (i < labels.length) {
            a.textContent = labels[i];
            a.setAttribute('href', '#' + keys[i]);
            a.dataset.sitecraftSlot = 'navigation.' + keys[i] + '.zh';
          } else {
            a.remove();
          }
        });
      }
      // 右上角 demo 按钮（Start a project）
      const headerBtn = header.querySelector('a.button-small');
      if (headerBtn) { headerBtn.textContent = '联系我们'; headerBtn.setAttribute('href', '#contact'); }
    }

    // ---- hero 装饰面板的 demo 文案隐藏（保留外壳与信号条，纯视觉）----
    const panel = document.querySelector('.hero-panel');
    if (panel) {
      const label = panel.querySelector('.panel-label');
      const strong = panel.querySelector('strong');
      if (label) { label.hidden = true; label.style.setProperty('display', 'none', 'important'); }
      if (strong) { strong.hidden = true; strong.style.setProperty('display', 'none', 'important'); }
    }

    // ---- 打节标记（模板 id 已齐全，只需补 hero 与 scope）----
    const mark = (sec, key) => {
      if (!sec) return;
      sec.id = key;
      sec.dataset.sitecraftSection = key;
      sec.dataset.sitecraftScope = key;
    };
    mark(document.querySelector('section.hero'), 'hero');
    mark(document.querySelector('#about'), 'about');
    mark(document.querySelector('#features'), 'features');
    mark(document.querySelector('#services'), 'services');
    mark(document.querySelector('#work'), 'products');
    mark(document.querySelector('#contact'), 'contact');

    // ---- footer：品牌 + 联系信息 ----
    const footer = document.querySelector('footer');
    if (footer) {
      const brand = footer.querySelector('a.brand');
      if (brand) brand.textContent = company;
      const holder = footer;
      let band = holder.querySelector('[data-sitecraft-footer-content]');
      if (!band) {
        band = document.createElement('div');
        band.dataset.sitecraftFooterContent = 'true';
        band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;justify-content:center;padding:.75rem 1rem;font-size:.875rem;opacity:.85';
        holder.append(band);
      }
      band.innerHTML = '';
    }
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const contact = content.contact || {};

    // ---- hero：h1 / 副文 / 首个 CTA ----
    const heroSec = document.querySelector('[data-sitecraft-section="hero"]');
    if (heroSec) {
      const h1 = heroSec.querySelector('h1');
      const sub = heroSec.querySelector('p');
      const eyebrow = heroSec.querySelector('.eyebrow');
      const cta = heroSec.querySelector('.hero-actions a.button, a.button');
      if (h1) setText(h1, localize(content.hero?.title, locale), 'hero.title.' + locale, applied);
      if (sub) setText(sub, localize(content.hero?.subtitle, locale), 'hero.subtitle.' + locale, applied);
      if (eyebrow) setText(eyebrow, localize(draft.industry, locale) || 'Strategy / Design / Delivery', 'industry.zh', applied);
      if (cta) setText(cta, localize(content.hero?.cta, locale), 'hero.cta.' + locale, applied);
    }

    // ---- about：h2 / p ----
    const aboutSec = document.querySelector('[data-sitecraft-section="about"]');
    if (aboutSec) {
      const h2 = aboutSec.querySelector('h2');
      const p = aboutSec.querySelector('p');
      if (h2) setText(h2, localize(content.about?.title, locale), 'about.title.' + locale, applied);
      if (p) setText(p, localize(content.about?.body, locale), 'about.body.' + locale, applied);
    }

    // ---- features：.card-grid（3 条，article > span + h3 + p）----
    const featureSec = document.querySelector('[data-sitecraft-section="features"]');
    if (featureSec) {
      const head = featureSec.querySelector('.section-heading');
      if (head) {
        const h2 = head.querySelector('h2');
        const p = head.querySelector('p');
        if (h2) setText(h2, localize(content.features?.title, locale), 'features.title.' + locale, applied);
        if (p) setText(p, localize(content.features?.intro, locale), 'features.intro.' + locale, applied);
      }
      fillArticles(featureSec.querySelector('.card-grid'), content.features?.items, 'features', locale, applied);
    }

    // ---- services：.service-list（3 条）----
    const serviceSec = document.querySelector('[data-sitecraft-section="services"]');
    if (serviceSec) {
      const head = serviceSec.querySelector('.section-heading');
      if (head) {
        const h2 = head.querySelector('h2');
        const p = head.querySelector('p');
        if (h2) setText(h2, localize(content.services?.title, locale), 'services.title.' + locale, applied);
        if (p) setText(p, localize(content.services?.intro, locale), 'services.intro.' + locale, applied);
      }
      fillArticles(serviceSec.querySelector('.service-list'), content.services?.items, 'services', locale, applied);
    }

    // ---- products：#work 的 .work-grid（2 条，article > span + h3，无 p）----
    const workSec = document.querySelector('[data-sitecraft-section="products"]');
    if (workSec) {
      const head = workSec.querySelector('.section-heading');
      if (head) {
        const h2 = head.querySelector('h2');
        const p = head.querySelector('p');
        if (h2) setText(h2, localize(content.products?.title, locale), 'products.title.' + locale, applied);
        if (p) setText(p, localize(content.products?.intro, locale), 'products.intro.' + locale, applied);
      }
      const grid = workSec.querySelector('.work-grid');
      const products = Array.isArray(draft.products) ? draft.products : [];
      if (grid) {
        const articles = Array.from(grid.querySelectorAll('article'));
        articles.forEach((article, index) => {
          const product = products[index];
          if (!product) {
            article.style.setProperty('display', 'none', 'important');
            article.setAttribute('aria-hidden', 'true');
            return;
          }
          const tag = article.querySelector('span');
          const title = article.querySelector('h3');
          // 该模板的作品卡只有「分类标签 + 标题」，把产品名写标题、分类写标签，简介无处安放（不硬塞）
          if (tag) setText(tag, localize(product.category, locale) || product.sku, 'products.' + product.sku + '.category.' + locale, applied);
          if (title) setText(title, localize(product.name, locale), 'products.' + product.sku + '.name.' + locale, applied);
        });
      }
    }

    // ---- contact：h2 / p / 按钮（写电话）----
    const contactSec = document.querySelector('[data-sitecraft-section="contact"]');
    if (contactSec) {
      const h2 = contactSec.querySelector('h2');
      const p = contactSec.querySelector('p');
      const button = contactSec.querySelector('a.button, a');
      if (h2) setText(h2, localize(contact.title, locale), 'contact.title.' + locale, applied);
      if (p) setText(p, localize(contact.body, locale), 'contact.body.' + locale, applied);
      const phone = String(contact.phone || '').trim();
      const email = String(contact.email || '').trim();
      if (button && (phone || email)) {
        button.textContent = phone || email;
        button.setAttribute('href', phone ? 'tel:' + phone.replace(/\\s+/g, '') : 'mailto:' + email);
        button.setAttribute('data-sitecraft-slot', (phone ? 'contact.phone.' : 'contact.email.') + locale);
        applied.add((phone ? 'contact.phone.' : 'contact.email.') + locale);
      }
    }

    // ---- footer 联系带：邮箱/地址（电话已用在 contact 按钮）----
    const band = document.querySelector('[data-sitecraft-footer-content]');
    if (band) {
      const ensureNode = (slot, tag) => {
        let node = band.querySelector('[data-sitecraft-slot^="' + slot + '."]');
        if (!node) {
          node = document.createElement(tag || 'span');
          band.append(node);
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

  /** 统一的 article 卡片填充（features/services 共用：span 序号 + h3 标题 + p 正文）。
   *  注意：必须把 locale/applied 作为参数传入——本函数定义在 applyNativeContentFill 之外，
   *  不共享其闭包（2026-09-09 实测：漏传 locale 导致 "locale is not defined"）。 */
  const fillArticles = (container, items, sectionKey, locale, applied) => {
    if (!container) return;
    const list = items || [];
    const articles = Array.from(container.querySelectorAll('article'));
    articles.forEach((article, index) => {
      const item = list[index];
      if (!item) {
        article.style.setProperty('display', 'none', 'important');
        article.setAttribute('aria-hidden', 'true');
        return;
      }
      const itemKey = (item && item.id) ? item.id : String(index);
      const title = article.querySelector('h3');
      const body = article.querySelector('p');
      if (title) setText(title, localize(item.title, locale), sectionKey + '.items.' + itemKey + '.title.' + locale, applied);
      if (body) setText(body, localize(item.body, locale), sectionKey + '.items.' + itemKey + '.body.' + locale, applied);
    });
  };
`;

export const nextjsLandingAdapter: TemplateAdapter = {
  templateId: "nextjs-landing",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    // 该模板结构规整、配色克制，生成区仅在「产品条目超出 #work 容量」时出现，统一浅底即可
    '[data-sitecraft-generated-products]{background:#f7f7f5}' +
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
    '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '[data-sitecraft-generated-products] article{background:#fff!important;border:1px solid #e5e5e5!important;border-radius:10px;padding:20px}',
};
