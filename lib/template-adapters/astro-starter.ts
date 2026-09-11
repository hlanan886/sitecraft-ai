import type { TemplateAdapter } from "./types.ts";

/**
 * astro-starter（= TAILCAST）专属适配 —— 企业官网形态。
 *
 * 原模板（Tailcast 深色 SaaS 落地页，vendor/open-source-templates/tailcast/dist/index.html）：
 *   main > nav#main-nav(品牌 + Home/About/Services/Blog/Careers/Contact + GitHub Source code)
 *   → #home hero(h1「One platform to track the full picture」+ eyebrow + 副文 + 双 Get Started/Live demo
 *     按钮 + 整宽 dashboard 产品大图 + shape divider)
 *   → #features 图文分栏 1「Unlike any tool…」(eyebrow block-subtitle + h2.block-big-title + intro p
 *     + ul>li.flex(勾 svg + span) 勾选列 · 右侧 feature1-4 图墙 2x2)
 *   → 分栏 2「Issue tracking…」(同构，图在左 feature5-6)
 *   → 分栏 3「Build & Launch…」(subtitle+h2+p+CTA+整幅 featuresdiagonal 图)
 *   → pricing(Beginner/Standard/Premium) → Trusted by brands(all over the world 换行) logo 条
 *   → Preview what's inside + 图廊 → Latest Insights 博客卡 → FAQ → Join 10,000+ teams CTA → footer
 *   (+ body 下 #invitation-modal 订阅 dialog)。
 *
 * 企业站编排（不建卡墙、demo 零残留）：
 *   #home hero          ← h1/副文/CTA（保留深色背景与 dashboard 截图）；hero CTA 重建为 #products 锚点。
 *   #features 分栏 1     ← features：大标题 + intro + 勾选列承载全部 features.items（原生仅 3 行，
 *                          多余条目克隆同构 li 行补齐，仍是原生「勾 + 短句」排版而非卡片墙）。
 *   "Issue tracking" 分栏 2 ← services：大标题 + intro + 勾选列承载 services.items，原生行多于条目隐藏。
 *   "Build & Launch" 分栏 3 & pricing/logo/Preview/blog/FAQ/CTA ← 整节隐藏，demo 零残留。
 *   products/about/contact ← 由共享引擎 generated（带图产品卡 / 简介 / 联系），adapter 用 designTokenCss
 *                          把它们统一到模板深色底（html bg-bgDark2 #1e1f23），卡片底 #28292e。
 *
 * 机制对齐 foxi/landwind/moon：prepareFn 删 demo section / 重建导航与 footer / 打原生区标记；
 * nativeFillFn 用共享 setText 把条目写进原生勾选列 li>span，打上 data-sitecraft-slot 后由共享
 * hasVisibleSlotPrefix 短路通用卡墙。导航锚点重建；hero 视觉无 demo 按钮。
 *
 * 注：模板配色用 CSS 变量（--color-bgDark1:#17181b / bgDark2:#1e1f23 / bgDark3:#28292e /
 * secondaryText:#aeb2b7 / secondaryColor:#a1a3f7），生成区与标题颜色必须显式收敛。
 */
const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const navCopy = draft?.navigation || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || '新能源企业';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';
    const main = document.querySelector('main') || document.body;
    const hideSec = (s) => { if (s) { s.hidden = true; s.style.setProperty('display', 'none', 'important'); } };

    // 1) 删 SaaS demo section（整节隐藏，供共享 sectionScopes/scopeBy 忽略）。
    // 分栏 3 Build&Launch / pricing / logo 条 / Preview / 图廊 / blog / FAQ / Join teams CTA 全删。
    allVisible('h1,h2,h3').forEach((heading) => {
      const t = (heading.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/^(Build & Launch without problems|Choose your best plan|Trusted by brands|all over the world|Preview what.s inside|Latest Insights|Frequently Asked Questions|Join 10,000. teams who trust Tailcast)$/i.test(t)) {
        hideSec(heading.closest('section'));
      }
    });
    // Preview 的图廊是无标题但 ≥6 张图的 section（20 img），也删。
    Array.from(main.querySelectorAll('section')).forEach((sec) => {
      if (sec.hidden) return;
      if (!sec.querySelector('h1,h2,h3') && sec.querySelectorAll('img').length >= 6) hideSec(sec);
    });
    // 订阅弹窗 dialog（Subscribe Now / Winter is coming / Join 3,953）与 hero CTA 的 data-open-modal 一起清。
    document.querySelectorAll('dialog, #invitation-modal, [data-open-modal]').forEach((n) => n.remove());

    // 2) 导航重建：品牌 → 企业名；Home/About/Services/Blog/Careers/Contact → 5 企业锚点；删 GitHub 源链接。
    const nav = document.getElementById('main-nav') || document.querySelector('nav');
    if (nav) {
      const brandLink = nav.querySelector('a[href^="/#home"], a[href*="#home"]');
      if (brandLink) {
        const textEl = Array.from(brandLink.querySelectorAll('div')).find((d) => {
          const c = String(d.className || '');
          return /font-\\[Inter\\]/.test(c) || (/text-xl/.test(c) && !d.querySelector('svg,img'));
        });
        if (textEl && !textEl.querySelector('svg,img') && !textEl.dataset.sitecraftBrand) {
          textEl.dataset.sitecraftBrand = 'true';
          textEl.textContent = brandName;
          textEl.dataset.sitecraftSlot = 'companyName.zh';
        }
      }
      nav.querySelectorAll('a[href*="github.com"], a[aria-label*="Source code"]').forEach((a) => a.remove());
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [localize(navCopy.about) || '关于我们', localize(navCopy.features) || '产品方案', localize(navCopy.products) || '产品中心', localize(navCopy.services) || '服务支持', localize(navCopy.contact) || '联系我们'];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      const applyNavSet = (anchors) => {
        const list = anchors.filter((a) => !/github/i.test(a.getAttribute('href') || ''));
        list.slice(0, navKeys.length).forEach((a, index) => {
          a.textContent = labels[index];
          a.setAttribute('href', targets[index]);
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[index] + '.zh';
          a.removeAttribute('aria-current');
        });
        list.slice(navKeys.length).forEach((a) => a.remove());
      };
      // 桌面链接容器（hidden h-full pl-12 lg:flex）
      const deskBox = Array.from(nav.querySelectorAll('div')).find((d) => {
        const c = String(d.className || '');
        return c.indexOf('pl-12') >= 0 && c.indexOf('lg:flex') >= 0;
      });
      if (deskBox) applyNavSet(Array.from(deskBox.querySelectorAll('a')));
      const mobileMenu = document.getElementById('mobile-menu');
      if (mobileMenu) applyNavSet(Array.from(mobileMenu.querySelectorAll('a')));
    }

    // 3) hero：#home h1/副文/CTA 交给共享槽位改写。先隐藏英文 eyebrow；把两个 demo 弹窗按钮
    //    (Get Started / Live demo) 收敛为单个 #products 锚点（打 hero.cta 槽，文本由共享注入）。
    const hero = document.getElementById('home');
    if (hero) {
      hero.querySelectorAll('.block-subtitle').forEach((eb) => eb.style.setProperty('display', 'none', 'important'));
      const ctaBox = Array.from(hero.querySelectorAll('div')).find((d) => {
        const c = String(d.className || '');
        return c.indexOf('flex-col') >= 0 && c.indexOf('gap-') >= 0 && d.querySelector('button');
      });
      if (ctaBox) {
        ctaBox.querySelectorAll('button').forEach((b) => b.remove());
        if (!ctaBox.querySelector('[data-sitecraft-hero-cta]')) {
          const a = document.createElement('a');
          a.dataset.sitecraftHeroCta = 'true';
          a.className = 'contained-button mr-0 mb-2 flex h-12 w-72 items-center justify-center text-sm transition-all duration-300 sm:mr-2 sm:mb-0 sm:w-44';
          a.setAttribute('href', '#products');
          a.dataset.sitecraftSlot = 'hero.cta.zh';
          ctaBox.append(a);
        }
      }
    }

    // 4) 原生分栏定位/标记：分栏 1 = #features（features）；分栏 2（紧随其后，无 id）→ services。
    //    eyebrow 结构位文案清为中文小眉题，避免 demo 眉题残留。
    const featuresSec = document.getElementById('features');
    if (featuresSec) {
      const eb = featuresSec.querySelector('.block-subtitle');
      if (eb) eb.textContent = '核心优势';
    }
    const servicesSec = featuresSec ? featuresSec.nextElementSibling : null;
    if (servicesSec && servicesSec.tagName === 'SECTION') {
      servicesSec.id = 'services';
      servicesSec.dataset.sitecraftScope = 'services';
      const eb = servicesSec.querySelector('.block-subtitle');
      if (eb) eb.textContent = '服务体系';
    }

    // 5) footer：清 demo 列/品牌/外链，重建企业联系。
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      footer.style.cssText = 'background:#17181b;padding:2.2rem clamp(1rem,4vw,3rem)';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem 1.4rem;text-align:center;font-size:.9rem;color:#aeb2b7';
      const parts = ['<span style="color:#f3f4f6;font-weight:700">' + brandName + '</span>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#a1a3f7;text-decoration:none">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#a1a3f7;text-decoration:none">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.85">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 6) 通用清理：srcset / 外链文案锚 / meta。
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('a[href^="http"], a[href^="//"]').forEach((a) => a.remove());
    document.querySelectorAll('link[rel="canonical"], link[href^="https://"], link[href^="http://"]').forEach((node) => node.remove());
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 features/services.items 写进两块原生图文分栏的勾选列（ul>li>span），title 落到 span。
// 大标题/眉题/intro 由共享引擎经 scopeBy(features/services) 已写入，这里只处理条目与多余行隐藏，
// 并克隆同构 li 补足 features 超出原生 3 行的条目，仍保持原生「勾 + 短句」排版，不建卡墙。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const features = content.features || {};
    const services = content.services || {};
    const featureItems = Array.isArray(features.items) ? features.items : [];
    const serviceItems = Array.isArray(services.items) ? services.items : [];
    const fillSplit = (sec, items, slotKey, dataTitle, dataIntro) => {
      if (!sec) return;
      const hasData = Boolean(dataTitle) || Boolean(dataIntro) || items.length > 0;
      if (!hasData) {
        sec.hidden = true;
        sec.style.setProperty('display', 'none', 'important');
        return;
      }
      sec.dataset.sitecraftNativeFeatures = 'true';
      sec.dataset.sitecraftSection = slotKey;
      const ul = sec.querySelector('ul');
      if (!ul) return;
      const nativeLis = Array.from(ul.querySelectorAll('li'));
      if (!nativeLis.length) return;
      const lis = nativeLis.slice();
      // 条目多于原生 li 时克隆同构 li（保留勾 svg），补齐剩余条目
      if (items.length > nativeLis.length) {
        const template = nativeLis[0];
        for (let k = nativeLis.length; k < items.length; k += 1) {
          const li = template.cloneNode(true);
          li.removeAttribute('data-sitecraft-slot');
          li.removeAttribute('data-sitecraft-native-features-item');
          const sp = li.querySelector('span');
          if (sp) sp.textContent = '';
          ul.append(li);
          lis.push(li);
        }
      }
      // 原生行多于条目：隐藏多余 demo li
      lis.slice(items.length).forEach((li) => {
        li.hidden = true;
        li.style.setProperty('display', 'none', 'important');
        li.setAttribute('aria-hidden', 'true');
      });
      lis.slice(0, items.length).forEach((li, index) => {
        const item = items[index];
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        const span = li.querySelector('span');
        if (span && item && item.title) setText(span, localize(item.title, locale), slotKey + '.items.' + itemKey + '.title.' + locale, applied);
        li.dataset.sitecraftSection = slotKey;
        li.dataset.sitecraftNativeFeaturesItem = itemKey;
      });
    };
    const featuresSec = document.getElementById('features');
    const servicesSec = document.getElementById('services') || document.querySelector('section[data-sitecraft-scope="services"]');
    fillSplit(featuresSec, featureItems, 'features', features.title, features.intro);
    fillSplit(servicesSec, serviceItems, 'services', services.title, services.intro);
  };
`;

const designTokenCss =
  // 生成区（products/about/contact）收敛到模板深色底，避免默认黑字黑底不可见
  '[data-sitecraft-generated-content],[data-sitecraft-generated-products]{background:#1e1f23!important;color:#d6d8dd!important}' +
  '[data-sitecraft-generated-content="contact"]{background:#17181b!important}' +
  '[data-sitecraft-generated-content] h2,[data-sitecraft-generated-products] h2{color:#ffffff!important}' +
  '[data-sitecraft-generated-content] h3,[data-sitecraft-generated-products] h3{color:#ffffff!important}' +
  '[data-sitecraft-generated-content] p,[data-sitecraft-generated-products] p{color:#b6bac2!important}' +
  '[data-sitecraft-generated-content] a,[data-sitecraft-generated-products] a{color:#a1a3f7!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#28292e!important;border:1px solid rgba(255,255,255,.14)!important}' +
  '[data-sitecraft-generated-products] small{color:#8b8f98!important}' +
  // 产品 6 卡在浅/深色下固定 3 列成 2 行，避免 auto-fit 出现 5+1 失衡
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
  '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
  '@media(max-width:640px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
  // hero h1 内层 heroText 高亮 span 被 setText 整体替换后需要补色
  '#home h1{color:#e6e6e6!important}' +
  // 首屏进场动画兜底：dashboard 容器原生内联 opacity:0.005 + .hero-fade-in 靠 JS/滚动触发，
  // 无交互时首屏会整块近黑不可见 → 强制内容恒不透明
  '#home .hero-fade-in,#home .image-glow-border,#home img{opacity:1!important;transform:none!important;animation:none!important}' +
  'a[href="#products"],a[href="#top"]{cursor:pointer}';

export const astroStarterAdapter: TemplateAdapter = {
  templateId: "astro-starter",
  prepareFn,
  nativeFillFn,
  designTokenCss,
};
