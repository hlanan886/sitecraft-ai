import { templates } from "@/lib/site-model";
import { readTemplateStaticFile, rewriteTemplateRootRelativeReferences } from "@/lib/template-static";
import { getRequiredVisibleTargets, getTemplateManifest } from "@/lib/template-manifest";
import { TEMPLATE_UI_COPY } from "@/lib/template-ui-copy";
import { getTemplateAdapter } from "@/lib/template-adapters";
import {
  MAX_TEMPLATE_EXPORT_BYTES,
  buildTemplateResourceResolverScript,
} from "@/lib/template-export-contract";

const BRIDGE_NONCE = "sitecraft-template-bridge";

/**
 * CSP for the local-snapshot preview (served from the vendored dist).
 * - Dev (local tool): loose enough that a vendored template actually runs —
 *   Alpine/legacy dev bundles may eval; iconify/CDN + preview-only outbound fetch
 *   need broad connect-src. frame-ancestors keeps the whole thing inside our
 *   preview iframe; this header is dropped entirely on exported HTML.
 * - Prod (public preview): strict — templates must be built artifacts, and any
 *   Alpine goes through its CSP-safe path; scripts require the per-response nonce
 *   that prepareHtml stamps on the bridge script, so nothing template-shipped runs
 *   unverified. 'unsafe-inline' remains only for style, which vendors use heavily.
 */
function localPreviewCsp() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    return [
      "default-src 'none'",
      "base-uri 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https: data:",
      "img-src 'self' https: data: blob:",
      "font-src 'self' https: data:",
      "media-src 'self' https: data: blob:",
      "connect-src 'self' https: http://localhost:* ws://localhost:* blob:",
      "worker-src 'self' blob:",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; ");
  }
  const nonce = `nonce-${BRIDGE_NONCE}`;
  return [
    "default-src 'none'",
    "base-uri 'self'",
    `script-src 'self' '${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' https: data:",
    "media-src 'self' https: data: blob:",
    "connect-src 'self' https:",
    "worker-src 'self' blob:",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Response headers shared by every preview variant. */
function previewHeaders(csp: string, templateId: string, source: "local" | "upstream") {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Sitecraft-Preview-Template": templateId,
    "X-Sitecraft-Preview-Source": source === "local" ? "local-open-source-snapshot" : "upstream-demo",
  };
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function bridgeScript(templateId: string, templateRootUrl: string | null) {
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
  const applyDesignTokens = (draft) => {
    const tokens = draft?.designTokens;
    if (!tokens) return;
    const isColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (isColor(tokens.primary)) document.documentElement.style.setProperty('--sitecraft-primary', tokens.primary);
    if (isColor(tokens.secondary)) document.documentElement.style.setProperty('--sitecraft-secondary', tokens.secondary);
    if (isColor(tokens.accent)) document.documentElement.style.setProperty('--sitecraft-accent', tokens.accent);
    const fontStyles = { sans: 'Inter,Manrope,system-ui,sans-serif', editorial: 'Georgia,Times New Roman,serif', technical: 'Arial Narrow,Roboto Condensed,Arial,sans-serif' };
    const radii = { sharp: '2px', soft: '8px', rounded: '18px' };
    const sectionSpace = { compact: '44px', balanced: '64px', spacious: '84px' };
    document.documentElement.style.setProperty('--sitecraft-font', fontStyles[tokens.fontStyle] || fontStyles.sans);
    document.documentElement.style.setProperty('--sitecraft-radius', radii[tokens.radius] || radii.soft);
    document.documentElement.style.setProperty('--sitecraft-section-space', sectionSpace[tokens.density] || sectionSpace.balanced);
    let style = document.getElementById('sitecraft-design-tokens');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sitecraft-design-tokens';
      document.head.append(style);
    }
    const shared = 'body{font-family:var(--sitecraft-font)!important}h1,h2,h3{font-family:var(--sitecraft-font)!important}button,a[class*="btn"],a[class*="button"],[class*="card"],article{border-radius:var(--sitecraft-radius)!important}main>section,body>section{padding-top:var(--sitecraft-section-space)!important;padding-bottom:var(--sitecraft-section-space)!important}::selection{background:var(--sitecraft-accent);color:#172019}';
    const templateTokenCss = ${JSON.stringify(adapter?.designTokenCss || '')} || 'h1,h2,h3{color:var(--sitecraft-primary)!important}button,a[class*="btn"],a[class*="button"]{background-color:var(--sitecraft-primary)!important;color:#fff!important}';
    style.textContent = shared + templateTokenCss;
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
      if (imgNode) card.append(imgNode);
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
  // 资源内联 fetch：单资源 8s 超时，避免某个不可达外网主机让整个导出挂死。
  const resourceFetch = (url, options = {}) => fetch(url, Object.assign({ credentials: 'same-origin', signal: AbortSignal.timeout(8000) }, options));
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
    if (!draft) return { appliedSlots: [], missingSlots: expectedTargets || [] };
    const applied = new Set();
    if (typeof prepareTemplate === 'function') prepareTemplate();
    applyDesignTokens(draft);
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
      if (setText(emailNode, email, 'contact.email.' + locale, applied)) emailNode.setAttribute('href', 'mailto:' + email);
      const phone = draft.content?.contact?.phone;
      const phoneNode = ensureContactNode('contact.phone', 'a');
      if (setText(phoneNode, phone, 'contact.phone.' + locale, applied)) phoneNode.setAttribute('href', 'tel:' + phone);
      const address = localize(draft.content?.contact?.address, locale);
      const addressNode = ensureContactNode('contact.address', 'address');
      setText(addressNode, address, 'contact.address.' + locale, applied);
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
      const headings = nativeProductsScope ? allVisible('h3,h4,[class*="title"],[class*="name"]', nativeProductsScope) : [];
      const mappedHeadings = headings.slice(0, productNames.length);
      mappedHeadings.forEach((heading, index) => setText(heading, productNames[index], 'products.' + draft.products[index].sku + '.name.' + locale, applied));
      renderAdditionalProducts(draft, locale, 0, applied);
    }
    const hiddenSections = new Set(draft.hiddenSections || []);
    // 动态生成区需按当前 locale 重建（hasVisibleSlotPrefix 会因上次注入的 slot 短路，导致切换语言后内容停留旧语言）；
    // 模板原生槽位已由上方 setText/applyCards 用当前 locale 更新，此处只需兜底无原生槽位的板块。
    if (!hiddenSections.has('about') && (!hasVisibleSlotPrefix('about.body') || hasGeneratedSection('about'))) {
      renderGeneratedContent('about', draft.content?.about?.title, draft.content?.about?.body, [], locale, applied);
    }
    if (!hiddenSections.has('features') && (!hasVisibleSlotPrefix('features.items') || hasGeneratedSection('features'))) {
      renderGeneratedContent('features', draft.content?.features?.title, draft.content?.features?.intro, draft.content?.features?.items, locale, applied);
    }
    if (!hiddenSections.has('services') && (!hasVisibleSlotPrefix('services.items') || hasGeneratedSection('services'))) {
      renderGeneratedContent('services', draft.content?.services?.title, draft.content?.services?.intro, draft.content?.services?.items, locale, applied);
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
      if (setText(emailNode, email, 'contact.email.' + locale, applied)) emailNode.setAttribute('href', 'mailto:' + email);
      const phone = draft.content?.contact?.phone;
      const phoneNode = document.createElement('a');
      if (setText(phoneNode, phone, 'contact.phone.' + locale, applied)) phoneNode.setAttribute('href', 'tel:' + phone);
      const addressNode = document.createElement('address');
      setText(addressNode, localize(draft.content?.contact?.address, locale), 'contact.address.' + locale, applied);
      details.append(emailNode, phoneNode, addressNode);
      contactSection.append(heading, body, details);
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
    if (variant === 'published') sanitizePublishedDemo();
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
    return { appliedSlots, visibleSlots, visibleTextsBySlot, residualDemoSlots, missingSlots, incompatible: missingSlots.length > 0 };
  };
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'sitecraft:content' && event.data.templateId === templateId) {
      activeVariant = event.data.variant || 'preview';
      activeSiteKey = event.data.siteKey || null;
      activeRevision = event.data.draft?.revision ?? null;
      activeDraft = event.data.draft || null;
      activeLocale = event.data.locale || 'zh';
      activeExpectedTargets = Array.isArray(event.data.expectedTargets) ? event.data.expectedTargets : [];
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const report = applyContent(event.data.draft, event.data.locale, event.data.expectedTargets, event.data.variant);
        parent.postMessage({ type: 'sitecraft:applied', templateId, revision: event.data.draft?.revision, ...report }, '*');
      }));
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
  document.addEventListener('click', (event) => {
    const node = event.target?.closest?.('h1, p, a, button, h2, h3');
    if (!node) return;
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
  parent.postMessage({ type: 'sitecraft:ready', templateId }, '*');
})();
</script>`;
}

function prepareHtml(html: string, baseUrl: string, templateId: string, local = false) {
  const assetBase = `/api/templates/${encodeURIComponent(templateId)}/assets/`;
  const sourceHtml = local
    ? rewriteTemplateRootRelativeReferences(html, "text/html; charset=utf-8", assetBase)
    : html;
  const base = `<base href="${escapeAttribute(local ? assetBase : baseUrl)}">`;
  const normalized = sourceHtml
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "");
  const cleaned = normalized;
  const injection = `${base}<meta name="sitecraft-template" content="${escapeAttribute(templateId)}"><style>html{scroll-behavior:smooth}body{min-height:100vh}[class*="scroll-fade"],[class*="fade-up"],[class*="reveal"],[data-aos]{opacity:1!important;visibility:visible!important;transform:none!important}a,button,h1,h2,h3,main p{cursor:pointer}a:hover,button:hover,h1:hover,h2:hover,h3:hover,main p:hover{outline:2px solid rgba(46,107,79,.45);outline-offset:3px}</style>`;
  const finalStateStyle = `<style>html body [class*="scroll-fade"],html body [class*="fade-up"],html body [class*="reveal"],html body [data-aos]{opacity:1!important;visibility:visible!important;transform:none!important}</style>`;
  if (/<head\b[^>]*>/i.test(cleaned)) {
    return cleaned
      .replace(/<head\b([^>]*)>/i, `<head$1>${injection}`)
      .replace(/<\/body\s*>/i, `${finalStateStyle}${bridgeScript(templateId, local ? assetBase : null)}</body>`);
  }
  return `<!doctype html><html><head>${injection}</head><body>${cleaned}${finalStateStyle}${bridgeScript(templateId, local ? assetBase : null)}</body></html>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params;
  const template = templates.find((item) => item.id === templateId);
  if (!template) return new Response("Template not found", { status: 404 });

  const localIndex = await readTemplateStaticFile(template.id, ["index.html"]);
  if (localIndex) {
    const html = prepareHtml(localIndex.body.toString("utf8"), template.source.demoUrl, template.id, true);
    return new Response(html, {
      headers: previewHeaders(localPreviewCsp(), template.id, "local"),
    });
  }

  try {
    const response = await fetch(template.source.demoUrl, {
      headers: { "User-Agent": "Sitecraft-Template-Preview/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) throw new Error("upstream did not return HTML");
    const html = prepareHtml(await response.text(), response.url, template.id);
    const demoOrigin = new URL(response.url).origin;
    const upstreamCsp = [
      "default-src 'none'",
      `base-uri ${demoOrigin}`,
      "script-src https: 'unsafe-inline'",
      "style-src * 'unsafe-inline'",
      "img-src * data: blob:",
      "font-src * data:",
      "media-src * data: blob:",
      "connect-src https:",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; ");
    return new Response(html, {
      headers: previewHeaders(upstreamCsp, template.id, "upstream"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown upstream error";
    if (template.id === "yukina") {
      const fallbackHtml = `<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f3;font:14px system-ui;color:#263238}.note{padding:10px 16px;background:#263238;color:white;text-align:center}.preview{display:block;width:100%;height:auto}</style></head><body><div class="note">Yukina 官方 README 预览 · 上游内容集合缺失，暂用官方全页预览图</div><main><section><h1>企业内容与品牌故事</h1><p>当前模板使用官方预览图，结构化内容仍会保存并回报可用槽位。</p></section><img class="preview" src="https://s2.loli.net/2025/01/26/S4URrsj9TFgOKAp.webp" alt="Yukina template official preview"></main></body></html>`;
      return new Response(
        prepareHtml(fallbackHtml, template.source.demoUrl, template.id),
        { status: 200, headers: previewHeaders(localPreviewCsp(), template.id, "local") },
      );
    }
    return new Response(
      `<!doctype html><html lang="zh"><body style="font:14px system-ui;padding:40px;color:#33413a;background:#f4f7f4"><h1>模板预览暂时无法加载</h1><p>${message}</p><p>源码已经保存在本地模板库中，请稍后重试官方演示。</p></body></html>`,
      { status: 502, headers: previewHeaders("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'", template.id, "upstream") },
    );
  }
}
