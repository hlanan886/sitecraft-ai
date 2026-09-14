import type { TemplateAdapter } from "./types.ts";

/**
 * tailwind-landing 专属适配（TailwindToolbox/Landing-Page，单文件静态 HTML）。
 *
 * 原模板结构（vendor/open-source-templates/tailwind-landing/index.html）：
 *   nav#header(fixed) → hero(div.pt-24 > .container：h1 + 副文 + 按钮 + 右 hero.png)
 *   → section1「图文分栏×2」(h2 Title + 两组 .flex.flex-wrap：h3 + p + svg 插图)
 *   → section2「博客卡×3」(h2 + 3 张 .w-full.md:w-1/3 卡：p 分类 + div 标题 + p 正文 + button)
 *   → section3「定价×3」(h2 Pricing + 3 张 .flex.flex-col.w-5/6 卡：价格 div + ul li + button)
 *   → section4 CTA 带(h2 + h3 + button) → footer(链接网格 + 社交)
 *
 * 适配前实测（scripts/probe-template-coverage.mjs）：
 *   tailwind-landing → generated = about,features,services（3 节走通用卡片墙，22 模板中最差）
 * 适配后目标：generated = products（仅 1 节，与 landwind/atlas/moon 持平）
 *
 * 编排：
 *   hero     ← h1 + 副文 + 单一 CTA（清 undraw/freepik 外链与 demo 引导句）
 *   about    ← section1 第一组图文分栏（h3←about.title，p←about.body，插图保留）
 *   features ← section1 第二组图文分栏（h3←features.title，p←features.intro；
 *              features.items 按模板原生「h3 + p」节奏追加到该组右栏）
 *   services ← section2 三张博客卡（分类 p←services.title，标题 div←item.title，正文 p←item.body）
 *   products ← 定价区（SaaS 语义，与企业站不符）整体隐藏；产品由通用生成区承载，
 *              经 designTokenCss 贴合模板卡片风格（与 forge/landwind 同一取舍）
 *   contact  ← section4 CTA 带（h2←contact.title，h3←contact.body，button←电话）+ footer 联系带
 *
 * 容量：features 原生 1 组 + 追加条目；services 3 张卡。超出容量隐藏多余卡，不堆卡墙。
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
    const company = draft?.companyName || draft?.siteName || '企业';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const nav = draft?.navigation || {};
    const navLabel = (k, fb) => localize(nav[k]) || fb;

    // ---- 导航：作品牌位 + 5 个企业锚点 ----
    const navBar = document.querySelector('nav#header, nav');
    if (navBar) {
      const navUl = navBar.querySelector('ul');
      const keys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = keys.map((k, i) => navLabel(k, ['关于我们', '核心优势', '产品中心', '服务支持', '联系我们'][i]));
      const brandAnchor = navBar.querySelector('a');
      if (brandAnchor) {
        // textContent 赋值会清掉子节点（模板品牌位里的飞机 svg），避免残留 demo 图标
        brandAnchor.textContent = company;
        brandAnchor.setAttribute('href', '#top');
        brandAnchor.dataset.sitecraftSlot = 'companyName.zh';
      }
      // 原生只有 3 个 li：按需克隆补足到 5 个，保持模板的 li>a 结构与类名
      if (navUl) {
        const lis = Array.from(navUl.querySelectorAll('li'));
        while (navUl.querySelectorAll('li').length < labels.length && lis.length) {
          const clone = lis[0].cloneNode(true);
          navUl.append(clone);
        }
        Array.from(navUl.querySelectorAll('a')).forEach((a, i) => {
          if (i < labels.length) {
            a.textContent = labels[i];
            a.setAttribute('href', '#' + keys[i]);
            a.dataset.sitecraftSlot = 'navigation.' + keys[i] + '.zh';
            a.classList.remove('text-black', 'font-bold');
            a.classList.add('text-white');
          } else {
            (a.closest('li') || a).remove();
          }
        });
      }
      // 导航右侧 demo 按钮（Action）
      navBar.querySelectorAll('button').forEach((b) => b.remove());
    }

    // ---- hero：打锚点 + 清 demo 引导句与外链 ----
    const h1 = allVisible('h1')[0];
    if (h1) {
      const heroContainer = h1.closest('.container');
      (heroContainer || h1).closest('div.pt-24, div')?.setAttribute('id', 'top');
      if (!document.querySelector('#top')) (heroContainer || h1).parentElement?.setAttribute('id', 'top');
      // h1 上方的 "What business are you?" demo 引导句
      const lead = h1.parentElement?.querySelector('p.uppercase, p.tracking-loose');
      if (lead) lead.remove();
      // 首屏按钮：demo 文案 Subscribe/Action → 询盘引导，并标 hero.cta 槽（通用引擎会再写一次）
      const heroBtn = h1.parentElement?.querySelector('button, a[class*="rounded-full"]');
      if (heroBtn) {
        heroBtn.textContent = '获取方案';
        heroBtn.setAttribute('data-sitecraft-slot', 'hero.cta.zh');
      }
    }
    // 全文 demo 说明与外链
    document.querySelectorAll('a[href*="undraw"], a[href*="freepik"], a[href*="tailwindcss.com"]').forEach((a) => a.remove());
    document.querySelectorAll('p').forEach((p) => {
      if (/^\\s*Images from:\\s*$/i.test(p.textContent || '')) p.remove();
    });

    // ---- 节归属判定：按结构特征打标记，不靠文案 ----
    const sections = Array.from(document.querySelectorAll('body > section'));
    // section1 = 含两组 .flex.flex-wrap 且有 ≥2 个 h3 的图文分栏区
    const splitSection = sections.find((sec) => sec.querySelectorAll('.flex.flex-wrap').length >= 1 && sec.querySelectorAll('h3').length >= 2);
    // section2 = 三张博客卡（有 a>div 结构，无 ul li）
    const serviceSection = sections.find((sec) => sec !== splitSection && sec.querySelectorAll('.w-full.md\\\\:w-1\\\\/3').length >= 2);
    // section3 = 定价卡（含 ul li 且文本含定价词）
    const pricingSection = sections.find((sec) => sec !== splitSection && sec !== serviceSection && sec.querySelectorAll('ul li').length >= 3);
    // section4 = CTA 带（h2 + h3，无卡片）
    const ctaSection = sections.find((sec) => sec !== splitSection && sec !== serviceSection && sec !== pricingSection && sec.querySelector('h2') && sec.querySelector('h3'));

    const mark = (sec, key) => {
      if (!sec) return;
      sec.id = key;
      sec.dataset.sitecraftSection = key;
      sec.dataset.sitecraftScope = key;
    };
    if (splitSection) splitSection.dataset.sitecraftSplit = 'true';
    mark(splitSection, 'about');
    mark(serviceSection, 'services');
    mark(ctaSection, 'contact');
    // 定价区：SaaS 套餐语义与企业站不符，整体隐藏（产品改由通用生成区承载）
    if (pricingSection) {
      pricingSection.hidden = true;
      pricingSection.style.setProperty('display', 'none', 'important');
    }

    // ---- footer：清 demo 链接与社交，补企业联系 ----
    const footer = document.querySelector('footer');
    if (footer) {
      footer.querySelectorAll('a').forEach((a) => {
        const t = (a.textContent || '').trim();
        if (/^(FAQ|Help|Support|Terms|Privacy|Facebook|Linkedin|Twitter|Official Blog|About Us|Contact)$/i.test(t)) a.remove();
      });
      footer.querySelectorAll('a[href*="freepik"], a[href*="undraw"]').forEach((a) => a.remove());
      // demo 品牌锚点（飞机 svg + LANDING）与列标题（Links/Legal/Social/Company）
      footer.querySelectorAll('a').forEach((a) => {
        if (/^LANDING$/i.test((a.textContent || '').trim())) a.remove();
      });
      footer.querySelectorAll('p.uppercase').forEach((p) => {
        if (/^(Links|Legal|Social|Company)$/i.test((p.textContent || '').trim())) p.remove();
      });
      // 清空后残留的空列容器（每列去掉标题与链接后只剩空 div）
      footer.querySelectorAll('.flex-1').forEach((col) => {
        if (!(col.textContent || '').trim() && !col.querySelector('img')) col.remove();
      });
      const holder = footer.querySelector('.container') || footer;
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;justify-content:center;padding:1rem;color:#6b7280;font-size:.875rem';
      const parts = ['<span style="font-weight:600;color:#374151">' + company + '</span>'];
      if (contact.phone) parts.push('<a href="tel:' + String(contact.phone).replace(/\\s+/g, '') + '" style="color:#6b7280">' + contact.phone + '</a>');
      band.innerHTML = parts.join('');
      holder.append(band);
    }

    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((n) => n.remove());
  };
`;

/**
 * nativeFillFn：把 about/features/services/contact 填进模板原生排版。
 * 通用引擎在检测到对应 data-sitecraft-slot 可见时会跳过该节的兜底生成，
 * 因此每节都必须写入 slot 标记（否则该节仍会走 generated 卡片墙）。
 */
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const contact = content.contact || {};

    // ---- about + features：section1 的两组图文分栏 ----
    const splitSec = document.querySelector('[data-sitecraft-split="true"]');
    if (splitSec) {
      const groups = Array.from(splitSec.querySelectorAll('.flex.flex-wrap')).filter((g) => g.querySelector('h3'));
      const sectionHeading = splitSec.querySelector('h2');
      const fillGroup = (group, titleObj, bodyObj, slotPrefix, bodySlotName) => {
        if (!group) return;
        const h3 = group.querySelector('h3');
        const p = group.querySelector('p');
        const title = titleObj ? localize(titleObj, locale) : '';
        const body = bodyObj ? localize(bodyObj, locale) : '';
        if (h3 && title) setText(h3, title, slotPrefix + 'title.' + locale, applied);
        else if (h3) h3.style.setProperty('display', 'none', 'important');
        if (p && body) setText(p, body, slotPrefix + bodySlotName + '.' + locale, applied);
        else if (p) p.textContent = '';
        return { h3, p };
      };
      fillGroup(groups[0], content.about?.title, content.about?.body, 'about.', 'body');
      // 该节只有一个 h2（模板的 "Title" 占位），承载 features.title；
      // 第二组 h3 承载 features.items[0].title，p 承载 features.intro——
      // 若这里也用 features.title 会被首条 item 覆盖，造成标题丢失。
      if (sectionHeading) {
        const featuresTitle = localize(content.features?.title, locale);
        if (featuresTitle) setText(sectionHeading, featuresTitle, 'features.title.' + locale, applied);
      }

      // features.items 按模板原生「h3 + p」节奏填进第二组（分栏是模板的价值主张排版）
      const featureItems = content.features?.items || [];
      const anchorGroup = groups[1];
      if (anchorGroup) {
        const h3 = anchorGroup.querySelector('h3');
        const p = anchorGroup.querySelector('p');
        const first = featureItems[0];
        if (h3 && first) setText(h3, localize(first.title, locale), 'features.items.' + (first.id || 0) + '.title.' + locale, applied);
        const intro = localize(content.features?.intro, locale);
        if (p && intro) setText(p, intro, 'features.intro.' + locale, applied);
        // 其余条目以同样式追加（h3 + p），超出模板节奏的条数不追加
        const anchorCol = h3?.parentElement;
        featureItems.slice(1, 4).forEach((item, offset) => {
          if (!anchorCol) return;
          const index = offset + 1;
          const clone = anchorGroup.cloneNode(false);
          const itemH3 = document.createElement('h3');
          itemH3.className = 'text-3xl text-gray-800 font-bold leading-none mb-3 mt-6';
          const itemP = document.createElement('p');
          itemP.className = 'text-gray-600 mb-8';
          clone.append(itemH3, itemP);
          anchorCol.append(clone);
          if (item.title) setText(itemH3, localize(item.title, locale), 'features.items.' + (item.id || index) + '.title.' + locale, applied);
          if (item.body) setText(itemP, localize(item.body, locale), 'features.items.' + (item.id || index) + '.body.' + locale, applied);
        });
      }
    }

    // ---- services：section2 的三张博客卡 ----
    const serviceSec = document.querySelector('[data-sitecraft-section="services"]');
    if (serviceSec) {
      const cards = Array.from(serviceSec.querySelectorAll('.w-full.md\\\\:w-1\\\\/3'));
      const serviceItems = content.services?.items || [];
      const serviceTitle = localize(content.services?.title, locale);
      cards.forEach((card, index) => {
        const item = serviceItems[index];
        if (!item) {
          card.style.setProperty('display', 'none', 'important');
          card.setAttribute('aria-hidden', 'true');
          return;
        }
        const itemKey = (item && item.id) ? item.id : String(index);
        const cat = card.querySelector('p');
        const titleEl = card.querySelector('a > div, .font-bold');
        const bodyEl = Array.from(card.querySelectorAll('p')).find((node) => node !== cat);
        const button = card.querySelector('button');
        if (cat && serviceTitle) setText(cat, serviceTitle, 'services.title.' + locale, applied);
        if (titleEl) setText(titleEl, localize(item.title, locale), 'services.items.' + itemKey + '.title.' + locale, applied);
        if (bodyEl) setText(bodyEl, localize(item.body, locale), 'services.items.' + itemKey + '.body.' + locale, applied);
        if (button) button.textContent = '了解详情';
      });
    }

    // ---- products：定价区（SaaS 套餐语义）已隐藏，产品由通用生成区承载 ----
    // 该模板定价卡是「价格 + 特性 ul + Sign Up」，与企业站产品目录语义不符；
    // 与其把产品硬塞进套餐卡，不如让通用产品网格承载，再经 designTokenCss 贴合模板卡片风格
    // （与 forge/landwind 同一取舍）。此处只需保证 products.title 落在生成区标题上。

    // ---- contact：section4 CTA 带 + footer 联系带 ----
    const contactSec = document.querySelector('[data-sitecraft-section="contact"]');
    if (contactSec) {
      const h2 = contactSec.querySelector('h2');
      const h3 = contactSec.querySelector('h3');
      const button = contactSec.querySelector('button, a');
      if (h2) setText(h2, localize(contact.title, locale), 'contact.title.' + locale, applied);
      if (h3) setText(h3, localize(contact.body, locale), 'contact.body.' + locale, applied);
      if (button && contact.phone) {
        button.textContent = contact.phone;
        button.setAttribute('data-sitecraft-slot', 'contact.phone.' + locale);
        applied.add('contact.phone.' + locale);
      }
    }
    // footer 联系带：邮箱与地址必须带 slot 标记——contact 节被本适配器接管后，
    // 通用引擎不再生成联系区，若这里不落标记则 contact.email/address 判定为未覆盖。
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

export const tailwindLandingAdapter: TemplateAdapter = {
  templateId: "tailwind-landing",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    // 产品生成区贴合模板卡片风格（白卡 + 圆角 + 阴影，与 section2 博客卡一致）
    // 产品生成区落在深色渐变底上：卡片给实心白底（引擎内联的是半透明 color-mix，
    // 不加 !important 会被内联样式压过），文字用深色，保证对比度。
    '[data-sitecraft-generated-products]{background:#f9fafb}' +
    '[data-sitecraft-generated-products] h2{color:#fff!important}' +
    '[data-sitecraft-generated-products] > p{color:#fff!important;opacity:.85}' +
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
    '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
    '@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '[data-sitecraft-generated-products] article{background:#fff!important;border:none!important;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.12)}' +
    '[data-sitecraft-generated-products] article h3{color:#1f2937!important}' +
    '[data-sitecraft-generated-products] article p{color:#4b5563!important;opacity:1!important}' +
    '[data-sitecraft-generated-products] article small{color:#6b7280!important;opacity:1!important}' +
    // 其余生成兜底区（理论上不应出现）统一浅底
    '[data-sitecraft-generated-content]{background:#f9fafb}' +
    '[data-sitecraft-generated-content] h2{color:var(--sitecraft-primary)!important}',
};
