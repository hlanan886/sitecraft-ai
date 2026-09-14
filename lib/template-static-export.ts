/**
 * A 方案的**纯逻辑层**：把一个抓下来的网页整理成「能搬走的静态模板」。
 *
 * ## 与 B（截图 → 模型出 DSL）的分工
 *
 * A 和 B 是**两条完全解耦的路**（见计划 §3.2）：
 *
 * | | A（本模块） | B（`site-vision.ts`） |
 * |---|---|---|
 * | 输入 | 渲染后的 HTML + 资源清单 | 一张截图 |
 * | 做法 | **原样搬运**，只做本地化与清洗 | 读结构 → 重新拼装 |
 * | 保真度 | **100%**（就是同一份 HTML） | 「大致像」 |
 * | 可编辑性 | 看运气（原站没有槽位） | 每个字段都有槽位 |
 * | 成本 | 0 模型调用 | 一次多模态调用 |
 *
 * **两者不共享任何代码**——A 不碰 DSL、不碰拼装器；B 不碰抓取、不碰清洗。
 * 强行合并会让 A 去处理"翻译不了的版式"、让 B 去处理"有些站是搬来的"这种特例。
 *
 * ## 纯函数，不碰 fs、不碰网络
 *
 * 资源**下载**在 `lib/template-static-export.ts`（重依赖层）。
 * 本模块只做"给定 HTML 和一份资源映射表，产出清洗后的 HTML"——
 * 这样清洗规则能被单测直接喂字符串断言，不必起浏览器或联网。
 */

// ---------------------------------------------------------------------------
// 域名与地址工具
// ---------------------------------------------------------------------------

/** 安全解析 URL，失败返回 null（不抛）。 */
export function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * 从 URL 造一个安全的本地文件名。
 *
 * **不能只取 pathname**：实测很多站点用 `/img?id=123`、`/a/b?ver=2` 这种查询串区分资源，
 * 丢掉查询串会让两张不同的图落到同一个文件名，后一张覆盖前一张——
 * 表现为"页面里有张图莫名变成了另一张"，极难排查。
 *
 * 做法：query 参与哈希，扩展名尽量从 pathname 取（取不到就按 content-type 补）。
 */
export function localFileNameFor(url: string, contentType?: string): string {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  const pathPart = decodeURIComponent(parsed.pathname);
  const rawName = pathPart.split("/").filter(Boolean).pop() ?? "asset";
  const dotIndex = rawName.lastIndexOf(".");
  const base = (dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName).replace(/[^\w.-]+/g, "_").slice(0, 60) || "asset";
  let ext = dotIndex > 0 ? rawName.slice(dotIndex + 1).toLowerCase() : "";
  // 扩展名只留认识的，避免 `.php`/`.aspx` 这类"看着像扩展名其实是路由"
  if (!/^(png|jpe?g|webp|gif|svg|avif|ico|bmp|css|js|mjs|woff2?|ttf|otf|eot|mp4|webm)$/.test(ext)) {
    ext = extensionForMime(contentType) || "bin";
  }
  // 有查询串就加短哈希——同路径不同参数是两个资源
  const hash = parsed.search ? `-${shortHash(parsed.search + parsed.pathname)}` : "";
  return `${base}${hash}.${ext}`;
}

function extensionForMime(contentType?: string): string {
  if (!contentType) return "";
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const table: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "text/css": "css",
    "text/javascript": "js",
    "application/javascript": "js",
    "font/woff2": "woff2",
    "font/woff": "woff",
    "font/ttf": "ttf",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return table[type] ?? "";
}

/** 短哈希（FNV-1a 32 位）——只是为了让同路径不同参数的资源不撞名，不作安全用途。 */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// HTML 清洗
// ---------------------------------------------------------------------------

/**
 * 该不该清掉这个资源引用。
 *
 * 判据只有一条：**留不留它对"这个页面看起来是不是原样"有影响吗。**
 * 统计脚本、广告、预连接提示——留着的唯一效果是把访客的浏览数据送给原站，
 * 以及在国内网络下挂在连不上的域名上。
 */
export type CleanupReason = "tracking" | "analytics" | "ads" | "preconnect" | "iframe" | "meta-refresh";

const TRACKING_HOST_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: CleanupReason }> = [
  { pattern: /google-analytics\.com|googletagmanager\.com|analytics\.google\.com/i, reason: "analytics" },
  { pattern: /doubleclick\.net|googlesyndication\.com|googleadservices\.com/i, reason: "ads" },
  { pattern: /baidu\.com\/hm\.js|hm\.baidu\.com|cnzz\.com|umeng\.com|51\.la|tongji\./i, reason: "analytics" },
  { pattern: /hotjar\.com|clarity\.ms|mixpanel\.com|segment\.(io|com)|matomo|plausible\.io/i, reason: "analytics" },
  { pattern: /facebook\.net|fbcdn\.net\/.*\/fbevents|connect\.facebook\.net/i, reason: "tracking" },
  { pattern: /static\.hs-scripts\.com|hs-analytics\.net|hubspot/i, reason: "analytics" },
];

function classifyCleanup(url: string): CleanupReason | null {
  for (const { pattern, reason } of TRACKING_HOST_PATTERNS) {
    if (pattern.test(url)) return reason;
  }
  return null;
}

export type CleanupReport = {
  html: string;
  removed: Array<{ kind: string; url: string; reason: CleanupReason }>;
  /** 按原因计数（给用户/日志看的汇总） */
  counts: Partial<Record<CleanupReason, number>>;
};

/**
 * 清洗抓下来的 HTML。**只清"留着有害"的，不清"看着多余"的。**
 *
 * 刻意**不做**的事（都有代价，且都不是这一步该担的）：
 *  - 不删原站的 `<script>`：现代站的导航/轮播/懒加载全靠它，删了页面就残；
 *  - 不格式化/重排 HTML：正则改结构必然出错，而我们的产出要能原样渲染；
 *  - 不改文案、不换图：那是 B 路径的事，A 的定位就是"一模一样"。
 */
export function cleanCapturedHtml(html: string): CleanupReport {
  const removed: CleanupReport["removed"] = [];
  const counts: CleanupReport["counts"] = {};

  const record = (kind: string, url: string, reason: CleanupReason) => {
    removed.push({ kind, url, reason });
    counts[reason] = (counts[reason] ?? 0) + 1;
  };

  let output = html;

  // ① 追踪/统计/广告脚本
  output = output.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src: string) => {
    const reason = classifyCleanup(src);
    if (!reason) return tag;
    record("script", src, reason);
    return "";
  });

  // ② 行内统计脚本（百度统计/GA 的常见内联形态）——只认特征串，不误删业务脚本
  output = output.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (tag, body: string) => {
    if (!/hm\.baidu\.com|google-analytics\.com|gtag\s*\(|_gaq\.push|dataLayer\.push|clarity\s*\(/i.test(body)) return tag;
    record("inline-script", "inline", "analytics");
    return "";
  });

  // ③ 追踪像素（1x1 的 img，多半在 noscript 里）
  output = output.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (tag, src: string) => {
    const reason = classifyCleanup(src);
    if (!reason) return tag;
    record("img", src, reason);
    return "";
  });

  // ④ 预连接提示：本地化之后这些域名一个都不会连，
  //    留着只会让浏览器在国内网络下**挂着等超时**（实测教训，见 template-asset-mirror.ts）
  output = output.replace(/<link\b[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch|prefetch|preload)["']?[^>]*>/gi, (tag) => {
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const reason = href ? classifyCleanup(href) : null;
    if (!reason) return tag;
    record("link", href, reason);
    return "";
  });

  // ⑤ 第三方 iframe（客服/广告/地图）。**不含同源 iframe**——那可能是页面结构的一部分。
  output = output.replace(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, (tag, src: string) => {
    const reason = classifyCleanup(src);
    if (!reason) return tag;
    record("iframe", src, reason);
    return "";
  });

  // ⑥ 自动跳转的 meta refresh——搬过来之后跳去别处，用户会以为我们做坏了
  output = output.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, () => {
    record("meta", "refresh", "meta-refresh");
    return "";
  });

  return { html: output, removed, counts };
}

// ---------------------------------------------------------------------------
// 资源引用重写
// ---------------------------------------------------------------------------

/** 一张要下载的资源：原始 URL → 本地相对路径（相对模板目录）。 */
export type ResourceMapping = Record<string, string>;

/**
 * 把 HTML 里指向**已下载资源**的引用改成相对路径。
 *
 * 与 `template-asset-mirror.ts` 的 `rewriteExternalResourceReferences` 的区别：
 * 那个是"按前缀命中一张固定登记表"（模板自带资源），
 * 这个是"按一张这次抓取现算出来的映射表"——因为每次搬的站都不一样，没法预先登记。
 *
 * ⚠️ 用 **相对路径**（`assets/xxx.jpg`）而不是绝对路径：模板可能被挂在任意前缀下
 * （`/api/templates/<id>/preview`、导出后的文件路径…），绝对路径在导出时就断了。
 * 相对路径由服务端的资源路由按模板目录解析（已核实：`readTemplateStaticFile`
 * 对运行时模板同样生效）。
 */
export function rewriteResourceReferences(html: string, mapping: ResourceMapping): { html: string; rewritten: number } {
  if (Object.keys(mapping).length === 0) return { html, rewritten: 0 };
  let rewritten = 0;

  // 属性值可能是 `url1 400w, url2 800w`（srcset）也可能是单个 URL——
  // 逐候选处理，两种情况都能覆盖。
  const attributePattern = /\b(src|srcset|poster|href|data-src|data-background-image|data-original)\s*=\s*(["'])([^"']*)\2/gi;

  let output = html.replace(attributePattern, (match, attribute: string, quote: string, value: string) => {
    let touched = false;
    const next = value
      .split(",")
      .map((candidate) => {
        const leading = candidate.match(/^\s*/)?.[0] ?? "";
        const trailing = candidate.match(/\s*$/)?.[0] ?? "";
        const core = candidate.trim();
        if (!core) return candidate;
        const [url, ...descriptor] = core.split(/\s+/);
        const local = url ? mapping[url] ?? mapping[decodeHtmlEntities(url)] : undefined;
        if (!local) return candidate;
        touched = true;
        return `${leading}${local}${descriptor.length ? ` ${descriptor.join(" ")}` : ""}${trailing}`;
      })
      .join(",");
    if (!touched) return match;
    rewritten += 1;
    return `${attribute}=${quote}${next}${quote}`;
  });

  // CSS 里的 url()——原站常把背景图写在 <style> 或内联 style 里
  output = output.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, rawUrl: string) => {
    const local = mapping[rawUrl.trim()] ?? mapping[decodeHtmlEntities(rawUrl.trim())];
    if (!local) return match;
    rewritten += 1;
    return `url(${quote}${local}${quote})`;
  });

  return { html: output, rewritten };
}

/** HTML 实体解码——属性里 `&amp;` 编码过的 URL 要在映射表里找到同一个键。 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x2f;/gi, "/");
}

/**
 * 把 CSS 文本里的 `url(...)` 与 `@import` 换成本地路径。
 *
 * ## 为什么必须单独做这一步
 *
 * 实测（2026-09-11）踩到的坑：`index.html` 里的引用重写好了，
 * 但**样式表里的背景图还是指向原站**——`html { background: url(https://原站/bg.jpg) }`
 * 这一类。结果页面主体看着对，背景图却全是空的，而且**不报错**。
 *
 * 这与 `rewriteResourceReferences` 的差别不只是"文件类型不同"：
 * CSS 的 url 是**相对 CSS 文件自身**解析的，而这里统一换成了相对模板根
 * （`assets/xxx.jpg`）——所以样式表被放到 `assets/` 下之后，
 * 里面的相对路径会**多一层**。处理办法：把 CSS 里原本相对于自己的路径
 * 也按"它自己在哪"重新算，而不是当成模板根路径。
 */
export function rewriteCssReferences(css: string, mapping: ResourceMapping, cssFileRelative: string): { css: string; rewritten: number } {
  if (Object.keys(mapping).length === 0) return { css, rewritten: 0 };
  let rewritten = 0;

  // CSS 文件所在目录（相对模板根）。`assets/a/b.css` → `assets/a`
  const cssDir = cssFileRelative.includes("/") ? cssFileRelative.slice(0, cssFileRelative.lastIndexOf("/")) : "";
  const depth = cssDir ? cssDir.split("/").length : 0;

  const resolve = (raw: string): string | undefined => {
    const url = raw.trim().replace(/^["']|["']$/g, "");
    if (/^(data:|#|mailto:|tel:)/i.test(url)) return undefined;
    // ① 本来就是绝对地址：直接查映射表
    const direct = mapping[url] ?? mapping[decodeHtmlEntities(url)];
    if (direct) return direct;
    // ② 相对地址：按"相对 CSS 文件"解析成相对模板根的路径，再查表。
    //    原站的 CSS 常写 `../images/bg.jpg`，映射表里的键是绝对 URL，
    //    所以这里只能比对**本地相对路径**。
    const normalized = normalizeRelative(cssDir, url);
    if (!normalized) return undefined;
    for (const local of Object.values(mapping)) {
      if (local === normalized) return local;
    }
    return undefined;
  };

  let output = css.replace(/url\(\s*([^)]+?)\s*\)/gi, (match, raw: string) => {
    const local = resolve(raw);
    if (!local) return match;
    rewritten += 1;
    // ⚠️ CSS 里的相对路径是**相对 CSS 文件**的，所以要把"相对模板根"的路径
    // 换算回"相对这个 CSS 文件"——否则样式表放进 assets/ 之后，
    // `assets/bg.jpg` 会被解析成 `assets/assets/bg.jpg`。
    return `url(${toCssRelative(local, depth)})`;
  });

  output = output.replace(/@import\s+([^;]+);/gi, (match, raw: string) => {
    const local = resolve(raw);
    if (!local) return match;
    rewritten += 1;
    return `@import url(${toCssRelative(local, depth)});`;
  });

  return { css: output, rewritten };
}

/** 把 `a/b/../c` 归一成 `a/c`（纯字符串处理，不碰文件系统）。 */
function normalizeRelative(baseDir: string, relative: string): string | null {
  if (/^[a-z]+:/i.test(relative)) return null;
  const segments = `${baseDir ? `${baseDir}/` : ""}${relative}`.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null; // 越过模板根，不可信
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}

/** 相对模板根的路径 → 相对某个深度的 CSS 文件的路径。 */
function toCssRelative(templateRelative: string, depth: number): string {
  if (depth <= 0) return templateRelative;
  return `${"../".repeat(depth)}${templateRelative}`;
}

/**
 * 收集 HTML 里所有指向**绝对地址**的资源引用。
 *
 * 只收 http(s) 的：`data:` 内联资源不用下载，相对路径在搬过来之后本来就会
 * 指向模板目录（但**保留下来**可能指向原站不存在的路径——见下面的 `decideKeep`）。
 */
export function collectExternalReferences(html: string): string[] {
  const found = new Set<string>();
  const attributePattern = /\b(?:src|srcset|poster|href|data-src|data-background-image|data-original)\s*=\s*(["'])([^"']*)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(html)) !== null) {
    for (const candidate of match[2].split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (!url || !/^https?:\/\//i.test(url)) continue;
      found.add(decodeHtmlEntities(url));
    }
  }
  const cssPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  while ((match = cssPattern.exec(html)) !== null) {
    const url = match[2].trim();
    if (/^https?:\/\//i.test(url)) found.add(decodeHtmlEntities(url));
  }
  return [...found];
}

/**
 * 哪些绝对引用**不该**下载。
 *
 * 三类：锚点、已经被上面清洗掉的追踪地址、以及**页面自身的地址**
 * （`<link rel=canonical>` 这类指向自己的 URL，下载它等于递归抓自己）。
 */
export function shouldSkipReference(url: string, pageUrl: string): { skip: boolean; reason?: string } {
  const parsed = safeUrl(url);
  if (!parsed) return { skip: true, reason: "不是合法网址" };
  if (classifyCleanup(url)) return { skip: true, reason: "追踪/广告地址" };
  const page = safeUrl(pageUrl);
  if (page && parsed.origin === page.origin && parsed.pathname === page.pathname && !parsed.search) {
    return { skip: true, reason: "指向页面自身" };
  }
  return { skip: false };
}

// ---------------------------------------------------------------------------
// 产出组装
// ---------------------------------------------------------------------------

export type StaticExportPlan = {
  /** 清洗 + 重写后的 HTML（已可直接写盘） */
  html: string;
  /** 要下载的资源：`原始 URL → 资源清单里那条记录` */
  toDownload: Array<{ url: string; kind: string }>;
  /** 清洗报告（如实告诉用户我们动了什么） */
  cleanup: CleanupReport;
  /** 跳过的资源与原因（**不静默丢弃**） */
  skipped: Array<{ url: string; reason: string }>;
  warnings: string[];
};

/**
 * 把抓取结果整理成一份"可以写盘的静态模板"。
 *
 * **不下载任何东西**——下载在重依赖层做（`template-static-export.ts`）。
 * 本函数只回答"下哪些、怎么改引用"，因此能被单测完整覆盖。
 */
export function planStaticExport(args: {
  html: string;
  pageUrl: string;
  /** 抓取阶段拿到的资源清单（`site-capture` 的产物） */
  assets: ReadonlyArray<{ url: string; kind: string; bytes?: number; error?: string }>;
  /** 单文件大小上限——超了不下载（大视频会把模板体积撑爆） */
  maxBytes?: number;
}): StaticExportPlan {
  const maxBytes = args.maxBytes ?? 4 * 1024 * 1024;
  const warnings: string[] = [];
  const skipped: StaticExportPlan["skipped"] = [];

  // ① 先清洗——清洗掉的引用不该被下载
  const cleanup = cleanCapturedHtml(args.html);

  // ② 页面里实际引用到的外部地址（以**清洗后**的 HTML 为准）
  const referenced = collectExternalReferences(cleanup.html);
  const assetByUrl = new Map(args.assets.map((asset) => [asset.url, asset]));

  const toDownload: StaticExportPlan["toDownload"] = [];
  for (const url of referenced) {
    const decision = shouldSkipReference(url, args.pageUrl);
    if (decision.skip) {
      skipped.push({ url, reason: decision.reason ?? "跳过" });
      continue;
    }
    const asset = assetByUrl.get(url);
    if (asset?.error) {
      skipped.push({ url, reason: `抓取时就没拿到：${asset.error}` });
      continue;
    }
    if (asset?.bytes !== undefined && asset.bytes > maxBytes) {
      skipped.push({ url, reason: `文件太大（${(asset.bytes / 1e6).toFixed(1)}MB）` });
      continue;
    }
    toDownload.push({ url, kind: asset?.kind ?? "other" });
  }

  if (skipped.length > 0) {
    warnings.push(`${skipped.length} 个资源没有本地化（大文件/抓取失败/追踪地址），页面上可能有个别位置显示不出来`);
  }

  // ③ 重写引用要在**下载之后**才能做（那时才知道每个 URL 落到哪个文件）。
  //    这里先原样带回清洗后的 HTML，由调用方拿到映射表后再调 `rewriteResourceReferences`。
  return { html: cleanup.html, toDownload, cleanup, skipped, warnings };
}

/** 给用户/日志用的一句话：这次搬下来了什么、动了什么。 */
export function describeStaticExport(plan: StaticExportPlan, downloadedBytes: number): string {
  const parts = [
    `本地化 ${plan.toDownload.length} 个资源（${(downloadedBytes / 1024 / 1024).toFixed(1)}MB）`,
  ];
  const cleaned = Object.entries(plan.cleanup.counts);
  if (cleaned.length > 0) {
    const labels: Record<string, string> = { analytics: "统计", ads: "广告", tracking: "追踪", preconnect: "预连接", iframe: "第三方框架", "meta-refresh": "自动跳转" };
    parts.push(`清掉 ${cleaned.map(([reason, count]) => `${count} 个${labels[reason] ?? reason}`).join("、")}`);
  }
  if (plan.skipped.length > 0) parts.push(`跳过 ${plan.skipped.length} 个`);
  return parts.join(" · ");
}
