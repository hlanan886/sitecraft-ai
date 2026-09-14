/**
 * capture 模块（纯逻辑层）。
 *
 * ## 为什么与 `site-capture-browser.ts` 分开
 *
 * 照抄 `template-runtime.ts` / `template-runtime-loader.ts` 的分工：**纯逻辑与重依赖分开**。
 * Playwright 一旦进客户端 bundle，Turbopack 直接报 `does not support external modules` 而
 * **构建失败**——这个坑本项目已经踩过（`node:fs` 那次）。
 *
 * ## 职责
 *
 * 一次打开页面，产出**三种消费方**各自需要的东西：
 *
 * | 产出 | 给谁 | 关键约束 |
 * |---|---|---|
 * | 截图 | B（喂模型） | **宽 ≥ 1000px、总像素 < 8MP** |
 * | 渲染后 HTML | A（清洗后导出） | 用 `page.content()`，不是 `fetch` |
 * | 资源清单 | A 本地化 + B 抓图 | 含**真实坐标**，不许猜 |
 */
import type { LibraryAsset, SiteCaptureAsset, SiteCaptureResult, SiteCaptureShot } from "./site-capture.types.ts";

// ---------------------------------------------------------------------------
// 尺寸规则（全部来自实测，不是估算）
// ---------------------------------------------------------------------------

/**
 * 模型可接受的图片上限。**两个独立的限制，缺一不可**。
 *
 * ## ① 总像素 ≤ 8MP
 *
 * 实测（2026-09-11，DeepSeek）：
 * ```
 *  1010x4863  4.9MP  ✓
 *  1440x6935 10.0MP  ✓
 *  1700x8187 13.9MP  ✓
 *  2000x9632 19.3MP  ✗ 400
 * ```
 * 边界在 14~19MP 之间。**取 8MP 是留一倍安全余量**——真实客户的截图尺寸不可控，
 * 贴着上限走迟早出事。
 */
export const MAX_CAPTURE_PIXELS = 8_000_000;

/**
 * ② 单边 ≤ 8192px。
 *
 * 这条是**后来才发现的**（2026-09-11，跑 Recipe 提取时撞上）：
 * 一个模板 demo 是 `967x8260`（7.99MP，**没超像素限制**），却被模型
 * 以 `unsupported image` 拒绝。逐档二分测出来的准确边界：
 *
 * ```
 *  937x8000  7.5MP  ✓
 *  959x8192  7.9MP  ✓  ← 正好在临界
 *  972x8300  8.1MP  ✗ 400
 * ```
 *
 * 8192 是常见编解码器的硬上限（2^13）。**只按总像素缩放挡不住这种情况**——
 * 窄而高的整页截图（门户、长列表页）很容易「像素没超、单边超了」。
 */
export const MAX_CAPTURE_EDGE = 8192;

/**
 * 图片宽度下限（**硬底线**）。
 *
 * 实测只有两个点：**1010px 能读准配色**（`#c8102e`），**450px 把主色读成了蓝色**。
 * 真阈值在两者之间，这里取 **800** 是**内插**，不是实测值。
 *
 * ## 为什么与 `MIN_CAPTURE_WIDTH` 是两个数
 *
 * `MIN_CAPTURE_WIDTH = 1000` 是**取图时的偏好**（视口宽度、缩放目标），
 * 这个是**收图时的底线**。两者用途不同，混成一个会打架：
 *
 * 实测（2026-09-11）：一个 `967x8260` 的窄长页面，为满足模型单边 8192 的限制
 * 只能缩到 `959x8192`——**宽度 959 < 1000**，于是被自己的宽度规则拒了。
 * 结果是用户拿着一张完全合法的整页截图，却卡在"这张图太窄"上**无路可走**。
 *
 * **为满足硬限制而缩到的宽度，不该被软偏好拒掉。**
 */
export const MIN_ACCEPTABLE_WIDTH = 800;

/**
 * 图片宽度偏好（取图时用）。
 *
 * **低于 1000px 字会糊，模型读不准配色和文字**——这不是猜测，是实测对比：
 * 同一张 1010 宽的截图能读准配色（`#c8102e`），而 450 宽的缩略图把主色读成了蓝色。
 * 抓取时按它设视口；但**收货判定用 `MIN_ACCEPTABLE_WIDTH`**（见上）。
 */
export const MIN_CAPTURE_WIDTH = 1000;

export type CaptureSizePlan = {
  /** 是否需要缩放 */
  needsResize: boolean;
  /** 目标宽高（不需要缩放时等于原尺寸） */
  width: number;
  height: number;
  /** 给用户/日志看的原因 */
  reason?: string;
};

/**
 * 决定截图的目标尺寸。**两条限制都要满足，取更严的那个缩放比。**
 *
 * **只缩不放**——放大不会增加信息，只会让文件变大。
 *
 * ⚠️ `MIN_CAPTURE_WIDTH` 是**目标值不是硬保证**：为了满足单边/像素限制，
 * 宽度有时必须降到 1000 以下（一个 500×20000 的页面，压到 8192 高就只有 205 宽）。
 * 那种情况下**宁可窄也不能超限**——超限是模型直接拒收，窄只是读得糙一点。
 * 早先的实现在这里用 `Math.max(MIN_CAPTURE_WIDTH, …)` 把宽度**抬回 1000**，
 * 反而把像素预算撑破了——那是修一个限制、坏另一个限制。
 */
export function planCaptureSize(width: number, height: number): CaptureSizePlan {
  if (width <= 0 || height <= 0) {
    return { needsResize: false, width, height, reason: "尺寸无效，跳过缩放" };
  }

  const pixels = width * height;
  const longestEdge = Math.max(width, height);
  const overPixels = pixels > MAX_CAPTURE_PIXELS;
  const overEdge = longestEdge > MAX_CAPTURE_EDGE;
  if (!overPixels && !overEdge) {
    return { needsResize: false, width, height };
  }

  // 两个缩放比各算各的，取**更小的那个**（更严的限制说了算）
  const scaleForPixels = overPixels ? Math.sqrt(MAX_CAPTURE_PIXELS / pixels) : 1;
  const scaleForEdge = overEdge ? MAX_CAPTURE_EDGE / longestEdge : 1;
  const scale = Math.min(scaleForPixels, scaleForEdge);

  const targetW = Math.max(1, Math.floor(width * scale));
  const targetH = Math.max(1, Math.floor(height * scale));

  const reasons: string[] = [];
  if (overPixels) reasons.push(`原图 ${(pixels / 1e6).toFixed(1)}MP 超出 ${(MAX_CAPTURE_PIXELS / 1e6).toFixed(0)}MP`);
  if (overEdge) reasons.push(`最长边 ${longestEdge}px 超出 ${MAX_CAPTURE_EDGE}px`);

  return {
    needsResize: true,
    width: targetW,
    height: targetH,
    reason: `${reasons.join("、")}，已等比缩放到 ${targetW}x${targetH}`,
  };
}

// ---------------------------------------------------------------------------
// 资源判定
// ---------------------------------------------------------------------------

/** 从 URL 推资源类型。查不到时归 `other`（不丢弃，交给上层决定）。 */
export function classifyAsset(url: string): SiteCaptureAsset["kind"] {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase().split("?")[0];
    }
  })();

  if (/\.(png|jpe?g|webp|gif|avif|svg|ico|bmp)$/.test(path)) return "image";
  if (/\.(woff2?|ttf|otf|eot)$/.test(path)) return "font";
  if (/\.css$/.test(path)) return "stylesheet";
  if (/\.m?js$/.test(path)) return "script";
  if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "video";
  return "other";
}

/**
 * 装饰性图片的判定——**小图标不值当抓**。
 *
 * 阈值取 80px：实测模板里 logo/图标多在 24~64px，而产品图/背景图都 ≥ 200px。
 * 这条只用于**降噪**，不用于丢弃重要资源——被过滤的仍留在清单里，只是标 `decorative`。
 */
export const DECORATIVE_MAX_SIZE = 80;

export function isDecorative(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= DECORATIVE_MAX_SIZE && height <= DECORATIVE_MAX_SIZE;
}

// ---------------------------------------------------------------------------
// 可达性
// ---------------------------------------------------------------------------

export type CaptureVerdict = {
  ok: boolean;
  /** 给**用户**看的话——不是给工程师看的错误码 */
  message: string;
};

/**
 * 判断抓取结果是否可用。
 *
 * **输出必须说人话**——客户自助场景下，"capture failed" 这种人看不懂的东西
 * 只会让他关掉页面。所有分支都给出**下一步该做什么**。
 */
export function judgeCapture(result: Pick<SiteCaptureResult, "html" | "assets" | "shot" | "failure">): CaptureVerdict {
  if (result.failure) {
    return { ok: false, message: result.failure };
  }

  if (!result.shot) {
    return { ok: false, message: "页面没能截出图来，可能是网站禁止了截图。可以换一个网址，或者直接把截图传给我。" };
  }

  if (result.shot.width < MIN_CAPTURE_WIDTH) {
    return {
      ok: false,
      message: `这个页面太窄了（${result.shot.width}px），截图里的字会看不清。可以换一个网址，或者直接把截图传给我。`,
    };
  }

  if (result.assets.length === 0) {
    return { ok: true, message: "页面抓到了，但没找到图片资源——可能会用占位图形代替。" };
  }

  const images = result.assets.filter((a) => a.kind === "image" && !a.decorative);
  if (images.length === 0) {
    return { ok: true, message: "页面抓到了，但没有可用的产品图或背景图——可能会用占位图形代替。" };
  }

  const withBox = images.filter((a) => a.box).length;
  if (withBox === 0) {
    // 没有坐标 = 之后没法裁图。这不是致命错误（还能整页截图喂模型），但要记下来。
    return { ok: true, message: "页面抓到了。图片定位信息不完整，后续如果要单独提取图片可能需要你手动指定。" };
  }

  return { ok: true, message: `抓取成功：${images.length} 张可用图片、页面高度 ${result.shot.height}px。` };
}

// ---------------------------------------------------------------------------
// 清单汇总
// ---------------------------------------------------------------------------

export type CaptureSummary = {
  assetCount: number;
  imageCount: number;
  usableImageCount: number;
  stylesheetCount: number;
  totalBytes: number;
};

export function summarizeAssets(assets: readonly SiteCaptureAsset[]): CaptureSummary {
  const images = assets.filter((a) => a.kind === "image");
  return {
    assetCount: assets.length,
    imageCount: images.length,
    usableImageCount: images.filter((a) => !a.decorative).length,
    stylesheetCount: assets.filter((a) => a.kind === "stylesheet").length,
    totalBytes: assets.reduce((sum, a) => sum + (a.bytes ?? 0), 0),
  };
}

/** 截图是否满足喂给模型的条件。 */
export function isShotUsable(shot: SiteCaptureShot | null): boolean {
  if (!shot) return false;
  if (shot.width < MIN_CAPTURE_WIDTH) return false;
  return shot.width * shot.height <= MAX_CAPTURE_PIXELS;
}

// ---------------------------------------------------------------------------
// 失败信息说人话
// ---------------------------------------------------------------------------

/**
 * 把 Playwright 的原始错误翻成**客户能看懂、且知道下一步做什么**的话。
 *
 * ## 为什么必须做（2026-09-11 实测）
 *
 * 访问一个不存在的域名，用户看到的是：
 *
 * ```
 * 抓取失败：page.goto: net::ERR_NAME_NOT_RESOLVED at https://xxx.com/
 * Call log:
 *  - navigating to "https://xxx.com/", waiting until "load"
 * 。可以换成直接上传截图。
 * ```
 *
 * 里面混着：Playwright 的内部方法名、Chromium 的错误码、一段调用日志、
 * 以及 `[2m` 这样的 ANSI 转义码（在浏览器里会显示成乱码）。
 * **客户看不懂，也不知道该改什么。**
 *
 * ## 做法
 *
 * 先认出**具体原因**（域名不存在 / 连不上 / 证书问题 / 超时），
 * 每条都给一句"这是怎么回事 + 你该怎么做"；认不出来时才退回通用文案，
 * 并**剥掉技术噪音**（ANSI、Call log 段落、`page.goto:` 前缀）。
 *
 * 认不出来时**不猜**——把没见过的错误说成"域名不存在"会让用户去改一个
 * 本来没问题的网址。
 */
export function humanizeCaptureError(message: string): string {
  const raw = String(message ?? "");
  // 先剥噪音，再判断——顺序反了会因为前缀里的 `page.goto:` 误判
  const cleaned = raw
    // ANSI 转义（`[2m` 这类在浏览器里显示成乱码）
    .replace(/?\[\d+m/g, "")
    // Playwright 的调用日志段落：从 "Call log:" 到结尾，对用户零价值
    .replace(/\n?Call log:[\s\S]*$/i, "")
    .replace(/\bpage\.goto:\s*/gi, "")
    .replace(/\s*at\s+https?:\/\/\S+\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ---- 认得出原因的，逐条给人话 ----
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(cleaned)) {
    return "这个网址打不开——域名不存在或拼错了。检查一下网址是否写对（比如有没有多打或少打字母）。";
  }
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(cleaned)) {
    return "这个网址拒绝连接——网站可能没在运行，或者不允许外部访问。确认一下网址能在浏览器里正常打开。";
  }
  if (/ERR_CONNECTION_RESET|ECONNRESET|ERR_CONNECTION_CLOSED/i.test(cleaned)) {
    return "连这个网站时连接被中断了（可能是网络不通或对方限制了访问）。可以稍后重试，或者直接把截图传给我。";
  }
  if (/ERR_CONNECTION_TIMED_OUT|ETIMEDOUT|Timeout.*exceeded|timeout/i.test(cleaned)) {
    return "这个网址响应太慢，等超时了。可以稍后重试，或者直接把截图传给我。";
  }
  if (/ERR_CERT|SSL|TLS/i.test(cleaned)) {
    return "这个网站的安全证书有问题，浏览器不信任它。可以先把截图传给我，我照样能做。";
  }
  if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(cleaned)) {
    return "页面加载被中断了（对方网站可能做了跳转拦截）。可以稍后重试，或者直接把截图传给我。";
  }
  if (/ERR_HTTP_RESPONSE_CODE_FAILURE|HTTP 4\d\d|HTTP 5\d\d/i.test(cleaned)) {
    return "对方服务器返回了错误，这个页面打不开。确认一下网址是否正确。";
  }

  // ---- 认不出来：给通用指引，并保证不露出技术噪音 ----
  // 不说"未知错误"——那等于没说。给出**唯一确定有用的下一步**。
  return `${cleaned.slice(0, 120)}。可以稍后重试，或者直接把截图传给我。`;
}

// ---------------------------------------------------------------------------
// 素材沉淀
// ---------------------------------------------------------------------------

/**
 * 沉淀的门槛：**只留以后真可能再用的图**。
 *
 * 与 `DECORATIVE_MAX_SIZE`（80px，判"是不是装饰"）是两个不同的判据——
 * 那个用来降噪，这个用来挑选。一条图可以"不是装饰"但"不值得沉淀"
 * （比如 200px 的小配图），所以是两道独立的尺子。
 */
export const LIBRARY_MIN_EDGE = 200;

/** 沉淀上限——超过这个数就不是"素材库"而是"把原站图片全搬走"了。 */
export const LIBRARY_MAX_ITEMS = 40;

/**
 * 从抓取到的资源清单里筛出**值得沉淀**的图片。
 *
 * ## 为什么用尺寸而不是让模型挑
 *
 * 模型判"哪张是产品图"要花 token，而且**会错**——实测它会把背景纹理当成产品图。
 * 而尺寸是浏览器算出来的确定事实。一个工业站首页实测的尺寸分布：
 *
 * ```
 * logo / 图标    24–80px    → 装饰，不沉淀
 * 小配图         ~200px     → 边界，不沉淀
 * 产品图         400–900px  → 沉淀，role = product
 * 首屏主视觉     1400px+    → 沉淀，role = hero
 * 横幅           1600×400   → 沉淀，role = wide（宽高比 > 2）
 * ```
 *
 * ## 只按尺寸，不算"哪张最好看"
 *
 * `role` 只是**按形态给的建议**（最大的当主视觉、近方形的当产品图），
 * 不是判断。真要用的时候人来挑——这比让模型猜准得多，也便宜得多。
 */
export function collectLibraryAssets(assets: readonly SiteCaptureAsset[]): LibraryAsset[] {
  const candidates = assets
    .filter((asset) => asset.kind === "image" && asset.natural)
    .map((asset) => ({
      url: asset.url,
      width: asset.natural?.width ?? 0,
      height: asset.natural?.height ?? 0,
      box: asset.box,
    }))
    // 两边都要够大：一张 2000×60 的细条是分割线，不是素材
    .filter((item) => item.width >= LIBRARY_MIN_EDGE && item.height >= LIBRARY_MIN_EDGE)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, LIBRARY_MAX_ITEMS);

  if (candidates.length === 0) return [];

  // 最大的一张当主视觉——**只有一个**，避免"每张都像主视觉"等于没分类
  const heroIndex = 0;

  return candidates.map((item, index) => {
    const ratio = item.width / item.height;
    let role: LibraryAsset["role"];
    if (index === heroIndex) role = "hero";
    else if (ratio >= 2 || ratio <= 0.5) role = "wide";
    else if (ratio >= 0.75 && ratio <= 1.33) role = "product";
    else role = "other";
    return { url: item.url, role, width: item.width, height: item.height, box: item.box };
  });
}

/** 素材库汇总（给用户看的一句话）。 */
export function summarizeLibrary(library: readonly LibraryAsset[]): string {
  if (library.length === 0) return "没有找到值得沉淀的图片";
  const counts = { hero: 0, product: 0, wide: 0, other: 0 };
  for (const item of library) counts[item.role] += 1;
  const parts = [
    counts.hero > 0 ? `${counts.hero} 张主视觉` : "",
    counts.product > 0 ? `${counts.product} 张产品图` : "",
    counts.wide > 0 ? `${counts.wide} 张横幅` : "",
    counts.other > 0 ? `${counts.other} 张其他` : "",
  ].filter(Boolean);
  return `沉淀 ${library.length} 张图片：${parts.join("、")}`;
}
