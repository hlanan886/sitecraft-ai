import type { TemplateAdapter } from "./types.ts";

/**
 * signal（RICOFAST / ricofast，SaaS 科技浅色模板）专属适配 —— 企业官网形态。
 *
 * 原模板(vendor/open-source-templates/ricofast/dist/index.html)结构(已核)：
 *   header#header(fixed：logo + GitHub CTA + 下拉 Pages(demo) + 深浅色切换 + 移动端汉堡菜单)
 *   → body 直系 hero 块(无 <section> 包裹：两枚 badge + h1 + subtitle(animated-text 拆词) +
 *     GitHub/Twitter 双按钮 + 右侧 SaaS dashboard mock) →
 *   logo 条("Drop in your customer logos" 6 个假 logo) → "wrong problems" 3 插图卡 →
 *   "A design system" 居中标题 + 漂浮文件夹 → (虚线分隔) → "Everything you need" 6 图标/插画卡
 *   (features 承载：双层 div + img/h3/p，lg:grid-cols-3) → "A full layout system" 分栏 dashboard mock →
 *   "Made for different kinds of SaaS" 6 竖卡 → (分隔) → "Built with modern tools" 技术 logo 堆 →
 *   pricing 3 卡(月/年切换) → FAQ accordion → "Latest articles" blog 卡 → 收尾 CTA → footer(section)。
 *
 * 标题/副文多为 .animated-text > span.word（行内 opacity:0 + JS 逐词动画）。setText 会把文本直写
 * 容器（清掉 span），但会丢掉原本落在 .animated-text 上的字号/字色类。因此 prepareFn 先把 hero h1
 * 的样式类搬到 h1、副文替换为干净 <p>；其余 demo 标题随所在 section 整块删除。
 *
 * 企业站编排：
 *   hero     ← 引擎改写标题/副文/CTA（prepare 清 badge/拆词/右侧 dashboard mock/GitHub/Twitter 按钮）
 *   features ← 保留 "Everything you need" 6 图标卡区，nativeFill 逐条写 items(高效组件/EPC/逆变/
 *              储能/支架/运维 6 条正好)；图标保留；slot 前缀短路通用卡墙。
 *   about/services/products/contact ← 共享引擎 generated（产品带图 6 卡，华曜/鑫力同款）。
 *   header 品牌 → 企业名 + 5 中文锚点；原 footer(section) 换成真正 <footer>（引擎据此把生成区
 *   插到它前面），再重建企业联系。
 * 转义铁律: adapter 源码字符串禁反引号禁 ${；含冒号(:) 类名不用 CSS 选择器, 一律 className contains
 * 或 :scope 直子匹配。明亮浅色模板, 生成区统一浅色面板。
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || '新能源';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';

    // ---- features section：唯一保留的原生业务资产（优先按已有 scope 定位，避免 locale 切换后标题变中文找不到）----
    let featuresSec = document.querySelector('section[data-sitecraft-scope="features"]');
    if (!featuresSec) {
      featuresSec = Array.from(document.querySelectorAll('section')).find((sec) => {
        const head = (sec.querySelector('h2')?.textContent || '').replace(/\\s+/g, ' ').trim();
        return /Everything you need/i.test(head);
      }) || null;
    }
    if (featuresSec) {
      featuresSec.dataset.sitecraftScope = 'features';
      featuresSec.dataset.sitecraftSection = 'features';
      featuresSec.id = 'features';
      // 标题下 demo 副文(.animated-text 拆词 div)替换为干净 <p data-sitecraft-intro>，
      // 供共享引擎 features.intro 写入中文简介(引擎取该区第一个可见 p)
      const h2 = featuresSec.querySelector('h2');
      if (h2 && h2.parentElement) {
        const hasIntro = Array.from(h2.parentElement.children).some((n) => n.tagName === 'P' && n.dataset && n.dataset.sitecraftIntro);
        const demoIntro = Array.from(h2.parentElement.children).find((n) => n.tagName === 'DIV' && n.querySelector('.animated-text'));
        if (demoIntro && !hasIntro) {
          const p = document.createElement('p');
          p.dataset.sitecraftIntro = 'true';
          p.dataset.sitecraftSlot = 'features.intro.zh';
          p.className = 'mt-3 text-sm leading-7 sm:text-base text-neutral-600 dark:text-neutral-300 max-w-2xl mx-auto';
          p.textContent = ' ';
          demoIntro.replaceWith(p);
        }
      }
    }

    // ---- 先删除 demo 大区, 拿到最后的原 footer 前先做特征收集, 便于结构定位 ----
    // 收集所有 body>section 快照；原 footer 是其中最后一个（模板以 footer section 收尾）
    const bodySections = Array.from(document.querySelectorAll('body > section'));
    const isFooterLike = (sec) => /\\btext-gray-700\\b/.test(sec.className || '') && /border-t/.test(sec.className || '');
    const originalFooter = bodySections[bodySections.length - 1];
    const footerCandidate = (originalFooter && isFooterLike(originalFooter)) ? originalFooter : null;
    // 其余 demo section 全部摘除（只留 features + 原 footer）
    bodySections.forEach((sec) => {
      if (sec === featuresSec || sec === footerCandidate) return;
      const head = ((sec.querySelector('h2,h3,h4')?.textContent || '') + ' ' + (sec.textContent || '').slice(0, 200)).replace(/\\s+/g, ' ').trim();
      if (/wrong problems|design system, not just a template|everything you need|full layout system|made for different|built with modern tools|free template, real pricing|frequently asked|customer logos|start building your saas/i.test(head)) sec.remove();
    });
    // blog 卡块是 body>div 内嵌 section：摘掉含 "Latest articles" 的 body 直系 div
    Array.from(document.body.children).forEach((el) => {
      if (el.tagName !== 'DIV') return;
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (/latest articles/i.test(t) && !el.querySelector('h1')) el.remove();
    });
    // 虚线分隔条(body 直系, 纯装饰)删除
    Array.from(document.body.children).forEach((el) => {
      if (el.tagName === 'DIV' && /border-dashed/.test(el.className || '') && !el.id) el.remove();
    });

    // ---- header：品牌替换 + 导航 5 锚点 + 删 demo 操作项 ----
    const header = document.getElementById('header');
    if (header) {
      const brandLink = header.querySelector('a[href="/"]');
      if (brandLink) {
        brandLink.innerHTML = '';
        brandLink.setAttribute('href', '#top');
        brandLink.style.cssText = 'display:flex;align-items:center;text-decoration:none;white-space:nowrap;aspect-ratio:auto';
        const span = document.createElement('span');
        span.dataset.sitecraftBrand = 'true';
        span.textContent = brandName;
        span.style.cssText = 'font-weight:700;font-size:1.02rem;letter-spacing:.01em;color:var(--sitecraft-primary,#4f46e5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(52vw,16em)';
        brandLink.append(span);
      }
      // 桌面 GitHub CTA / 深浅色切换 / 移动端主题切换：全部删除
      header.querySelectorAll('a[href*="github.com"], #darkToggle, #darkToggleMobile').forEach((n) => n.remove());
      // 导航：清掉 demo 列表(Home/Pages 下拉/Elements/Contact/GitHub)，重建 5 个企业锚点
      const menuEl = document.getElementById('menu');
      if (menuEl) {
        menuEl.innerHTML = '';
        const navCopy = draft?.navigation || {};
        const labelOf = (k, fb) => localize(navCopy[k]) || fb;
        const navKeys = ['about', 'features', 'products', 'services', 'contact'];
        const labels = [
          labelOf('about', '关于我们'), labelOf('features', '产品方案'),
          labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们'),
        ];
        const targets = ['#about', '#features', '#products', '#services', '#contact'];
        labels.forEach((label, i) => {
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.className = 'px-3 py-3 sm:py-2 sm:px-4 font-medium tracking-wide rounded-lg text-neutral-700 dark:text-neutral-200 hover:text-primary dark:hover:text-neutral-100 whitespace-nowrap';
          a.textContent = label;
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          menuEl.append(a);
        });
      }
    }

    // ---- hero 块(body 直系 div.site-container)：清 badge/拆词/右侧 mock/双按钮 ----
    const heroBox = Array.from(document.body.children).find((el) => el.tagName === 'DIV' && /site-container/.test(el.className || '') && el.querySelector('h1'));
    if (heroBox && !heroBox.dataset.sitecraftHeroDone) {
      heroBox.dataset.sitecraftHeroDone = 'true';
      heroBox.id = 'top';
      // 1) 徽章 pill("Open-source" / "Astro + Tailwind")删除
      heroBox.querySelectorAll('span').forEach((s) => {
        const t = (s.textContent || '').trim();
        if (/^open-source$|astro|tailwind/i.test(t)) {
          const wrap = s.closest('div');
          if (wrap && wrap.querySelector('span') === s) wrap.remove(); else s.remove();
        }
      });
      // 2) 右侧 SaaS dashboard mock：删除(它包含 Dashboard/Active users/Revenue 等英文 demo)
      const row = heroBox.querySelector('h1')?.closest('div[class*="flex"]') || heroBox;
      Array.from(row.children).forEach((child) => { if (!child.querySelector('h1')) child.remove(); });
      // 3) 标题：把 .animated-text 上的字号/字体类搬到 h1, 清成干净文本容器并打 hero 槽
      const h1 = heroBox.querySelector('h1');
      if (h1) {
        const anim = h1.querySelector('.animated-text');
        const cls = ['text-4xl', 'leading-tight', 'font-brand'];
        if (anim) {
          String(anim.className || '').split(/\\s+/).forEach((c) => { if (/^text-|^font-|^leading-|^tracking-/.test(c)) cls.push(c); });
        }
        h1.className = Array.from(new Set(cls)).join(' ');
        h1.removeAttribute('style');
        h1.textContent = '';
        h1.dataset.sitecraftSlot = 'hero.title.zh';
      }
      // 4) 副文 wrapper(.animated-text 拆词)替换为干净 p(引擎 hero.subtitle 写入)
      const oldSub = h1 && h1.nextElementSibling ? h1.nextElementSibling : null;
      if (oldSub) {
        const p = document.createElement('p');
        p.dataset.sitecraftSlot = 'hero.subtitle.zh';
        p.className = 'mx-auto mt-4 text-base sm:text-lg leading-7 text-neutral-600 dark:text-neutral-300 max-w-2xl';
        p.textContent = ' ';
        oldSub.replaceWith(p);
        // 5) 按钮区：清 GitHub/Twitter, 留一个企业主 CTA(引擎 hero.cta 写入)
        const btnRow = p.nextElementSibling;
        if (btnRow) {
          btnRow.innerHTML = '';
          const cta = document.createElement('a');
          cta.setAttribute('href', '#products');
          cta.dataset.sitecraftSlot = 'hero.cta.zh';
          cta.textContent = '获取电站方案';
          cta.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.72rem 1.4rem;border-radius:12px;background:var(--sitecraft-primary,#4f46e5);color:#fff;font-weight:600;text-decoration:none;box-shadow:0 6px 14px rgba(79,70,229,.24)';
          btnRow.append(cta);
        }
      }
      // 6) 左列放宽到整宽居中(右列已删)
      const left = heroBox.querySelector('h1')?.parentElement;
      if (left) { left.style.cssText = 'width:100%;max-width:880px;margin:0 auto;text-align:center'; }
    }

    // ---- 原 footer(section) 换成真正 <footer> 并重建企业联系：这样引擎把生成区(about/services/products/contact)
    //      插到 <footer> 之前, 页序自然为 hero → features → about → services → products → contact → footer ----
    if (footerCandidate) {
      const footer = document.createElement('footer');
      footer.dataset.sitecraftFooterReplaced = 'true';
      footer.style.cssText = 'border-top:1px solid rgba(100,116,139,.18)';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:.55rem;padding:2.6rem 1.2rem;text-align:center;font-size:.9rem;color:#475569';
      const parts = ['<strong style="color:#0f172a;font-weight:700;font-size:1.04rem">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#4f46e5;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + String(contactPhone).replace(/\\s+/g, '') + '" style="color:#4f46e5;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.7">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
      footerCandidate.replaceWith(footer);
    }

    // ---- 通用清理 ----
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('a[href^="http"], a[href^="/"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (/^http/i.test(href) || (href.startsWith('/') && href !== '/' && !href.startsWith('/api/') && !href.startsWith('#'))) a.remove();
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.append(description);
    }
    description.setAttribute('content', (company ? company + '：' : '') + localize(draft?.content?.about?.body) || '');
  };
`;

// nativeFillFn：把 draft.features.items 逐条写进 "Everything you need" 的原生 6 图标卡
// (双层 div：外层 data-aos wrapper > 内层卡 div(rounded-xl border) > img/h3/p)。图标保留；
// 改写后卡内 h3/p 带 sitecraft-slot(features.items 前缀)短路通用卡墙。多余原生卡整卡隐藏。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = Array.isArray(features.items) ? features.items : [];
    const section = document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    const hide = (el) => { if (!el) return; el.hidden = true; el.style.setProperty('display', 'none', 'important'); };
    // 精确匹配内层卡：直接子级同时含 img/h3/p(外层 wrapper 无直接 img/h3)
    const cards = Array.from(section.querySelectorAll('div')).filter((d) => d.querySelector(':scope > img') && d.querySelector(':scope > h3') && d.querySelector(':scope > p'));
    if (!cards.length) return;
    if (!items.length) { cards.forEach(hide); return; }
    cards.slice(items.length).forEach(hide);
    cards.slice(0, items.length).forEach((card, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = card.querySelector('h3');
      const body = card.querySelector('p');
      if (h3 && item && item.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item && item.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftNativeFeaturesItem = itemKey;
      card.dataset.sitecraftSection = 'features';
    });
  };
`;

const designTokenCss =
  // 逐词动画兜底：任何残留 .word/span 行内 opacity:0 也强制可见(离线导出无 JS 时标题不消失)
  '[class*="animated-text"] .word,[class*="animated-text"] span{opacity:1!important;transform:none!important;filter:none!important}' +
  // hero 标题：中文单行清晰
  '#top h1{font-size:clamp(2rem,5vw,3.4rem)!important;line-height:1.16!important;letter-spacing:.01em!important;color:var(--sitecraft-primary,#4f46e5)!important;font-weight:800!important}' +
  // features 区标题用主题主色
  '#features h2{color:var(--sitecraft-primary,#4f46e5)!important}' +
  // 生成区(about/services/products/contact)统一浅色面板, 内容暗色可读
  '[data-sitecraft-generated-products],[data-sitecraft-generated-content]{background:#ffffff!important;color:#0f172a!important}' +
  '[data-sitecraft-generated-products] h2,[data-sitecraft-generated-content] h2{color:var(--sitecraft-primary,#4f46e5)!important}' +
  '[data-sitecraft-generated-products] h3,[data-sitecraft-generated-content] h3{color:#0f172a!important}' +
  '[data-sitecraft-generated-content="contact"] a,[data-sitecraft-generated-content="contact"] address{color:var(--sitecraft-primary,#4f46e5)!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#fff!important;border:1px solid #e2e8f0!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important}' +
  '[data-sitecraft-generated-content] p{color:#334155!important}' +
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}';

export const signalAdapter: TemplateAdapter = {
  templateId: "signal",
  prepareFn,
  heroFn,
  nativeFillFn,
  sanitize: {
    sections: [
      "Drop in your customer logos",
      "wrong problems",
      "A design system, not just a template",
      "full layout system",
      "Made for different kinds of SaaS",
      "Built with modern tools",
      "Free template, real pricing",
      "Frequently asked questions",
      "Latest articles",
      "Start building your SaaS today",
    ],
    leafPatterns: ["Get started", "Start free trial", "View on GitHub", "Star on GitHub", "Get Template", "View Features", "Contact sales", "Read More", "Sign in", "Sign up", "View All Articles"],
  },
  designTokenCss,
};
