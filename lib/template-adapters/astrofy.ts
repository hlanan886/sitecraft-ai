import type { TemplateAdapter } from "./types.ts";

/**
 * Astrofy portfolio 适配：模板没有语义 section，保留原生项目卡流并补齐 about/contact 锚点。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('main .text-5xl, main h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const localizeValue = (value) => (value && typeof value === 'object' ? (value.zh || value.en || Object.values(value)[0]) : value) || '';
    const main = document.querySelector('main');
    if (!main) return;

    const intro = main.querySelector('.pb-12.mt-5') || main.firstElementChild;
    if (intro && !intro.closest('[data-sitecraft-astrofy-intro]')) {
      const about = document.createElement('section');
      about.id = 'about';
      about.dataset.sitecraftScope = 'about';
      about.dataset.sitecraftSection = 'about';
      about.dataset.sitecraftAstrofyIntro = 'true';
      intro.parentElement?.insertBefore(about, intro);
      about.append(intro);
    }

    const introScope = document.querySelector('[data-sitecraft-astrofy-intro]');
    const role = introScope?.querySelector('.text-3xl');
    if (role && role.tagName !== 'P') {
      const p = document.createElement('p');
      p.className = role.className;
      p.textContent = role.textContent || '';
      role.replaceWith(p);
    }
    const description = introScope?.querySelector('text.text-lg, .py-2 text, .py-2');
    if (description && description.tagName !== 'P') {
      const p = document.createElement('p');
      p.className = description.className || 'text-lg';
      p.textContent = description.textContent || '';
      description.replaceWith(p);
    }

    const navLabels = ['关于', '作品', '联系'];
    const navTargets = ['#about', '#features', '#contact'];
    const navKeys = ['about', 'features', 'contact'];
    document.querySelectorAll('.drawer-side a, .sticky a').forEach((link) => {
      const id = link.id || '';
      if (id === 'home' || id === 'projects' || id === 'services' || id === 'store' || id === 'blog' || id === 'cv' || /contact/i.test(link.textContent || '')) {
        const index = id === 'home' ? 0 : id === 'projects' ? 1 : id === 'contact' || /contact/i.test(link.textContent || '') ? 2 : -1;
        if (index >= 0) {
          link.textContent = localizeValue(draft?.navigation?.[navKeys[index]]) || navLabels[index];
          link.setAttribute('href', navTargets[index]);
          link.dataset.sitecraftSlot = 'navigation.' + navKeys[index] + '.zh';
        } else {
          link.remove();
        }
      }
    });

    let contact = document.querySelector('[data-sitecraft-astrofy-contact]');
    const footer = document.querySelector('footer');
    if (!contact) {
      contact = document.createElement('section');
      contact.id = 'contact';
      contact.dataset.sitecraftScope = 'contact';
      contact.dataset.sitecraftSection = 'contact';
      contact.dataset.sitecraftAstrofyContact = 'true';
      contact.style.cssText = 'margin-top:3rem;padding:3rem 0;border-top:1px solid currentColor;opacity:.9';
      const contactHeading = document.createElement('h2');
      contactHeading.textContent = 'Contact';
      const contactBody = document.createElement('p');
      contactBody.textContent = 'Get in touch';
      contact.append(contactHeading, contactBody);
      if (footer?.parentElement) footer.parentElement.insertBefore(contact, footer);
      else main.append(contact);
    }

    document.querySelectorAll('a[href^="http"]').forEach((link) => link.remove());
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    if (footer) {
      footer.innerHTML = '';
      const line = document.createElement('div');
      line.dataset.sitecraftFooterContent = 'true';
      line.textContent = company;
      footer.append(line);
    }
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const intro = document.querySelector('[data-sitecraft-astrofy-intro]');
    if (intro) {
      const aboutTitle = intro.querySelector('.text-xl');
      const aboutBody = intro.querySelector('p.py-2, p.text-lg, text');
      if (aboutTitle) setText(aboutTitle, localize(content.about?.title, locale), 'about.title.' + locale, applied);
      if (aboutBody) setText(aboutBody, localize(content.about?.body, locale), 'about.body.' + locale, applied);
    }

    const main = document.querySelector('main');
    if (!main) return;
    // 补 contact 槽内容（自建区，共享引擎对非原生 section 定位不稳，这里直接填+打 slot 短路生成区）
    const contact = document.querySelector('[data-sitecraft-astrofy-contact]');
    if (contact) {
      const t = contact.querySelector('h2');
      const bd = contact.querySelector('p');
      const ct = content.contact || {};
      if (t) setText(t, localize(ct.title, locale), 'contact.title.' + locale, applied);
      if (bd) setText(bd, localize(ct.body, locale), 'contact.body.' + locale, applied);
      // 联系方式三项都要落 slot：本适配器接管 contact 后共享引擎不再生成联系区，
      // 只写 email 会让 contact.phone/address 判定为未覆盖（2026-09-09 全量探针发现）。
      const ensureLine = (target, tag) => {
        let node = contact.querySelector('[data-sitecraft-slot^="' + target + '."]');
        if (!node) {
          node = document.createElement(tag);
          node.style.cssText = 'display:block;margin-top:6px';
          contact.append(node);
        }
        return node;
      };
      const email = typeof ct.email === 'string' ? ct.email : '';
      if (email) {
        const a = ensureLine('contact.email', 'a');
        a.setAttribute('href', 'mailto:' + email);
        setText(a, email, 'contact.email.' + locale, applied);
      }
      const phone = typeof ct.phone === 'string' ? ct.phone : '';
      if (phone) {
        const a = ensureLine('contact.phone', 'a');
        a.setAttribute('href', 'tel:' + phone.replace(/\\s+/g, ''));
        setText(a, phone, 'contact.phone.' + locale, applied);
      }
      const address = localize(ct.address);
      if (address) setText(ensureLine('contact.address', 'address'), address, 'contact.address.' + locale, applied);
    }
    const headings = Array.from(main.querySelectorAll('div, h2, h3')).filter((node) => /last projects|latest from blog/i.test(node.textContent || ''));
    const featureHeading = headings[0];
    if (featureHeading) {
      featureHeading.dataset.sitecraftSection = 'features';
      setText(featureHeading, localize(content.features?.title, locale), 'features.title.' + locale, applied);
    }
    // portfolio 站无博客板块：Latest from blog 标题与随后的博客卡（其 h1 不带项目卡结构标记时）
    // 整体隐藏，避免 demo 英文标题残留。
    const blogHeading = headings.find((h) => /latest from blog/i.test(h.textContent || ''));
    if (blogHeading) {
      blogHeading.hidden = true;
      blogHeading.style.setProperty('display', 'none', 'important');
      let sibling = blogHeading.parentElement && blogHeading.parentElement.nextElementSibling ? blogHeading.parentElement.nextElementSibling : blogHeading.nextElementSibling;
      let guard = 0;
      while (sibling && guard++ < 8) {
        const isCard = sibling.querySelector && sibling.querySelector('h1');
        const t = (sibling.textContent || '');
        if (isCard || /blog|post/i.test(t.slice(0, 60))) {
          sibling.hidden = true;
          sibling.style.setProperty('display', 'none', 'important');
          sibling = sibling.nextElementSibling;
        } else break;
      }
    }
    const cards = Array.from(main.querySelectorAll('div.rounded-lg.bg-base-100')).filter((card) => card.querySelector('h1') && card.querySelector('p') && !card.hidden);
    const items = Array.isArray(content.features?.items) ? content.features.items : [];
    cards.forEach((card, index) => {
      if (index >= items.length) {
        card.hidden = true;
        card.style.setProperty('display', 'none', 'important');
        return;
      }
      const item = items[index];
      const itemKey = item && typeof item.id === 'string' && item.id ? item.id : String(index);
      const title = card.querySelector('h1');
      const body = card.querySelector('p');
      if (title) setText(title, localize(item?.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body) setText(body, localize(item?.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftNativeFeaturesItem = 'true';
      card.dataset.sitecraftSection = 'features';
      card.dataset.sitecraftItemId = itemKey;
    });
  };
`;

export const astrofyAdapter: TemplateAdapter = {
  templateId: "astrofy",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss: '#about,#features,#contact{opacity:1!important;visibility:visible!important} footer{margin-top:2rem}',
};

