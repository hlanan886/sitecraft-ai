import type { TemplateAdapter } from "./types.ts";

/**
 * awesome（= ttntm/astro-landing-page）专属适配 —— 企业官网形态。
 *
 * 原模板（vendor/open-source-templates/awesome/dist/index.html）结构（已核）：
 *   header.header(min-h-screen) = nav(logo img + About/Features/Follow/Register Now 链接) +
 *     居中 hero(h1「New Thing: AWE.SOME」+ h2「Intro goes here...」+ 旋转 li 列表 + p「…think about it!」
 *     + 右侧 undraw 插画) + 底部「More Information」CTA →
 *   main > div#about(Maecenas 假文 + undraw 插画 + CTA) →
 *         div#features(bg-blue-900 深蓝带：h2「Most AWE.SOME Features」+ intro +
 *            6 行 icon_row：div.w-full.sm:w-1/2.flex.flex-row = 左 icon img(w-16) + 右 h3 大写标题 + 文本 div)
 *            + 尾 h3「…and so much more!」+ Register CTA) →
 *         div#register(bg-gray-800 注册表单 + gdpr)
 *   → footer(外链列) + 版权 + 浮动 GitHub/UP + popper/tippy CDN(移动汉堡菜单与 #follow tooltip)。
 *
 * 模板正文是 Lorem 占位、图片 src 全为 https://example.com/...（Astro site 误配 example.com 烘焙出的绝对地址），
 * 但 dist/img 物理存在该模板自带的一组真实 SVG（logo/features/iconN/undraw 插画），经 assets 路由可正常服务。
 *
 * 企业站编排（不建卡墙、demo 零残留、真实资产可用）：
 *   hero       ← h1 大标题(去掉 demo 眉题层级)+ p 副文 + 底部 CTA(共享引擎改写文本，adapter 打 hero.cta 槽)；
 *                右侧 undraw 插画保留并指向本地 assets（真实视觉资产而非 404）。
 *   features   ← #features 深蓝带 6 行 icon_row：engine 写 title/intro（草稿缺则整块隐藏 demo 标题），
 *                nativeFill 把 features.items 逐条写进 h3+文本 div，icon 图保留（重指本地 assets）。
 *   about/services/products/contact ← demo 区删除后由共享引擎 generated（带图产品卡 6 卡）；
 *                designTokenCss 统一深蓝带与生成区（约白带、contact 用模板同系深海军蓝收尾）。
 * 删除：h2「Intro goes here...」/旋转列表 / #about / #register(表单) / #features 尾 demo / 外链 / CDN 脚本。
 * 转义铁律：adapter 源码字符串禁反引号禁 ${；含冒号(:)类名一律 className contains，不用 CSS 选择器。
 */
const heroFn = `
  const resolveHeroByAdapter = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    return allVisible('header h1')[0] || null;
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
    const featContent = draft?.content?.features || {};
    const hasFTitle = Boolean(featContent.title);
    const hasFIntro = Boolean(featContent.intro);

    // 1) demo 大区整节删除：#about(Maecenas 假文) / #register(注册表单)。企业内容由共享引擎 generated。
    const killIds = ['about', 'register'];
    killIds.forEach((id) => { const s = document.getElementById(id); if (s) s.remove(); });

    // 2) #features = 原生 icon_row 深蓝带资产：打 features scope/section 标记 + 清尾部 demo 尾巴。
    const feat = document.getElementById('features');
    if (feat) {
      feat.dataset.sitecraftScope = 'features';
      feat.dataset.sitecraftSection = 'features';
      feat.dataset.sitecraftNativeFeatures = 'true';
      // 尾部 demo：'...and so much more!' 标题 + 'Register Now' CTA（href=#register）删除
      const tailH = Array.from(feat.querySelectorAll('h3')).filter((h) => /so much more/i.test(h.textContent || ''))[0];
      if (tailH) { const shell = tailH.closest('div'); if (shell) shell.remove(); }
      const regCta = feat.querySelector('a[href="#register"]');
      if (regCta) { const shell = regCta.closest('div'); if (shell) shell.remove(); }
      // 草稿无 features.title/intro 时删掉 demo 标题块（避免英文 'Most AWE.SOME Features' / Pellentesque 残留）
      if (!hasFTitle && !hasFIntro) {
        const headBox = feat.querySelector('div[class*="sm:w-2/3"]');
        if (headBox) headBox.remove();
      }
    }

    // 3) header：logo → 企业名；导航重建 5 中文锚点；hero 视觉清理；首屏标题/副文容器保留。
    const header = document.querySelector('header');
    if (header) {
      if (!header.id) header.id = 'top';
      const logo = header.querySelector('nav a[href*="example.com"]');
      if (logo) {
        logo.innerHTML = '';
        logo.setAttribute('href', '#top');
        const sp = document.createElement('span');
        sp.dataset.sitecraftBrand = 'true';
        sp.style.cssText = 'font-weight:800;font-size:1.2rem;letter-spacing:.02em;color:#111827;white-space:nowrap';
        sp.textContent = brandName;
        logo.append(sp);
      }
      // 删除 hero 中间 demo 层级：h2「Intro goes here...」与大写眉题仅保留 h1 作首屏标题
      Array.from(header.querySelectorAll('h2')).forEach((h) => h.remove());
      const heroList = header.querySelector('span.content__container, [class*="content__container"]');
      if (heroList) heroList.remove();
      // 导航：#menu 清空重建（保留 id/menuBtn/汉堡 id），去掉 Follow/Mastodon/LinkedIn/Register Now demo
      const menu = document.getElementById('menu');
      if (menu) {
        menu.innerHTML = '';
        const navKeys = ['about', 'features', 'products', 'services', 'contact'];
        const labels = [localize(navCopy.about) || '关于我们', localize(navCopy.features) || '产品方案', localize(navCopy.products) || '产品中心', localize(navCopy.services) || '服务支持', localize(navCopy.contact) || '联系我们'];
        const targets = ['#about', '#features', '#products', '#services', '#contact'];
        navKeys.forEach((key, i) => {
          const a = document.createElement('a');
          a.setAttribute('href', targets[i]);
          a.textContent = labels[i];
          a.dataset.sitecraftSlot = 'navigation.' + key + '.zh';
          a.style.cssText = 'display:inline-block;padding:.5rem .8rem;color:#1f2937;font-weight:700;font-size:1rem;white-space:nowrap;text-decoration:none';
          menu.append(a);
        });
      }
      // Follow tooltip 触发点删除（连同模板 followTip）
      const follow = header.querySelector('#follow');
      if (follow) follow.remove();
      const followTip = document.getElementById('followTip');
      if (followTip) followTip.remove();
      // hero 首屏标题 h1：加大为真正的首屏大标题（文本由共享引擎改写），右侧插画保留
      const heroTitle = header.querySelector('h1');
      if (heroTitle) {
        heroTitle.style.cssText = 'font-size:clamp(2.1rem,5vw,3.6rem);line-height:1.12;font-weight:800;letter-spacing:-.01em;color:#111827';
        heroTitle.setAttribute('data-sitecraft-slot', 'hero.title.zh');
      }
      const heroPara = header.querySelector('p');
      if (heroPara) {
        heroPara.style.cssText = 'font-size:clamp(1.15rem,2.2vw,1.55rem);font-weight:400;letter-spacing:normal;line-height:1.8;color:#374151;max-width:34em';
      }
      // 底部「More Information」CTA → 主 CTA（hero.cta 槽），指向 #features
      const pill = header.querySelector('a[class*="rounded-full"]');
      if (pill) {
        pill.setAttribute('href', '#features');
        pill.dataset.sitecraftSlot = 'hero.cta.zh';
      }
    }

    // 4) footer：清 demo 外链列，重建企业联系（版权行一并清理）
    const footer = document.querySelector('footer');
    if (footer) {
      footer.innerHTML = '';
      footer.style.cssText = 'display:block;padding:clamp(2rem,4vw,3rem) clamp(1rem,5vw,4rem);background:#ffffff';
      const band = document.createElement('div');
      band.dataset.sitecraftFooterContent = 'true';
      band.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem 1.5rem;text-align:center;color:#374151;font-size:.92rem';
      const parts = ['<strong style="color:#111827;font-weight:700">' + brandName + '</strong>'];
      if (contactEmail) parts.push('<a href="mailto:' + contactEmail + '" style="color:#4338ca;text-decoration:none">' + contactEmail + '</a>');
      if (contactPhone) parts.push('<a href="tel:' + contactPhone.replace(/\\s+/g, '') + '" style="color:#4338ca;text-decoration:none">' + contactPhone + '</a>');
      if (addressText) parts.push('<span style="opacity:.8">' + addressText + '</span>');
      band.innerHTML = parts.join('');
      footer.append(band);
    }
    // footer 下方独立版权行：'© AWE.SOME' → 企业版权
    document.querySelectorAll('span, small, p, div').forEach((n) => {
      if (n.children.length) return;
      const t = (n.textContent || '').trim();
      if (t.indexOf('©') >= 0) n.textContent = '© ' + brandName;
    });

    // 5) demo 浮动 UI：GitHub 源码角标 / 回到顶部 / 外链
    const gh = document.querySelector('a[href*="github.com"]');
    if (gh) gh.remove();
    const btt = document.getElementById('btt');
    if (btt) btt.remove();

    // 6) 脚本：移除 popper/tippy CDN 与调用 tippy 的内联脚本（防离线 ReferenceError/pageerror）；
    //    补一个安全的汉堡 navToggle（只挂一次），保留移动端菜单可用。
    Array.prototype.forEach.call(document.querySelectorAll('script'), (s) => {
      const src = s.getAttribute('src') || '';
      const txt = s.textContent || '';
      if (/unpkg\\.com/.test(src)) s.remove();
      else if (txt.indexOf('tippy(') >= 0) s.remove();
    });
    if (!window.__awesomeSafeNav) {
      window.__awesomeSafeNav = true;
      const ns = document.createElement('script');
      ns.textContent = "function navToggle(){var b=document.getElementById('menuBtn');var n=document.getElementById('menu');if(b&&n){b.classList.toggle('open');n.classList.toggle('flex');n.classList.toggle('hidden')}}";
      document.body.appendChild(ns);
    }

    // 7) 真实资产修复：example.com 绝对图 src 全部重指本地 assets（相对 base），消除 404 破图。
    //    （模板 dist/img 物理含 logo/features/undraw SVG，assets 路由可服务）
    document.querySelectorAll('img[src^="https://example.com/"]').forEach((im) => {
      const s = im.getAttribute('src') || '';
      im.setAttribute('src', s.replace('https://example.com/', ''));
    });

    // 8) 通用清理：外链锚点 / preconnect(CDN) / og-twitter 等 meta
    document.querySelectorAll('a[href^="http"], a[href^="//"]').forEach((a) => a.remove());
    document.querySelectorAll('link[href^="http"], link[href^="//"], link[rel="preconnect"], link[rel="preload"]').forEach((n) => n.remove());
    document.head.querySelectorAll('meta[name="generator"], meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    let description = document.head.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement('meta');
      description.setAttribute('name', 'description');
      document.head.append(description);
    }
    description.setAttribute('content', (brandName ? brandName + '：' : '') + localize(draft?.content?.about?.body));
  };
`;

// nativeFillFn：把 draft.features.items 写进 #features 深蓝带原生 6 行 icon_row
// （每行 w-full sm:w-1/2 flex flex-row = 左 icon + 右 h3 大写标题 + 文本 div）。
// 保留 icon img（已重指本地 assets）；行打 sitecraft-slot → 短路通用卡墙（不建卡墙）。
const nativeFillFn = `
  const applyNativeContentFill = (draft, locale, applied) => {
    const features = draft.content?.features || {};
    const items = (features.items && Array.isArray(features.items)) ? features.items : [];
    const feat = document.getElementById('features');
    if (!feat) return;
    feat.dataset.sitecraftNativeFeatures = 'true';
    feat.dataset.sitecraftSection = 'features';
    const rows = Array.from(feat.querySelectorAll('div')).filter((row) => {
      const c = String(row.className || '');
      return c.indexOf('flex flex-row') >= 0 && row.querySelector('h3');
    });
    if (!rows.length) return;
    rows.slice(items.length).forEach((row) => {
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute('aria-hidden', 'true');
    });
    rows.slice(0, items.length).forEach((row, index) => {
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      const h3 = row.querySelector('h3');
      const body = Array.from(row.querySelectorAll('div')).find((d) => String(d.className || '').indexOf('font-light') >= 0);
      if (h3 && item && item.title) setText(h3, localize(item.title, locale), 'features.items.' + itemKey + '.title.' + locale, applied);
      if (body && item && item.body) setText(body, localize(item.body, locale), 'features.items.' + itemKey + '.body.' + locale, applied);
      row.dataset.sitecraftSection = 'features';
      row.dataset.sitecraftItemId = itemKey;
    });
  };
`;

const designTokenCss =
  // 生成区统一浅底（template 深蓝 features 带之外企业内容用白/浅灰），文字收敛深灰
  '[data-sitecraft-generated-content="about"], [data-sitecraft-generated-content="services"]{background:#ffffff!important;color:#1f2937!important;border-top:1px solid rgba(15,23,42,.06)!important}' +
  '[data-sitecraft-generated-products]{background:#f8fafc!important;color:#1f2937!important;border-top:1px solid rgba(15,23,42,.06)!important}' +
  '[data-sitecraft-generated-content] h2, [data-sitecraft-generated-products] h2{color:#111827!important}' +
  '[data-sitecraft-generated-content] h3, [data-sitecraft-generated-products] h3{color:#111827!important}' +
  '[data-sitecraft-generated-content] p, [data-sitecraft-generated-products] p, [data-sitecraft-generated-products] small{color:#4b5563!important}' +
  '[data-sitecraft-generated-products] article{background:#ffffff!important;border:1px solid rgba(15,23,42,.12)!important}' +
  // contact 用模板同系深海军蓝收尾（呼应 #features bg-blue-900），文字浅色
  '[data-sitecraft-generated-content="contact"]{background:linear-gradient(165deg,#0f172a,#1e2a47)!important;color:#dbe3ee!important}' +
  '[data-sitecraft-generated-content="contact"] h2{color:#f8fafc!important}' +
  '[data-sitecraft-generated-content="contact"] p, [data-sitecraft-generated-content="contact"] address{color:#9fb0c3!important}' +
  '[data-sitecraft-generated-content="contact"] a{color:#7dd3fc!important}' +
  // 产品 6 卡固定 3 列成 2 行（避免 auto-fit 5+1 失衡）
  '[data-sitecraft-generated-products] > div:last-child{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:20px!important}' +
  '@media(max-width:900px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:repeat(2,minmax(0,1fr))!important}}' +
  '@media(max-width:600px){[data-sitecraft-generated-products] > div:last-child{grid-template-columns:1fr!important}}';

export const awesomeAdapter: TemplateAdapter = {
  templateId: "awesome",
  prepareFn,
  heroFn,
  nativeFillFn,
  designTokenCss,
};
