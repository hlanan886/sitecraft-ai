import type { TemplateAdapter } from "./types.ts";

/**
 * screwfast 首页包含面向模板作者的评价、定价、FAQ 与社区 CTA。
 * 演示站只保留制造企业需要的首屏、能力、服务、产品和联系区。
 */
const sanitize: TemplateAdapter["sanitize"] = {
  sections: [
    "Trusted by Industry Leaders",
    "Meeting Industry Demands",
    "Customize ScrewFast",
    "Fast-Track Your Projects",
    "Simple, Transparent Pricing",
    "Frequently Asked Questions",
    "Let's Build Together",
  ],
  leafPatterns: [
    "Log in",
    "Sign in",
    "Sign up",
    "Forgot password",
    "Dismiss",
    "Explore ScrewFast on GitHub",
    "Start Exploring",
    "Contact Sales Team",
    "7K[+]",
    "4[.]8 / 5",
    "12[.]8k",
    "Reviews",
    "Ecosystem",
    "Company",
    "Stay up to date",
    "Documentation",
    "Construction Services",
    "Tools & Equipment",
    "About us",
    "Blog",
    "Careers",
    "Customers",
    "We['’]re hiring",
    "Stay updated with the latest tools",
    "Crafted by",
    "gulamoff",
    "Facebook",
    "Twitter",
    "GitHub",
    "Google",
    "Slack",
    "Continue with Github",
    "Subscribe",
    // 定价/FAQ 卡内嵌于服务区时的残留文案（2026-09 实测补充）
    "Starter Kit",
    "Get the Starter Kit",
    "Professional Toolbox",
    "Get the Professional Toolbox",
    "Best option for",
    "Most popular",
    "What types of tools are incl",
    "What is",
    "email support",
  ],
};

const prepareFn = `
  const prepareTemplate = () => {
    // screwfast 原生首页由「hero + Clients logo条 + FeaturesGeneral(整宽图横幅+左标题栏+右 icon 行)
    // + FeaturesNavs(Tab) + Testimonials(数据条) + Pricing/FAQ/CTA」组成。演示站是制造企业，
    // 需要「首屏 + 能力/优势(icon 行) + 产品 + 联系」。
    // 策略：保留 hero 与 FeaturesGeneral 原生区（FeaturesGeneral 是图横幅+icon 行的非卡片排版，
    // 最贴制造企业的原生资产），删掉 SaaS demo 区(logo条/定价/FAQ/评价/社区CTA)与 footer；
    // about/services/products/contact 由共享 bridge 按 SiteDraft 生成。
    // 注：各 section 外层 class 都是 mx-auto max-w-... 这类通用值，不能靠 section.className 区分；
    // 须用 section 内部结构特征（grid-cols-3+sm:grid-cols-2+图+gap-x-5 = FeaturesGeneral 独有）。
    // 也不能用 '.sm\\\\:grid-cols-2' 含冒号类名做 CSS 选择器——字符串里 \\: 塌成 : 会当伪类抛错，
    // 一律用 innerHTML/className 的字符串 contains 判断。
    const main = document.querySelector('main') || document.body;
    const allSections = Array.from(main.querySelectorAll(':scope > section'));
    const heroSection = allSections.find((section) => section.querySelector('h1')) || allSections[0];
    // FeaturesGeneral 识别：内部同时含 grid-cols-3 + sm:grid-cols-2 + <img> + gap-x-5（该区独有）
    const featuresSection = allSections.find((section) => {
      const html = section.innerHTML || '';
      return /grid-cols-3/.test(html) && /gap-x-5/.test(html) && section.querySelector('img');
    });
    // 捕获模板自带 industrial 图（construction-image 等，在将被删除的 FeaturesNavs demo 区里），
    // 供 hero 主视觉替换用——制造官网首屏放产线/厂房场景，不放包装盒渲染图。
    let industrialImageUrl = '';
    document.querySelectorAll('main img[src*="construction-image"], main img[src*="automated-tools"]').forEach((img) => {
      const u = (img.currentSrc || img.src || '');
      if (u && /_astro/.test(u)) industrialImageUrl = u;
    });
    // 把 hero 大图（hero-image 包装渲染）替换为 industrial 图
    if (industrialImageUrl) {
      const heroImgs = Array.from(heroSection ? heroSection.querySelectorAll('img') : []);
      heroImgs.forEach((img) => {
        const cur = (img.currentSrc || img.src || '');
        if (cur && cur.indexOf('hero-image.') >= 0) {
          img.src = industrialImageUrl;
          img.removeAttribute('srcset');
        }
      });
    }
    allSections.forEach((section) => {
      if (section !== heroSection && section !== featuresSection) section.remove();
    });
    // 清 demo 残留叶节点（登录/外链/评分/头像），仅在保留区内部做
    const mainAfter = document.querySelector('main') || document.body;
    const removeLinks = /^(?:Start Exploring|Contact Sales Team|Explore ScrewFast on GitHub|Log in|Sign in|Sign up|Dismiss|Learn more|From Over \\d+[.]?\\d*k? Reviews|\\d+[.]?\\d*k\\+)$/i;
    mainAfter.querySelectorAll('a, button, span').forEach((node) => {
      const v = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (v.length < 60 && removeLinks.test(v)) {
        const wrap = node.closest('[class*="avatar"], [class*="review"], [class*="rating"], [class*="stat"]');
        (wrap || node).remove();
      }
    });
    // 删 hero 内的"评分 + 客户头像"整块（4.8/5 From Over 12.8k Reviews + avatar 头像列）。
    // 这是 SaaS demo 的电商化信任元素，制造业官网不需要；容器 class 是 min-h-[5.5rem] 这类，
    // 按文本特征删整块（rating 文案可能是模板 JS 运行时拼的，静态 HTML 里未必有）。
    document.querySelectorAll('main section div').forEach((block) => {
      const t = (block.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t.length < 120 && /(?:4[.]8|12[.]8k)[^]{0,30}(?:Reviews|review)|From Over \\d+[.]?\\d*k? Reviews/i.test(t) && !block.querySelector('h1,h2,h3')) {
        // 只删到最近的稳定"评分块"父级（含 mt-6 min-h 的容器），不误删 hero 文案
        const ratingWrap = block.closest('[class*="min-h-[5.5rem]"], [class*="avatar"], [class*="review"]');
        (ratingWrap || block).remove();
      }
    });
    const banner = mainAfter.querySelector('astro-banner');
    banner?.remove();
    document.querySelectorAll('footer').forEach((footer) => footer.remove());
    // 删 header 里的登录/注册/找回密码 modal（含 demo form，触发脚本报错；制造企业站不需要）
    // 及无站点映射的演示导航（Blog/Terms/多语言切换）。这些在 header/body，不在 main。
    ['login', 'register', 'recover'].forEach((key) => {
      document.querySelectorAll('[id*="' + key + '-modal"], [id*="modal-' + key + '"]').forEach((modal) => modal.remove());
    });
    document.querySelectorAll('header [class*="hs-overlay"], [id*="modal"]').forEach((el) => {
      if (/login|register|recover|sign[- ]?in/i.test((el.id || '') + ' ' + String(el.className || ''))) el.remove();
    });
    document.querySelectorAll('header a, header button, nav a').forEach((node) => {
      const t = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      const href = node.getAttribute('href') || '';
      const demoNav = /^(blog|terms and conditions|english|français|france|deutsch|español|japanese|log in|sign up|login|sign in)$/i.test(t);
      const demoHref = /^(\\/blog|\\/(?:fr|de|es|ja|zh-cn|fa))$/i.test(href);
      if (demoNav || demoHref) node.remove();
    });
    document.querySelectorAll('[data-demo-form]').forEach((f) => f.remove());
  };
`;

// nativeFillFn：把 draft.features 填进 screwfast 原生 FeaturesGeneral 区
// （整宽图横幅 + 左栏标题/副文 + 右栏 sm:grid-cols-2 的 flex icon 行），改写 h2/p/h3+p，
// 图标保留模板自带 svg。项多于原生行时隐藏多余 demo 行。仿 forge.servicesFn"定位+改写+多隐藏"。
// 同样只用 innerHTML/className contains，不用含冒号类名的 CSS 选择器。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features;
    const items = (features && features.items) || [];
    // 定位保留的原生 FeaturesGeneral 区：内部含 grid-cols-3 + gap-x-5 + 图
    const main = document.querySelector('main') || document.body;
    const section = Array.from(main.querySelectorAll('section')).find((s) => {
      const html = s.innerHTML || '';
      return /grid-cols-3/.test(html) && /gap-x-5/.test(html) && s.querySelector('img');
    });
    if (!section) return;
    section.dataset.sitecraftNativeFeatures = 'true';
    section.dataset.sitecraftSection = 'features';
    // 左栏标题 h2（col-span-1 内）
    const leftCol = Array.from(section.querySelectorAll('div')).find((d) => /col-span-1/.test(String(d.className || '')));
    const h2 = leftCol ? leftCol.querySelector('h2') : section.querySelector('h2');
    if (h2 && (features?.title)) setText(h2, localize(features.title, locale), 'features.title.' + locale, applied);
    const introP = leftCol ? leftCol.querySelector('p') : null;
    if (introP && (features?.intro)) setText(introP, localize(features.intro, locale), 'features.intro.' + locale, applied);
    // icon 行：div class 含 gap-x-5 且有 h3+p
    const rows = Array.from(section.querySelectorAll('div')).filter((d) => {
      return /gap-x-5/.test(String(d.className || '')) && d.querySelector('h3') && d.querySelector('p');
    });
    rows.slice(items.length).forEach((row) => {
      if (!items.length) return;
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    });
    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = row.querySelector('h3');
      const body = row.querySelector('p');
      if (h3 && item?.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item?.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
    });
    // 原生区已承载 features → 打 applied 标，让 applyContent 的 hasVisibleSlotPrefix('features.items')
    // 短路，不再退回 renderGeneratedContent 的通用卡片墙。
    if (features?.title || items.length) {
      applied.add('features.title.' + locale);
      applied.add('features.intro.' + locale);
      items.forEach((item, index) => {
        const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
        applied.add('features.items.' + itemKey + '.title.' + locale);
        applied.add('features.items.' + itemKey + '.body.' + locale);
      });
    }
  };
`;

export const screwfastAdapter: TemplateAdapter = {
  templateId: "screwfast",
  prepareFn,
  nativeFillFn,
  sanitize,
};
