import type { TemplateAdapter } from "./types.ts";

/**
 * powerai（= GENAI / genai 深色 AI 模板）适配 —— 企业官网形态。
 *
 * 模板(vendor/open-source-templates/genai/dist/index.html)结构(已核)：
 *   header(sticky：渐变 sparkles logo + "GenAI" 品牌文字 + 导航 Features/Pricing/Components/
 *   Dashboard/Changelog/Contact + 主题切换/Get Started/汉堡 动作栏) →
 *   main: hero(.relative.overflow-hidden，绝对定位紫/粉/蓝渐变光斑 bg animate-blob，
 *         "Powered by AI" chip + 居中 h1(渐变强调 span) + 副文 + 双按钮 + 99.9%/10M+/50K+ 统计带) →
 *         #features("Everything you need to build with AI"：6 张 div.group.rounded-2xl.border.bg-card
 *         渐变 icon + h3 + p，lg:grid-cols-3 —— 原生核心资产，承载 features) →
 *         "Loved by developers"(评价 3 卡，dicebear 外链头像) →
 *         #pricing(Simple, transparent pricing，Free/Pro/Enterprise) →
 *         #faq(Frequently asked questions) → footer(4 列：品牌+社交外链 / Product / Company /
 *         "Stay Updated" 订阅 form)。
 *
 * 企业站只保留 hero + #features 原生渐变卡带；删整段 demo(评价/定价/FAQ/导航 demo 项/动作栏)。
 * hero 标题/副文/CTA 由共享引擎改写；#features 6 张原生 bg-card 的 h3/p 由 nativeFillFn 填入
 * (h3+p 打 slot 短路通用 features 卡墙——共享 applyCards 会因已有 features.title slot 跳过)；
 * about/services/products/contact 由共享引擎 generated 兜底。模板默认深浅双主题，这里强制 .dark，
 * 让原生渐变卡/光斑走 dark 分支，视觉统一"深色 AI 能力卡"。首屏与卡带元素带 SSR 入场
 * 内联 opacity:0 → designTokenCss 兜底恒可见。
 *
 * 转义铁律: adapter 源码字符串禁反引号/禁 ${；含冒号(:)类名不用 CSS 选择器，一律 className contains。
 */

const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('main h1, h1')[0] || null;
  };
`;

const prepareFn = `
  const prepareTemplate = () => {
    const draft = (typeof activeDraft !== 'undefined' && activeDraft) || null;
    const company = draft?.companyName || draft?.siteName || '';
    const contact = draft?.content?.contact || {};
    const localize = (v) => (v && typeof v === 'object' ? (v.zh || v.en || Object.values(v)[0]) : v) || '';
    const brandName = company || 'AI 新能源';
    const contactEmail = contact.email || '';
    const contactPhone = contact.phone || '';
    const addressText = localize(contact.address) || '';

    // GENAI 深浅双主题；以深色 AI 视觉为卖点，固定 .dark 让原生渐变卡/光斑走 dark 分支统一深色。
    // 主题切换按钮随后被删，且其 useEffect 只在偏好暗色时"添加"dark、从不移除，故不会被水合翻转。
    document.documentElement.classList.add('dark');

    // 1) header：品牌渐变方形 logo 保留 + 文字→企业名；导航清空重建 5 中文锚点；删动作栏
    const header = document.querySelector('header');
    if (header) {
      const nav = header.querySelector('nav');
      const brandLink = nav ? nav.querySelector('a[class*="space-x-2"]') : null;
      if (brandLink) {
        brandLink.setAttribute('href', '#top');
        brandLink.innerHTML = '';
        const logoBox = document.createElement('div');
        logoBox.className = 'flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 shrink-0';
        logoBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles h-5 w-5 text-white"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg>';
        const brand = document.createElement('span');
        brand.dataset.sitecraftSlot = 'companyName.zh';
        brand.style.cssText = 'font-weight:700;letter-spacing:.02em;white-space:nowrap;font-size:1.1rem;background:linear-gradient(90deg,#c4b5fd,#f9a8d4);-webkit-background-clip:text;background-clip:text;color:transparent';
        brand.textContent = brandName;
        brandLink.append(logoBox, brand);
      }
      const menu = nav ? nav.querySelector('div[class*="space-x-6"]') : null;
      const navCopy = draft?.navigation || {};
      const labelOf = (k, fb) => localize(navCopy[k]) || fb;
      const navKeys = ['about', 'features', 'products', 'services', 'contact'];
      const labels = [
        labelOf('about', '关于我们'), labelOf('features', '产品方案'),
        labelOf('products', '产品中心'), labelOf('services', '服务支持'), labelOf('contact', '联系我们'),
      ];
      const targets = ['#about', '#features', '#products', '#services', '#contact'];
      if (menu) {
        menu.innerHTML = '';
        labels.forEach((label, i) => {
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.className = 'text-sm font-medium text-muted-foreground hover:text-foreground transition-colors';
          a.textContent = label;
          a.dataset.sitecraftSlot = 'navigation.' + navKeys[i] + '.zh';
          menu.append(a);
        });
      }
      // 删主题切换 + Get Started + 移动端汉堡 动作栏（避免 demo 英文按钮残留）
      const action = nav ? nav.querySelector('div[class*="space-x-4"]') : null;
      if (action) action.remove();
    }

    // 2) hero：定位首屏 section(#top)；删 demo chip/统计带/双按钮，保留 h1+副文，补单一 CTA 锚点
    const h1Node = allVisible('main h1, h1')[0] || null;
    const heroSection = h1Node ? h1Node.closest('section') : null;
    if (heroSection) {
      heroSection.id = 'top';
      const box = heroSection.querySelector('div[class*="items-center"][class*="space-y-8"]') || heroSection;
      Array.from(box.children).forEach((child) => {
        const cls = ' ' + String(child.className || '') + ' ';
        const t = (child.textContent || '').replace(/\\s+/g, ' ').trim();
        if (/Powered by AI/.test(t)) child.remove();                 // AI chip 小胶囊
        else if (cls.indexOf('grid-cols-3') >= 0) child.remove();    // 99.9%/10M+/50K+ 统计带
        else if (cls.indexOf('flex-col') >= 0) child.remove();       // Get Started Free / View Demo 双按钮组
      });
      if (!heroSection.querySelector('[data-sitecraft-hero-cta]')) {
        const cta = document.createElement('a');
        cta.dataset.sitecraftHeroCta = 'true';
        cta.href = '#contact';
        cta.textContent = '获取电站方案';
        cta.style.cssText = 'display:inline-block;margin-top:1.1rem;padding:.8rem 1.9rem;border-radius:999px;background:linear-gradient(90deg,#8b5cf6,#ec4899);color:#fff;font-weight:700;font-size:1rem;line-height:1.2;text-decoration:none;box-shadow:0 10px 26px rgba(139,92,246,.35)';
        box.append(cta);
      }
    }

    // 3) main 里 demo 大区整段删：只留 hero(h1) 与 #features(原生渐变卡资产)
    const main = document.querySelector('main');
    if (main) {
      Array.from(main.querySelectorAll('section')).forEach((sec) => {
        const keep = (sec.id === 'features') || Boolean(sec.querySelector('h1'));
        if (!keep) {
          const host = sec.closest('astro-island');
          if (host && host !== main) host.remove();
          else sec.remove();
        }
      });
    }

    // 4) #features 打 scope=features + native 标记；共享引擎 applyCards 直接改写 6 张原生 bg-card
    const features = document.getElementById('features');
    if (features) {
      features.dataset.sitecraftScope = 'features';
      features.dataset.sitecraftSection = 'features';
      features.dataset.sitecraftNativeFeatures = 'true';
    }

    // 5) footer：清 4 列 demo(含 github/twitter/linkedin 外链与订阅 form)，重建企业联系带
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem 1.4rem;justify-content:center;align-items:center;padding:2rem 1.2rem;color:#cbd5e1;font-size:.9rem;text-align:center';
      const parts = ['<strong style="color:#f8fafc;font-weight:700">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#a5b4fc;text-decoration:none">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#a5b4fc;text-decoration:none">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.72">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }

    // 6) 通用清理：外链锚点 / srcset / canonical-preconnect / og-twitter meta；meta description 更新
    document.querySelectorAll('a[href^="http"]').forEach((a) => a.remove());
    document.querySelectorAll('[srcset]').forEach((node) => node.removeAttribute('srcset'));
    document.querySelectorAll('link[rel="canonical"], link[rel="alternate"], link[rel="preconnect"], link[rel="preload"], link[rel="prefetch"]').forEach((n) => n.remove());
    document.querySelectorAll('link[href^="http"]').forEach((n) => n.remove());
    // 删空壳交互 island（CommandPalette / CookieConsent）：SSR 无内容，但水合后会向 body 注入英文
    // cookie 弹窗/命令面板 demo 文案，企业站不需要 → 连宿一起移除，杜绝水合回灌英文 demo。
    document.querySelectorAll('astro-island[component-export="CookieConsent"], astro-island[component-export="CommandPalette"]').forEach((n) => n.remove());
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

// nativeFillFn：把 draft.features.items 逐条写进 GENAI 原生 #features 的 6 张渐变卡
// (div.rounded-2xl.border.bg-card = 渐变 inline-flex 图标 + h3 标题 + p 正文)。保留渐变图标；
// h3/p 改写后带 sitecraft-slot，令共享 hasVisibleSlotPrefix('features.items') 短路，
// 不生成通用 features 卡墙、也不会二次 applyCards。仅用 className contains 匹配，不用含冒号(:) 类名当选择器。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const section = document.getElementById('features');
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    const rows = Array.from(section.querySelectorAll('div')).filter((row) => {
      const c = ' ' + String(row.className || '') + ' ';
      return c.indexOf('bg-card') >= 0 && row.querySelector('h3') && row.querySelector('p');
    });
    if (!items.length) {
      rows.forEach((row) => { row.style.setProperty('display', 'none', 'important'); row.setAttribute('aria-hidden', 'true'); });
      return;
    }
    rows.slice(items.length).forEach((row) => {
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    });
    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = row.querySelector('h3');
      const body = row.querySelector('p');
      if (h3 && item && item.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item && item.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
    });
  };
`;

const designTokenCss =
  'html,body{background:#07070f!important;color:#e5e7eb!important}' +
  // 清 SSR 入场动画内联残留(opacity:0 + translateY)：静态导出/截图不允许文字停在不可见
  '[style*="opacity:0"]{opacity:1!important;transform:none!important}' +
  '#top h1{color:#f8fafc!important}' +
  '#top p{color:#d1d5db!important}' +
  '[data-sitecraft-scope="features"] h2{color:#f8fafc!important}' +
  '[data-sitecraft-scope="features"] h3{color:#f1f5f9!important}' +
  '[data-sitecraft-scope="features"] p{color:#cbd5e1!important}' +
  'header nav a{color:#e5e7eb!important}' +
  '[data-sitecraft-generated-content="about"]{background:#0c0f1e!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content="services"]{background:#11142a!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-products]{background:#161a33!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content="contact"]{background:linear-gradient(160deg,#0b1133,#1b1037)!important;color:#e2e8f0!important}' +
  '[data-sitecraft-generated-content] h2,[data-sitecraft-generated-products] h2{color:#f8fafc!important}' +
  '[data-sitecraft-generated-content] h3,[data-sitecraft-generated-products] h3{color:#f1f5f9!important}' +
  '[data-sitecraft-generated-content] article,[data-sitecraft-generated-products] article{background:#1b2140!important;border-color:rgba(165,180,252,.28)!important}' +
  '[data-sitecraft-generated-content="contact"] a,[data-sitecraft-generated-content="contact"] address{color:#a5b4fc!important}' +
  'footer{background:#07070f!important;color:#cbd5e1!important}' +
  // 产品 6 卡固定 3 列成 2 行，避免 auto-fit 5+1 失衡
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:18px!important}@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}';

export const poweraiAdapter: TemplateAdapter = {
  templateId: "powerai",
  sanitize: {
    sections: ["Everything you need to build with AI", "Loved by developers", "Simple, transparent pricing", "Frequently asked questions"],
    leafPatterns: [
      "99.9%",
      "10M[+]",
      "50K[+]",
      "Uptime",
      "AI Requests",
      "Users",
      "[$]0",
      "[$]49",
      "[/]month",
      "Most Popular",
      "API requests",
      "uptime SLA",
      "Basic AI models",
      "Advanced AI models",
      "All AI models",
      "Lightning Fast",
      "Enterprise Security",
      "Developer First",
      "Global Scale",
      "Auto-Optimization",
      "Sarah Chen",
      "Marcus Rodriguez",
      "Emily Watson",
      "TechCorp",
      "StartupXYZ",
      "InnovateLabs",
      "SOC 2",
      "HIPAA",
      "GDPR",
    ],
  },
  heroFn,
  prepareFn,
  nativeFillFn,
  designTokenCss,
};
