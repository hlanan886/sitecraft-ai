import type { TemplateAdapter } from "./types.ts";

/**
 * forge（SMALL BIS / small-bis）专属适配 —— 小而美的本地企业首页。
 *
 * 结构（已核实 vendor/open-source-templates/small-bis/dist/index.html）：
 *   header(fixed-nav：桌面 LOGO + Home/About/Services/Reviews/Contact/FAQ + 主题钮；移动 ☰) →
 *   hero(main>section 首个：整宽 heroimg 背景 + h1 "Main Keywords" + h2 "brief description"，无原生按钮) →
 *   图文分栏 A(work1.jpg + 正文 lorem + "A List If Needed" + ul part1-4 + pushable→/Services) →
 *   图文分栏 B(work2.jpg + lorem 正文 + pushable→/Services) →
 *   服务卡带(mx-auto mt-60 + 3 张 .h-96 深色卡，p.text-4xl 标题 + p.text-lg 正文) →
 *   astro-island FAQ(#FAQ 手风琴，答案在 SSR 为空) → 主内容结束 → 页面底部
 *   CTA(body>section：CTAbg 背景图 + "Suggest Confidence..." + pushable→/Contact) → footer。
 * 主战场在 /Services 子页，首页信息薄：本轮企业编排把首页收敛为
 * hero(标题/副文/注入 CTA) + 分栏 A(features 列表) + 分栏 B(about) + 服务卡带 + CTA(contact band)
 * + 生成产品区，删 FAQ(无 draft FAQ 数据) 与全部 demo 英文。
 *
 * 共享引擎注入同一 IIFE 闭包，可访问 allVisible/setText/localize/sectionScopes/activeDraft。
 * 不修改 vendor 源码，全部经注入层 DOM/CSS 完成。
 *
 * 本文件函数：
 *  1. heroFn —— 首屏标题定位器：h1[data-testid=hero-text]（默认 findHero 会先命中 header LOGO）。
 *  2. prepareFn —— 删 demo、重建导航/页脚、打业务区 id/scope、FAQ 移除、CTA 改建为企业联系带。
 *  3. nativeFillFn —— features.items 标题逐条写入分栏 A 的 ul（原生无卡正文位，故仅标题）。
 *  4. servicesFn —— 保留：原生 .h-96 深色服务卡区改写（已有，避免通用 scopeBy 误判）。
 *  5. designTokenCss / sanitize —— 保留并补 contact band 可读性覆盖。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('[data-testid="hero-text"], main > section h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const content = (draft && draft.content) || {};
    const contact = content.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || '本地企业';
    const shortBrand = (brandName.replace(/\\([^)]*\\)/g, '').replace(/^.*?市/, '').replace(/(有限公司|有限责任公司|公司|集团)$/, '')) || brandName;
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';
    const navCopy = draft?.navigation || {};
    const navLabel = (key) => localize(navCopy[key]) || { about: '关于我们', features: '核心优势', services: '服务支持', products: '产品中心', contact: '联系我们' }[key] || '';

    // ---- 1. 品牌文本（桌面 LOGO h1 + 移动 Logo p）+ 锚点样式 ----
    document.querySelectorAll('header a[href="/"] h1, header a[href="/"] p').forEach(function (t) { t.textContent = shortBrand; });
    const brandAnchor = document.querySelector('header a[href="/"]');
    if (brandAnchor) brandAnchor.style.cssText = 'font-weight:800;letter-spacing:.04em;font-size:1.12rem;white-space:nowrap;text-decoration:none';

    // ---- 2. 桌面导航重建为 5 个企业锚点；清主题钮与移动端 ☰（含 Radix demo） ----
    const desktopNav = Array.from(document.querySelectorAll('header nav')).filter(function (n) { return !(n.closest && n.closest('[class*="md:hidden"]')); })[0];
    if (desktopNav) {
      const ul = desktopNav.querySelector('ul');
      if (ul) {
        ul.innerHTML = '';
        const keys = ['about', 'features', 'products', 'services', 'contact'];
        const targets = ['#about', '#features', '#products', '#services', '#contact'];
        keys.forEach(function (k, i) {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.textContent = navLabel(k);
          a.dataset.sitecraftSlot = 'navigation.' + k + '.zh';
          a.style.cssText = 'color:inherit;text-decoration:none;font-weight:600';
          li.append(a);
          ul.append(li);
        });
      }
    }
    document.querySelectorAll('header button').forEach(function (b) { b.remove(); });

    // ---- 3. hero：深色大字标题/副文保留；副文(h2)标记 subtitle 槽；注入主 CTA → #contact ----
    const heroSection = document.querySelector('main > section');
    if (heroSection && !heroSection.dataset.sitecraftScope) {
      heroSection.id = 'top';
      const sub = heroSection.querySelector('h2');
      if (sub && !sub.dataset.sitecraftSlot) sub.dataset.sitecraftSlot = 'hero.subtitle.zh';
      if (!heroSection.querySelector('[data-sitecraft-hero-cta]')) {
        const holder = heroSection.querySelector('div[class*="justify-center"], .flex.h-full') || heroSection;
        const ctaLink = document.createElement('a');
        ctaLink.dataset.sitecraftHeroCta = 'true';
        ctaLink.dataset.sitecraftSlot = 'hero.cta.zh';
        ctaLink.setAttribute('href', '#contact');
        ctaLink.textContent = navLabel('contact');
        ctaLink.style.cssText = 'display:inline-flex;align-items:center;margin-top:1.6rem;padding:.85rem 1.7rem;border-radius:9999px;background:var(--sitecraft-primary,#6d28d9);color:#fff;font-weight:700;font-size:1.02rem;text-decoration:none;box-shadow:0 10px 24px rgba(0,0,0,.3)';
        holder.append(ctaLink);
      }
    }

    // ---- 4. 图文分栏 A(features) / B(about)：清 demo 覆盖层、列表标签、pushable，加标题槽 ----
    const mainSections = Array.from(document.querySelectorAll('main > section'));
    const cleanupSplit = (sec) => {
      if (!sec) return;
      const textCol = Array.from(sec.children).find((d) => d.querySelector('p')) || sec;
      const overlay = Array.from(sec.querySelectorAll('div')).find((d) => /opacity-0/.test(d.className || '') && d.querySelector('span'));
      if (overlay) overlay.remove();
      const label = Array.from(textCol.querySelectorAll('p')).find((p) => /A List If Needed/i.test(p.textContent || ''));
      if (label) label.remove();
      const btn = sec.querySelector('.pushable');
      if (btn) btn.remove();
      if (!textCol.querySelector('h2')) {
        const h2 = document.createElement('h2');
        h2.style.cssText = 'margin:0 0 .4rem;font-size:clamp(26px,3vw,38px);font-weight:800;line-height:1.2;text-align:center';
        textCol.insertBefore(h2, textCol.firstChild);
      }
    };
    const featuresSplit = mainSections.find((s) => s.querySelector('img[src*="work1"]'));
    const aboutSplit = mainSections.find((s) => s.querySelector('img[src*="work2"]'));
    cleanupSplit(featuresSplit);
    cleanupSplit(aboutSplit);
    if (featuresSplit) { featuresSplit.id = 'features'; featuresSplit.dataset.sitecraftScope = 'features'; featuresSplit.dataset.sitecraftNativeFeatures = 'true'; }
    if (aboutSplit) { aboutSplit.id = 'about'; aboutSplit.dataset.sitecraftScope = 'about'; }
    const servicesSection = Array.from(mainSections).find((s) => s.querySelector('.h-96'));
    if (servicesSection && !servicesSection.id) servicesSection.id = 'services';

    // ---- 5. FAQ（astro-island #FAQ）：draft 无 FAQ 数据 → 整区移除 ----
    const faq = document.querySelector('#FAQ');
    if (faq) { const island = faq.closest('astro-island') || faq.parentElement || faq; island.remove(); }

    // ---- 6. CTA(body>section) 改建为企业联系带：id=contact，标题/正文由共享引擎写入，
    //         email/phone/address 由引擎挂到 data-sitecraft-contact-details ----
    // ⚠️ **保留原生 class**（2026-09-14，T-21 机制 b）：
    //     原生 CTA 的 class 含 bg-[url(/CTAbg.jpg)] bg-cover，是这张 1.33MB 背景大图
    //     的**唯一来源**。此前 removeAttribute(class) + 纯渐变把它整段抹掉，
    //     用户看到的就是「只剩渐变底、背景图消失」。
    //     现在保留 class、只把 background **简写**换成不透明深色封顶（连同
    //     background-clip/origin 一起重置，防 bg-cover 的 background-size 参与重复平铺），
    //     压在原图之上，形成「深色遮罩 + 品牌背景」。
    const cta = document.querySelector('body > section');
    if (cta && !cta.dataset.sitecraftContactBuilt) {
      cta.dataset.sitecraftContactBuilt = 'true';
      cta.id = 'contact';
      cta.dataset.sitecraftScope = 'contact';
      cta.style.boxSizing = 'border-box';
      cta.style.display = 'flex';
      cta.style.flexDirection = 'column';
      cta.style.alignItems = 'center';
      cta.style.justifyContent = 'center';
      cta.style.height = 'auto';
      cta.style.minHeight = '0';
      cta.style.textAlign = 'center';
      cta.style.color = '#f8fafc';
      cta.style.padding = 'clamp(60px,7vw,96px) clamp(20px,7vw,48px)';
      /* 深色遮罩用**子节点叠层**实现，绝不碰 background 系列属性——
       * 与 vendor 原生的 <div class="bg-black bg-opacity-30"> 同思路。
       * ⚠️ 这里连 backgroundImage:none 都不写：那会清掉 class 指定的背景图。
       * 背景图本身的落地挂在共享层 repairUncompiledBackgroundClasses()——
       * 因为 vendor 的 dist **根本没编译出** bg-[url(...)] 的 CSS 规则（T-28）。 */
      cta.replaceChildren();
      cta.style.position = 'relative';
      cta.style.overflow = 'hidden';
      const overlay = document.createElement('div');
      overlay.setAttribute('data-sitecraft-contact-overlay', 'true');
      overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(150deg,rgba(16,22,42,.88) 0%,rgba(28,31,74,.82) 100%);pointer-events:none';
      cta.append(overlay);
      const box = document.createElement('div');
      box.style.cssText = 'position:relative;z-index:1;width:100%;max-width:720px;display:flex;flex-direction:column;align-items:center;gap:1.1rem';
      const h1 = document.createElement('h1');
      h1.style.cssText = 'margin:0;font-size:clamp(30px,4.5vw,52px);font-weight:800;line-height:1.15';
      const p = document.createElement('p');
      p.style.cssText = 'margin:0;max-width:640px;font-size:1.06rem;line-height:1.75;opacity:.9';
      box.append(h1, p);
      const telHref = contactPhone ? 'tel:' + contactPhone.replace(/\\s+/g, '') : '';
      const mailHref = contactEmail ? 'mailto:' + contactEmail : '';
      const action = document.createElement('a');
      action.textContent = navLabel('contact');
      action.setAttribute('href', telHref || mailHref || '#contact');
      action.style.cssText = 'display:inline-flex;margin-top:.5rem;padding:.9rem 2.1rem;border-radius:9999px;background:var(--sitecraft-primary,#6d28d9);color:#fff;font-weight:700;text-decoration:none';
      box.append(action);
      cta.append(box);
    }

    // ---- 7. footer：清 demo 列，重建企业联系（品牌 + 邮箱 + 电话 + 地址） ----
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.45rem 1.3rem;justify-content:center;align-items:center;padding:2.1rem 1rem;font-size:.95rem';
      const parts = ['<strong style="font-weight:700">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:inherit;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:inherit;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.72">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // ---- 8. 通用清理 ----
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 draft.features.items 标题逐条写入分栏 A 的 ul（分栏原生没有卡正文位，
// 故每项只落 features.title 到 li；正文省略——这是该模板不堆卡墙的取舍，与 landwind 勾选列一致）。
// 标题写入后带上 features.items 前缀 slot，使共享引擎短路，不再回退通用卡片墙 / generated features。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = (draft.content && draft.content.features) || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const split = document.getElementById('features');
    if (!split) return;
    const textCol = Array.from(split.children).find((d) => d.querySelector('p')) || split;
    let ul = textCol.querySelector('ul');
    if (!items.length) { if (ul) ul.hidden = true; return; }
    if (!ul) {
      ul = document.createElement('ul');
      ul.style.cssText = 'display:flex;flex-direction:column;gap:.4rem;list-style:disc;padding-left:1.2rem;align-items:flex-start';
      textCol.append(ul);
    }
    ul.hidden = false;
    ul.innerHTML = '';
    items.forEach((item, index) => {
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const li = document.createElement('li');
      li.style.cssText = 'text-align:left';
      const label = document.createElement('span');
      if (item && item.title) setText(label, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      li.append(label);
      ul.append(li);
    });
  };
`;

const servicesFn = `
  const applyNativeServiceCards = (draft, locale, applied) => {
    const items = draft.content?.services?.items;
    if (!items?.length) return;
    const section = sectionScopes().find((scope) =>
      scope.classList?.contains('mx-auto') && /mt-60/.test(scope.className || '') && scope.querySelector('.h-96'));
    if (!section) return;
    const cards = Array.from(section.querySelectorAll('.h-96'));
    const visibleCount = Math.min(cards.length, items.length);
    // 隐藏超出 SiteDraft 项数的原生演示卡（如只有 2 项服务时第 3 张 "Services" dummy 卡不应残留）。
    cards.slice(visibleCount).forEach((card) => {
      card.style.setProperty('display', 'none', 'important');
      card.setAttribute('aria-hidden', 'true');
    });
    cards.slice(0, visibleCount).forEach((card, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      card.dataset.sitecraftSection = 'services';
      card.dataset.sitecraftItemId = itemKey;
      card.style.removeProperty('display');
      card.removeAttribute('aria-hidden');
      const titleNode = allVisible('p[class*="text-4xl"]', card)[0];
      const bodyNode = allVisible('p[class*="text-lg"]', card)[0];
      setText(titleNode, localize(item.title, locale), 'services.items.' + itemKey + '.title.' + locale, applied);
      setText(bodyNode, localize(item.body, locale), 'services.items.' + itemKey + '.body.' + locale, applied);
    });
    if (cards.length < items.length) {
      // SiteDraft 服务项多于原生卡位：补生成多余项，避免静默丢内容。
      const extra = items.slice(cards.length);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:16px;margin-top:16px;width:100%';
      extra.forEach((item, extraIndex) => {
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(cards.length + extraIndex);
        const card = document.createElement('article');
        card.style.cssText = 'min-width:0;padding:20px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:rgba(255,255,255,.05)';
        card.dataset.sitecraftSection = 'services';
        card.dataset.sitecraftItemId = itemKey;
        const t = document.createElement('p'); t.className = 'text-4xl'; t.style.cssText = 'margin:0 0 8px;font-weight:700;color:inherit';
        const b = document.createElement('p'); b.className = 'text-lg'; b.style.cssText = 'margin:0;opacity:.85;line-height:1.6;color:inherit';
        setText(t, localize(item.title, locale), 'services.items.' + itemKey + '.title.' + locale, applied);
        setText(b, localize(item.body, locale), 'services.items.' + itemKey + '.body.' + locale, applied);
        card.append(t, b);
        grid.append(card);
      });
      section.append(grid);
    }
  };
`;

const designTokenCss =
  'h1,h2,h3{color:var(--sitecraft-primary)!important}' +
  'button,a[class*="btn"],a[class*="button"]{background-color:var(--sitecraft-primary)!important;color:#fff!important}' +
  '[class*="card"],article{border-color:color-mix(in srgb,var(--sitecraft-primary) 22%,transparent)!important}' +
  // 首屏大字压在整宽背景图上，保持白色+投影可读（designToken 主色可能偏深）
  '[data-testid="hero-text"],[data-testid="intro-text"]{color:#fff!important}' +
  // 模板自带的 hero 区是 `relative z-[-10]`，会被 <main> 的绘制层盖住：
  // 视觉上背景图能看见，但 elementFromPoint 命中 <main>，导致**用户点不到 hero 里的标题**
  // （2026-09-09 实测，P3.1 就地编辑因此完全失效）。抬到 0 层不影响观感。
  'main > section.relative.z-\\[-10\\]{z-index:0!important}' +
  // 联系带（深色渐变）：标题/正文/明细保持浅色，联系方式可点
  '#contact h1,#contact p,#contact address,#contact [data-sitecraft-contact-details]{color:#f8fafc!important}' +
  '#contact [data-sitecraft-contact-details]{justify-items:center;color:#f8fafc!important}' +
  '#contact [data-sitecraft-contact-details] a{color:#fff!important;text-decoration:underline}' +
  '#contact address{font-style:normal}' +
  // 生成产品区：浅色模板上给白底卡边框，明确分隔
  '[data-sitecraft-generated-products] article{background:#fff;border:1px solid #e5e7eb}' +
  '[data-sitecraft-generated-products],[data-sitecraft-generated-content]{background:#f3f4f6}';

const sanitize: TemplateAdapter["sanitize"] = {
  sections: ["Frequently Asked Questions", "Suggest Confidence"],
  leafPatterns: [
    "A List If Needed",
    "part [1-4]",
    "One or two sentences about what your company offers[.]",
    "brief description of services",
    "Name of this service",
    "Lorem ipsum",
    "About Our Services",
    "Get A Free Estimate",
    "Suggest Confidence In Your Company",
  ],
};

export const forgeAdapter: TemplateAdapter = {
  templateId: "forge",
  prepareFn,
  heroFn,
  nativeFillFn,
  servicesFn,
  designTokenCss,
  sanitize,
};
