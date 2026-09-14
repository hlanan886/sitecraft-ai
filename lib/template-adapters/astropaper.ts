import type { TemplateAdapter } from "./types.ts";

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('#hero h1, main h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const localizeValue = (value) => (value && typeof value === 'object' ? (value.zh || value.en || Object.values(value)[0]) : value) || '';
    const hero = document.getElementById('hero');
    const main = document.querySelector('main');
    if (!main) return;

    if (hero && !document.querySelector('[data-sitecraft-astropaper-about]')) {
      const about = document.createElement('section');
      about.id = 'about';
      about.dataset.sitecraftScope = 'about';
      about.dataset.sitecraftSection = 'about';
      about.dataset.sitecraftAstropaperAbout = 'true';
      about.className = hero.className || '';
      const heading = document.createElement('h2');
      heading.textContent = '关于';
      const body = document.createElement('p');
      body.textContent = localizeValue(draft?.content?.about?.body) || '';
      about.append(heading, body);
      hero.after(about);
      // hero 博客简介 demo（两段英文介绍 + Social Links + 社交外链 + RSS）：改写为站点简介，删社交区
      const heroDesc = Array.from(hero.querySelectorAll(':scope > p, :scope > div p')).filter((p) => p.textContent && !p.querySelector('a'));
      heroDesc.forEach((p, idx) => {
        if (idx === 0) {
          const t = localizeValue(draft?.content?.hero?.subtitle) || localizeValue(draft?.content?.about?.body) || '';
          if (t) p.textContent = t;
          else p.remove();
        } else p.remove();
      });
      hero.querySelectorAll('div:has(> div)').forEach((d) => {
        const t = (d.textContent || '');
        if (/social links:/i.test(t) || /github|twitter|mastodon|linkedin/i.test(t)) d.remove();
      });
      hero.querySelectorAll('a[href*="rss"], a[aria-label*="rss"], a[title*="rss"]').forEach((a) => a.remove());
      // 简介段里 README 等剩余外链与文字一起清
      hero.querySelectorAll('p').forEach((p) => {
        if (!p.getAttribute('data-sitecraft-slot') && !p.querySelector('[data-sitecraft-slot]')) {
          const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
          if (/read the blog|astro.?paper|check .*readme|more info/i.test(t)) p.remove();
        }
      });
    }

    const featured = document.getElementById('featured');
    if (featured) {
      featured.hidden = true;
      featured.style.setProperty('display', 'none', 'important');
    }
    const recent = document.getElementById('recent-posts');
    if (recent) {
      recent.dataset.sitecraftScope = 'features';
      recent.dataset.sitecraftSection = 'features';
      recent.dataset.sitecraftNativeFeatures = 'true';
    }

    const nav = document.getElementById('menu-items');
    if (nav) {
      Array.from(nav.querySelectorAll('a')).forEach((link) => {
        const text = (link.textContent || '').trim().toLowerCase();
        if (text.includes('post')) {
          link.textContent = localizeValue(draft?.navigation?.features) || '文章';
          link.setAttribute('href', '#recent-posts');
          link.dataset.sitecraftSlot = 'navigation.features.zh';
        } else if (text.includes('about')) {
          link.textContent = localizeValue(draft?.navigation?.about) || '关于';
          link.setAttribute('href', '#about');
          link.dataset.sitecraftSlot = 'navigation.about.zh';
        } else if (text.includes('tag') || text.includes('archive')) {
          link.remove();
        }
      });
    }

    document.querySelectorAll('a[href^="http"]').forEach((link) => link.remove());
    // demo 组件：Search 触发钮、RSS Feed、Skip to content 无障碍跳转、作者介绍/邮箱外链
    document.querySelectorAll('a, button, span, p').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t === 'skip to content' || t === 'rss feed' || /^send an email/i.test(t) || /^read the blog posts/i.test(t) || t === 'search') {
        const wrap = el.closest('li, div, p, button');
        (wrap || el).remove();
      }
    });
    document.querySelectorAll('[data-search], [id*="search"], button[aria-label*="search" i], a[href*="rss"]').forEach((el) => el.remove());
    // 文章 demo 日期行（Updated: + time "3 Jun, 2026"）——无真实日期整行隐藏
    document.querySelectorAll('time').forEach((el) => {
      const t = (el.textContent || '');
      if (/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[,.]?\s*\d{1,2}/i.test(t)) {
        if (!el.closest('[data-sitecraft-slot]') && !el.querySelector('[data-sitecraft-slot]')) {
          // 隐藏时间行整容器（Updated: 前缀 span 一并隐藏）
          let holder = el.parentElement;
          while (holder && holder.children.length <= 3 && holder.textContent && (holder.textContent || '').length < 120 && !/^[a-z]+$/i.test(holder.textContent.trim())) {
            if (holder.parentElement && holder.parentElement.children.length <= 2) holder = holder.parentElement;
            else break;
          }
          holder.hidden = true;
          holder.style.setProperty('display', 'none', 'important');
        }
      }
    });
    // "Updated:" 前缀与 time 日期同一行——time 隐藏后前缀也删（无真实日期时整行 demo 元数据清除）
    document.querySelectorAll('span').forEach((s) => {
      if (/^updated:/i.test((s.textContent || '').trim())) {
        const row = s.parentElement;
        if (row && /flex/.test(getComputedStyle(row).display)) {
          row.hidden = true;
          row.style.setProperty('display', 'none', 'important');
        } else s.remove();
      }
    });
    // "All Posts" 查看全部链接 → 中文
    document.querySelectorAll('a').forEach((a) => {
      if (/^all posts$/i.test((a.textContent || '').trim())) a.textContent = '全部文章';
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());

    const footer = document.querySelector('footer');
    if (footer) {
      footer.querySelectorAll('a').forEach((link) => link.remove());
      const company = draft?.companyName || draft?.siteName || '';
      // 版权行 demo（Copyright/All rights reserved）重建为站点版权
      const copyright = Array.from(footer.querySelectorAll('span, p, div')).find((el) => /copyright|rights reserved/i.test(el.textContent || ''));
      if (copyright) {
        const year = (copyright.textContent || '').match(/\d{4}/)?.[0] || '';
        copyright.textContent = 'Copyright © ' + year + ' ' + company;
      }
      if (company && !footer.textContent?.includes(company)) {
        const line = footer.querySelector('p:last-child') || document.createElement('p');
        line.textContent = company;
        footer.append(line);
      }
    }
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const hero = document.getElementById('hero');
    const about = document.querySelector('[data-sitecraft-astropaper-about]');
    const aboutBody = about?.querySelector('p');
    const aboutValue = localize(content.about?.body, locale);
    if (aboutBody && aboutValue) setText(aboutBody, aboutValue, 'about.body.' + locale, applied);
    const heroBody = hero?.querySelector('p');
    if (heroBody && aboutValue) setText(heroBody, aboutValue, 'about.body.' + locale, applied);

    const recent = document.getElementById('recent-posts');
    if (!recent) return;
    recent.dataset.sitecraftScope = 'features';
    recent.dataset.sitecraftSection = 'features';
    const heading = recent.querySelector('h2');
    if (heading) setText(heading, localize(content.features?.title, locale), 'features.title.' + locale, applied);

    const items = Array.isArray(content.features?.items) ? content.features.items : [];
    const cards = Array.from(recent.querySelectorAll('li')).filter((card) => card.querySelector('h3'));
    cards.forEach((card, index) => {
      const meta = card.querySelector('.text-muted-foreground');
      if (meta) {
        meta.hidden = true;
        meta.style.setProperty('display', 'none', 'important');
      }
      if (index >= items.length) {
        card.hidden = true;
        card.style.setProperty('display', 'none', 'important');
        return;
      }
      const item = items[index];
      const itemKey = item && typeof item.id === 'string' && item.id ? item.id : String(index);
      const title = card.querySelector('h3');
      const body = card.querySelector('p:not(.text-sm)');
      if (title) setText(title, localize(item?.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body) setText(body, localize(item?.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftNativeFeaturesItem = 'true';
      card.dataset.sitecraftSection = 'features';
      card.dataset.sitecraftItemId = itemKey;
    });
  };
`;

export const astropaperAdapter: TemplateAdapter = {
  templateId: "astropaper",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss: '#hero,#about,#recent-posts,footer{opacity:1!important;visibility:visible!important}#recent-posts li{opacity:1!important;visibility:visible!important}',
};
