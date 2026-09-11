import type { TemplateAdapter } from "./types.ts";

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('.title-index, h1.title')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const localizeValue = (value) => (value && typeof value === 'object' ? (value.zh || value.en || Object.values(value)[0]) : value) || '';
    const main = document.querySelector('main.content, main');
    if (!main) return;

    // lozad 懒加载封面/轮播图：src 为空 → 破图；把 data-src/data-background-image 落成真实 src。
    // 内联 module script（lozad 观察者）在注入后不一定跑，直接同步补 src 最稳。
    document.querySelectorAll('img.lozad[data-src]').forEach((img) => {
      if (!img.getAttribute('src') || img.getAttribute('src') === '') {
        img.setAttribute('src', img.getAttribute('data-src'));
      }
    });
    document.querySelectorAll('.item.lozad[data-background-image]').forEach((li) => {
      const url = li.getAttribute('data-background-image');
      if (url && !li.style.backgroundImage) li.style.backgroundImage = 'url("' + url + '")';
    });
    // 移除 lozad JS 观察者脚本与 pagefind（preview/离线无对应静态产物，会 404 且 pageerror）
    Array.from(document.scripts).forEach((s) => {
      const t = (s.textContent || '');
      if (/lozad|pagefind/i.test(t)) s.remove();
    });

    // 清 sidebar 作者 demo（avatar/用户名 WhitePaper/slogan/外链图标），保留模板布局骨架
    const sidebar = document.querySelector('.side-bar, aside');
    if (sidebar) {
      const avatarWrap = sidebar.querySelector('.avatar-wrapper');
      avatarWrap?.remove();
      sidebar.querySelectorAll('.username, .slogan').forEach((n) => n.remove());
      sidebar.querySelectorAll('a[href^="http"]').forEach((a) => a.remove());
    }

    if (!document.querySelector('[data-sitecraft-yukina-about]')) {
      const about = document.createElement('section');
      about.id = 'about';
      about.dataset.sitecraftScope = 'about';
      about.dataset.sitecraftSection = 'about';
      about.dataset.sitecraftYukinaAbout = 'true';
      about.style.cssText = 'padding:3rem 1rem 1rem';
      const heading = document.createElement('h2');
      heading.textContent = '关于';
      const body = document.createElement('p');
      body.textContent = localizeValue(draft?.content?.about?.body) || '';
      about.append(heading, body);
      main.before(about);
    }

    if (!document.querySelector('[data-sitecraft-yukina-contact]')) {
      const contact = document.createElement('section');
      contact.id = 'contact';
      contact.dataset.sitecraftScope = 'contact';
      contact.dataset.sitecraftSection = 'contact';
      contact.dataset.sitecraftYukinaContact = 'true';
      contact.style.cssText = 'padding:3rem 1rem;border-top:1px solid currentColor';
      const heading = document.createElement('h2');
      heading.textContent = '联系';
      const body = document.createElement('p');
      body.textContent = '欢迎联系';
      contact.append(heading, body);
      const footer = document.querySelector('footer');
      if (footer?.parentElement) footer.parentElement.insertBefore(contact, footer);
      else main.after(contact);
    }

    main.dataset.sitecraftScope = 'features';
    main.dataset.sitecraftSection = 'features';
    main.dataset.sitecraftNativeFeatures = 'true';
    if (!main.querySelector('[data-sitecraft-yukina-features-title]')) {
      const heading = document.createElement('h2');
      heading.dataset.sitecraftYukinaFeaturesTitle = 'true';
      heading.textContent = '文章';
      main.prepend(heading);
    }

    // 桌面+移动两套菜单（#nav .menu 与 #mobile-menu-nav 抽屉）
    const navs = document.querySelectorAll('#nav .menu, #mobile-menu-nav, #menu .menu');
    navs.forEach((nav) => {
      Array.from(nav.querySelectorAll('a')).forEach((link) => {
        const text = (link.textContent || '').replace(/[·•]/g, '').trim().toLowerCase();
        if (text.includes('home')) {
          link.textContent = localizeValue(draft?.navigation?.home) || '首页';
          link.setAttribute('href', '#top');
          link.dataset.sitecraftSlot = 'navigation.home.zh';
        } else if (text.includes('about')) {
          link.textContent = localizeValue(draft?.navigation?.about) || '关于';
          link.setAttribute('href', '#about');
          link.dataset.sitecraftSlot = 'navigation.about.zh';
        } else if (text.includes('archive')) {
          link.textContent = localizeValue(draft?.navigation?.features) || '文章';
          link.setAttribute('href', '#features');
          link.dataset.sitecraftSlot = 'navigation.features.zh';
        } else if (/github|archive/i.test(text)) {
          link.remove();
        } else {
          link.remove();
        }
      });
    });
    // sidebar 分类/标签 demo（Categories/Examples/Tags/Markdown/Blogging 等）+ 阅读统计（Words/Minutes）
    document.querySelectorAll('.side-bar, aside').forEach((sb) => {
      sb.querySelectorAll('a').forEach((a) => {
        const t = (a.textContent || '').trim().toLowerCase();
        if (/category|tag|example|video|categories|tags|markdown|blogging|github|about/i.test(t)) a.remove();
      });
      sb.querySelectorAll('.desc, p').forEach((p) => {
        const t = (p.textContent || '').trim().toLowerCase();
        if (/markdown|blogging|powered|theme/i.test(t)) p.remove();
      });
    });
    // 文章卡 demo 分类标签（a.tag：Markdown/Blogging/Example/Video 等）与阅读统计（Words/Minutes）
    document.querySelectorAll('a.tag, .tag, li a').forEach((a) => {
      const t = (a.textContent || '').trim().toLowerCase();
      if (/markdown|blogging|example|video|category|tag|words|minutes/i.test(t) && !a.querySelector('img,svg')) {
        const li = a.closest('li');
        (li || a).remove();
      }
    });
    // 阅读统计（Words/Minutes）与 Powered By（demo 博客元数据）
    document.querySelectorAll('.reading-time').forEach((n) => {
      n.hidden = true;
      n.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('p, span, div, small').forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/Powered|Built with|Theme By/i.test(t) && !el.querySelector('img,svg')) {
        const holder = el.closest('div[class*="items-center"], footer');
        const target = holder && !/Powered/i.test(holder.textContent || '') ? holder : el;
        target.remove();
      }
    });
    document.querySelectorAll('a[href^="http"]').forEach((link) => link.remove());
    // hero 副题（h2.subtitle，非 p → 共享 findSubtitle 找不到）：直接改写为站点简介
    const heroSub = document.querySelector('.subtitle');
    const subText = localizeValue(draft?.hero?.subtitle) || localizeValue(draft?.content?.hero?.subtitle) || '';
    if (heroSub && subText) {
      heroSub.textContent = subText;
      heroSub.dataset.sitecraftSlot = 'hero.subtitle.zh';
    }
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());

    const footer = document.querySelector('footer');
    if (footer) {
      footer.querySelectorAll('a').forEach((link) => link.remove());
      const company = draft?.companyName || draft?.siteName || '';
      const line = footer.querySelector('p:first-child') || document.createElement('p');
      line.textContent = company;
      footer.append(line);
    }
  };
`;

const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const about = document.querySelector('[data-sitecraft-yukina-about]');
    const aboutBody = about?.querySelector('p');
    if (aboutBody) setText(aboutBody, localize(content.about?.body, locale), 'about.body.' + locale, applied);

    const featureHeading = document.querySelector('[data-sitecraft-yukina-features-title]');
    if (featureHeading) setText(featureHeading, localize(content.features?.title, locale), 'features.title.' + locale, applied);

    const main = document.querySelector('main.content, main');
    if (!main) return;
    const wrappers = Array.from(main.querySelectorAll('.onload-animation')).filter((wrapper) => wrapper.querySelector('.title') && wrapper.querySelector('.desc'));
    const items = Array.isArray(content.features?.items) ? content.features.items : [];
    wrappers.forEach((wrapper, index) => {
      const card = wrapper.querySelector(':scope > div') || wrapper;
      if (index >= items.length) {
        wrapper.hidden = true;
        wrapper.style.setProperty('display', 'none', 'important');
        return;
      }
      const item = items[index];
      const itemKey = item && typeof item.id === 'string' && item.id ? item.id : String(index);
      const title = card.querySelector('.title p') || card.querySelector('.title');
      const body = card.querySelector('.desc');
      card.querySelectorAll('.data').forEach((meta) => {
        meta.hidden = true;
        meta.style.setProperty('display', 'none', 'important');
      });
      if (title) setText(title, localize(item?.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body) setText(body, localize(item?.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftNativeFeaturesItem = 'true';
      card.dataset.sitecraftSection = 'features';
      card.dataset.sitecraftItemId = itemKey;
    });
  };
`;

export const yukinaAdapter: TemplateAdapter = {
  templateId: "yukina",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss: '#about,#features,#contact,main{opacity:1!important;visibility:visible!important}main .onload-animation{opacity:1!important;visibility:visible!important}',
};
