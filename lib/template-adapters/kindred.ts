import type { TemplateAdapter } from "./types.ts";

/**
 * kindred 专属适配（Sapling/Odyssey 主题，Astro 静态，vendor 目录名 `odyssey`）。
 *
 * **注意目录名与 templateId 不一致**：`lib/template-catalog.ts` 的 `localPath` 指向
 * `vendor/open-source-templates/odyssey`，而 manifest/适配器注册键是 `kindred`。
 *
 * 该模板的首页是**主题展示页**，不是企业落地页：三个 `section.feature-card__section`
 * 分别列出 "Landing Pages"(2 卡) / "Company Pages"(5 卡) / "Theme Pages"(2 卡)，
 * 每张卡只有标题（`h3.feature-card__title`，无正文），链接指向 demo 子页。
 *
 * 结构：
 *   header#odysseyNavHeader（logo + nav[Home/Blog/About/Contact] + a.btn）
 *   main#content > div#page > div.content__container
 *     section.hero-section__section（.hero-section__text[h1 + p>a + .hero-btns__container>a.btn] + a.btn）
 *     div.hero-section__image
 *     div.content__container > section.feature-card__section × 3（h2 + p + .feature-card__grid>卡）
 *   footer（.footer-brand__container[logo + 社交列] + 链接列）
 *
 * 编排：
 *   hero     ← h1 / p / 首个 CTA
 *   features ← 第 1 个卡片区（2 卡：h3←item.title）
 *   services ← 第 2 个卡片区（5 卡）
 *   products ← 第 3 个卡片区（2 卡）
 *   about / contact ← 首页无原生区，由通用生成区承载（manifest 未声明，走 defaultPresentation）
 *
 * 卡内只有标题、无正文——正文不硬塞（与 landwind 勾选列同一取舍）。
 * 所有 demo 子页链接（/landing-pages/、/company/、/blog/…）改为锚点，避免点了跳走。
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('.hero-section__text h1, main h1, h1')[0] || null;
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
    const header = document.querySelector('header#odysseyNavHeader, header');
    if (header) {
      const logo = header.querySelector('.odyssey-logo');
      if (logo) { logo.textContent = company; logo.dataset.sitecraftSlot = 'companyName.zh'; }
      const navEl = header.querySelector('nav ul') || header.querySelector('nav');
      if (navEl) {
        const keys = ['about', 'features', 'products', 'services', 'contact'];
        const labels = keys.map((k, i) => navLabel(k, ['关于我们', '核心优势', '产品中心', '服务支持', '联系我们'][i]));
        const lis = Array.from(navEl.querySelectorAll('li'));
        while (navEl.querySelectorAll('li').length < labels.length && lis.length) navEl.append(lis[0].cloneNode(true));
        Array.from(navEl.querySelectorAll('a')).forEach((a, i) => {
          if (i < labels.length) {
            a.textContent = labels[i];
            a.setAttribute('href', '#' + keys[i]);
            a.dataset.sitecraftSlot = 'navigation.' + keys[i] + '.zh';
          } else {
            (a.closest('li') || a).remove();
          }
        });
      }
      const headerBtn = header.querySelector('.header-action-item__container a');
      if (headerBtn) { headerBtn.textContent = '联系我们'; headerBtn.setAttribute('href', '#contact'); }
    }

    // ---- demo 子页链接改锚点（/landing-pages/、/company/、/blog/… 会跳到模板 demo 页）----
    document.querySelectorAll('a[href^="/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^\\/(?:landing-pages|company|blog|theme|legal)/.test(href)) {
        a.setAttribute('href', '#products');
        a.removeAttribute('target');
      }
    });

    // ---- 打节标记：hero + 三个卡片区（按 DOM 顺序）----
    const mark = (el, key) => {
      if (!el) return;
      el.id = key;
      el.dataset.sitecraftSection = key;
      el.dataset.sitecraftScope = key;
    };
    mark(document.querySelector('.hero-section__section'), 'hero');
    const cardSections = Array.from(document.querySelectorAll('section.feature-card__section'));
    mark(cardSections[0], 'features');
    mark(cardSections[1], 'services');
    // 第 3 个卡片区是「Theme Pages」（Get Started / Style Guide），纯主题演示，整体隐藏；
    // 产品改由通用生成区承载（该模板的产品卡是主题预览瓦片，语义不符）
    if (cardSections[2]) {
      cardSections[2].hidden = true;
      cardSections[2].style.setProperty('display', 'none', 'important');
    }

    // ---- footer：清 demo 社交列与链接列，补企业联系 ----
    // 结构：.footer-grid__container > [.footer-brand__container(logo+社交), div(p+ul.footer-link__list)×3]
    //      + .footer-copyright__container(a.btn + p)
    const footer = document.querySelector('footer');
    if (footer) {
      // 社交列与三列 demo 链接（Landing Pages / Company / Theme）整体移除
      footer.querySelectorAll('.footer-socials__list, .footer-socials__item, .footer-link__list').forEach((n) => n.remove());
      // 移走链接列表后只剩标题 p 的空列（列内已无任何链接与图片）
      footer.querySelectorAll('.footer-grid__container > div').forEach((col) => {
        if (col.classList.contains('footer-brand__container')) return;
        if (!col.querySelector('a') && !col.querySelector('img')) col.remove();
      });
      // 底部 demo 版权条（"Get This Template" 按钮 + 版权文字）
      footer.querySelectorAll('.footer-copyright__container').forEach((n) => n.remove());
      const logo = footer.querySelector('.odyssey-logo');
      if (logo) logo.textContent = company;
      const holder = footer.querySelector('.footer-grid__container') || footer;
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;justify-content:center;padding:1rem;font-size:.875rem;opacity:.85';
      band.innerHTML = '<span style="font-weight:600">' + company + '</span>';
      holder.append(band);
    }

    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((n) => n.remove());
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const contact = content.contact || {};

    // ---- hero：h1 / 副文 / 首个 CTA（第二个按钮是 demo 次要入口，隐藏）----
    const heroSec = document.querySelector('[data-sitecraft-section="hero"]');
    if (heroSec) {
      const h1 = heroSec.querySelector('h1');
      const p = heroSec.querySelector('p');
      const btns = Array.from(heroSec.querySelectorAll('.hero-btns__container a, a.btn'));
      if (h1) setText(h1, localize(content.hero?.title, locale), 'hero.title.' + locale, applied);
      if (p) setText(p, localize(content.hero?.subtitle, locale), 'hero.subtitle.' + locale, applied);
      if (btns[0]) setText(btns[0], localize(content.hero?.cta, locale), 'hero.cta.' + locale, applied);
      btns.slice(1).forEach((b) => { b.hidden = true; b.style.setProperty('display', 'none', 'important'); });
    }

    /** 卡片区填充：每卡只有 h3 标题（无正文），超出容量的卡隐藏 */
    const fillCards = (sectionKey, items) => {
      const sec = document.querySelector('[data-sitecraft-section="' + sectionKey + '"]');
      if (!sec) return;
      const list = items || [];
      const h2 = sec.querySelector('h2');
      const p = sec.querySelector('p');
      const titleKey = sectionKey === 'products' ? 'products.title' : sectionKey + '.title';
      const introKey = sectionKey === 'products' ? 'products.intro' : sectionKey + '.intro';
      const titleValue = sectionKey === 'products' ? content.products?.title : content[sectionKey]?.title;
      const introValue = sectionKey === 'products' ? content.products?.intro : content[sectionKey]?.intro;
      if (h2) setText(h2, localize(titleValue, locale), titleKey + '.' + locale, applied);
      if (p) setText(p, localize(introValue, locale), introKey + '.' + locale, applied);
      const cards = Array.from(sec.querySelectorAll('.feature-card__card'));
      cards.forEach((card, index) => {
        const item = list[index];
        if (!item) {
          card.style.setProperty('display', 'none', 'important');
          card.setAttribute('aria-hidden', 'true');
          return;
        }
        const itemKey = (item && item.id) ? item.id : (item.sku ? item.sku : String(index));
        const h3 = card.querySelector('h3');
        if (h3) {
          const label = item.title ? localize(item.title, locale) : localize(item.name, locale);
          const prefix = sectionKey === 'products' ? 'products.' + itemKey + '.name' : sectionKey + '.items.' + itemKey + '.title';
          setText(h3, label, prefix + '.' + locale, applied);
        }
        // 卡内 demo 子页截图（Landing Page 1 / About Page 等）无企业语义，隐藏
        card.querySelectorAll('img, picture, video').forEach((node) => {
          node.hidden = true;
          node.style.setProperty('display', 'none', 'important');
        });
      });
    };

    fillCards('features', content.features?.items);
    fillCards('services', content.services?.items);
    // products 不走原生卡片区（见 prepareFn 说明），由通用生成区承载

    // ---- footer 联系带：邮箱/电话/地址 ----
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
      const phone = String(contact.phone || '').trim();
      if (phone) {
        const a = ensureNode('contact.phone', 'a');
        a.setAttribute('href', 'tel:' + phone.replace(/\\s+/g, ''));
        setText(a, phone, 'contact.phone.' + locale, applied);
      }
      const address = localize(contact.address);
      if (address) setText(ensureNode('contact.address', 'span'), address, 'contact.address.' + locale, applied);
    }
  };
`;

export const kindredAdapter: TemplateAdapter = {
  templateId: "kindred",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    '[data-sitecraft-generated-products], [data-sitecraft-generated-content]{background:var(--theme-surface-2, #f7f7f5)}' +
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
    '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}',
};
