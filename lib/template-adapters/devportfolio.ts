import type { TemplateAdapter } from "./types.ts";

/** DevPortfolio portfolio 适配：保留 hero/about/projects 原生排版，隐藏履历 demo 区。 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('#hero h1, section h1, main h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const localizeValue = (value) => (value && typeof value === 'object' ? (value.zh || value.en || Object.values(value)[0]) : value) || '';
    const about = document.getElementById('about');
    const projects = document.getElementById('projects');
    if (about) {
      about.dataset.sitecraftScope = 'about';
      about.dataset.sitecraftSection = 'about';
    }
    if (projects) {
      projects.dataset.sitecraftScope = 'features';
      projects.dataset.sitecraftSection = 'features';
      // 原生项目卡填充提前到 prepareFn（此时 DOM 完整）：直接改写卡内 h3/p 并打 slot，
      // 避免依赖 applyContent 后续时序（共享引擎对 #projects 的二次处理会清空卡内容）。
      const fTitle = projects.querySelector('h2');
      const fTitleText = localizeValue(draft?.content?.features?.title);
      if (fTitle && fTitleText) {
        fTitle.textContent = fTitleText;
        fTitle.dataset.sitecraftSlot = 'features.title.zh';
      }
      // 项目卡技术标签（React/AWS 等英文 demo）清掉，卡更干净
      projects.querySelectorAll('.group.relative .flex.flex-wrap span, .group.relative span[class*="text-xs"]').forEach((s) => {
        if (/react|node|aws|docker|python|javascript|typescript|html|css/i.test(s.textContent || '')) s.remove();
      });
      const fItems = Array.isArray(draft?.content?.features?.items) ? draft.content.features.items : [];
      const cards = Array.from(projects.querySelectorAll('.group.relative')).filter((card) => card.querySelector('h3'));
      cards.forEach((card, index) => {
        const item = fItems[index];
        if (!item) {
          card.hidden = true;
          card.style.setProperty('display', 'none', 'important');
          return;
        }
        const itemKey = item.id || String(index);
        const h3 = card.querySelector('h3');
        const body = card.querySelector('p');
        const link = card.querySelector('a');
        if (h3) { h3.textContent = localizeValue(item.title); h3.dataset.sitecraftSlot = 'features.items.' + itemKey + '.title.zh'; }
        if (body) { body.textContent = localizeValue(item.body); body.dataset.sitecraftSlot = 'features.items.' + itemKey + '.body.zh'; }
        if (link) link.setAttribute('href', '#contact');
        card.dataset.sitecraftNativeFeaturesItem = 'true';
        card.dataset.sitecraftSection = 'features';
        card.dataset.sitecraftItemId = itemKey;
      });
      // 超出原生卡位（>3）的条目：加一张原生同款卡补位，避免静默丢内容
      const extra = fItems.slice(cards.length);
      if (extra.length && cards.length) {
        const templateCard = cards[0].cloneNode(true);
        extra.forEach((item, ei) => {
          const card = templateCard.cloneNode(true);
          const idx = cards.length + ei;
          const itemKey = item.id || String(idx);
          const h3 = card.querySelector('h3');
          const body = card.querySelector('p');
          if (h3) { h3.textContent = localizeValue(item.title); h3.dataset.sitecraftSlot = 'features.items.' + itemKey + '.title.zh'; }
          if (body) { body.textContent = localizeValue(item.body); body.dataset.sitecraftSlot = 'features.items.' + itemKey + '.body.zh'; }
          card.dataset.sitecraftNativeFeaturesItem = 'true';
          card.dataset.sitecraftSection = 'features';
          card.dataset.sitecraftItemId = itemKey;
          const wrap = projects.querySelector('.space-y-8');
          wrap?.append(card);
        });
      }
    }

    ['experience', 'education'].forEach((id) => {
      const section = document.getElementById(id);
      if (section) {
        section.hidden = true;
        section.style.setProperty('display', 'none', 'important');
      }
    });

    const navLabels = [
      localizeValue(draft?.navigation?.about) || '关于',
      localizeValue(draft?.navigation?.features) || '作品',
      localizeValue(draft?.navigation?.contact) || '联系',
    ];
    const navTargets = ['#about', '#projects', '#contact'];
    Array.from(document.querySelectorAll('#header nav a')).forEach((link, index) => {
      if (index < navLabels.length) {
        link.textContent = navLabels[index];
        link.setAttribute('href', navTargets[index]);
        link.dataset.sitecraftSlot = 'navigation.' + ['about', 'features', 'contact'][index] + '.zh';
      } else {
        link.remove();
      }
    });

    const contact = document.createElement('section');
    contact.id = 'contact';
    contact.dataset.sitecraftScope = 'contact';
    contact.dataset.sitecraftSection = 'contact';
    contact.dataset.sitecraftDevportfolioContact = 'true';
    contact.style.cssText = 'padding:clamp(48px,8vw,120px);background:#f8fafc;color:#111827';
    const h2 = document.createElement('h2');
    const cTitle = localizeValue(draft?.content?.contact?.title) || '联系';
    const cBody = localizeValue(draft?.content?.contact?.body) || '';
    const cEmail = (draft?.content?.contact?.email) || '';
    h2.textContent = cTitle;
    h2.dataset.sitecraftSlot = 'contact.title.zh';
    contact.append(h2);
    if (cBody) {
      const p = document.createElement('p');
      p.textContent = cBody;
      p.dataset.sitecraftSlot = 'contact.body.zh';
      contact.append(p);
    }
    if (cEmail) {
      const a = document.createElement('a');
      a.setAttribute('href', 'mailto:' + cEmail);
      a.textContent = cEmail;
      a.dataset.sitecraftSlot = 'contact.email.zh';
      a.style.cssText = 'color:#1d4ed8;text-decoration:underline;display:inline-block;margin-top:.6rem';
      contact.append(a);
    }
    const footer = document.querySelector('footer');
    if (footer?.parentElement) footer.parentElement.insertBefore(contact, footer);
    else document.body.append(contact);

    // 技能 demo 标签（Javascript/Python/AWS 等纯英文残留，散布在 about/hero）
    document.querySelectorAll('span[class*="px-3"], span[class*="bg-gray-100"], #hero span, .skill-tag').forEach((s) => {
      const t = (s.textContent || '').trim();
      if (/^(javascript|typescript|react|node\.?js?|python|aws|docker|html|css|git|flutter|swift|java|go)$/i.test(t) && !s.querySelector('*') && !s.closest('#projects')) s.remove();
    });

    document.querySelectorAll('a[href^="http"]').forEach((link) => {
      if (!link.closest('#hero')) link.remove();
    });
    if (footer) {
      footer.innerHTML = '';
      const line = document.createElement('p');
      line.dataset.sitecraftFooterContent = 'true';
      line.textContent = draft?.companyName || draft?.siteName || '';
      footer.append(line);
    }
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const section = document.getElementById('projects') || document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftScope = 'features';
    section.dataset.sitecraftSection = 'features';
    const content = draft.content || {};
    const featureTitle = section.querySelector('h2');
    if (featureTitle) setText(featureTitle, localize(content.features?.title, locale), 'features.title.' + locale, applied);
    const cards = Array.from(section.querySelectorAll('.group.relative')).filter((card) => card.querySelector('h3') && card.querySelector('p'));
    const items = Array.isArray(content.features?.items) ? content.features.items : [];
    cards.forEach((card, index) => {
      if (index >= items.length) {
        card.hidden = true;
        card.style.setProperty('display', 'none', 'important');
        return;
      }
      const item = items[index];
      const itemKey = item && typeof item.id === 'string' && item.id ? item.id : String(index);
      const title = card.querySelector('h3');
      const body = card.querySelector('p');
      if (title) setText(title, localize(item?.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body) setText(body, localize(item?.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftNativeFeaturesItem = 'true';
      card.dataset.sitecraftSection = 'features';
      card.dataset.sitecraftItemId = itemKey;
      card.querySelector('a')?.setAttribute('href', '#features');
    });
  };
`;

export const devportfolioAdapter: TemplateAdapter = {
  templateId: "devportfolio",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss: '#hero,#about,#features,#contact{opacity:1!important;visibility:visible!important;transform:none!important}',
};

