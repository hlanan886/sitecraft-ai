import { templates } from "@/lib/site-model";
import { readTemplateStaticFile } from "@/lib/template-static";

const BRIDGE_NONCE = "sitecraft-template-bridge";

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function bridgeScript(templateId: string) {
  return `<script nonce="${BRIDGE_NONCE}">
(() => {
  const templateId = ${JSON.stringify(templateId)};
  const visible = (node) => Boolean(node && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const allVisible = (selector, scope = document) => Array.from(scope.querySelectorAll(selector)).filter(visible);
  const findHero = () => document.querySelector('[data-sitecraft-slot^="hero.title."]') || allVisible('main h1, header h1, h1')[0];
  const findSubtitle = (hero) => {
    const existing = document.querySelector('[data-sitecraft-slot^="hero.subtitle."]');
    if (existing) return existing;
    const scope = hero?.closest('section, header, main, article') || document;
    return allVisible('p', scope)[0];
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
    const nodes = allVisible('main section, main article, body > section').filter((node) => node !== findHero()?.closest('section, header'));
    return nodes.filter((node) => !nodes.some((parent) => parent !== node && parent.contains(node)));
  };
  const scopeBy = (key, pattern) => document.querySelector('[data-sitecraft-scope="' + key + '"]') || sectionScopes().find((scope) => pattern.test((allVisible('h1,h2,h3', scope)[0]?.textContent || '') + ' ' + (scope.id || '') + ' ' + (scope.className || '') + ' ' + (scope.textContent || '').slice(0, 500)));
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
    if (templateId === 'forge') {
      hideSectionByHeading(/Frequently Asked Questions/i);
      hideLeafMatches(/^(A List If Needed|part [1-4]|One or two sentences about what your company offers[.]|brief description of services)$/i);
    }
    if (templateId === 'atlas') {
      hideSectionByHeading(/Top Reasons to Choose Astro|Ready to build your next project with Astro/i);
      hideLeafMatches(/Lorem ipsum|Marvin McKinney|Web Designer|Zero JS, by default|UI-agnostic|10[+] Pre-build pages|Google Pagespeed/i);
    }
    if (templateId === 'powerai') {
      hideSectionByHeading(/Everything you need to build with AI|Loved by developers|Frequently asked questions/i);
      hideLeafMatches(/^(99.9%|10M[+]|50K[+]|Uptime|AI Requests|Users|[$]0|[$]49|[/]month|Most Popular)$/i);
      hideLeafMatches(/API requests|uptime SLA|Basic AI models|Advanced AI models|All AI models|Sarah Chen|Marcus Rodriguez|Emily Watson|TechCorp|StartupXYZ|InnovateLabs|SOC 2|HIPAA|GDPR/i);
    }
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
      const headings = allVisible('h2,h3,h4,strong,[class*="title"],[class*="name"],span.text-4xl,span[class*="title"]', card);
      const title = headings.find((node) => (node.textContent || '').trim().length > 2 && !/^(0?[0-9]+|learn more|read more)$/i.test((node.textContent || '').trim()));
      const body = allVisible('p', card)[0];
      setText(title, localize(items[index].title, locale), section + '.items.' + index + '.title.' + locale, applied);
      setText(body, localize(items[index].body, locale), section + '.items.' + index + '.body.' + locale, applied);
    });
  };
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
      const sku = document.createElement('small');
      sku.style.cssText = 'display:block;margin-bottom:12px;opacity:.58;font:11px ui-monospace,monospace';
      sku.textContent = product.sku + ' / ' + product.category;
      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 10px;font:inherit;font-size:20px;font-weight:800;line-height:1.25';
      const body = document.createElement('p');
      body.style.cssText = 'margin:0;opacity:.72;line-height:1.65';
      setText(title, localize(product.name, locale), 'products.' + product.sku + '.name.' + locale, applied);
      setText(body, localize(product.summary, locale), 'products.' + product.sku + '.summary.' + locale, applied);
      card.append(sku, title, body);
      grid.append(card);
    });
    section.append(heading, intro, grid);
  };
  const applyContent = (draft, locale, expectedTargets, variant) => {
    if (!draft) return { appliedSlots: [], missingSlots: expectedTargets || [] };
    const applied = new Set();
    document.documentElement.lang = locale || 'zh';
    const hero = findHero();
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
    const contactScope = scopeBy('contact', /contact|get started|get in touch|estimate|联系|咨询/i) || sectionScopes().at(-1);
    const sectionMap = { about: aboutScope, features: featuresScope, services: servicesScope, products: productsScope, contact: contactScope };
    Object.entries(sectionMap).forEach(([key, scope]) => {
      if (!scope) return;
      scope.dataset.sitecraftSection = key;
      scope.dataset.sitecraftScope = key;
      scope.hidden = (draft.hiddenSections || []).includes(key);
      applied.add(key + '.visibility');
    });
    setText(aboutScope && allVisible('h1,h2,h3', aboutScope)[0], localize(draft.content?.about?.title, locale), 'about.title.' + locale, applied);
    setText(aboutScope && allVisible('p', aboutScope)[0], localize(draft.content?.about?.body, locale), 'about.body.' + locale, applied);
    setText(featuresScope && allVisible('h1,h2', featuresScope)[0], localize(draft.content?.features?.title, locale), 'features.title.' + locale, applied);
    setText(featuresScope && allVisible('p', featuresScope)[0], localize(draft.content?.features?.intro, locale), 'features.intro.' + locale, applied);
    setText(servicesScope && allVisible('h1,h2', servicesScope)[0], localize(draft.content?.services?.title, locale), 'services.title.' + locale, applied);
    setText(servicesScope && allVisible('p', servicesScope)[0], localize(draft.content?.services?.intro, locale), 'services.intro.' + locale, applied);
    setText(productsScope && allVisible('h1,h2', productsScope)[0], localize(draft.content?.products?.title, locale), 'products.title.' + locale, applied);
    setText(contactScope && allVisible('h1,h2', contactScope)[0], localize(draft.content?.contact?.title, locale), 'contact.title.' + locale, applied);
    setText(contactScope && allVisible('p', contactScope)[0], localize(draft.content?.contact?.body, locale), 'contact.body.' + locale, applied);
    applyCards('features', featuresScope, draft.content?.features?.items, locale, applied, /feature|advantage|benefit/i);
    applyCards('services', servicesScope, draft.content?.services?.items, locale, applied, /Name of this service|service|solution/i);

    const productNames = (draft.products || []).map((item) => item.name?.[locale] || item.name?.zh || item.name?.en).filter(Boolean);
    if (productNames.length) {
      const headings = productsScope ? allVisible('h3,h4,[class*="title"],[class*="name"]', productsScope) : [];
      const mappedHeadings = headings.slice(0, productNames.length);
      mappedHeadings.forEach((heading, index) => setText(heading, productNames[index], 'products.' + draft.products[index].sku + '.name.' + locale, applied));
      renderAdditionalProducts(draft, locale, 0, applied);
    }
    const mapped = Object.values(sectionMap).filter(Boolean);
    const commonParent = mapped.length === 5 && mapped.every((scope) => scope.parentElement === mapped[0].parentElement) ? mapped[0].parentElement : null;
    if (commonParent && Array.isArray(draft.sectionOrder)) {
      draft.sectionOrder.forEach((key) => sectionMap[key] && commonParent.append(sectionMap[key]));
      applied.add('sections.order');
    }
    document.documentElement.dataset.sitecraftTemplate = templateId;
    applied.add('template');
    if (variant === 'published') sanitizePublishedDemo();
    const appliedSlots = Array.from(applied);
    const missingSlots = (expectedTargets || []).filter((target) => !appliedSlots.some((slot) => slot === target || slot.startsWith(target) || target.startsWith(slot)));
    return { appliedSlots, missingSlots };
  };
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'sitecraft:content' && event.data.templateId === templateId) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const report = applyContent(event.data.draft, event.data.locale, event.data.expectedTargets, event.data.variant);
        parent.postMessage({ type: 'sitecraft:applied', templateId, revision: event.data.draft?.revision, ...report }, '*');
      }));
    }
  });
  document.addEventListener('click', (event) => {
    const node = event.target?.closest?.('h1, p, a, button, h2, h3');
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    const slot = node.dataset.sitecraftSlot || node.closest('[data-sitecraft-slot]')?.dataset.sitecraftSlot || '';
    const section = node.closest('[data-sitecraft-section]')?.dataset.sitecraftSection;
    const hero = findHero();
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
    ? html
        .replace(/(\b(?:src|href|poster)=["'])\/(?!\/)/gi, `$1${assetBase}`)
        .replace(/(\bsrcset=["'][^"']*)\/(?!\/)/gi, `$1${assetBase}`)
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
      .replace(/<\/body\s*>/i, `${finalStateStyle}${bridgeScript(templateId)}</body>`);
  }
  return `<!doctype html><html><head>${injection}</head><body>${cleaned}${finalStateStyle}${bridgeScript(templateId)}</body></html>`;
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
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Content-Security-Policy": `default-src 'none'; base-uri 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; media-src 'self' https: data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self';`,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Sitecraft-Preview-Source": "local-open-source-snapshot",
      },
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
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Content-Security-Policy": `default-src 'none'; base-uri ${demoOrigin}; script-src https: 'unsafe-inline'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src https:; form-action 'none'; frame-ancestors 'self';`,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown upstream error";
    if (template.id === "yukina") {
      const fallbackHtml = `<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width"><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f3;font:14px system-ui;color:#263238}.note{padding:10px 16px;background:#263238;color:white;text-align:center}.preview{display:block;width:100%;height:auto}</style></head><body><div class="note">Yukina 官方 README 预览 · 上游内容集合缺失，暂用官方全页预览图</div><main><section><h1>企业内容与品牌故事</h1><p>当前模板使用官方预览图，结构化内容仍会保存并回报可用槽位。</p></section><img class="preview" src="https://s2.loli.net/2025/01/26/S4URrsj9TFgOKAp.webp" alt="Yukina template official preview"></main></body></html>`;
      return new Response(
        prepareHtml(fallbackHtml, template.source.demoUrl, template.id),
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } },
      );
    }
    return new Response(
      `<!doctype html><html lang="zh"><body style="font:14px system-ui;padding:40px;color:#33413a;background:#f4f7f4"><h1>模板预览暂时无法加载</h1><p>${message}</p><p>源码已经保存在本地模板库中，请稍后重试官方演示。</p></body></html>`,
      { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
