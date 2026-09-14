/**
 * 静态导出（A 路径）的**重依赖层**：下载资源 + 落盘。
 *
 * ## 与 `template-static-export.ts` 的分工
 *
 * 照抄 `site-capture.ts` / `site-capture-browser.ts` 那条分工：
 * **纯逻辑与网络/磁盘分开**。那边是 Playwright，这边是 `fetch` + `node:fs`——
 * 一样不能让它们进客户端 bundle，否则 Turbopack 报
 * `does not support external modules` 而构建失败（实测踩过）。
 *
 * 所以：清洗规则、路径推导、该不该下载——全在纯逻辑层，能被单测直接覆盖；
 * 本文件只做"照着决定去下载、去写盘"。
 */
import {
  collectExternalReferences,
  decodeHtmlEntities,
  localFileNameFor,
  planStaticExport,
  rewriteCssReferences,
  rewriteResourceReferences,
  shouldSkipReference,
  type ResourceMapping,
  type StaticExportPlan,
} from "./template-static-export.ts";
import type { LibraryAsset } from "./site-capture.types.ts";

const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "Mozilla/5.0 (compatible; SiteCraftExport/1.0)";

/** 单个资源的大小上限——超过就不搬（大视频会把模板体积撑爆）。 */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export type DownloadedResource = {
  url: string;
  /** 相对模板目录的路径，如 `assets/photo-1a2b3c.jpg` */
  relative: string;
  bytes: number;
  contentType: string;
  /**
   * 文件内容。
   *
   * 直接带在返回值里而不是"先写盘、再让调用方读回来"：登记接口要的是
   * `assets` / `binaryAssets` 两个内存里的映射，绕一趟磁盘只是多一次 IO
   * 和多一个"写失败但读到了半截"的失败面。一个页面的资源通常在几 MB 量级，
   * 放内存里没有问题。
   */
  body: Buffer;
};

export type StaticExportResult = {
  /** 清洗 + 引用重写后的 HTML（**可以直接写盘**） */
  html: string;
  resources: DownloadedResource[];
  plan: StaticExportPlan;
  /** 引用被改写了几处 */
  rewritten: number;
  totalBytes: number;
  elapsedMs: number;
  warnings: string[];
};

/**
 * 下载一个资源。
 *
 * **永不抛异常**——失败收进返回值。理由与 capture 一致：自助场景下，
 * 一个未捕获的异常等于"页面崩了"，而客户只会关掉它。
 */
async function downloadResource(
  url: string,
  timeoutMs: number,
): Promise<{ ok: true; body: Buffer; contentType: string } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ok: true, body: buffer, contentType: response.headers.get("content-type")?.split(";")[0]?.trim() ?? "" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 把抓下来的一个页面整理成**自包含的静态模板**。
 *
 * 产出三样交给登记接口：`html`（已重写引用）、`assets`（文本资源）、
 * `binaryAssets`（图片等 base64）。
 */
export async function exportStaticTemplate(args: {
  html: string;
  pageUrl: string;
  assets: ReadonlyArray<{ url: string; kind: string; bytes?: number; error?: string }>;
  /** 是否在写盘时把大文件按 base64 也带上（登记接口的 binaryAssets 字段） */
  includeBinary?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<StaticExportResult> {
  const startedAt = Date.now();
  const maxBytes = args.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // ---- ① 决定下哪些（纯逻辑） ----
  const plan = planStaticExport({ html: args.html, pageUrl: args.pageUrl, assets: args.assets, maxBytes });

  // ---- ② 下载 ----
  const mapping: ResourceMapping = {};
  const resources: DownloadedResource[] = [];
  const warnings = [...plan.warnings];
  const usedPaths = new Set<string>();

  const results = await Promise.all(
    plan.toDownload.map(async (item) => {
      const downloaded = await downloadResource(item.url, timeoutMs);
      return { item, downloaded };
    }),
  );

  for (const { item, downloaded } of results) {
    if (!downloaded.ok) {
      plan.skipped.push({ url: item.url, reason: downloaded.error });
      continue;
    }
    if (downloaded.body.length > maxBytes) {
      plan.skipped.push({ url: item.url, reason: `下载后确认超过上限（${(downloaded.body.length / 1e6).toFixed(1)}MB）` });
      continue;
    }
    const fileName = localFileNameFor(item.url, downloaded.contentType);
    if (!fileName) {
      plan.skipped.push({ url: item.url, reason: "推不出安全的文件名" });
      continue;
    }
    // 同名冲突：加序号后缀，**不覆盖**——两张图落到一个文件是"有张图莫名变了"的根源
    let relative = `assets/${fileName}`;
    let suffix = 2;
    while (usedPaths.has(relative)) {
      const dot = fileName.lastIndexOf(".");
      relative = `assets/${fileName.slice(0, dot)}-${suffix}${fileName.slice(dot)}`;
      suffix += 1;
    }
    usedPaths.add(relative);

    mapping[item.url] = relative;
    resources.push({ url: item.url, relative, bytes: downloaded.body.length, contentType: downloaded.contentType, body: downloaded.body });
  }

  // ---- ③ 重写引用（必须在下完之后——那时才知道每个 URL 落到哪个文件） ----
  const rewritten = rewriteResourceReferences(plan.html, mapping);

  // 样式表**单独再走一遍**：CSS 里的背景图不处理的话，
  // 页面主体看着对、背景却全是空的，而且不报错（实测踩过）。
  let cssRewritten = 0;
  for (const resource of resources) {
    const isCss = resource.contentType.includes("css") || /\.css$/i.test(resource.relative);
    if (!isCss) continue;
    const result = rewriteCssReferences(resource.body.toString("utf8"), mapping, resource.relative);
    if (result.rewritten > 0) {
      resource.body = Buffer.from(result.css, "utf8");
      resource.bytes = resource.body.length;
      cssRewritten += result.rewritten;
    }
  }

  // 没下载成功的引用仍然指向原站——**如实说明**：那些位置要么显示原站的图
  // （境外域名在国内网络下多半显示不出来），要么空着。
  const brokenCount = plan.skipped.filter((entry) => entry.reason !== "追踪/广告地址" && entry.reason !== "指向页面自身").length;
  if (brokenCount > 0) {
    warnings.push(`${brokenCount} 个资源没能本地化，页面上对应位置可能显示不出来`);
  }

  const totalBytes = resources.reduce((sum, resource) => sum + resource.bytes, 0);
  return {
    html: rewritten.html,
    resources,
    plan,
    rewritten: rewritten.rewritten,
    totalBytes,
    elapsedMs: Date.now() - startedAt,
    warnings,
  };
}

/**
 * 把下载到的资源转成登记接口要的两个字段。
 *
 * **不落盘**——登记接口自己会写（`POST /api/templates/runtime` 按同名相对路径
 * 写进模板目录）。这里只做格式转换，避免出现"两处都写盘、写得不一致"的可能。
 *
 * HTML/CSS/JS 走文本字段（可直接读、不膨胀），其余走 base64 二进制字段。
 */
export function toRegisterAssets(resources: readonly DownloadedResource[]): {
  assets: Record<string, string>;
  binaryAssets: Record<string, string>;
} {
  const assets: Record<string, string> = {};
  const binaryAssets: Record<string, string> = {};
  for (const resource of resources) {
    const isText =
      /^(text\/|application\/(?:javascript|json|x-javascript))/.test(resource.contentType) ||
      /\.(css|js|mjs|json|svg|txt)$/i.test(resource.relative);
    if (isText) {
      assets[resource.relative] = resource.body.toString("utf8");
    } else {
      // 登记接口要求带 `data:<mime>;base64,` 前缀或纯 base64，两种都收；
      // 这里给纯 base64（少一层拼接错误的机会）
      binaryAssets[resource.relative] = resource.body.toString("base64");
    }
  }
  return { assets, binaryAssets };
}

/** 素材库落盘：把沉淀下来的图片写进上传目录，返回 `素材名 → URL` 映射。 */
export async function persistLibraryAssets(
  library: readonly LibraryAsset[],
  store: (buffer: Buffer, mime: string, name: string) => Promise<string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Array<{ url: string; storedUrl: string; role: LibraryAsset["role"]; error?: string }>> {
  const out: Array<{ url: string; storedUrl: string; role: LibraryAsset["role"]; error?: string }> = [];
  for (const item of library) {
    const downloaded = await downloadResource(item.url, timeoutMs);
    if (!downloaded.ok) {
      out.push({ url: item.url, storedUrl: "", role: item.role, error: downloaded.error });
      continue;
    }
    try {
      const ext = downloaded.contentType.includes("png") ? "png" : downloaded.contentType.includes("webp") ? "webp" : "jpg";
      const storedUrl = await store(downloaded.body, `image/${ext === "jpg" ? "jpeg" : ext}`, `${item.role}-${Date.now()}.${ext}`);
      out.push({ url: item.url, storedUrl, role: item.role });
    } catch (error) {
      out.push({ url: item.url, storedUrl: "", role: item.role, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

export { collectExternalReferences, decodeHtmlEntities, shouldSkipReference };
