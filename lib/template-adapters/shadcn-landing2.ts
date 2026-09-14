import type { TemplateAdapter } from "./types.ts";

/**
 * shadcn-landing2 专属适配 —— 企业官网形态（原生静态 SSG，非 SPA 壳）。
 *
 * 原模板（Next.js App Router 静态导出 + shadcn/ui 组件）结构（自上而下）：
 *   header(悬浮圆角导航：logo + Radix 菜单 Features/Testimonials/Team/Contact/FAQ + 主题切换)
 *   → hero 居中首屏(h1 "Experience the Shadcn landing page" + p + Get Started/Github 双按钮 + 大图 mock)
 *   → #sponsors(logo 跑马灯) → #benefits(4 icon 卡 "Your Shortcut to Success")
 *   → #features(6 原生 icon 卡) → #services(4 卡 h3+p)
 *   → #testimonials(评价墙) → #team(团队头像) → #community(Discord CTA)
 *   → Pricing(3 档) → #contact(左说明+联系方式行 + 右询盘表单) → #faq(手风琴) → footer(4 列外链)。
 *
 * 企业站编排：
 *   - 删除 demo 区：#sponsors / #benefits / #testimonials / #team / #community / Pricing / #faq。
 *   - 原生资产保留：#features 6 卡承载 features、#services 4 卡承载 services、#contact 承载 contact+表单。
 *   - 全站业务 section 归入新建 <main>（本模板原无 main），使 section 级排序/生成块在 main 内完成，
 *     避免空 DOM 时 body 级 append 把板块排到 footer 之后。
 *   - about / products 无原生区：prepare 预置空 section#about（带 generated-content 标记）与
 *     section#products（带 generated-products 标记）承接共享引擎生成块，并让导航锚点可跳。
 *   - hero：删 "New/Design is out now!" chip、Github 外链、底部大图 mock，保主按钮打 hero.cta 槽。
 *   - features/services：#features 卡本身 icon+标题 无正文，nativeFill 逐卡改写 h3 并补一行正文
 *     （模板浅色 icon-grid 是原生形态，非通用卡墙），超量卡隐藏；intro 段落样 h3 写入 features/services.intro。
 *   - contact：nativeFill 清掉 demo 英文联系信息行（Find us/Call us/Mail US/Visit us）与 Subject 下拉，
 *     把引擎生成的 email/phone/address 联系方式块挪进左列。
 *   - 导航/页脚企业化；主题切换(葡语 Escuro/Claro)删除。
 *
 * 转义：adapter 源码字符串禁反引号禁 ${，含冒号(:) 的类名一律用 className 判断而非 CSS 选择器。
 */
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
    const hide = (el) => { if (el) { el.hidden = true; el.style.setProperty('display', 'none', 'important'); } };

    // ---------- header：品牌替换（保留 logo svg）+ 导航锚点化 + 删主题切换 ----------
    const header = document.querySelector('header');
    if (header) {
      const brandLink = header.querySelector('a[href="/"]') || header.querySelector('a[href="#"]');
      if (brandLink) {
        brandLink.setAttribute('href', '#top');
        Array.from(brandLink.childNodes).forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) n.remove(); });
        if (!brandLink.querySelector('[data-sitecraft-slot]')) {
          const span = document.createElement('span');
          span.dataset.sitecraftSlot = 'companyName.zh';
          span.textContent = brandName;
          brandLink.append(span);
        }
      }
      const nav = header.querySelector('nav');
      if (nav) {
        const navCopy = draft?.navigation || {};
        const labelOf = (k, fb) => localize(navCopy[k]) || fb;
        const items = [
          ['features', '产品方案', '#features'],
          ['products', '产品中心', '#products'],
          ['services', '服务支持', '#services'],
          ['about', '关于我们', '#about'],
          ['contact', '联系我们', '#contact'],
        ];
        nav.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.cssText = 'list-style:none;display:flex;align-items:center;gap:2px;margin:0;padding:0';
        items.forEach((item) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.setAttribute('href', item[2]);
          a.textContent = labelOf(item[0], item[1]);
          a.dataset.sitecraftSlot = 'navigation.' + item[0] + '.zh';
          a.style.cssText = 'display:inline-block;padding:8px 13px;font-size:15px;font-weight:500;border-radius:8px;color:inherit;text-decoration:none;white-space:nowrap';
          li.append(a);
          ul.append(li);
        });
        nav.append(ul);
      }
      // 主题切换按钮（葡语 Escuro/Claro/Trocar de tema），企业静态站无意义
      const themeBtn = Array.from(header.querySelectorAll('button')).find((b) => {
        const s = ((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
        return /escuro|claro|trocar|theme|tema/.test(s);
      });
      if (themeBtn) themeBtn.remove();
    }

    // ---------- 删除 SaaS demo 大区 ----------
    ['sponsors', 'benefits', 'testimonials', 'team', 'community', 'faq'].forEach((id) => {
      const sec = document.getElementById(id);
      if (sec && sec.parentElement) sec.remove();
    });
    // Pricing 区无 id，按首个可见标题定位
    allVisible('h2').forEach((h2) => {
      const t = (h2.textContent || '').trim();
      if (/^Pricing$/i.test(t) || /unlimitted|unlimited access/i.test(t)) {
        const sec = h2.closest('section');
        if (sec && sec.parentElement && sec.id !== 'contact') sec.remove();
      }
    });

    // ---------- hero：删 chip / Github 外链 / 底部大图 mock；主 CTA 打槽 ----------
    const heroSec = Array.from(document.querySelectorAll('section')).find((s) => s.querySelector('h1'));
    if (heroSec) {
      heroSec.id = 'top';
      const chip = Array.from(heroSec.querySelectorAll('div[class*="inline-flex"]')).find((d) => /Design is out|is out now/i.test(d.textContent || ''));
      if (chip) chip.remove();
      heroSec.querySelectorAll('a[href*="github"]').forEach((a) => a.remove());
      const mock = Array.from(heroSec.querySelectorAll('div[class*="relative"]')).find((d) => d.querySelector('img[alt="dashboard"], img[class*="md:w-[1200px]"]'));
      if (mock) mock.remove();
      const cta = Array.from(heroSec.querySelectorAll('button')).find((b) => /bg-primary/.test(b.className || ''));
      if (cta) cta.dataset.sitecraftSlot = 'hero.cta.zh';
    }

    // ---------- features/services/contact：去掉小号眉题 h2（text-lg），使共享引擎把标题写入主 h2 ----------
    const featuresSec = document.getElementById('features');
    const servicesSec = document.getElementById('services');
    const contactSec = document.getElementById('contact');
    [featuresSec, servicesSec, contactSec].forEach((sec) => {
      if (!sec) return;
      const eyebrow = Array.from(sec.querySelectorAll('h2')).find((h) => /text-lg/.test(h.className || ''));
      if (eyebrow) eyebrow.remove();
    });

    // ---------- 所有业务 section 归入 <main>（本模板原无 main） ----------
    const aboutPl = document.createElement('section');
    aboutPl.id = 'about';
    aboutPl.dataset.sitecraftGeneratedContent = 'about';
    const productsPl = document.createElement('section');
    productsPl.id = 'products';
    productsPl.dataset.sitecraftGeneratedProducts = 'true';
    const genPad = 'padding:clamp(48px,7vw,96px) clamp(20px,7vw,96px);background:inherit;color:inherit;border-top:1px solid rgba(127,127,127,.18)';
    aboutPl.style.cssText = genPad;
    productsPl.style.cssText = genPad;
    const hero = document.getElementById('top');
    const main = document.createElement('main');
    if (hero) main.append(hero);
    main.append(aboutPl);
    if (featuresSec) main.append(featuresSec);
    if (servicesSec) main.append(servicesSec);
    main.append(productsPl);
    if (contactSec) main.append(contactSec);
    if (header && header.parentElement) header.after(main);

    // ---------- footer：重建为企业联系带 ----------
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.6rem 1.6rem;justify-content:center;align-items:center;padding:1.8rem 1rem;text-align:center';
      const parts = ['<strong style="font-size:1.05em">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:inherit;text-decoration:underline">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + String(contactPhone).replace(/\\s+/g, '') + '" style="color:inherit;text-decoration:underline">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.76">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      const small = document.createElement('small');
      small.style.cssText = 'display:block;text-align:center;width:100%;opacity:.62;padding-bottom:1.6rem';
      footer.append(band, small);
    }

    // ---------- 通用清理 ----------
    document.querySelectorAll('a[href^="http"], a[href^="//"]').forEach((a) => a.remove());
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"], link[rel="preconnect"], link[rel="preload"], link[rel="prefetch"], link[href^="http"]').forEach((n) => n.remove());
  };
`;

// nativeFillFn：把 draft 内容写进模板原生排版（features/services 原生卡 + 区 intro + contact 整理）。
// 该模板需要 nativeFill：shadcn icon-grid 原生卡无 <p>，通用 applyCards 卡检测(要求卡内 p)抓不到，
// 若不填会导致回退 renderGeneratedContent 生成 features 卡墙，与原生卡重复。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const content = draft.content || {};
    const localize = (v) => (v && typeof v === 'object' ? (v[locale] || v.zh || v.en || Object.values(v)[0]) : v) || '';
    const hide = (el) => { if (el) { el.hidden = true; el.style.setProperty('display', 'none', 'important'); } };

    // ---- features：#features 6 原生 icon 卡（图标 + h3；正文 p 由本适配补建）----
    const fsec = document.getElementById('features');
    if (fsec) {
      const grid = fsec.querySelector('div[class*="grid"]');
      const intro = Array.from(fsec.querySelectorAll('h3')).find((h) => !h.closest('div[class*="grid"]'));
      const introVal = localize(content.features?.intro);
      if (intro) {
        if (introVal) setText(intro, introVal, 'features.intro.' + locale, applied);
        else hide(intro);
      }
      if (grid) {
        const cells = Array.from(grid.children);
        const items = (content.features?.items && Array.isArray(content.features.items)) ? content.features.items : [];
        cells.forEach((cell, index) => {
          if (index >= items.length) { hide(cell); return; }
          cell.hidden = false;
          cell.style.removeProperty('display');
          const item = items[index];
          const key = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
          const h3 = cell.querySelector('h3');
          const title = item?.title ? localize(item.title) : '';
          if (h3 && title) setText(h3, title, 'features.items.' + key + '.title.' + locale, applied);
          const bodyVal = item?.body ? localize(item.body) : '';
          if (bodyVal) {
            // 卡正文是 div（shadcn card-content：p-6 pt-0 text-muted-foreground）而非 p——用 div 承载
            let p = cell.querySelector('p') || cell.querySelector('div[class*="pt-0"], div[class*="card-content"], div[class*="text-muted-foreground"]');
            if (!p) {
              p = document.createElement('p');
              p.className = 'text-sm text-muted-foreground leading-relaxed mt-3 text-center';
              const holder = (h3 && h3.parentElement) || cell;
              holder.append(p);
            }
            if (p && p.tagName === 'P') setText(p, bodyVal, 'features.items.' + key + '.body.' + locale, applied);
            else if (p) setText(p, bodyVal, 'features.items.' + key + '.body.' + locale, applied);
          }
          // 清掉卡内其余 demo 文本节点（Lorem 等，保留 svg 图标）
          Array.from(cell.querySelectorAll('*')).forEach((n) => {
            if (!n.children.length && n !== cell.querySelector('h3') && !n.closest('svg') && !n.dataset?.sitecraftSlot && !n.getAttribute?.('data-sitecraft-slot')) {
              const t = (n.textContent || '').trim();
              if (/lorem|ipsum|dolor|mobile friendly|social proof|targeted content|strong visuals|clear cta|clear headline/i.test(t)) n.remove();
            }
          });
        });
      }
    }

    // ---- services：#services 原生 4 卡（h3+p）----
    const ssec = document.getElementById('services');
    if (ssec) {
      const grids = Array.from(ssec.querySelectorAll('div[class*="grid"]'));
      // 首 grid 是空容器(模板 demo 残留)，隐藏之
      grids.forEach((g) => { if (!g.children.length) hide(g); });
      const cardGrid = grids.find((g) => g.querySelector('h3') && g.querySelector('p'));
      const intro = Array.from(ssec.querySelectorAll('h3')).find((h) => !h.closest('div[class*="grid"]'));
      const introVal = localize(content.services?.intro);
      if (intro) {
        if (introVal) setText(intro, introVal, 'services.intro.' + locale, applied);
        else hide(intro);
      }
      if (cardGrid) {
        const cards = Array.from(cardGrid.children).filter((c) => c.querySelector('h3'));
        const items = (content.services?.items && Array.isArray(content.services.items)) ? content.services.items : [];
        cards.forEach((card, index) => {
          if (index >= items.length) { hide(card); return; }
          card.hidden = false;
          card.style.removeProperty('display');
          const item = items[index];
          const key = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
          const h3 = card.querySelector('h3');
          const p = card.querySelector('p');
          const title = item?.title ? localize(item.title) : '';
          const bodyVal = item?.body ? localize(item.body) : '';
          if (h3 && title) setText(h3, title, 'services.items.' + key + '.title.' + locale, applied);
          if (p && bodyVal) setText(p, bodyVal, 'services.items.' + key + '.body.' + locale, applied);
        });
      }
    }

    // ---- contact：清 demo 英文联系方式行 / Subject 下拉，把引擎生成的 email/phone/address 块挪入左列 ----
    const csec = document.getElementById('contact');
    if (csec) {
      const gridSec = csec.querySelector('section[class*="grid"], div[class*="grid"]');
      const cols = gridSec ? Array.from(gridSec.children) : [];
      const leftCol = cols[0];
      if (leftCol) {
        const rows = leftCol.querySelector('div.flex-col.gap-4, div[class*="gap-4"]');
        if (rows) rows.remove();
      }
      const combo = csec.querySelector('button[role="combobox"]');
      if (combo && combo.parentElement) combo.parentElement.remove();
      const details = csec.querySelector('[data-sitecraft-contact-details]');
      if (details && leftCol) leftCol.append(details);
    }
  };
`;

export const shadcnLanding2Adapter: TemplateAdapter = {
  templateId: "shadcn-landing2",
  prepareFn,
  nativeFillFn,
  designTokenCss:
    '[data-sitecraft-generated-products], [data-sitecraft-generated-content], footer{background:#fff}' +
    '[data-sitecraft-generated-products] h2, [data-sitecraft-generated-content] h2, #features h2, #services h2, #contact h2{color:var(--sitecraft-primary)!important}' +
    // 产品 6 卡浅色模板固定 3 列（避免 auto-fit 5+1 失衡）
    '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
    '[data-sitecraft-generated-products] article{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;box-shadow:0 1px 2px rgba(15,23,42,.05)}' +
    '#contact .grid{display:grid}',
};
