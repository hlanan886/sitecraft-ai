/**
 * 模板预览/导出的**注入桥**（B4 拆文件 · preview/route.ts 那一刀）。
 *
 * ## 为什么单独成模块
 *
 * 这段脚本占原路由 94.8KB 的 81.6%（77,341 字节）。它是**被注入进模板页面的
 * 字符串载荷**，与路由的 HTTP 逻辑（缓存、上游回源、错误分支）毫无耦合——
 * 唯一接触面是 `prepareHtml` 的一次调用。
 *
 * ## 门禁 2 复验（反引号禁令）
 *
 * `tests/no-backtick-in-injection.test.ts` 原本按**行号锚点**扫本段
 * （`preview/route.ts:93..1424`）。搬移后锚点已重定向到本文件。
 * 搬移前后均以坏样本拍红、还原拍绿，两次都跑过（见 commit 正文）。
 *
 * ## 纯搬家声明
 *
 * 函数体逐字来自 `app/api/templates/[templateId]/preview/route.ts:83-1425`，
 * **零字符改动**。唯一的语义增补是把函数本身导出供路由调用。
 */
import { getRequiredVisibleTargets, getTemplateManifest } from "@/lib/template-manifest";
import { navigationViewSnippet } from "@/lib/template-adapters/navigation-view";
import { getBrandAssetSelector, getHeroAssetSelector } from "@/lib/template-asset-registry";
import { TEMPLATE_UI_COPY } from "@/lib/template-ui-copy";
import { getTemplateAdapter } from "@/lib/template-adapters";
import { INLINE_EDIT_REJECTED_PREFIXES, INLINE_EDITABLE_PREFIXES, NAV_SLOT_PATTERN } from "@/lib/inline-edit-mapping";
import {
  MAX_TEMPLATE_EXPORT_BYTES,
  buildTemplateResourceResolverScript,
} from "@/lib/template-export-contract";

/** 注入桥的 CSP nonce（`localPreviewCsp()` 生产分支引用同一个字符串字面量）。 */
const BRIDGE_NONCE = "sitecraft-template-bridge";

export function bridgeScript(templateId: string, templateRootUrl: string | null) {
  const requiredVisibleTargets = getRequiredVisibleTargets(templateId);
  const contentSlots = getTemplateManifest(templateId)?.slots ?? [];
  const adapter = getTemplateAdapter(templateId);
  const adapterPrepareFn = adapter?.prepareFn ?? "";
  const adapterServicesFn = adapter?.servicesFn ?? "";
  const adapterNativeFillFn = adapter?.nativeFillFn ?? "";
  const adapterHeroFn = adapter?.heroFn ?? "";
  const adapterSanitize = adapter?.sanitize ?? { sections: [], leafPatterns: [] };
  const maxExportBytes = MAX_TEMPLATE_EXPORT_BYTES;
  return `<script nonce="${BRIDGE_NONCE}">
(() => {
  ${buildTemplateResourceResolverScript(templateRootUrl)}
  const templateExportMaxBytes = ${JSON.stringify(maxExportBytes)};
  const templateRequiredTargets = ${JSON.stringify(requiredVisibleTargets)};
  const templateContentSlots = ${JSON.stringify(contentSlots)};
  const templateUiCopy = ${JSON.stringify(TEMPLATE_UI_COPY)};
  const templateId = ${JSON.stringify(templateId)};
  let activeVariant = 'preview';
  let activeSiteKey = null;
  let activeLeadForm = null;
  let activeLeadRequestId = null;
  let activeUiCopy = templateUiCopy.zh;
  let activeRevision = null;
  let activeDraft = null;
  let activeLocale = 'zh';
  let activeExpectedTargets = [];
  // ---- 就地编辑状态（P3.1，2026-09-09）----
  let activeEditMode = 'ai';          // 'ai' | 'direct'：direct 模式下点选直接进入编辑
  let activeEdit = null;              // { node, slot, original, requestId }
  let deferredContent = null;         // 编辑期间挂起的 content 消息，编辑结束后 flush
  // 可映射的槽位前缀（与 lib/inline-edit-mapping.ts 的 isInlineEditableSlot 同源，服务端序列化注入）
  const inlineEditableSlot = (slot) => ${JSON.stringify(INLINE_EDITABLE_PREFIXES)}.some((prefix) => slot === prefix || slot.startsWith(prefix + '.')) || /^(features|services)\\.items\\.|^products\\./.test(slot);
  // 中段带变量的导航槽（⑥）。正则源在 lib/inline-edit-mapping.ts，
  // 改那里就会改到这里——**别在这段注入脚本里另写一份**，两处一定会漂。
  //
  // ⚠️ 这里**不校验 id 是否真的存在**（那份正则在服务端也不带草稿）。
  // 判宽了最坏是"点了才被拒并看到原因"；判窄了是"点了毫无反应"。
  // 真正拦得住的是父窗口保存时那次 slotToDraftOperation。
  const editableSlot = (slot) => inlineEditableSlot(slot) || new RegExp(${JSON.stringify(NAV_SLOT_PATTERN)}).test(slot);
  const INLINE_EDIT_REJECTED = ${JSON.stringify(INLINE_EDIT_REJECTED_PREFIXES)};
  // 可见性判定：除无布局/display:none/visibility:hidden 外，还要排除 sr-only 类"仅屏幕阅读器"元素
  // （absolute + 1px + clip 裁剪，getClientRects 仍会给出 1px 矩形，不能视为可见槽位）。
  const isScreenReaderOnly = (node) => {
    const style = getComputedStyle(node);
    if (style.position !== 'absolute') return false;
    const w = parseFloat(style.width); const h = parseFloat(style.height);
    const clip = style.clip || style.clipPath || '';
    return (w >= 0 && w <= 2 && h >= 0 && h <= 2) && /rect\\(|clip|0%/.test(clip);
  };
  const visible = (node) => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden' && !isScreenReaderOnly(node));
  const allVisible = (selector, scope = document) => Array.from(scope.querySelectorAll(selector)).filter(visible);
  const findHero = () => document.querySelector('[data-sitecraft-slot^="hero.title."]') || allVisible('main h1, header h1, h1')[0];
  const findSubtitle = (hero) => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.subtitle."]');
    if (existing) return existing;
    const scope = hero?.closest('section, header, main, article') || document;
    return allVisible('p', scope)[0];
  };
  // 模板专属 hero 定位器（adapter.heroFn 声明时注入为 resolveHeroByAdapter）；否则退回通用 findHero()。
  ${adapterHeroFn}
  const resolveHero = () => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.title."]');
    if (existing) return existing;
    if (typeof resolveHeroByAdapter === 'function') {
      const node = resolveHeroByAdapter();
      if (node) return node;
    }
    return findHero();
  };
  const localize = (value, locale) => value && typeof value === 'object' ? (value[locale] || value.zh || value.en) : value;
  /**
   * 修复「**任意值背景类未被编译成 CSS**」的通用兜底（T-21 机制 b / T-28）。
   *
   * ## 问题（vendor 构建缺陷，非本仓注入缺陷）
   *
   * 部分模板的 HTML 用了 Tailwind 任意值类，例如 forge 的
   * <section class="... bg-[url('/CTAbg.jpg')] bg-cover ...">。
   * 但它们的 dist 里**根本没有生成对应的 CSS 规则**——
   * 实测：small-bis/dist/index.html 只引 _astro/About.B3kSiVBb.css，
   * 而该 CSS 中 bg-\[url 规则数 = **0**。于是那张背景大图**在原生页上也不显示**。
   *
   * ## 做法
   *
   * 遍历带 class 的元素，找出含 url(...) 的任意值背景类；**当且仅当**
   * computed style 里确实没有背景图时，把该 URL 解析出来写成**内联长属性**。
   *
   * ## 三条设计约束（都有代价支撑）
   *
   * 1. **URL 从 class 文本解析**，不手抄路径——手抄等于把 'CTAbg.jpg' 变成第二处真相
   *    （军规 1）；class 里没有就什么都不注入。
   * 2. **只写 backgroundImage + backgroundSize 两个长属性，绝不写 background 简写**：
   *    简写会重置全部 background-* （含 vendor 样式表给的），且**内联优先于样式表**
   *    —— 本轮实测过一次背景图被静默吃掉，B 在 T-27 也踩过同款。
   * 3. **幂等**：只在「computed 无图」时动手。vendor 哪天把规则补上，这里自然不再触发，
   *    不会与它的规则打架（这正是选内联、不选注入同名 CSS 规则的理由）。
   */
  const repairUncompiledBackgroundClasses = () => {
    /* ⚠️ 这段代码处于**外层模板字面量内部**，正则里的反斜杠转义（如 s 的斜杠变体）
     * 会被模板字面量吃掉（实测：/\\s+/ 交付到浏览器变成 /s+/），
     * 于是 split 不按空白切、token 判定全假、函数静默不生效——**且没有任何报错**。
     * 所以这里一律**不用反斜杠转义**：切分用字符串，判等用 indexOf。 */
    const nodes = Array.from(document.querySelectorAll('[class*="bg-[url("]'));
    nodes.forEach((node) => {
      const cls = typeof node.className === 'string' ? node.className : (node.getAttribute('class') || '');
      /* 用空格/Tab/换行三种**字面量**切分，等价于按空白切。
       * ⚠️ 这里**不能写反斜杠转义的 n/t**：本段处于外层模板字面量内部，
       * 它们会被**先展开成真实控制字符**（实测交付后字符串被换行劈开、语法直接崩）。
       * 一律用 String.fromCharCode 构造，零转义面。 */
      const NL = String.fromCharCode(10);
      const TAB = String.fromCharCode(9);
      const parts = cls.split(' ').join(NL).split(TAB).join(NL).split(NL);
      const token = parts.find((name) => name.indexOf('bg-[url(') === 0);
      if (!token) return;
      /* token 形如 bg-[url('X')] 或 bg-[url(X)] —— 取 url( 与结尾 )] 之间的内容 */
      const inner = token.slice('bg-[url('.length, token.endsWith(')]') ? -2 : -1);
      /* 剥掉可能存在的成对引号（单双均可）。
       * ⚠️ 这里**不能写反斜杠转义的单引号**：本段处于外层模板字面量内部，
       * 转义会被先吃掉一层，交付成 first === ''' —— 字符串未终止、整段脚本报废。
       * 用 charCodeAt 判等，零转义面。 */
      let url = inner;
      if (url.length >= 2) {
        const firstCode = url.charCodeAt(0);
        const isQuote = firstCode === 39 || firstCode === 34; // ' or "
        if (isQuote && url.charCodeAt(url.length - 1) === firstCode) url = url.slice(1, -1);
      }
      if (!url) return;
      const computed = getComputedStyle(node);
      /* 幂等守卫：vendor 修好之后 computed 会有图，这里就不再插手 */
      if (computed.backgroundImage && computed.backgroundImage !== 'none') return;
      node.style.backgroundImage = 'url("' + url + '")';
      if (!computed.backgroundSize || computed.backgroundSize === 'auto') node.style.backgroundSize = 'cover';
    });
  };
  const setText = (node, value, slot, applied) => {
    if (!node || typeof value !== 'string' || !value.trim()) return false;
    node.dataset.sitecraftSlot = slot;
    if (node.textContent !== value) node.textContent = value;
    if (node.textContent === value) {
      applied.add(slot);
      return true;
    }
    return false;
  };
  // 访客不该看到"待补充"、假邮箱或模板演示值。发布变体下隐藏这类字段；
  // 工作台/预览仍显示，便于用户看到缺口并补齐（2026-09-08）。
  const HIDE_PATTERN = /(?:待补充|暂无|敬请期待|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon)/i;
  const HIDE_PATTERN_GLOBAL = /(?:待补充|暂无|敬请期待|\b(?:tbd|todo)\b|to be (?:completed|provided)|coming soon)/gi;
  const isPlaceholderLike = (value) => {
    if (typeof value !== 'string' || !value.trim()) return true;
    // 保留域名/示例文案一定是假的，直接隐藏
    if (/example\.com/i.test(value) || /lorem ipsum/i.test(value)) return true;
    if (!HIDE_PATTERN.test(value)) return false;
    // 剥掉标记后几乎没有实义残留 → 该字段就是标记本身（"地址待补充"），隐藏；
    // 若残留较长（"企业事实尚未提供的部分将明确标记为待补充"）则是正文，照常显示。
    const residue = value.replace(HIDE_PATTERN_GLOBAL, '').replace(/[\s\p{P}\p{S}]/gu, '');
    return Array.from(residue).length <= 10;
  };
  // 发布变体才隐藏缺口字段：工作台/预览需要看到"待补充"以便用户补齐。
  // 注意 activeVariant 在收到草稿后才赋值，必须每次实时判断，不能在顶层缓存。
  const isPublishedVariant = () => activeVariant === 'published';
  const setTextOrHide = (node, value, slot, applied, hideWhenPlaceholder) => {
    if (!node) return false;
    if (hideWhenPlaceholder && isPlaceholderLike(value)) {
      node.hidden = true;
      node.style.setProperty('display', 'none', 'important');
      return false;
    }
    return setText(node, value, slot, applied);
  };
  const hideIfAllSlotsHidden = (container) => {
    if (!container) return;
    const slots = Array.from(container.querySelectorAll('[data-sitecraft-slot]'));
    if (slots.length && slots.every((node) => node.hidden)) {
      container.hidden = true;
      container.style.setProperty('display', 'none', 'important');
    }
  };
  // 发布态兜底：adapter 的 prepareFn 会绕过 setTextOrHide 直接写 DOM（如 forge 把
  // email/phone/address 写进 footer），共享引擎的隐藏覆盖不到。这里做一次全页清扫，
  // 确保访客在任何模板下都看不到缺口标记（2026-09-08）。
  const scrubPlaceholders = () => {
    const candidates = Array.from(document.querySelectorAll('a, address, span, p, li, div, small, td, dd'));
    candidates.forEach((node) => {
      // 只看叶子文本节点，避免把整段容器误删
      if (node.children.length > 0) return;
      const text = (node.textContent || '').trim();
      if (!text || !isPlaceholderLike(text)) return;
      const host = node.closest('a, address, li, dd, small') || node;
      host.hidden = true;
      host.style.setProperty('display', 'none', 'important');
    });
  };
  const sectionScopes = () => {
    const nodes = allVisible('main section, main article, body > section').filter((node) => node !== resolveHero()?.closest('section, header'));
    return nodes.filter((node) => !nodes.some((parent) => parent !== node && parent.contains(node)));
  };
  // 兜底排除已被某槽精确认领的 section（data-sitecraft-scope 已设）：一区多义时
  // （如 features 原生分栏文本同时含服务词），避免 services/products 兜底改写同一物理区。
  const scopeBy = (key, pattern) => document.querySelector('[data-sitecraft-scope="' + key + '"]') || sectionScopes().filter((s) => !s.hasAttribute('data-sitecraft-scope')).find((scope) => pattern.test((allVisible('h1,h2,h3', scope)[0]?.textContent || '') + ' ' + (scope.id || '') + ' ' + (scope.className || '') + ' ' + (scope.textContent || '').slice(0, 500)));
  const unique = (nodes) => nodes.filter((node, index) => node && nodes.indexOf(node) === index);
  const hideSectionByHeading = (pattern) => {
    allVisible('h1,h2,h3').filter((heading) => pattern.test(heading.textContent || '')).forEach((heading) => {
      const semanticScope = heading.closest('section, article');
      const parent = heading.parentElement;
      const scope = semanticScope || (parent && !['MAIN', 'BODY', 'HTML'].includes(parent.tagName) ? parent : heading);
      if (scope) {
        scope.hidden = true;
        scope.style.setProperty('display', 'none', 'important');
      }
    });
  };
  const hideLeafMatches = (pattern) => {
    Array.from(document.querySelectorAll('body *')).filter((node) => !node.children.length && pattern.test((node.textContent || '').trim())).forEach((node) => {
      const scope = node.closest('li, blockquote, [class*="stat"], [class*="metric"], [class*="price"]') || node;
      if (scope) {
        scope.hidden = true;
        scope.style.setProperty('display', 'none', 'important');
      }
    });
  };
  const sanitizePublishedDemo = () => {
    // 规则来自 adapter.sanitize（per-template 数据，见 lib/template-adapters/<id>.ts）。
    ${JSON.stringify(adapterSanitize.sections)}.forEach((pattern) => hideSectionByHeading(new RegExp(pattern, 'i')));
    ${JSON.stringify(adapterSanitize.leafPatterns)}.forEach((pattern) => hideLeafMatches(new RegExp(pattern, 'i')));
  };
  /**
   * 资产替换（P3.2）：把 draft.assets 里用户上传的实拍图写进模板首屏/品牌位。
   *
   * 定位靠 lib/template-asset-registry.ts 的**逐模板显式 selector**——不用「hero 区面积最大的 img」
   * 这类启发式（实测 22 模板里 shadcn-landing 最大图是 96×96 的 logo，会替换错图）。
   * 未登记的模板一律不替换（fail-closed），并回报 missing 让 UI 明确告知用户。
   */
  const applyAssets = (draft) => {
    const report = { applied: [], missing: [] };
    const assets = (draft && draft.assets) || {};
    const slots = [
      { target: 'hero.image', selector: ${JSON.stringify(getHeroAssetSelector(templateId) ?? "")} },
      { target: 'brand.logo', selector: ${JSON.stringify(getBrandAssetSelector(templateId) ?? "")} },
    ];
    const restore = (img, target) => {
      if (!img || img.dataset.sitecraftAsset !== target) return;
      const originalSrc = img.dataset.sitecraftOriginalSrc;
      const originalSrcset = img.dataset.sitecraftOriginalSrcset;
      if (originalSrc) img.setAttribute('src', originalSrc);
      if (originalSrcset) img.setAttribute('srcset', originalSrcset);
      else img.removeAttribute('srcset');
      delete img.dataset.sitecraftAsset;
      delete img.dataset.sitecraftOriginalSrc;
      delete img.dataset.sitecraftOriginalSrcset;
    };
    for (const { target, selector } of slots) {
      const asset = assets[target];
      if (!selector) {
        if (asset) report.missing.push({ target, reason: 'template_not_supported' });
        continue;
      }
      const img = document.querySelector(selector)
        || document.querySelector('[data-sitecraft-asset="' + target + '"]');
      if (!img) {
        if (asset) report.missing.push({ target, reason: 'no_img_element' });
        continue;
      }
      if (!asset) { restore(img, target); continue; }
      // 首次替换前记住模板原图，支持「恢复模板原图」
      if (img.dataset.sitecraftAsset !== target) {
        img.dataset.sitecraftOriginalSrc = img.getAttribute('src') || '';
        img.dataset.sitecraftOriginalSrcset = img.getAttribute('srcset') || '';
      }
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      const picture = img.closest('picture');
      if (picture) picture.querySelectorAll('source').forEach((source) => { source.removeAttribute('srcset'); source.removeAttribute('sizes'); });
      if (img.getAttribute('src') !== asset.url) img.setAttribute('src', asset.url);
      if (typeof asset.alt === 'string' && asset.alt) img.setAttribute('alt', asset.alt);
      img.dataset.sitecraftAsset = target;
      img.dataset.sitecraftSlot = target;
      report.applied.push(target);
    }
    return report;
  };
  /**
   * 判断被点选的 <img> 对应哪个可替换资产槽。
   * 只认注册表声明的 selector（fail-closed）——否则点任意插图都会弹出上传框，属于噪音。
   */
  const resolveAssetSlotForImage = (image) => {
    const candidates = [
      { target: 'hero.image', selector: ${JSON.stringify(getHeroAssetSelector(templateId) ?? "")} },
      { target: 'brand.logo', selector: ${JSON.stringify(getBrandAssetSelector(templateId) ?? "")} },
    ];
    for (const { target, selector } of candidates) {
      if (!selector) continue;
      try {
        if (image.matches(selector) || image.closest(selector) === image) return target;
      } catch { /* 非法 selector 忽略 */ }
    }
    return image.dataset.sitecraftAsset || null;
  };
  /**
   * 点选**空白处**时的资产判定：模板的 hero 图常被文字容器（relative z-10）完全覆盖，
   * 用户点图上任何位置命中的都是那个容器而不是 <img> 本身（forge 实测）。
   * 因此：没有命中可编辑文字槽、但落在某个已登记资产图的容器内 → 视为选图。
   */
  const resolveAssetSlotForNode = (node) => {
    if (!node) return null;
    const candidates = [
      { target: 'hero.image', selector: ${JSON.stringify(getHeroAssetSelector(templateId) ?? "")} },
      { target: 'brand.logo', selector: ${JSON.stringify(getBrandAssetSelector(templateId) ?? "")} },
    ];
    for (const { target, selector } of candidates) {
      // 已被替换过的图 src 不再匹配原 selector，用 data-sitecraft-asset 兜底
      let image = null;
      try { image = document.querySelector('[data-sitecraft-asset="' + target + '"]'); } catch { /* ignore */ }
      if (!image && selector) {
        try { image = document.querySelector(selector); } catch { image = null; }
      }
      if (!image) continue;
      const container = image.closest('section, header, main > div') || image.parentElement;
      if (container && (container === node || container.contains(node))) return target;
    }
    return null;
  };
  const applyDesignTokens = (draft) => {    const tokens = draft?.designTokens;
    // 适配器的 designTokenCss 是模板专属的兜底样式（生成区配色、原生区收敛等），
    // 与用户是否设置 designTokens 无关——此前 !tokens 时整段 return，导致 18 个模板的
    // adapter.designTokenCss 全部静默失效（2026-09-09 实测：tailwind-landing 生成区白底规则不生效）。
    // 现在：有 tokens 走完整令牌样式，无 tokens 仍注入模板专属兜底样式。
    const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    const fontStyles = { sans: 'Inter,Manrope,system-ui,sans-serif', editorial: 'Georgia,Times New Roman,serif', technical: 'Arial Narrow,Roboto Condensed,Arial,sans-serif' };
    const radii = { sharp: '2px', soft: '8px', rounded: '18px' };
    const sectionSpace = { compact: '44px', balanced: '64px', spacious: '84px' };
    if (tokens) {
      if (isColor(tokens.primary)) document.documentElement.style.setProperty('--sitecraft-primary', tokens.primary);
      if (isColor(tokens.secondary)) document.documentElement.style.setProperty('--sitecraft-secondary', tokens.secondary);
      if (isColor(tokens.accent)) document.documentElement.style.setProperty('--sitecraft-accent', tokens.accent);
      document.documentElement.style.setProperty('--sitecraft-font', fontStyles[tokens.fontStyle] || fontStyles.sans);
      document.documentElement.style.setProperty('--sitecraft-radius', radii[tokens.radius] || radii.soft);
      document.documentElement.style.setProperty('--sitecraft-section-space', sectionSpace[tokens.density] || sectionSpace.balanced);
    }
    let style = document.getElementById('sitecraft-design-tokens');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sitecraft-design-tokens';
      document.head.append(style);
    }
    const shared = tokens
      ? 'body{font-family:var(--sitecraft-font)!important}h1,h2,h3{font-family:var(--sitecraft-font)!important}button,a[class*="btn"],a[class*="button"],[class*="card"],article{border-radius:var(--sitecraft-radius)!important}main>section,body>section{padding-top:var(--sitecraft-section-space)!important;padding-bottom:var(--sitecraft-section-space)!important}::selection{background:var(--sitecraft-accent);color:#172019}'
      : '';
    // 模板专属兜底样式始终注入；通用默认样式仅在用户设置了 designTokens 时注入
    // （否则 --sitecraft-primary 未定义，会让按钮 background 变成 invalid → 透明，破坏模板原样）。
    const adapterCss = ${JSON.stringify(adapter?.designTokenCss || '')};
    const defaultTokenCss = 'h1,h2,h3{color:var(--sitecraft-primary)!important}button,a[class*="btn"],a[class*="button"]{background-color:var(--sitecraft-primary)!important;color:#fff!important}';
    style.textContent = shared + (adapterCss || (tokens ? defaultTokenCss : ''));
  };
  const cardScopes = (scope, fallbackPattern) => {
    let nodes = scope ? allVisible('article, [class*="card"], [class*="item"], [class*="service"], [class*="feature"]', scope) : [];
    nodes = nodes.filter((node) => allVisible('h2,h3,h4,strong,[class*="title"],[class*="name"],span', node).length && allVisible('p', node).length);
    if (!nodes.length && fallbackPattern) {
      nodes = sectionScopes().filter((node) => fallbackPattern.test(node.textContent || '') && allVisible('p', node).length);
    }
    return unique(nodes).filter((node) => !nodes.some((other) => other !== node && other.contains(node) && other.querySelectorAll('p').length === node.querySelectorAll('p').length));
  };
  const applyCards = (section, scope, items, locale, applied, fallbackPattern) => {
    if (!items?.length) return;
    const cards = cardScopes(scope, fallbackPattern).slice(0, items.length);
    cards.forEach((card, index) => {
      card.dataset.sitecraftSection = section;
      const item = items[index];
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      card.dataset.sitecraftItemId = itemKey;
      const headings = allVisible('h2,h3,h4,strong,[class*="title"],[class*="name"],span.text-4xl,span[class*="title"]', card);
      const title = headings.find((node) => (node.textContent || '').trim().length > 2 && !/^(0?[0-9]+|learn more|read more)$/i.test((node.textContent || '').trim()));
      const body = allVisible('p', card)[0];
      setText(title, localize(item.title, locale), section + '.items.' + itemKey + '.title.' + locale, applied);
      setText(body, localize(item.body, locale), section + '.items.' + itemKey + '.body.' + locale, applied);
    });
  };
  // 模板专属 services 适配：adapter.servicesFn 若声明，注入为 applyNativeServiceCards；
  // 未声明的模板走通用 applyCards('services', ...)（applyContent 内分发）。
  // ⑥ 导航数组化：21 个适配器仍按「draft.navigation 点 id」这种**键索引**读导航，
  // 而 navigation 现在是数组。这段兼容视图让它们的既有写法继续工作，
  // 同时把「下标索引」与「把槽位路径当字段名」两类写法挡成 undefined
  // （挡成 undefined 是"回退到兜底文案"，看得见；放行才是静默串位）。
  ${navigationViewSnippet()}
  // ⚠️ 适配器读的是**全局 activeDraft**（不是参数），所以兼容视图要包在赋值处，
  // 而不是包在调用处——包在 prepareTemplate(draft) 那种地方是无效的。
  const withNavigationView = (draft) => {
    if (!draft || !Array.isArray(draft.navigation)) return draft;
    return Object.assign({}, draft, { navigation: makeNavigationView(draft.navigation) });
  };
  ${adapterPrepareFn}
  ${adapterServicesFn}
  // 模板专属原生排版填充：adapter.nativeFillFn 若声明，注入为 applyNativeFill（闭包访问
  // 模板 prepareFn 声明的原生区定位器 + 共享 setText/localize/allVisible）。它让业务槽内容
  // 填进模板自身的非卡片原生排版（icon_row/image_banner/分栏），而不是退回通用卡片重建。
  ${adapterNativeFillFn}
  const applyNativeFill = (typeof applyNativeContentFill === 'function') ? applyNativeContentFill : null;
  const renderAdditionalProducts = (draft, locale, startIndex, applied) => {
    let section = document.querySelector('[data-sitecraft-generated-products]');
    const remaining = (draft.products || []).slice(startIndex);
    if (!remaining.length) {
      section?.remove();
      return;
    }
    if (!section) {
      section = document.createElement('section');
      section.dataset.sitecraftGeneratedProducts = 'true';
      section.dataset.sitecraftSection = 'products';
      section.style.cssText = 'padding:clamp(48px,7vw,96px) clamp(20px,7vw,96px);background:inherit;color:inherit;border-top:1px solid rgba(127,127,127,.22)';
      const footer = document.querySelector('footer');
      const main = document.querySelector('main') || document.body;
      if (footer?.parentElement) footer.parentElement.insertBefore(section, footer);
      else main.append(section);
    }
    section.innerHTML = '';
    const heading = document.createElement('h2');
    heading.style.cssText = 'margin:0 0 12px;font:inherit;font-size:clamp(28px,4vw,52px);font-weight:800;line-height:1.05';
    const intro = document.createElement('p');
    intro.style.cssText = 'max-width:720px;margin:0 0 32px;opacity:.72;line-height:1.7';
    setText(heading, localize(draft.content?.products?.title, locale), 'products.title.' + locale, applied);
    setText(intro, localize(draft.content?.products?.intro, locale), 'products.intro.' + locale, applied);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:16px';
    remaining.forEach((product) => {
      const card = document.createElement('article');
      card.style.cssText = 'min-width:0;padding:22px;border:1px solid rgba(127,127,127,.25);border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent)';
      // 主图：product.image 存在则插 <img>，无图退回 imageColor 色块
      const imgUrl = typeof product.image === 'string' && product.image.trim() ? product.image.trim() : '';
      let imgNode = null;
      if (imgUrl) {
        imgNode = document.createElement('img');
        imgNode.src = imgUrl;
        imgNode.alt = localize(product.name, locale) || product.sku;
        imgNode.loading = 'lazy';
        imgNode.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:8px;margin-bottom:14px;background:#eef2f7';
        imgNode.onerror = function () { this.style.display = 'none'; };
      }
      const sku = document.createElement('small');
      sku.style.cssText = 'display:block;margin-bottom:12px;opacity:.58;font:11px ui-monospace,monospace';
      sku.textContent = product.sku + ' / ' + product.category;
      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px;font:inherit;font-size:20px;font-weight:800;line-height:1.25';
      const body = document.createElement('p');
      body.style.cssText = 'margin:0;opacity:.72;line-height:1.65';
      setText(title, localize(product.name, locale), 'products.' + product.sku + '.name.' + locale, applied);
      setText(body, localize(product.summary, locale), 'products.' + product.sku + '.summary.' + locale, applied);
      if (imgNode) {
        card.append(imgNode);
      } else {
        /* 无图回退色块——与生成器侧 template-composer.ts 的 sc-product__ph 对齐：
         * 那句注释一直承诺"与 preview 注入逻辑保持一致"，但此前**只有生成器实现了**
         * （2026-09-14 探针实测：2 张卡片只有 1 个 img，另一张什么 media 都没有）。
         * ⚠️ 色值用 style.backgroundColor **属性赋值**，不拼进 cssText：
         * imageColor 是 z.string().max(30) 的自由字符串，拼字符串等于把校验交给运气；
         * 属性赋值由浏览器自己丢弃非法值，且 dompurify/合规扫描更容易通过。 */
        const ph = document.createElement('div');
        ph.setAttribute('data-sitecraft-product-placeholder', product.sku);
        ph.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:4/3;border-radius:8px;margin-bottom:14px;font:12px ui-monospace,monospace;opacity:.85;color:inherit';
        ph.style.backgroundColor = (typeof product.imageColor === 'string' && product.imageColor.trim()) || '#e8ece9';
        const tag = document.createElement('span');
        tag.textContent = product.sku;
        ph.append(tag);
        card.append(ph);
      }
      card.append(sku, title, body);
      grid.append(card);
    });
    section.append(heading, intro, grid);
  };
  const hasVisibleSlotPrefix = (prefix) => Array.from(document.querySelectorAll('[data-sitecraft-slot]')).some((node) => {
    const slot = node.dataset.sitecraftSlot || '';
    const style = getComputedStyle(node);
    return (slot === prefix || slot.startsWith(prefix + '.')) && visible(node) && style.display !== 'none' && Number(style.opacity || 1) > 0;
  });
  // 该板块是否由宿主动态生成（[data-sitecraft-generated-content]）。动态生成区的 slot 是
  // 上次注入的（可能 zh），locale 切换时必须用当前 locale 重建，不能因 hasVisibleSlotPrefix 短路。
  const hasGeneratedSection = (sectionKey) => Boolean(document.querySelector('[data-sitecraft-generated-content="' + sectionKey + '"]'));
  const renderGeneratedContent = (sectionKey, titleValue, introValue, items, locale, applied) => {
    let section = document.querySelector('[data-sitecraft-generated-content="' + sectionKey + '"]');
    if (!section) {
      section = document.createElement('section');
      section.dataset.sitecraftGeneratedContent = sectionKey;
      section.dataset.sitecraftSection = sectionKey;
      section.style.cssText = 'padding:clamp(48px,7vw,96px) clamp(20px,7vw,96px);background:inherit;color:inherit;border-top:1px solid rgba(127,127,127,.18)';
      const footer = document.querySelector('footer');
      const main = document.querySelector('main') || document.body;
      if (footer?.parentElement) footer.parentElement.insertBefore(section, footer);
      else main.append(section);
    }
    section.hidden = false;
    section.style.removeProperty('display');
    section.innerHTML = '';
    const heading = document.createElement('h2');
    heading.style.cssText = 'margin:0 0 12px;font:inherit;font-size:clamp(28px,4vw,52px);font-weight:800;line-height:1.05';
    setText(heading, localize(titleValue, locale), sectionKey + '.title.' + locale, applied);
    const intro = document.createElement('p');
    intro.style.cssText = 'max-width:720px;margin:0 0 28px;opacity:.72;line-height:1.7';
    setText(intro, localize(introValue, locale), (sectionKey === 'about' ? 'about.body' : sectionKey + '.intro') + '.' + locale, applied);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:16px';
    (items || []).forEach((item, index) => {
      const card = document.createElement('article');
      card.style.cssText = 'min-width:0;padding:22px;border:1px solid rgba(127,127,127,.25);border-radius:8px;background:color-mix(in srgb,currentColor 4%,transparent)';
      // 稳定 itemId：优先用 items[].id（与 operation 层 site-operations 用 itemId 解析一致）；
      // 旧数据无 id 时兜底下标，保证历史草稿仍可解析。
      const itemKey = (item && typeof item.id === 'string' && item.id) ? item.id : String(index);
      card.dataset.sitecraftItemId = itemKey;
      const cardTitle = document.createElement('h3');
      cardTitle.style.cssText = 'margin:0 0 10px;font:inherit;font-size:20px;font-weight:800;line-height:1.25';
      setText(cardTitle, localize(item.title, locale), sectionKey + '.items.' + itemKey + '.title.' + locale, applied);
      const cardBody = document.createElement('p');
      cardBody.style.cssText = 'margin:0;opacity:.72;line-height:1.65';
      setText(cardBody, localize(item.body, locale), sectionKey + '.items.' + itemKey + '.body.' + locale, applied);
      card.append(cardTitle, cardBody);
      grid.append(card);
    });
    section.append(heading, intro, grid);
    return section;
  };
  const applyTemplateUiCopy = (draft, locale, applied) => {
    const copy = templateUiCopy[locale] || templateUiCopy.zh;
    activeUiCopy = copy;
    allVisible('header nav a, nav a').forEach((link) => {
      // adapter（prepareFn）已按 draft 定制并打 slot 的导航链接：不再被通用词表二次改写
      if (link.dataset.sitecraftSlot) return;
      if (link.querySelector('img,svg') || /logo|brand/i.test(link.className || '')) return;
      const signal = ((link.getAttribute('href') || '') + ' ' + (link.textContent || '')).toLowerCase();
      let key = null;
      if (/faq|frequently|常见/.test(signal)) key = 'faq';
      else if (/contact|inquiry|quote|联系|询盘/.test(signal)) key = 'contact';
      else if (/product|catalog|产品/.test(signal)) key = 'products';
      else if (/service|solution|服务|方案/.test(signal)) key = 'services';
      else if (/feature|advantage|benefit|优势|能力/.test(signal)) key = 'features';
      else if (/about|company|关于|公司/.test(signal)) key = 'about';
      else if (/^\\/?$|#home| home|首页/.test(signal)) key = 'home';
      if (key) setText(link, copy.navigation[key], 'navigation.' + key + '.' + locale, applied);
    });

    const faqScope = sectionScopes().find((scope) => /faq|frequently asked|常见问题/i.test(scope.textContent || ''));
    setText(faqScope && allVisible('h1,h2,h3', faqScope)[0], copy.faq.title, 'faq.title.' + locale, applied);

    const form = document.querySelector('form');
    if (form) {
      Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea')).forEach((field) => {
        const signal = ((field.getAttribute('name') || '') + ' ' + (field.getAttribute('type') || '') + ' ' + (field.getAttribute('placeholder') || '')).toLowerCase();
        let key = 'message';
        if (/mail/.test(signal)) key = 'email';
        else if (/company|organization|business/.test(signal)) key = 'company';
        else if (/name/.test(signal)) key = 'name';
        setText(field.labels?.[0] || field.closest('label'), copy.form.labels[key], 'form.labels.' + key + '.' + locale, applied);
        field.setAttribute('placeholder', copy.form.placeholders[key]);
        field.dataset.sitecraftSlot = 'form.placeholders.' + key + '.' + locale;
        applied.add('form.placeholders.' + key + '.' + locale);
      });
      const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (submit?.matches('input')) {
        submit.value = copy.form.submit;
        submit.dataset.sitecraftSlot = 'form.submit.' + locale;
        applied.add('form.submit.' + locale);
      } else {
        setText(submit, copy.form.submit, 'form.submit.' + locale, applied);
      }
    }

    const footer = document.querySelector('footer');
    if (footer) {
      const brand = localize(draft.siteName || draft.companyName || draft.businessName, locale) || '';
      const paragraphs = allVisible('p, small', footer);
      setText(paragraphs[paragraphs.length - 1], (brand ? brand + ' · ' : '') + copy.footer.rightsReserved, 'footer.rights.' + locale, applied);
      allVisible('a', footer).forEach((link) => {
        const signal = ((link.getAttribute('href') || '') + ' ' + (link.textContent || '')).toLowerCase();
        if (/privacy|隐私/.test(signal)) setText(link, copy.footer.privacy, 'footer.privacy.' + locale, applied);
        if (/terms|条款/.test(signal)) setText(link, copy.footer.terms, 'footer.terms.' + locale, applied);
      });
    }
  };
  const replaceAsync = async (input, pattern, replacer) => {
    const matches = Array.from(input.matchAll(pattern));
    if (!matches.length) return input;
    let output = '';
    let cursor = 0;
    for (const match of matches) {
      output += input.slice(cursor, match.index) + await replacer(match);
      cursor = match.index + match[0].length;
    }
    return output + input.slice(cursor);
  };
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('blob_read_failed'));
    reader.readAsDataURL(blob);
  });
  const canvasBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const compressImage = async (blob, report) => {
    if (!blob.type.startsWith('image/') || /svg|gif/.test(blob.type) || typeof createImageBitmap !== 'function') return blob;
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const compressed = await canvasBlob(canvas, 'image/webp', 0.72);
      if (compressed && compressed.size < blob.size) {
        report.compressedImages += 1;
        return compressed;
      }
    } catch (error) {
      report.warnings.push('image_compression_failed');
    }
    return blob;
  };
  // 资源内联 fetch：单资源超时避免某个不可达外网主机让整个导出挂死。
  // 2026-09-08：从固定 8s 改为 env 可配（默认 15s，慢网络更宽容）。
  const RESOURCE_TIMEOUT_MS = Number(window.__SITECRAFT_RESOURCE_TIMEOUT_MS__ || 15000);
  const resourceFetch = (url, options = {}) => fetch(url, Object.assign({ credentials: 'same-origin', signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS) }, options));
  const fetchDataUrl = async (rawUrl, baseUrl, cache, report) => {
    if (!rawUrl || /^(data:|#)/i.test(rawUrl)) return rawUrl;
    const absolute = resolveTemplateResourceUrl(rawUrl, baseUrl);
    if (cache.has(absolute)) {
      report.deduplicatedResources += 1;
      return cache.get(absolute);
    }
    try {
      const response = await resourceFetch(absolute);
      if (!response.ok) throw new Error('asset_status_' + response.status);
      let blob = await response.blob();
      blob = await compressImage(blob, report);
      const dataUrl = await blobToDataUrl(blob);
      cache.set(absolute, dataUrl);
      report.inlinedResources += 1;
      return dataUrl;
    } catch (error) {
      report.externalResourceUrls.push(absolute);
      report.warnings.push('asset_inline_failed:' + absolute);
      return rawUrl;
    }
  };
  const inlineCss = async (cssText, baseUrl, cache, report, seenCss) => {
    const imported = await replaceAsync(cssText, /@import\\s+(?:url\\()?\\s*["']?([^"'\\)\\s;]+)["']?\\s*\\)?[^;]*;/gi, async (match) => {
      const absolute = resolveTemplateResourceUrl(match[1], baseUrl);
      if (seenCss.has(absolute)) return '';
      seenCss.add(absolute);
      try {
        const response = await resourceFetch(absolute);
        if (!response.ok) throw new Error('css_status_' + response.status);
        return await inlineCss(await response.text(), absolute, cache, report, seenCss);
      } catch (error) {
        report.externalResourceUrls.push(absolute);
        report.warnings.push('css_import_failed:' + absolute);
        return match[0];
      }
    });
    return replaceAsync(imported, /url\\(\\s*["']?([^"'\\)]+)["']?\\s*\\)/gi, async (match) => {
      const rawUrl = match[1].trim();
      if (/^(data:|#)/i.test(rawUrl)) return match[0];
      return 'url("' + await fetchDataUrl(rawUrl, baseUrl, cache, report) + '")';
    });
  };
  const buildOfflineHtml = async () => {
    const report = { inlinedResources: 0, deduplicatedResources: 0, compressedImages: 0, externalResourceUrls: [], navigationUrls: [], warnings: [] };
    const cache = new Map();
    const seenCss = new Set();
    const clone = document.documentElement.cloneNode(true);
    const originalLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
    const clonedLinks = Array.from(clone.querySelectorAll('link[rel~="stylesheet"]'));
    for (let index = 0; index < originalLinks.length; index += 1) {
      const source = originalLinks[index];
      const target = clonedLinks[index];
      if (!target) continue;
      try {
        let cssText = '';
        try {
          cssText = Array.from(source.sheet?.cssRules || []).map((rule) => rule.cssText).join('\\n');
        } catch (error) {
          report.warnings.push('cssom_read_fallback:' + source.href);
        }
        if (!cssText) {
          const response = await fetch(source.href, { credentials: 'same-origin' });
          if (!response.ok) throw new Error('css_status_' + response.status);
          cssText = await response.text();
        }
        const style = document.createElement('style');
        style.textContent = await inlineCss(cssText, source.href, cache, report, seenCss);
        target.replaceWith(style);
      } catch (error) {
        report.externalResourceUrls.push(source.href);
        report.warnings.push('stylesheet_inline_failed:' + source.href);
      }
    }
    for (const style of Array.from(clone.querySelectorAll('style'))) {
      style.textContent = await inlineCss(style.textContent || '', document.baseURI, cache, report, seenCss);
      style.removeAttribute('nonce');
    }
    for (const node of Array.from(clone.querySelectorAll('[style]'))) {
      node.setAttribute('style', await inlineCss(node.getAttribute('style') || '', document.baseURI, cache, report, seenCss));
    }
    const resourceAttributes = [
      ['img', 'src'], ['source', 'src'], ['video', 'src'], ['video', 'poster'], ['audio', 'src'],
      ['input[type="image"]', 'src'], ['link[rel~="icon"]', 'href'], ['object', 'data'], ['image', 'href'], ['use', 'href'],
    ];
    for (const [selector, attribute] of resourceAttributes) {
      for (const node of Array.from(clone.querySelectorAll(selector + '[' + attribute + ']'))) {
        node.setAttribute(attribute, await fetchDataUrl(node.getAttribute(attribute), document.baseURI, cache, report));
      }
    }
    for (const node of Array.from(clone.querySelectorAll('[srcset]'))) {
      const candidates = (node.getAttribute('srcset') || '').split(',');
      const inlined = [];
      for (const candidate of candidates) {
        const parts = candidate.trim().split(/\\s+/);
        if (!parts[0]) continue;
        parts[0] = await fetchDataUrl(parts[0], document.baseURI, cache, report);
        inlined.push(parts.join(' '));
      }
      node.setAttribute('srcset', inlined.join(', '));
    }
    const originalCanvases = Array.from(document.querySelectorAll('canvas'));
    const clonedCanvases = Array.from(clone.querySelectorAll('canvas'));
    originalCanvases.forEach((canvas, index) => {
      try {
        const image = document.createElement('img');
        image.src = canvas.toDataURL('image/webp', 0.72);
        image.alt = canvas.getAttribute('aria-label') || '';
        clonedCanvases[index]?.replaceWith(image);
      } catch (error) {
        report.warnings.push('canvas_snapshot_failed');
      }
    });
    clone.querySelectorAll('script, link[rel="modulepreload"], link[rel="preload"], next-route-announcer, [data-nextjs-toast], [data-next-badge]').forEach((node) => node.remove());
    clone.querySelectorAll('astro-island, astro-slot').forEach((node) => node.replaceWith(...Array.from(node.childNodes)));
    clone.querySelectorAll('base, meta[name="sitecraft-template"]').forEach((node) => node.remove());
    clone.querySelectorAll('style').forEach((style) => {
      if ((style.textContent || '').includes('a:hover,button:hover')) style.remove();
    });
    clone.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        if (/^on/i.test(attribute.name) || /^data-sitecraft-(slot|scope|section|selected|template)$/i.test(attribute.name)) node.removeAttribute(attribute.name);
      });
    });
    clone.querySelectorAll('form').forEach((form) => {
      form.removeAttribute('action');
      form.removeAttribute('method');
      form.dataset.sitecraftOfflineForm = 'true';
    });
    clone.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && !/^javascript:/i.test(href)) report.navigationUrls.push(href);
    });
    const offlineScript = document.createElement('script');
    offlineScript.dataset.sitecraftOfflineRuntime = 'true';
    offlineScript.textContent = "document.addEventListener('submit',function(e){var f=e.target;if(!f.matches('form[data-sitecraft-offline-form]'))return;e.preventDefault();var s=f.querySelector('[data-sitecraft-offline-status]');if(!s){s=document.createElement('p');s.dataset.sitecraftOfflineStatus='true';s.setAttribute('role','status');f.append(s)}s.textContent=document.documentElement.lang==='en'?'This offline file cannot submit inquiries. Open the published website to contact us.':'这是离线文件，无法提交询盘。请打开已发布网站联系我们。'});document.addEventListener('click',function(e){var b=e.target.closest('[aria-controls][aria-expanded]');if(!b)return;var p=document.getElementById(b.getAttribute('aria-controls'));if(!p)return;var open=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!open));p.hidden=open});";
    (clone.querySelector('body') || clone).append(offlineScript);
    const csp = document.createElement('meta');
    csp.httpEquiv = 'Content-Security-Policy';
    csp.content = "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";
    (clone.querySelector('head') || clone).prepend(csp);
    const remainingResourceUrls = [];
    for (const [selector, attribute] of resourceAttributes) {
      clone.querySelectorAll(selector + '[' + attribute + ']').forEach((node) => {
        const value = node.getAttribute(attribute) || '';
        if (value && !/^(data:|#)/i.test(value)) remainingResourceUrls.push(value);
      });
    }
    clone.querySelectorAll('[srcset]').forEach((node) => {
      if ((node.getAttribute('srcset') || '').split(',').some((item) => !/^\\s*data:/i.test(item))) remainingResourceUrls.push(node.getAttribute('srcset'));
    });
    clone.querySelectorAll('style,[style]').forEach((node) => {
      const css = node.tagName === 'STYLE' ? node.textContent || '' : node.getAttribute('style') || '';
      for (const match of css.matchAll(/url\\(\\s*["']?([^"'\\)]+)["']?\\s*\\)/gi)) {
        if (!/^(data:|#)/i.test(match[1].trim())) remainingResourceUrls.push(match[1].trim());
      }
    });
    report.externalResourceUrls.push(...remainingResourceUrls);
    report.externalResourceUrls = Array.from(new Set(report.externalResourceUrls));
    report.navigationUrls = Array.from(new Set(report.navigationUrls));
    report.warnings = Array.from(new Set(report.warnings));
    const html = '<!doctype html>' + clone.outerHTML;
    const bytes = new TextEncoder().encode(html).byteLength;
    if (report.externalResourceUrls.length) throw Object.assign(new Error('external_resources_remaining'), { report });
    if (bytes > templateExportMaxBytes) throw Object.assign(new Error('export_too_large:' + bytes), { report });
    return { html, bytes, report };
  };
  const handleExportRequest = async (request) => {
    const base = { type: 'sitecraft:export-result', requestId: request.requestId, templateId, siteId: request.siteId, revision: request.revision };
    const fail = (error, report) => parent.postMessage({ ...base, ok: false, error, report }, '*');
    if (!request.requestId || request.templateId !== templateId) return fail('template_mismatch');
    if (!activeSiteKey || request.siteId !== activeSiteKey) return fail('site_mismatch');
    if (!Number.isInteger(request.revision) || request.revision !== activeRevision) return fail('revision_mismatch');
    try {
      if (activeDraft) {
        await applyContent(activeDraft, activeLocale, activeExpectedTargets, activeVariant);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const artifact = await buildOfflineHtml();
      const safeSite = String(activeSiteKey).replace(/[^a-z0-9_-]+/gi, '-');
      parent.postMessage({ ...base, ok: true, fileName: safeSite + '-' + templateId + '.html', ...artifact }, '*');
    } catch (error) {
      fail(error instanceof Error ? error.message : 'export_failed', error?.report);
    }
  };
  const applyContent = (draft, locale, expectedTargets, variant) => {
    const generatedSections = [];
    if (!draft) return { appliedSlots: [], missingSlots: expectedTargets || [] };
    const applied = new Set();
    if (typeof prepareTemplate === 'function') prepareTemplate();
    /* vendor 构建可能没把任意值背景类编译出规则（T-28）——在 prepareFn 造完 DOM 之后补一次 */
    repairUncompiledBackgroundClasses();
    applyDesignTokens(draft);
    // 资产替换放在 prepareTemplate 之后（prepareFn 可能重写 img.src，必须先让它跑完）
    const assetReport = applyAssets(draft);
    if (draft.siteName || draft.companyName) document.title = draft.siteName || draft.companyName;
    document.documentElement.lang = locale || 'zh';
    const hero = resolveHero();
    setText(hero, localize(draft.content?.hero?.title, locale), 'hero.title.' + locale, applied);
    setText(findSubtitle(hero), localize(draft.content?.hero?.subtitle, locale), 'hero.subtitle.' + locale, applied);
    const brandCandidates = Array.from(document.querySelectorAll('header a, nav a, [class*="logo"], [class*="brand"]'));
    const brand = document.querySelector('[data-sitecraft-slot="companyName.zh"]') || brandCandidates.find((node) => visible(node) && (node.textContent?.trim() || node.querySelector('img')));
    setText(brand, draft.companyName || draft.siteName, 'companyName.zh', applied);
    const ctaCandidates = Array.from(document.querySelectorAll('main a, main button'));
    const cta = document.querySelector('[data-sitecraft-slot^="hero.cta."]') || ctaCandidates.find((node) => visible(node) && node.textContent?.trim() && !node.querySelector('img, svg'));
    setText(cta, localize(draft.content?.hero?.cta, locale), 'hero.cta.' + locale, applied);

    const aboutScope = scopeBy('about', /about|who we are|story|company|关于/i);
    const featuresScope = scopeBy('features', /feature|benefit|advantage|why|capabilit|优势|能力/i);
    const servicesScope = scopeBy('services', /service|solution|process|how it works|服务|方案/i);
    const productsScope = scopeBy('products', /product|catalog|portfolio|project|work|产品|案例/i);
    // contactScope 用强信号优先：先找含表单/mailto/tel 锚的真实联系区；否则按 heading/id/类名
    // 明确含联系词(contact/get in touch/contact us/联系/询盘)的区；两轮都不中则置空，
    // 由下方独立生成完整联系区——避免把联系明细误塞进 FAQ/特性等正文里偶然含"contact"的区。
    const sectionList = sectionScopes();
    let contactScope = null;
    const strongContact = sectionList.find((scope) => (
      scope.querySelector('form, a[href^="mailto:"], a[href^="tel:"]')
      && /contact|get in touch|inquire|联系|询盘/i.test(
        (scope.id || '') + ' ' + (scope.className || '') + ' ' + (allVisible('h1,h2,h3', scope)[0]?.textContent || ''),
      )
    ));
    if (strongContact) {
      contactScope = strongContact;
    } else {
      contactScope = sectionList.find((scope) => {
        const headingText = (allVisible('h1,h2,h3', scope)[0]?.textContent || '') + ' ' + (scope.id || '') + ' ' + (scope.className || '');
        const looksLikeContact = /(?:^|[\s·|—-])(contact|contact us|get in touch|talk to us|start now|start today|get started|联系我们|联系|获取报价|咨询|询盘)(?:[\s·|—\-]|$)/i.test(headingText);
        const isFaqLike = /faq|frequently asked|常见问题/i.test(headingText);
        return looksLikeContact && !isFaqLike;
      }) || null;
    }
    const sectionMap = { about: aboutScope, features: featuresScope, services: servicesScope, products: productsScope, contact: contactScope };
    Object.entries(sectionMap).forEach(([key, scope]) => {
      if (!scope) return;
      scope.dataset.sitecraftSection = key;
      scope.dataset.sitecraftScope = key;
      const hidden = (draft.hiddenSections || []).includes(key);
      scope.hidden = hidden;
      if (hidden) scope.style.setProperty('display', 'none', 'important');
      else scope.style.removeProperty('display');
      applied.add(key + '.visibility');
    });
    setText(aboutScope && allVisible('h1,h2,h3', aboutScope)[0], localize(draft.content?.about?.title, locale), 'about.title.' + locale, applied);
    setText(aboutScope && allVisible('p', aboutScope)[0], localize(draft.content?.about?.body, locale), 'about.body.' + locale, applied);
    setText(featuresScope && allVisible('h1,h2', featuresScope)[0], localize(draft.content?.features?.title, locale), 'features.title.' + locale, applied);
    setText(featuresScope && allVisible('p', featuresScope)[0], localize(draft.content?.features?.intro, locale), 'features.intro.' + locale, applied);
    setText(servicesScope && allVisible('h1,h2', servicesScope)[0], localize(draft.content?.services?.title, locale), 'services.title.' + locale, applied);
    setText(servicesScope && allVisible('p', servicesScope)[0], localize(draft.content?.services?.intro, locale), 'services.intro.' + locale, applied);
    setText(productsScope && allVisible('h1,h2', productsScope)[0], localize(draft.content?.products?.title, locale), 'products.title.' + locale, applied);
    // 联系区写入：优先原生标题/正文；原生缺失时在区内补生成节点，保证五个联系槽都可见产出，
    // 不因模板某元素缺失而漏掉该槽（contact.body 在无 <p> 的联系区同样补出）。
    const ensureInScope = (scope, target, tagName, className) => {
      let node = scope.querySelector('[data-sitecraft-slot^="' + target + '."]');
      if (!node) {
        node = document.createElement(tagName);
        if (className) node.className = className;
        node.style.cssText = 'margin:8px 0;font:inherit;color:inherit';
        scope.append(node);
      }
      return node;
    };
    if (contactScope) {
      const nativeTitle = allVisible('h1,h2', contactScope)[0];
      const nativeBody = allVisible('p', contactScope)[0];
      const hasTitleNode = nativeTitle && /(h1|h2)/i.test(nativeTitle.tagName);
      const titleNode = hasTitleNode ? nativeTitle : ensureInScope(contactScope, 'contact.title', 'h2', '');
      setText(titleNode, localize(draft.content?.contact?.title, locale), 'contact.title.' + locale, applied);
      const bodyNode = nativeBody || ensureInScope(contactScope, 'contact.body', 'p', '');
      setText(bodyNode, localize(draft.content?.contact?.body, locale), 'contact.body.' + locale, applied);
      let details = contactScope.querySelector('[data-sitecraft-contact-details]');
      if (!details) {
        details = document.createElement('div');
        details.dataset.sitecraftContactDetails = 'true';
        details.style.cssText = 'display:grid;gap:8px;margin-top:16px';
        contactScope.append(details);
      }
      const ensureContactNode = (target, tagName) => {
        let node = details.querySelector('[data-sitecraft-slot^="' + target + '."]');
        if (!node) {
          node = document.createElement(tagName);
          details.append(node);
        }
        return node;
      };
      const email = draft.content?.contact?.email;
      const emailNode = ensureContactNode('contact.email', 'a');
      if (setTextOrHide(emailNode, email, 'contact.email.' + locale, applied, isPublishedVariant())) emailNode.setAttribute('href', 'mailto:' + email);
      const phone = draft.content?.contact?.phone;
      const phoneNode = ensureContactNode('contact.phone', 'a');
      if (setTextOrHide(phoneNode, phone, 'contact.phone.' + locale, applied, isPublishedVariant())) phoneNode.setAttribute('href', 'tel:' + phone);
      const address = localize(draft.content?.contact?.address, locale);
      const addressNode = ensureContactNode('contact.address', 'address');
      setTextOrHide(addressNode, address, 'contact.address.' + locale, applied, isPublishedVariant());
      if (isPublishedVariant()) hideIfAllSlotsHidden(details);
    }
    // 原生排版优先：adapter 声明了 nativeFillFn 的模板，先尝试把槽内容填进模板自身的
    // 非卡片原生区块（icon_row/image_banner/分栏）。成功则注入 setText 的 sitecraft-slot，
    // 使下方 hasVisibleSlotPrefix 短路、不会退回通用卡片重建。
    if (typeof applyNativeFill === 'function') applyNativeFill(draft, locale, applied);
    // nativeFill 已把该槽填进原生区块（slot 前缀命中）时，跳过通用 applyCards，
    // 避免其 fallback 把原生行/分栏当卡片二次覆写（landwind 等 split/分栏模板）。
    if (!hasVisibleSlotPrefix('features.items') && !hasVisibleSlotPrefix('features.title')) {
      applyCards('features', featuresScope, draft.content?.features?.items, locale, applied, /feature|advantage|benefit/i);
    }
    // services 槽位分发：声明了专属 servicesFn 的模板（如 forge 原生服务卡区）调 applyNativeServiceCards；
    // 未声明的模板走通用 applyCards('services')。
    if (typeof applyNativeServiceCards === 'function') {
      applyNativeServiceCards(draft, locale, applied);
    } else if (!hasVisibleSlotPrefix('services.items') && !hasVisibleSlotPrefix('services.title')) {
      applyCards('services', servicesScope, draft.content?.services?.items, locale, applied, /Name of this service|service|solution/i);
    }

    const productNames = (draft.products || []).map((item) => item.name?.[locale] || item.name?.zh || item.name?.en).filter(Boolean);
    if (productNames.length) {
      // 原生产品名写入保护：productsScope 若已被 nativeFill 等标为其它槽（如 features 的 icon 行），
      // 不得把产品名覆盖进该区（scopeBy('products') 正则可能被其它 section 的 demo 文案误命中）。
      // 产品一律由下方 renderAdditionalProducts 生成独立产品区承载；只有"确定是 products 原生区"
      // 的 scope 才走原生标题改写。
      const productsScopeOwned = productsScope && productsScope.getAttribute('data-sitecraft-section');
      const nativeProductsScope = (productsScopeOwned && productsScopeOwned === 'products') ? productsScope : null;
      // 适配器已把产品写进原生区（nativeFillFn 落了 products.<sku>.name 槽）时，
      // 只生成「原生区装不下的剩余产品」，避免同一批产品在原生区与生成区各出现一次
      // （2026-09-09 实测 nextjs-landing/kindred 重复渲染）。
      const nativeProductSlots = new Set(Array.from(document.querySelectorAll('[data-sitecraft-slot]'))
        .filter((node) => {
          const slot = node.dataset.sitecraftSlot || '';
          return slot.startsWith('products.') && slot.endsWith('.name.' + locale) && visible(node);
        })
        .map((node) => node.dataset.sitecraftSlot));
      if (nativeProductSlots.size) {
        renderAdditionalProducts(draft, locale, nativeProductSlots.size, applied);
      } else {
        const headings = nativeProductsScope ? allVisible('h3,h4,[class*="title"],[class*="name"]', nativeProductsScope) : [];
        const mappedHeadings = headings.slice(0, productNames.length);
        mappedHeadings.forEach((heading, index) => setText(heading, productNames[index], 'products.' + draft.products[index].sku + '.name.' + locale, applied));
        renderAdditionalProducts(draft, locale, 0, applied);
      }
    }
    const hiddenSections = new Set(draft.hiddenSections || []);
    // 动态生成区需按当前 locale 重建（hasVisibleSlotPrefix 会因上次注入的 slot 短路，导致切换语言后内容停留旧语言）；
    // 模板原生槽位已由上方 setText/applyCards 用当前 locale 更新，此处只需兜底无原生槽位的板块。
    if (!hiddenSections.has('about') && (!hasVisibleSlotPrefix('about.body') || hasGeneratedSection('about'))) {
      renderGeneratedContent('about', draft.content?.about?.title, draft.content?.about?.body, [], locale, applied);

      generatedSections.push('about');
    }
    if (!hiddenSections.has('features') && (!hasVisibleSlotPrefix('features.items') || hasGeneratedSection('features'))) {
      renderGeneratedContent('features', draft.content?.features?.title, draft.content?.features?.intro, draft.content?.features?.items, locale, applied);

      generatedSections.push('features');
    }
    if (!hiddenSections.has('services') && (!hasVisibleSlotPrefix('services.items') || hasGeneratedSection('services'))) {
      renderGeneratedContent('services', draft.content?.services?.title, draft.content?.services?.intro, draft.content?.services?.items, locale, applied);

      generatedSections.push('services');
    }
    // 模板无真实联系区（contactScope 为空）：独立生成一个完整的联系区（标题+正文+email/phone/address），
    // 避免把联系内容塞进 FAQ/评价等误判区。已有 contactScope 时上方已写入原生槽位，这里不再重复。
    if (!hiddenSections.has('contact') && !contactScope && !hasVisibleSlotPrefix('contact.body')) {
      let contactSection = document.querySelector('[data-sitecraft-generated-content="contact"]');
      if (!contactSection) {
        contactSection = document.createElement('section');
        contactSection.dataset.sitecraftGeneratedContent = 'contact';
        contactSection.dataset.sitecraftSection = 'contact';
        contactSection.style.cssText = 'padding:clamp(48px,7vw,96px) clamp(20px,7vw,96px);background:inherit;color:inherit;border-top:1px solid rgba(127,127,127,.18)';
        const footer = document.querySelector('footer');
        const main = document.querySelector('main') || document.body;
        if (footer?.parentElement) footer.parentElement.insertBefore(contactSection, footer);
        else main.append(contactSection);
      }
      const heading = document.createElement('h2');
      heading.style.cssText = 'margin:0 0 12px;font:inherit;font-size:clamp(28px,4vw,52px);font-weight:800;line-height:1.05';
      setText(heading, localize(draft.content?.contact?.title, locale), 'contact.title.' + locale, applied);
      const body = document.createElement('p');
      body.style.cssText = 'max-width:720px;margin:0 0 20px;opacity:.78;line-height:1.7';
      setText(body, localize(draft.content?.contact?.body, locale), 'contact.body.' + locale, applied);
      const details = document.createElement('div');
      details.style.cssText = 'display:grid;gap:8px;margin-top:16px';
      const email = draft.content?.contact?.email;
      const emailNode = document.createElement('a');
      if (setTextOrHide(emailNode, email, 'contact.email.' + locale, applied, isPublishedVariant())) emailNode.setAttribute('href', 'mailto:' + email);
      const phone = draft.content?.contact?.phone;
      const phoneNode = document.createElement('a');
      if (setTextOrHide(phoneNode, phone, 'contact.phone.' + locale, applied, isPublishedVariant())) phoneNode.setAttribute('href', 'tel:' + phone);
      const addressNode = document.createElement('address');
      setTextOrHide(addressNode, localize(draft.content?.contact?.address, locale), 'contact.address.' + locale, applied, isPublishedVariant());
      details.append(emailNode, phoneNode, addressNode);
      if (isPublishedVariant()) hideIfAllSlotsHidden(details);
      contactSection.append(heading, body, details);
      // 2026-09-10 修复：此处创建的是**通用生成兜底区**，必须和 about/features/services 一样
      // 记入 generatedSections，否则 L3 结构判定与工作台「以下板块为动态备用排版」提示**漏检 contact**。
      generatedSections.push('contact');
    }
    // ===== 询盘表单兜底注入（P3.5 / A8，2026-09-09）=====
    // 实测 22 个模板只有 2 个（astrogent / shadcn-landing2）自带可用的 name/email/message 表单，
    // 其余 20 个发布后访客**无处提交询盘**——这是主路径缺口，不是边缘兜底。
    // 只在 published 变体注入：工作台/预览保留模板原样，不污染编辑面。
    // 表单由下方 submit 拦截器接管（postMessage → 父页 POST /api/public/<siteKey>/leads），
    // 因此 action 必须为空，否则浏览器会带着访客数据跳到模板 demo 站。
    if (isPublishedVariant() && !hiddenSections.has('contact')) {
      const hasUsableForm = Array.from(document.querySelectorAll('form')).some((form) => {
        const signals = Array.from(form.querySelectorAll('input, textarea')).map((field) => ((field.getAttribute('name') || '') + ' ' + (field.getAttribute('type') || '') + ' ' + (field.getAttribute('placeholder') || '')).toLowerCase()).join(' ');
        return /name/.test(signals) && /mail/.test(signals) && /message|comment|content|body/.test(signals);
      });
      if (!hasUsableForm) {
        /**
         * ⚠️ 必须用 templateUiCopy[locale]，**不能**用 copy。
         *
         * 2026-09-12 真机实测（客户旅程 ⑨ 填询盘）：这段原本写的是 copy.form.labels[key]，
         * 而 copy 是 applyTemplateUiCopy 的**局部变量**（见上方 const copy = templateUiCopy[...]），
         * 在 applyContent 里**根本不存在** → 每次走到这里抛 ReferenceError: copy is not defined。
         *
         * 后果不是"表单样式不对"，而是**从这里往后的整段注入被中断**：
         * applyContent 的异常会让后续语句**全部不执行**，包括同函数末尾的
         * sanitizePublishedDemo() / scrubPlaceholders() —— 于是"待补充"占位标记
         * 直接显示给访客，22 个模板里 20 个的发布站**也没有任何询盘表单**。
         *
         * 那个缺口正是上方注释自称要修的"主路径缺口"：能力 2026-09-09 就写了，
         * 但一个标识符写错，**从未真正生效过**，而且静默无日志。
         *
         * 用 templateUiCopy[locale] 而不是 activeUiCopy：后者的赋值点在
         * applyTemplateUiCopy（本函数**之后**才调用），这里读会拿到语言不符的那一份。
         * 显式按 locale 取，不依赖语句顺序。
         *
         * （本段是注入脚本的一部分，身处模板字面量内——**注释里不能出现反引号**，
         *   否则会提前终止外层字符串。这个坑本轮已踩到第四次。）
         */
        const copy = templateUiCopy[locale] || templateUiCopy.zh;
        let form = document.querySelector('[data-sitecraft-lead-form]');
        if (!form) {
          form = document.createElement('form');
          form.dataset.sitecraftLeadForm = 'true';
          form.dataset.sitecraftGeneratedContent = 'lead-form';
          form.noValidate = true;
          form.style.cssText = 'display:grid;gap:14px;max-width:640px;margin:28px 0 0;font:inherit;color:inherit';
          const contactHost = document.querySelector('[data-sitecraft-generated-content="contact"]')
            || document.querySelector('[data-sitecraft-section="contact"]')
            || document.querySelector('footer')?.parentElement
            || document.querySelector('main')
            || document.body;
          const labelStyle = 'display:grid;gap:6px;font:inherit;font-size:13px;opacity:.82';
          const fieldStyle = 'width:100%;padding:11px 13px;font:inherit;font-size:15px;color:inherit;background:color-mix(in srgb,currentColor 6%,transparent);border:1px solid rgba(127,127,127,.35);border-radius:8px';
          const makeField = (key, tag, type) => {
            const label = document.createElement('label');
            label.style.cssText = labelStyle;
            label.textContent = copy.form.labels[key];
            const field = document.createElement(tag);
            field.setAttribute('name', key);
            if (type) field.setAttribute('type', type);
            field.setAttribute('placeholder', copy.form.placeholders[key]);
            field.style.cssText = fieldStyle;
            field.required = key !== 'company';
            label.append(field);
            return label;
          };
          form.append(makeField('name', 'input', 'text'), makeField('email', 'input', 'email'), makeField('company', 'input', 'text'), makeField('message', 'textarea'));
          // 蜜罐：真实访客看不见（视觉+读屏双重隐藏），机器人会填 → 服务端按 honeypot 丢弃
          const honeypot = document.createElement('input');
          honeypot.setAttribute('type', 'text');
          honeypot.setAttribute('name', 'website');
          honeypot.setAttribute('tabindex', '-1');
          honeypot.setAttribute('autocomplete', 'off');
          honeypot.setAttribute('aria-hidden', 'true');
          honeypot.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
          const submit = document.createElement('button');
          submit.setAttribute('type', 'submit');
          submit.textContent = copy.form.submit;
          submit.style.cssText = 'justify-self:start;padding:12px 26px;font:inherit;font-size:15px;font-weight:700;color:#fff;background:var(--sitecraft-primary,#111);border:0;border-radius:8px;cursor:pointer';
          form.append(honeypot, submit);
          contactHost.append(form);
        }
      }
    }
    const mapped = Object.values(sectionMap).filter(Boolean);
    const commonParent = mapped.length === 5 && mapped.every((scope) => scope.parentElement === mapped[0].parentElement) ? mapped[0].parentElement : null;
    if (commonParent && Array.isArray(draft.sectionOrder)) {
      draft.sectionOrder.forEach((key) => sectionMap[key] && commonParent.append(sectionMap[key]));
      applied.add('sections.order');
    }
    applyTemplateUiCopy(draft, locale || 'zh', applied);
    document.documentElement.dataset.sitecraftTemplate = templateId;
    applied.add('template');
    if (variant === 'published') { sanitizePublishedDemo(); scrubPlaceholders(); }
    const appliedSlots = Array.from(applied);
    const requiredTargets = Array.from(new Set([...(templateRequiredTargets || []), ...(expectedTargets || [])]));
    const targetPrefixes = {
      brand: ['companyName', 'brand'],
      heroTitle: ['hero.title'],
      heroSubtitle: ['hero.subtitle'],
      primaryCta: ['hero.cta'],
      about: ['about'],
      features: ['features'],
      services: ['services'],
      products: ['products'],
      contact: ['contact'],
    };
    const expectedFingerprints = {
      brand: localize(draft.siteName || draft.companyName || draft.businessName, locale),
      heroTitle: localize(draft.content?.hero?.title, locale),
      heroSubtitle: localize(draft.content?.hero?.subtitle, locale),
      primaryCta: localize(draft.content?.hero?.cta, locale),
      about: localize(draft.content?.about?.title, locale),
      features: localize(draft.content?.features?.title, locale),
      services: localize(draft.content?.services?.title, locale),
      products: localize(draft.content?.products?.title, locale),
      contact: localize(draft.content?.contact?.title, locale),
    };
    const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const renderedValue = (node) => node.matches('input,textarea') ? (node.placeholder || node.value || '') : (node.textContent || '');
    const slotNodes = Array.from(document.querySelectorAll('[data-sitecraft-slot]'));
    const actuallyVisible = (node) => {
      const style = getComputedStyle(node);
      return visible(node) && style.display !== 'none' && Number(style.opacity || 1) > 0;
    };
    const visibleSlots = appliedSlots.filter((slot) => {
      const node = slotNodes.find((candidate) => candidate.dataset.sitecraftSlot === slot);
      if (!node || !actuallyVisible(node)) return false;
      const target = Object.keys(targetPrefixes).find((key) => targetPrefixes[key].some((prefix) => slot === prefix || slot.startsWith(prefix + '.')));
      const fingerprint = target ? expectedFingerprints[target] : '';
      const rendered = normalizeText(renderedValue(node));
      return rendered.length > 0 && (!fingerprint || rendered.includes(normalizeText(fingerprint)));
    });
    const visibleTextsBySlot = {};
    templateContentSlots.forEach((binding) => {
      let declaredNodes = [];
      try {
        declaredNodes = allVisible(binding.selector);
      } catch {
        declaredNodes = [];
      }
      const exactSlotNodes = slotNodes.filter((node) => {
        const slot = node.dataset.sitecraftSlot || '';
        return actuallyVisible(node) && (slot === binding.target || slot.startsWith(binding.target + '.'));
      });
      const texts = unique([...declaredNodes, ...exactSlotNodes])
        .map((node) => String(renderedValue(node)).replace(/\s+/g, ' ').trim().slice(0, binding.maxLength))
        .filter(Boolean);
      if (texts.length) visibleTextsBySlot[binding.target] = Array.from(new Set(texts)).slice(0, 12);
    });
    const residualDemoSlots = templateContentSlots.filter((binding) => {
      const text = (visibleTextsBySlot[binding.target] || []).join('\\n').toLowerCase();
      return binding.demoFingerprints.some((fingerprint) => {
        const normalized = String(fingerprint || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return normalized && text.includes(normalized);
      });
    }).map((binding) => binding.target);
    const missingSlots = requiredTargets.filter((target) => {
      const prefixes = targetPrefixes[target] || [target];
      return !visibleSlots.some((slot) => prefixes.some((prefix) => slot === prefix || slot.startsWith(prefix + '.')));
    });
    return { appliedSlots, visibleSlots, visibleTextsBySlot, residualDemoSlots, missingSlots, generatedContentSections: generatedSections, assetReport, incompatible: missingSlots.length > 0 };
  };
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'sitecraft:content' && event.data.templateId === templateId) {
      // 就地编辑期间挂起全量重注入：setText 用 node.textContent = value 会重建文本节点，
      // 必然让光标塌缩；且父窗口有 4 次重试（500/1500/3500/6000ms），打字过程中会被覆盖。
      // 这里只记下最新一份，编辑结束（commit/cancel）后再 flush（2026-09-09）。
      if (activeEdit) {
        deferredContent = event.data;
        parent.postMessage({ type: 'sitecraft:applied', templateId, revision: activeRevision, deferred: true, appliedSlots: [], visibleSlots: [] }, '*');
        return;
      }
      activeVariant = event.data.variant || 'preview';
      activeSiteKey = event.data.siteKey || null;
      activeRevision = event.data.draft?.revision ?? null;
      activeDraft = withNavigationView(event.data.draft || null);
      activeLocale = event.data.locale || 'zh';
      activeExpectedTargets = Array.isArray(event.data.expectedTargets) ? event.data.expectedTargets : [];
      activeEditMode = event.data.editMode === 'direct' ? 'direct' : 'ai';
      // ===== thumbnail 变体：只渲染模板原件（2026-09-09）=====
      // 推荐卡片用 thumbnail 展示「这是个什么模板」，但此前它和 workspace 走同一条 applyContent，
      // 把 AI 生成的内容也渲染了进去——用户看到的是「模板 + AI 文案」，认不出模板本身，
      // 于是反馈「推荐的现有模板都像换皮」。
      // 这里只做模板自身初始化（adapter prepareFn + 模板专属兜底样式），不注入任何 draft 内容；
      // 仍发 sitecraft:applied 报告，否则调用方的 onPreviewStateChange 会一直等（bridge_apply_timeout）。
      if (activeVariant === 'thumbnail') {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (typeof prepareTemplate === 'function') prepareTemplate();
          repairUncompiledBackgroundClasses();
          applyDesignTokens(activeDraft);
          parent.postMessage({
            type: 'sitecraft:applied',
            templateId,
            revision: event.data.draft?.revision,
            appliedSlots: [], visibleSlots: [], visibleTextsBySlot: {}, residualDemoSlots: [],
            missingSlots: [], generatedContentSections: [], assetReport: { applied: [], missing: [] },
            incompatible: false,
          }, '*');
        }));
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const report = applyContent(event.data.draft, event.data.locale, event.data.expectedTargets, event.data.variant);
        parent.postMessage({ type: 'sitecraft:applied', templateId, revision: event.data.draft?.revision, ...report }, '*');
      }));
    }
    if (event.data?.type === 'sitecraft:edit-result' && event.data.templateId === templateId) {
      finishInlineEdit(event.data);
    }
    if (event.data?.type === 'sitecraft:export-request') {
      void handleExportRequest(event.data);
    }
    if (event.data?.type === 'sitecraft:lead-result' && event.data.templateId === templateId && event.data.siteKey === activeSiteKey && event.data.requestId === activeLeadRequestId && activeLeadForm) {
      const form = activeLeadForm;
      const button = form.querySelector('button[type="submit"], input[type="submit"]');
      if (button) button.disabled = false;
      let status = form.querySelector('[data-sitecraft-lead-status]');
      if (!status) {
        status = document.createElement('div');
        status.dataset.sitecraftLeadStatus = 'true';
        status.setAttribute('role', 'status');
        status.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:6px;font:13px/1.5 system-ui,sans-serif';
        form.append(status);
      }
      status.textContent = event.data.message || (event.data.ok ? activeUiCopy.form.success : activeUiCopy.form.error);
      status.style.background = event.data.ok ? '#eaf5e5' : '#fff1f0';
      status.style.color = event.data.ok ? '#24583e' : '#a33a32';
      if (event.data.ok) {
      form.reset();
        form.querySelectorAll('label, input, textarea, button').forEach((field) => { field.style.display = 'none'; });
      }
      activeLeadForm = null;
    }
  });
  document.addEventListener('submit', (event) => {
    if (activeVariant !== 'published') return;
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const button = form.querySelector('button[type="submit"], input[type="submit"]');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    activeLeadForm = form;
    activeLeadRequestId = crypto.randomUUID();
    const values = Object.fromEntries(new FormData(form).entries());
    parent.postMessage({ type: 'sitecraft:lead-submit', templateId, siteKey: activeSiteKey, requestId: activeLeadRequestId, fields: Object.assign(values, { idempotencyKey: activeLeadRequestId }) }, '*');
  }, true);
  // ===== 就地编辑生命周期（P3.1，2026-09-09）=====
  // 设计要点（逐条对应二次取证发现的阻断点）：
  //  1. 编辑期间挂起 sitecraft:content（见消息处理器），避免 setText 重建文本节点导致光标塌缩；
  //  2. 编辑节点用独立标记 data-sitecraft-editing，不复用 2 秒后会被清除的 data-sitecraft-selected；
  //  3. 提交后由父窗口写草稿，回 edit-result；成功才退出编辑态并 flush 挂起的 content。
  const beginInlineEdit = (node, slot) => {
    const requestId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    const original = (node.textContent || '').trim();
    activeEdit = { node, slot, original, requestId };
    node.setAttribute('contenteditable', 'plaintext-only');
    node.setAttribute('data-sitecraft-editing', 'true');
    node.style.outline = '3px solid #2e6b4f';
    node.style.outlineOffset = '3px';
    node.style.background = 'rgba(46,107,79,.06)';
    // 阻止编辑期间的回车换行（单行/短文本字段不需要多行）
    node.addEventListener('keydown', onEditKeydown, true);
    node.addEventListener('focusout', onEditFocusOut, true);
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    if (selection) { selection.removeAllRanges(); selection.addRange(range); }
    parent.postMessage({ type: 'sitecraft:edit-start', templateId, requestId, slot }, '*');
  };
  const onEditKeydown = (event) => {
    if (!activeEdit) return;
    if (event.key === 'Escape') { event.preventDefault(); cancelInlineEdit(); return; }
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commitInlineEdit(); }
  };
  const onEditFocusOut = () => {
    // blur 后若焦点仍在页面内且编辑未结束 → 视为提交（点击别处的场景已由 click 处理器先行 commit）
    if (!activeEdit) return;
    window.setTimeout(() => { if (activeEdit && document.activeElement !== activeEdit.node) commitInlineEdit(); }, 0);
  };
  const commitInlineEdit = () => {
    if (!activeEdit) return;
    const { node, slot, original, requestId } = activeEdit;
    const value = (node.textContent || '').replace(/\\s+/g, ' ').trim();
    if (value === original.replace(/\\s+/g, ' ').trim()) { cancelInlineEdit(); return; }
    parent.postMessage({ type: 'sitecraft:edit-commit', templateId, requestId, slot, value, originalValue: original }, '*');
  };
  const teardownEdit = () => {
    if (!activeEdit) return;
    const { node } = activeEdit;
    node.removeAttribute('contenteditable');
    node.removeAttribute('data-sitecraft-editing');
    node.style.outline = '';
    node.style.outlineOffset = '';
    node.style.background = '';
    node.removeEventListener('keydown', onEditKeydown, true);
    node.removeEventListener('focusout', onEditFocusOut, true);
    activeEdit = null;
  };
  const cancelInlineEdit = () => {
    if (!activeEdit) return;
    const { node, original } = activeEdit;
    if (node.textContent !== original) node.textContent = original;
    teardownEdit();
    flushDeferredContent();
  };
  const finishInlineEdit = (data) => {
    if (!activeEdit || data.requestId !== activeEdit.requestId) return;
    if (data.ok) {
      // 成功：父窗口已写草稿，revision 变化会带来新的 content 消息（或 flush 挂起的那份）
      teardownEdit();
      flushDeferredContent();
      return;
    }
    // 失败：回滚到编辑前的文本，保持编辑态让用户可重试
    const { node, original } = activeEdit;
    if (node.textContent !== original) node.textContent = original;
    node.setAttribute('data-sitecraft-edit-error', 'true');
    window.setTimeout(() => node.removeAttribute('data-sitecraft-edit-error'), 2500);
  };
  const flushDeferredContent = () => {
    const pending = deferredContent;
    deferredContent = null;
    if (!pending) return;
    activeVariant = pending.variant || activeVariant;
    activeSiteKey = pending.siteKey || activeSiteKey;
    activeRevision = pending.draft?.revision ?? activeRevision;
    activeDraft = withNavigationView(pending.draft || activeDraft);
    activeLocale = pending.locale || activeLocale;
    activeExpectedTargets = Array.isArray(pending.expectedTargets) ? pending.expectedTargets : activeExpectedTargets;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const report = applyContent(pending.draft, pending.locale, pending.expectedTargets, pending.variant);
      parent.postMessage({ type: 'sitecraft:applied', templateId, revision: pending.draft?.revision, ...report }, '*');
    }));
  };

  document.addEventListener('click', (event) => {
    // 就地编辑态下：点击已在编辑的节点（移动光标）不拦截；点击别处则先提交
    if (activeEdit) {
      if (activeEdit.node === event.target || activeEdit.node.contains(event.target)) return;
      commitInlineEdit();
      return;
    }
    // 图片点选（P3.2）：只有注册表声明了可替换的槽位才响应，避免误报
    const image = event.target?.closest?.('img');
    if (image && activeEditMode === 'direct' && !image.closest('form')) {
      const assetSlot = resolveAssetSlotForImage(image);
      if (assetSlot) {
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage({ type: 'sitecraft:asset-select', templateId, target: assetSlot, currentSrc: image.getAttribute('src') || '' }, '*');
        return;
      }
    }
    const node = event.target?.closest?.('h1, p, a, button, h2, h3');
    if (!node) {
      // 空白处（通常是压在图片上的文字容器）：若落在已登记资产图范围内 → 选图
      if (activeEditMode === 'direct') {
        const assetTarget = resolveAssetSlotForNode(event.target);
        if (assetTarget) {
          event.preventDefault();
          event.stopPropagation();
          parent.postMessage({ type: 'sitecraft:asset-select', templateId, target: assetTarget, currentSrc: '' }, '*');
        }
      }
      return;
    }
    if (node.closest('form')) return;
    event.preventDefault();
    event.stopPropagation();
    // 点选视觉反馈：给被点元素加高亮 outline（2 秒后清除；清掉上一次高亮）
    const prev = document.querySelector('[data-sitecraft-selected]');
    if (prev) { prev.removeAttribute('data-sitecraft-selected'); prev.style.outline = ''; }
    node.setAttribute('data-sitecraft-selected', 'true');
    node.style.outline = '3px solid #2e6b4f';
    node.style.outlineOffset = '3px';
    window.setTimeout(() => {
      if (node.getAttribute('data-sitecraft-selected')) {
        node.removeAttribute('data-sitecraft-selected');
        node.style.outline = '';
      }
    }, 2000);
    const slot = node.dataset.sitecraftSlot || node.closest('[data-sitecraft-slot]')?.dataset.sitecraftSlot || '';
    const section = node.closest('[data-sitecraft-section]')?.dataset.sitecraftSection;
    // direct 模式 + 可映射槽位 → 直接进入就地编辑，不再走「填对话框再发送」
    if (activeEditMode === 'direct') {
      // 可编辑性判定：静态前缀数组 + 两条**中段带变量**的正则。
      // 后者对应 products.<sku>.* 与 navigation.<id>.label——前缀数组表达不了。
      // 正则源来自 lib/inline-edit-mapping.ts，**别在这里另写一份**（会漂）。
      if (slot && editableSlot(slot) && !INLINE_EDIT_REJECTED.some((prefix) => slot.startsWith(prefix))) {
        beginInlineEdit(node, slot);
        return;
      }
      // 不可编辑的节点：仍发 select，让父窗口回落为 AI 修改
      parent.postMessage({ type: 'sitecraft:edit-rejected', templateId, reason: slot ? 'unsupported_slot' : 'not_editable' }, '*');
      return;
    }
    const hero = resolveHero();
    let target = 'products';
    if (slot.startsWith('services')) target = 'services';
    else if (slot.startsWith('features')) target = 'features';
    else if (slot.startsWith('about')) target = 'about';
    else if (slot.startsWith('contact')) target = 'contact';
    else if (slot.startsWith('products')) target = 'products';
    else if (section) target = section;
    else if (node === hero) target = 'heroTitle';
    else if (node === findSubtitle(hero)) target = 'heroSubtitle';
    else if (node.matches('a, button')) target = 'primaryCta';
    else if (node.closest('header, nav')) target = 'brand';
    parent.postMessage({ type: 'sitecraft:select', target, slot }, '*');
  }, true);

  /* ===== T-14 水合快照（2026-09-14）=====
   *
   * 为什么需要：shadcn-landing2 这类 Next.js 导出站，服务器发出含内容的 HTML
   * （273KB）→ 内容**进了 DOM**；但内联 flight payload 脚本被 CSP 拦（实测 7 条
   * 违规）→ React 拿不到数据 → 水合后**清空容器、渲染成空** → body 里只剩
   * 8 个 script 与 1 个 style。实测间歇率 3/50（约 6%）。
   *
   * 做法：等模板脚本跑完（load）后把 DOM 序列化下来，此后**内容元素塌缩**即还原。
   * 还原是一次性的（成功即断开 observer），避免与后续水合互相打架。
   *
   * ## ⚠️ 触发签名为什么必须"数内容元素"，而不是看 innerHTML 空不空
   *
   * 真实白屏态里 body 剩的是 **8 个 script + 1 个 style** ——
   * **innerHTML 完全非空**。首版守卫写成「innerHTML.trim() 非空就返回」，
   * 于是它判定"还有内容"、**永远不还原**：
   *
   * - 对这个真实形态 → **救不回来**（门禁用例 1/2 红，红得对）；
   * - 对合法编辑 → 不误伤（用例 3 绿）——但那是因为它**根本不动**，不是因为判得准。
   *
   * 收紧为：**只在"内容元素数从 N 塌缩到 ~0"时才 restore**。
   * SCRIPT / STYLE / LINK / META / TEMPLATE **不计入内容**。
   * 普通 mutation（合法编辑、局部更新）内容元素数不变 → 一律不动。
   * 门禁：e2e/specs/hydration-snapshot.spec.ts 三条（还原 / 一致性 / 不回滚编辑）。 */
  (() => {
    if (typeof MutationObserver !== 'function') return;
    var NON_CONTENT = ['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE'];
    let snapshot = null;
    let snapshotContent = 1;
    let snapshotText = 0;
    let lastContent = -1;
    /* ⚠️ 必须初始化为"现在"（2026-09-14 实测真缺陷）：写成 0 会让首次巡检
     * 算出「已稳定 30 年」→ 内容一到位就立刻收工 → 此后任何水合清空无人再救。
     * 这是「锁A/锁C 拍不红」的根因。 */
    let stableSince = Date.now();
    let rewrites = 0;
    /* 诊断计数器：只为回答"observer 到底跑没跑"（钩子按需读取） */
    let observeCalls = 0;
    let lastNSeen = -1;
    const root = () => document.querySelector('main') || document.body;
    const contentEls = (node) => {
      if (!node) return 0;
      return Array.prototype.filter.call(node.querySelectorAll('*'), (el) =>
        NON_CONTENT.indexOf(el.tagName) === -1).length;
    };
    const capture = () => {
      const main = root();
      if (!main) return;
      /* ⚠️ 采"有内容元素"的第一个状态——**不能只看 innerHTML.trim()**。
       * 实测：真实白屏发生在 load 之前，等 load 再采就永远采不到
       * （DOM 已被清空）。而中间态里 innerHTML 可能是 script/style 之类
       * 的非空串——那种状态不能当快照，否则还原出来还是空的。 */
      const n = contentEls(main);
      if (n === 0) return;
      /* 只接受**文字量更多**的新快照（2026-09-14 实测修正）。
       * 首版判据是「内容元素数更多」——**它拦不住水合中间态**：
       * React 水合时会留下大量**空壳节点**（实测 839 个空 div，
       * 元素数比快照的 834 还多，文字量却是 0），于是残页照样覆盖了完整快照。
       * 判据改成**文字量**：空壳再多也不算内容。 */
      const text = main.innerText ? main.innerText.trim().length : 0;
      if (snapshot && text <= snapshotText) return;
      snapshot = main.innerHTML;
      snapshotContent = n;
      snapshotText = text;
    };
    const restore = () => {
      if (!snapshot || rewrites >= 3) return;
      const main = root();
      if (!main) return;
      /* 收紧签名：只有内容元素塌缩才动。合法编辑/局部更新一律不碰。 */
      const n = contentEls(main);
      if (n > snapshotContent / 2) return;
      rewrites += 1;
      main.innerHTML = snapshot;
    };
    /* ⚠️ 判据从"是否关闸"改成"**内容元素数是否还在变**"（2026-09-14 实测）：
     * 旧实现 restore 一次就 disconnect，而实测存在**两次清空**的路径——
     * 桥在 194ms 抢在水合前还原，React 在 3179ms 水合时把它不认识的这批
     * 节点再清一次，那时已无人再救。所以快照必须**活到内容稳定为止**。
     * 稳定判据取"≥1.5s 内容元素数不变"：真实水合约 3.1s 落定，
     * 该窗口足以覆盖；也远晚于用户可能做的编辑。 */
    const STABLE_MS = 1500;
    const WATCH_MS = 20000;
    const observer = new MutationObserver(() => {
      observeContent();
    });
    /* 持续观察内容元素数：变了就按读数决定"再采"还是"再救"。
     * 不再一次性关闸——真实路径需要救两次（见上方 STABLE_MS 注释）。 */
    const observeContent = () => {
      observeCalls += 1;
      const main = root();
      if (!main) return;
      capture();
      const n = contentEls(main);
      lastNSeen = n;
      if (n !== lastContent) {
        lastContent = n;
        stableSince = Date.now();
      }
      restore();
    };
    /* 立刻开始观察（不等 load）——白屏可能发生在 load 之前 */
    observeContent();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState !== 'complete') window.addEventListener('load', observeContent, { once: true });
    /* ⚠️ **绝不提前收工**（2026-09-14 实测真缺陷）：
     * 首版让巡检在「内容已稳定且快照无损」时 disconnect——看似合理，
     * 实测却致命：真实水合清空发生在 **3.1s**，而内容在 1.5s 就"看起来稳定"了，
     * 观察者在那之前退休 → 水合清空时**已无人值守**（实测 observeCalls 冻结、
     * 注入 839 个节点也不再触发）。
     * 所以观察者必须**活满整个 WATCH_MS**。 */
    let aliveSince = Date.now();
    const watchdog = () => {
      /* 只在观察者还活着时读 DOM：收工后绝不再动页面（避免与 React 打架） */
      if (aliveSince !== -1) {
        const main = root();
        if (main) {
          const n = contentEls(main);
          if (n !== lastContent) {
            lastContent = n;
            stableSince = Date.now();
          }
        }
        capture();
      }
      if (Date.now() - aliveSince < WATCH_MS) {
        window.setTimeout(watchdog, 250);
        return;
      }
      observer.disconnect();
      aliveSince = -1;
    };
    window.setTimeout(watchdog, 250);
    /* 测试钩子：**只在异常签名下**暴露内部状态，用于把三处机制各自锁住
     *（军规 2：新机制必须有能红它的场景）。正常路径下这两个全局**永不出现**，
     * 故不构成对外接口，也不改变任何行为。 */
    if (/[?&]__sitecraftSnapshotProbe=1/.test(window.location.search)) {
      try {
        window.__sitecraftSnapshotState = {
          snapshotLen: () => (snapshot ? snapshot.length : 0),
          snapshotContent: () => snapshotContent,
          snapshotText: () => snapshotText,
          lastContent: () => lastContent,
          rewrites: () => rewrites,
          observeCalls: () => observeCalls,
          lastNSeen: () => lastNSeen,
          isStable: () => Date.now() - stableSince,
        };
      } catch (e) { /* 钩子绝不影响兜底逻辑 */ }
    }
  })();

  parent.postMessage({ type: 'sitecraft:ready', templateId }, '*');
})();
</script>`;
}
