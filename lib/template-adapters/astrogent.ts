import type { TemplateAdapter } from "./types.ts";

/**
 * ASTROGENT / Agency 专属适配 —— 企业官网形态。
 *
 * 原模板（AstroGen "mono" 浅色 Agency/产品落地页）结构（已核 dist/index.html）：
 *   nav(fixed: 品牌 + Features/How It Works/Pricing/FAQ + Get Started) →
 *   hero section(无 id，mono-mesh 浅色渐变：居中 h1 大标题(内嵌 <br>+强调 span) + 副文 p
 *     + 双 CTA(Get Started Free / See How It Works) + 统计行 10k+/99.9%/5M+) →
 *   #features("Powerful Capabilities"，9 张原生 border p-8 卡 = svg 图标 + h3 + p，
 *     grid lg:grid-cols-3；卡带 scroll-fade-* 与 stagger-N 等动画类) →
 *   #how-it-works(5 步流程卡，demo) → testimonial("Loved by Teams" 评价 + "Trusted by" logo 条，demo) →
 *   #pricing(3 档定价，demo) → #faq(手风琴，demo) → #contact("Start Building Today" 表单询盘区) → footer。
 *
 * 企业站保留：hero + #features(原生能力卡) + #contact(原生询盘表单区)。
 * 共享引擎 generated 承载 about/products/services，pre-place 到 features 与 contact 之间保持阅读顺序。
 *
 * 编排:
 *   hero     ← 引擎改写 h1；副文/双 CTA 由 prepare 中文化（模板无 <main>，共享 CTA 槽位扫不到，
 *              必须在 prepare 内处理）；统计行("Active Agents" 等)整行删除。
 *   features ← 引擎写 title/intro；nativeFillFn 把 draft.features.items(≤6) 写进 9 张原生 border 卡
 *              (h3+p) 并隐藏多余卡，打 slot → 短路通用 features 卡墙。
 *   services/products/about ← 共享引擎 generated，pre-place 带 id 的空 section(#services/#products/#about)
 *              使生成区落在 #contact 之前、导航锚点可滚。
 *   contact  ← 引擎写原生标题/正文/email/phone/address；prepare 清英文演示勾选/条款留白表单。
 *   nav      ← 品牌→企业名 + 5 中文锚点；footer 清 demo 大列重建企业联系。
 *
 * 转义铁律: adapter 源码字符串禁反引号、禁 ${；含冒号(:) 类名不当 CSS 选择器用 className contains。
 * 动画: 卡上 scroll-fade-* 与 stagger-* 由 prepare 移除，另 designTokenCss 加 !important 兜底（仿 lonestone）。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('body > section h1, h1')[0] || null;
  };
`;

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
    const labelOf = (k, fb) => localize(navCopy[k]) || fb;
    const navKeys = ['about', 'features', 'products', 'services', 'contact'];
    const navLabels = [labelOf('about', '关于我们'), labelOf('features', '产品方案'), labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们')];
    const navTargets = ['#about', '#features', '#products', '#services', '#contact'];

    // 1) 清掉全站 scroll-fade-*/stagger-* 动画类（IntersectionObserver 未触发时 CSS 把元素停 opacity:0/translate）。
    //    仅处理 className 为字符串的 HTML 元素（跳过 SVGAnimatedString）。
    document.querySelectorAll('[class*="scroll-fade"], [class*="stagger"]').forEach((el) => {
      if (typeof el.className !== 'string') return;
      const keep = el.className.split(' ').filter((c) => c.indexOf('scroll-fade') < 0 && c.indexOf('stagger-') < 0);
      el.className = keep.join(' ');
    });

    // 2) 导航重建：清 demo 菜单(Features/Pricing/FAQ/Get Started)，换成 5 中文锚点；品牌→企业名。
    const nav = document.querySelector('nav');
    if (nav) {
      nav.querySelector('#mobileMenuButton')?.remove();
      nav.querySelector('#mobileMenu')?.remove();
      const menu = nav.querySelector('.hidden.items-center.space-x-8');
      if (menu) {
        menu.innerHTML = '';
        navLabels.forEach((label, i) => {
          const a = document.createElement('a');
          a.setAttribute('href', navTargets[i]);
          a.textContent = label;
          a.style.cssText = 'color:#27272a;text-decoration:none;font-size:.95rem;font-weight:500;white-space:nowrap';
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          menu.append(a);
        });
      }
      const brand = nav.querySelector('a[href="/"]');
      if (brand) {
        brand.setAttribute('href', '#top');
        brand.textContent = '';
        brand.style.cssText = 'text-decoration:none';
        const span = document.createElement('span');
        span.textContent = brandName;
        span.style.cssText = 'font-weight:700;color:#18181b;letter-spacing:.01em;font-size:1.1rem';
        brand.append(span);
      }
    }

    // 3) hero section（第一个 body>section 无 id）：id=top；删统计行；副文预写中文兜底；双 CTA 中文化。
    const hero = allVisible('h1')[0] ? allVisible('h1')[0].closest('section') : null;
    if (hero) {
      hero.id = 'top';
      // 统计行（10k+ Active Agents / 99.9% Uptime / 5M+ Tasks Automated）
      Array.from(hero.querySelectorAll('div')).forEach((d) => {
        const c = ' ' + String(d.className || '') + ' ';
        if (c.indexOf(' border-t ') >= 0 && c.indexOf(' pt-20 ') >= 0) d.remove();
      });
      // 副文 p：无 hero.subtitle 时用 features.intro/about.body 一句话兜底，绝不留英文 demo 长句
      const sub = allVisible('p', hero)[0];
      const heroLine = localize(draft?.content?.hero?.subtitle) || localize(draft?.content?.features?.intro) || localize(draft?.content?.about?.body) || '';
      if (sub) {
        if (heroLine) sub.textContent = heroLine;
        else { sub.textContent = ''; sub.hidden = true; sub.style.setProperty('display', 'none', 'important'); }
      }
      // 双 CTA
      const ctaPrimary = hero.querySelector('a[href="#contact"]');
      const ctaSecondary = hero.querySelector('a[href="#how-it-works"]');
      const primaryLabel = localize(draft?.content?.hero?.cta) || '获取报价';
      if (ctaPrimary) {
        ctaPrimary.setAttribute('href', '#contact');
        ctaPrimary.textContent = primaryLabel;
        ctaPrimary.dataset.sitecraftSlot = 'hero.cta.zh';
      }
      if (ctaSecondary) {
        ctaSecondary.setAttribute('href', '#features');
        ctaSecondary.textContent = '了解方案';
        ctaSecondary.dataset.sitecraftSlot = 'hero.cta.secondary.zh';
      }
    }

    // 4) #features 原生卡区标记（供 scopeBy 精确认领 + nativeFill 定位；引擎写 title/intro）
    const featuresSection = document.getElementById('features');
    if (featuresSection) {
      featuresSection.dataset.sitecraftScope = 'features';
      featuresSection.dataset.sitecraftSection = 'features';
      featuresSection.dataset.sitecraftNativeFeatures = 'true';
    }

    // 5) 删除 SaaS demo 大区（heading 定位整节移除）：how-it-works / testimonials / pricing / faq
    const killByHeading = [/How It Works/i, /Loved by Teams Worldwide/i, /Simple, Transparent Pricing/i, /Frequently Asked Questions/i];
    allVisible('h2,h3').forEach((heading) => {
      const t = (heading.textContent || '').trim();
      if (killByHeading.some((re) => re.test(t))) {
        const sec = heading.closest('section');
        if (sec && sec.id !== 'features' && sec.id !== 'contact') sec.remove();
      }
    });

    // 6) #contact 原生询盘区：保留标题段 + 表单；清英文演示（勾选列表 / Questions 块 / 表单条款）
    const contactSection = document.getElementById('contact');
    if (contactSection) {
      contactSection.dataset.sitecraftScope = 'contact';
      contactSection.dataset.sitecraftSection = 'contact';
      Array.from(contactSection.querySelectorAll('ul')).forEach((u) => { if (u.querySelector('li')) u.remove(); });
      // 只删 "Questions? Reach out" 所在小容器（不含 h2/h3 的 div），勿误删承载标题的整列
      Array.from(contactSection.querySelectorAll('div')).forEach((d) => {
        if (d.querySelector('h1, h2, h3')) return;
        if (/Questions\\?|Reach out to our team/i.test(d.textContent || '')) d.remove();
      });
      const form = contactSection.querySelector('form');
      if (form) {
        Array.from(form.querySelectorAll('p')).forEach((p) => {
          if (/agree to our|Terms of Service|Privacy Policy/i.test(p.textContent || '')) p.remove();
        });
      }
    }

    // 7) 共享 generated 区（about/products/services）pre-place 到 #features 与 #contact 之间，
    //    带 id(#about/#products/#services) 使导航锚点可滚、区块顺序清爽（#contact 收尾询盘）。
    const contactRef = document.getElementById('contact');
    if (contactRef) {
      const styled = (key) => {
        const s = document.createElement('section');
        s.dataset.sitecraftSection = key;
        s.style.cssText = 'padding:clamp(48px,6vw,88px) clamp(20px,6vw,88px);background:inherit;color:inherit';
        return s;
      };
      const aboutPh = styled('about');
      aboutPh.id = 'about';
      aboutPh.dataset.sitecraftGeneratedContent = 'about';
      const servicesPh = styled('services');
      servicesPh.id = 'services';
      servicesPh.dataset.sitecraftGeneratedContent = 'services';
      const productsPh = styled('products');
      productsPh.id = 'products';
      productsPh.dataset.sitecraftGeneratedProducts = 'true';
      productsPh.style.borderTop = '1px solid rgba(0,0,0,.06)';
      contactRef.before(aboutPh);
      contactRef.before(productsPh);
      contactRef.before(servicesPh);
    }

    // 8) footer：清 demo 大列网格(Product/Company/Legal + 社交图标)，重建企业联系
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;align-items:center;min-height:110px;padding:2.4rem 1.2rem;color:#d4d4d8;font-size:.92rem;text-align:center';
      const parts = ['<strong style="color:#ffffff;font-weight:700;font-size:1rem">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#c7d2fe;text-decoration:none">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#c7d2fe;text-decoration:none">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.8">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 9) 通用清理：外部演示外链 / srcset / canonical-og-twitter meta
    document.querySelectorAll('a[href^="http"]').forEach((a) => a.remove());
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.append(description);
    }
    description.setAttribute('content', (company ? company + '：' : '') + (localize(draft?.content?.about?.body) || ''));
  };
`;

// nativeFillFn：把 draft.features.items 写进 ASTROGENT 原生 #features 的 9 张 border 卡（svg+h3+p）。
// 卡 className 含 border/p-8（无 card/item 词），共享 applyCards 的选择器扫不到，必须专属改写；
// 改写后 h3/p 打 features.items slot → hasVisibleSlotPrefix 短路通用 features 卡墙。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const section = document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    const cards = Array.from(section.querySelectorAll('div')).filter((d) => {
      const c = ' ' + String(d.className || '') + ' ';
      return c.indexOf(' p-8 ') >= 0 && d.querySelector('h3') && d.querySelector('p');
    });
    if (!items.length) {
      cards.forEach((card) => { card.hidden = true; card.style.setProperty('display', 'none', 'important'); });
      return;
    }
    cards.slice(items.length).forEach((card) => {
      card.hidden = true;
      card.style.setProperty('display', 'none', 'important');
      card.setAttribute('aria-hidden', 'true');
    });
    cards.slice(0, items.length).forEach((card, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = card.querySelector('h3');
      const body = card.querySelector('p');
      if (h3 && item && item.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item && item.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      card.dataset.sitecraftSection = 'features';
      card.dataset.sitecraftItemId = itemKey;
    });
  };
`;

const designTokenCss =
  // 首屏滚动动画兜底：任何时刻内容恒可见（清除 opacity-0/translate 残留）
  '#top, #top h1, #top p, #top a, #features, #features h2, #features h3, #features p, [class*="scroll-fade"], [class*="stagger"]{opacity:1!important;visibility:visible!important;transform:none!important;animation:none!important}' +
  'html,body{background:#ffffff!important;color:#18181b!important}' +
  'nav{background:rgba(255,255,255,.97)!important}' +
  'nav a{color:#27272a!important}' +
  '#features h2{color:#18181b!important}' +
  '#features p{color:#3f3f46!important}' +
  // 共享 generated 区：浅色面板 + 原生风格白卡
  '[data-sitecraft-generated-content="about"]{background:#fafaf7!important}' +
  '[data-sitecraft-generated-content="services"]{background:#f6f4f0!important}' +
  '[data-sitecraft-generated-content] h2,[data-sitecraft-generated-products] h2{color:#18181b!important}' +
  '[data-sitecraft-generated-content] p,[data-sitecraft-generated-products] p{color:#3f3f46!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#ffffff!important;border:1px solid #e5e2dc!important;border-radius:12px!important;box-shadow:0 1px 2px rgba(0,0,0,.04)!important}' +
  '[data-sitecraft-generated-products] article img{border-radius:8px!important;background:#eef0f2}' +
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}' +
  '#contact h2,#contact p{color:#18181b!important}' +
  '#contact a[href^="mailto:"],#contact a[href^="tel:"]{color:#4338ca!important}' +
  'footer{background:#18181b!important;color:#d4d4d8!important}';

export const astrogentAdapter: TemplateAdapter = {
  templateId: "astrogent",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss,
};
