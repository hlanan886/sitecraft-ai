import { allTemplates } from "@/lib/site-model";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";
import { readTemplateStaticFile, rewriteTemplateRootRelativeReferences } from "@/lib/template-static";
import { rewriteExternalResourceReferences } from "@/lib/template-asset-mirror";
import { navigationViewSnippet } from "@/lib/template-adapters/navigation-view";
import { getBrandAssetSelector, getHeroAssetSelector } from "@/lib/template-asset-registry";
// B4：注入桥（77KB 字符串载荷）搬去独立模块——本路由只做 HTTP 逻辑。
// 反引号门禁的扫描目标已随搬移重定向到 lib/template-preview-bridge.ts。
import { bridgeScript } from "@/lib/template-preview-bridge";

const BRIDGE_NONCE = "sitecraft-template-bridge";

// 2026-09-08：上游模板抓取超时从固定 15s 改为 env 可配（默认 20s）。
const UPSTREAM_TIMEOUT_MS = Number(process.env.SITECRAFT_UPSTREAM_TIMEOUT_MS || 20_000);

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


function prepareHtml(html: string, baseUrl: string, templateId: string, local = false) {
  const assetBase = `/api/templates/${encodeURIComponent(templateId)}/assets/`;
  // 境外致命资源（缺了版式就坏）重写为仓库内镜像路径，见 lib/template-asset-mirror.ts
  const sourceHtml = rewriteExternalResourceReferences(
    local ? rewriteTemplateRootRelativeReferences(html, "text/html; charset=utf-8", assetBase) : html,
    templateId,
  );
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
  // 运行时模板（沉淀产物）在磁盘上。两段都要跑，顺序不能反：
  //   ① allTemplates() 惰性装载**模板记录**（目录/白名单）
  //   ② ensureRuntimeTemplateManifests() 展开成 manifest + 门禁节注册——
  //      下面的 bridgeScript 要读 manifest.slots，漏了这步会拿到空槽位表，
  //      预览能开但**一个字段都填不进去**（静默失败，比 404 更难查）。
  ensureRuntimeTemplateManifests();
  const template = allTemplates().find((item) => item.id === templateId);
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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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
