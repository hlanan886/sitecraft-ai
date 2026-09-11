import type { TemplateAdapter } from "./types.ts";

/**
 * landwind 专属适配。
 *
 * 原模板（Flowbite Landwind 落地页）结构：
 *   header(fixed 导航 + GitHub Star + Download) →
 *   hero(h1 标题 + 副文 + GitHub/Figma 双 CTA + 右侧 hero.png) →
 *   图文分栏 #1（左 h2+p+勾选列 ul，右图）→ 图文分栏 #2（右图 + 左 h2+p+勾选列）
 *   → Trusted Worldwide 统计带 → 客户 quote → 定价卡 3 → FAQ → free-trial CTA → footer。
 *
 * 企业站只保留 hero + 2 组图文分栏（原生价值主张资产），删 SaaS demo 区。
 * 内容编排：
 *   hero        ← 标题/副文/单一 CTA（清 GitHub/Figma 外链）
 *   features    ← 2 组图文分栏勾选列（li>span 短句）承载 features.items 标题（≤6 点）
 *   services/products/contact ← 由共享引擎生成（产品带图、服务卡、联系区，鑫力/MOON 同款）
 * 勾选列是"勾 svg + span 短句"形态 → nativeFill 把 item.title 写进 span；item.body 在
 * 该模板无处安放（无卡正文），故省略——这正是不堆卡墙的取舍。
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
    const brandName = company || '企业';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';

    // 固定深色，避免日间亮色下 demo 灰字与注入对比异常；保留 Flowbite 原始风格但偏深可用
    // （landwind 双主题，这里不强改，交给 designTokenCss 收敛文字色）。

    // header：品牌名替换
    const nav = document.querySelector('header nav');
    if (nav) {
      const brandLink = nav.querySelector('a[href="#"]');
      if (brandLink) {
        const img = brandLink.querySelector('img');
        img?.remove();
        if (!brandLink.querySelector('[data-sitecraft-brand]')) {
          const span = document.createElement('span');
          span.dataset.sitecraftBrand = 'true';
          span.className = 'self-center text-xl font-semibold whitespace-nowrap dark:text-white';
          span.textContent = brandName;
          brandLink.append(span);
        }
      }
      // GitHub Star / Download 外链
      nav.querySelectorAll('a[class*="github-button"], a[href*="themesberg.com"], a[href*="github.com"], a[href*="figma"]').forEach((a) => a.remove());
    }
    document.querySelectorAll('header a[href*="themesberg"], header a[href*="github"]').forEach((a) => a.remove());

    // 导航：Home/Company/Marketplace/Features/Team/Contact → 企业锚点导航
    const navUl = document.querySelector('header nav ul');
    if (navUl) {
      const navCopy = draft?.navigation || {};
      const labelOf = (k, fb) => localize(navCopy[k]) || fb;
      const labels = [labelOf('about', '关于我们'), labelOf('features', '产品方案'), labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们')];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      const lis = Array.from(navUl.querySelectorAll('li'));
      while (navUl.children.length < labels.length) {
        const li = document.createElement('li');
        li.innerHTML = '<a href="#" class="block py-2 pl-3 pr-4 text-gray-700 border-b border-gray-100 hover:bg-gray-50 lg:border-0 lg:p-0 dark:text-gray-400"></a>';
        navUl.append(li);
      }
      Array.from(navUl.querySelectorAll('a')).slice(0, labels.length).forEach((a, i) => {
        a.textContent = labels[i] || '联系我们';
        a.setAttribute('href', targets[i] || '#contact');
        a.removeAttribute('aria-current');
        a.classList.remove('bg-purple-700', 'text-white');
        a.classList.add('lg:text-gray-700');
        a.dataset.sitecraftSlot = 'navigation.' + ['about', 'features', 'products', 'services', 'contact'][i] + '.zh';
      });
      // 多余的导航项隐藏（若 labels 少于原生项）
      Array.from(navUl.querySelectorAll('a')).slice(labels.length).forEach((a) => { const li = a.closest('li'); if (li) li.remove(); });
    }

    // header 右侧残留（登录/注册按钮等无 href 文本按钮）：清成空或删
    nav?.querySelectorAll('a[href="#"], button').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/log in|login|sign in|register|get started|staff|pricing/i.test(t)) el.remove();
    });

    // 删除 SaaS demo 大区（保留 hero + 2 分栏）
    const killByHeading = [/Trusted by over|Trusted Worldwide|Designed for business/i, /Frequently asked|Start your free trial/i, /client|testimonial|what (?:they|our) (?:say|clients)/i];
    allVisible('h1,h2,h3').forEach((heading) => {
      const t = (heading.textContent || '').trim();
      if (killByHeading.some((re) => re.test(t))) {
        const sec = heading.closest('section');
        if (sec) { sec.hidden = true; sec.style.setProperty('display', 'none', 'important'); }
      }
    });
    // demo 客户 logo 条（hero 下的纯 svg 网格，无标题无文字）
    document.querySelectorAll('body > section').forEach((sec) => {
      if (sec.hidden) return;
      const links = Array.from(sec.querySelectorAll('a[href="#"]'));
      if (links.length >= 4 && links.every((a) => a.querySelector('svg') && !a.textContent.trim()) && !sec.querySelector('h1,h2,h3,p')) {
        sec.hidden = true;
        sec.style.setProperty('display', 'none', 'important');
      }
    });
    // demo 客户评价（blockquote 引述，无 heading 但含 avatar img + "CEO at" 等）
    document.querySelectorAll('body > section').forEach((sec) => {
      if (sec.hidden) return;
      const t = (sec.textContent || '').replace(/\s+/g, ' ');
      if (sec.querySelector('blockquote') || /CEO at|just awesome|review|testimonial/i.test(t)) {
        sec.hidden = true;
        sec.style.setProperty('display', 'none', 'important');
      }
    });

    // hero 区：清 GitHub/Figma 双 CTA 与正文里的外链 a，保留一个主 CTA 锚点给共享引擎改写
    const h1 = allVisible('h1')[0];
    if (h1) {
      const heroSec = h1.closest('section');
      if (heroSec) heroSec.id = 'top';
      // 副文里的外链 a（Tailwind CSS / Flowbite）
      h1.parentElement?.querySelectorAll('a[href*="tailwindcss"], a[href*="flowbite"], a[href*="github"], a[href*="figma"], a[href*="themesberg"]').forEach((a) => a.remove());
      // hero 右侧按钮区：保留一个作为主 CTA（其余删）
      const heroCtaBox = heroSec?.querySelector('.space-y-4');
      if (heroCtaBox) {
        const ctaLinks = Array.from(heroCtaBox.querySelectorAll('a'));
        ctaLinks.slice(1).forEach((a) => a.remove());
        const primary = ctaLinks[0];
        if (primary) {
          primary.querySelector('svg')?.remove();
          primary.href = '#products';
          primary.classList.remove('border-gray-200');
          primary.classList.add('bg-purple-700', 'text-white', 'dark:bg-purple-600');
        }
      }
    }

    // 分栏 section：唯一保留的业务资产（2 组 lg:grid-cols-2 + 勾选 ul）
    // 打标记供 nativeFill 定位
    const featureRows = Array.from(document.querySelectorAll('div')).filter((d) => {
      const cls = String(d.className || '');
      return /lg:grid-cols-2/.test(cls) && d.querySelector('h2') && d.querySelector('ul[role="list"]');
    });
    if (featureRows.length) {
      const owner = featureRows[0].closest('section') || featureRows[0];
      owner.dataset.sitecraftNativeFeatures = 'true';
      owner.dataset.sitecraftScope = 'features';
      owner.dataset.sitecraftSection = 'features';
      owner.id = 'features';
    }

    // 删除 demo section 后若只剩 hero，footer 重建为企业联系（footer 的 4 列链接网格清掉）
    const footer = document.querySelector('footer');
    if (footer) {
      const grid = Array.from(footer.querySelectorAll('div')).find((d) => /grid-cols-[0-9]/.test(String(d.className || '')) && !d.textContent);
      grid?.remove();
      // 清掉 footer 底部残留：demo 品牌锚点（logo img + "Landwind"）与 demo 版权行
      footer.querySelectorAll('a[href="#"]').forEach((a) => {
        if (a.querySelector('img') || /landwind/i.test(a.textContent || '')) a.remove();
      });
      footer.querySelectorAll('span[class*="text-gray-500"], span').forEach((sp) => {
        if (/landwind|rights reserved|built with|©|™/i.test(sp.textContent || '')) sp.remove();
      });
      footer.querySelectorAll('h3, ul').forEach((n) => n.remove());
      const holder = footer.querySelector(':scope > div');
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;padding:1.4rem 1rem;color:#9ca3af';
      const parts = ['<span style="color:#f3f4f6;font-weight:600">' + brandName + '</span>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#9ca3af">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#9ca3af">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.8">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      (holder || footer).append(band);
    }

    // 通用清理
    document.querySelectorAll('a[href^="http"]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (/github|figma|tailwindcss|flowbite|themesberg/.test(href)) anchor.remove();
    });
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
  };
`;

// nativeFillFn：把 draft 内容填进 landwind 原生 2 组图文分栏（非卡墙，防 demo 残留与卡墙叠加）。
// 编排（各 1 行图文分栏，勾选列 li>span 承载条目标题）：
//   行 0 = features：h2←features.title，intro p←features.intro，勾选 li←features.items[0..k]
//   行 1 = services：h2←services.title，勾选 li←services.items[0..k]
// 原生化容纳 8 点（3+5），多于则隐藏多余 demo li；products/contact 由共享引擎 generated（带图产品卡，鑫力同款）。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const rows = Array.from(document.querySelectorAll('div')).filter((d) => {
      const cls = String(d.className || '');
      return /lg:grid-cols-2/.test(cls) && d.querySelector('h2') && d.querySelector('ul');
    });
    if (!rows.length) return;
    const fillRow = (row, titleObj, introObj, items, slotPrefix) => {
      const h2 = row.querySelector('h2');
      const ul = row.querySelector('ul');
      const introP = Array.from(row.querySelectorAll('p')).find((p) => p.parentElement !== ul && !ul?.contains(p));
      const lis = ul ? Array.from(ul.querySelectorAll('li')) : [];
      if (titleObj) {
        const t = localize(titleObj, locale);
        if (t && h2) setText(h2, t, slotPrefix + 'title.' + locale, applied);
      } else if (h2) h2.style.setProperty('display', 'none', 'important');
      const it = introObj ? localize(introObj, locale) : '';
      if (it && introP) setText(introP, it, slotPrefix + 'intro.' + locale, applied);
      // 清空该行内所有未被写入的 demo 段落（防英文 demo 触发共享引擎 fallback 误判 + 视觉残留）
      row.querySelectorAll('p').forEach((p) => {
        if (!p.getAttribute('data-sitecraft-slot')) p.textContent = '';
      });
      const list = items || [];
      lis.forEach((li, si) => {
        const span = li.querySelector('span');
        const item = list[si];
        if (!item) {
          li.style.setProperty('display', 'none', 'important');
          li.setAttribute('aria-hidden', 'true');
          return;
        }
        const itemKey = (item && item.id) ? item.id : String(si);
        if (item.title && span) setText(span, localize(item.title, locale), slotPrefix + 'items.' + itemKey + '.title.' + locale, applied);
      });
    };
    // 行0 = features；行1 = services（无 services 数据则整行隐藏）
    fillRow(rows[0], content.features?.title, content.features?.intro, content.features?.items, 'features.');
    if (content.services?.title || content.services?.items?.length) {
      if (rows[1]) fillRow(rows[1], content.services.title, content.services.intro, content.services.items, 'services.');
      rows.slice(2).forEach((row) => { row.style.setProperty('display', 'none', 'important'); row.setAttribute('aria-hidden', 'true'); });
    } else {
      rows.slice(1).forEach((row) => { row.style.setProperty('display', 'none', 'important'); row.setAttribute('aria-hidden', 'true'); });
    }
  };
`;

export const landwindAdapter: TemplateAdapter = {
  templateId: "landwind",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss:
    '[data-sitecraft-generated-products], [data-sitecraft-generated-content="services"], [data-sitecraft-generated-content="contact"]{background:#f9fafb}' +
    '[data-sitecraft-generated-products] h2, [data-sitecraft-generated-content] h2{color:var(--sitecraft-primary)!important}' +
    // 产品 6 卡在浅色模板下固定 3 列成 2 行，避免 auto-fit 出现 5+1 失衡（!important 压过内联样式）
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '[data-sitecraft-generated-products] article{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}' +
    '#features h2, #features p{color:inherit}' +
    'a[href="#top"]{cursor:pointer}',
};
