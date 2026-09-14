/**
 * capture 模块（Playwright 层）。
 *
 * ## 本文件是唯一允许 import `playwright` 的模块
 *
 * 原因与 `template-runtime-loader.ts` 只允许 import `node:fs` 完全相同：
 * **重依赖一旦进客户端 bundle，Turbopack 直接报
 * `does not support external modules` 而构建失败**（本项目实测踩过）。
 *
 * 所以：纯逻辑放 `site-capture.ts`，类型放 `site-capture.types.ts`，
 * **只有服务端脚本/路由可以 import 本文件**。
 *
 * ## 一次打开，三样产出
 *
 * 两条路（A 静态导出 / B DSL 复刻）共用这一步，**100% 复用**——
 * 这正是"共用一个 capture、两个解耦的出口"的落点。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import {
  MAX_CAPTURE_PIXELS,
  classifyAsset,
  collectLibraryAssets,
  humanizeCaptureError,
  isDecorative,
  planCaptureSize,
} from "./site-capture.ts";
import type { CaptureOptions, SiteCaptureAsset, SiteCaptureResult, SiteCaptureShot } from "./site-capture.types.ts";

const DEFAULT_OPTIONS = {
  viewportWidth: 1440,
  viewportHeight: 900,
  settleMs: 2500,
  timeoutMs: 45_000,
} as const;

/**
 * 页内探针：读**渲染后**的真实布局。
 *
 * ⚠️ **坐标必须来自 `getBoundingClientRect()`**——实测教训：按百分比等分猜坐标，
 * 每张"产品图"会塞进两三个产品（页面栅格有间距、元素大小不一，等分必然错位）。
 */
const PROBE_SCRIPT = `(() => {
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return ""; } };
  const out = [];
  const seen = new Set();

  const push = (el, url, kindHint) => {
    if (!url || url.startsWith("data:")) return;      // data URI 不是可下载资源
    const key = url + "|" + kindHint;
    if (seen.has(key)) return;
    seen.add(key);
    const r = el.getBoundingClientRect();
    const hasBox = r.width > 0 && r.height > 0;
    out.push({
      url,
      kindHint,
      box: hasBox ? {
        x: Math.round(r.left + window.scrollX),
        y: Math.round(r.top + window.scrollY),
        width: Math.round(r.width),
        height: Math.round(r.height),
      } : null,
      natural: (el.tagName === "IMG" && el.naturalWidth)
        ? { width: el.naturalWidth, height: el.naturalHeight } : null,
    });
  };

  document.querySelectorAll("img").forEach((el) => push(el, abs(el.currentSrc || el.src), "image"));
  document.querySelectorAll("source").forEach((el) => push(el, abs(el.srcset?.split(",")[0]?.trim().split(" ")[0] || el.src), "image"));
  document.querySelectorAll("video[poster]").forEach((el) => push(el, abs(el.getAttribute("poster")), "image"));
  document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => push(el, abs(el.href), "stylesheet"));

  return { assets: out, title: document.title, html: document.documentElement.outerHTML };
})()`;

async function extractAssets(page: Page): Promise<{ assets: SiteCaptureAsset[]; title: string; html: string }> {
  const raw = (await page.evaluate(PROBE_SCRIPT)) as {
    assets: Array<{
      url: string;
      kindHint: string;
      box: { x: number; y: number; width: number; height: number } | null;
      natural: { width: number; height: number } | null;
    }>;
    title: string;
    html: string;
  };

  const assets: SiteCaptureAsset[] = raw.assets.map((item) => {
    // 用 DOM 给的 kind 优先（`<img>` 就是 image，哪怕 URL 没有扩展名），
    // 猜不出来时再按扩展名归——两者都不可靠时归 `other`，**不丢弃**。
    const kind = item.kindHint === "image" ? "image" : classifyAsset(item.url);
    const width = item.box?.width ?? item.natural?.width ?? 0;
    const height = item.box?.height ?? item.natural?.height ?? 0;
    return {
      url: item.url,
      kind,
      box: item.box,
      natural: item.natural,
      decorative: isDecorative(width, height),
    };
  });

  return { assets, title: raw.title, html: raw.html };
}

/** 下载一张资源（带超时，失败不抛）。 */
async function downloadAsset(url: string, timeoutMs: number): Promise<{ bytes: number; body: Buffer } | { error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteCraftCapture/1.0)" },
      cache: "no-store",
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const body = Buffer.from(await response.arrayBuffer());
    return { bytes: body.length, body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 滚动一遍页面，触发懒加载的图片。
 *
 * ## 为什么必须做
 *
 * 实测（2026-09-11）：不滚的话 `loading="lazy"` 的长图**根本没加载**——
 * 元素有布局框（`960x2478`），但 `naturalWidth === 0`，截出来那块是**纯白**。
 *
 * 判据就在 capture 自己输出的清单里：**有 natural 尺寸 = 加载了；没有 = 没加载**。
 *
 * ## 做法
 *
 * 分步滚到底（每步等一小会儿让浏览器发起请求），再滚回顶部——
 * **回顶部是因为截图要从头截**，不回的话 `fullPage` 可能截到半路的滚动位置。
 */
async function triggerLazyLoad(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = 800;
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);

  // 等图片真正解码完（`complete === true`），最多等 5 秒——
  // 不等的话滚动触发了请求但图还没到，截图里仍是空白。
  await page
    .waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return imgs.every((img) => img.complete);
      },
      { timeout: 5000 },
    )
    .catch(() => {
      // 超时不算失败——有些图本来就 404。继续往下走，让 capture 如实报告哪些没加载。
    });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

/**
 * 抓取一个页面。
 *
 * **永不抛异常**——所有失败都收进 `result.failure`（**说人话**）。
 * 客户自助场景下，一个未捕获的异常等于"页面崩了"，而客户只会关掉它。
 */
export async function captureSite(url: string, options: CaptureOptions): Promise<SiteCaptureResult> {
  const startedAt = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const repoRoot = process.cwd();

  const base: SiteCaptureResult = {
    url,
    title: "",
    html: "",
    assets: [],
    shot: null,
    failure: null,
    elapsedMs: 0,
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: opts.viewportWidth, height: opts.viewportHeight },
      // 移动端 UA 会被很多站识别为不同布局；明确用桌面 UA 保证抓的是桌面版
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });

    const response = await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs });
    if (response && !response.ok()) {
      // 403/404 这类要**说清楚**，不能笼统说"抓取失败"
      return {
        ...base,
        failure: `这个网址打不开（服务器返回 ${response.status()}）。检查一下链接是否正确，或者对方网站不允许抓取。`,
        elapsedMs: Date.now() - startedAt,
      };
    }

    // SPA 需要额外时间渲染——`load` 事件早于 React/Vue 挂载完成
    await page.waitForTimeout(opts.settleMs);

    // 🔴 滚动一遍触发懒加载。
    //
    // 实测（2026-09-11）：不滚的话，`loading="lazy"` 的长图**根本没加载**——
    // 元素有布局框（960x2478），但 `naturalWidth === 0`，
    // 截出来那块是**纯白**，而且裁图也会裁到空白。
    // **长图基本都懒加载，所以这一步不是优化，是必需。**
    await triggerLazyLoad(page);

    const { assets, title, html } = await extractAssets(page);

    // 截图：先量真实高度，再决定是否缩放。
    // ⚠️ 不能拿 DOM 报的高度当最终结果——实测：DOM 的 scrollHeight 与截出的像素**不是一回事**。
    // 这里只用它做"要不要缩"的预判，**最终以 sharp 读出的元数据为准**。
    const metrics = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    const plan = planCaptureSize(metrics.width, metrics.height);
    if (plan.needsResize) {
      await page.setViewportSize({ width: plan.width, height: Math.min(plan.height, 1200) });
      await page.waitForTimeout(300);
    }

    const shotBuffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 85 });

    // 用 sharp 读**产物本身**的尺寸——这是唯一可信的数字
    const meta = await sharp(shotBuffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    // 兜底：视口缩放不一定精确命中（页面按 vw 排版时会回弹）。
    // ⚠️ 判据要用**同一个** `planCaptureSize`，而不是只盯像素——
    // 单边超 8192 是另一条独立限制，只查像素会让窄长截图漏过去（实测踩过）。
    const actualPlan = planCaptureSize(width, height);
    if (actualPlan.needsResize) {
      const resized = await sharp(shotBuffer)
        .resize({ width: actualPlan.width, height: actualPlan.height, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      await writeShot(repoRoot, opts.shotDir, `${slugFromUrl(url)}.jpg`, resized);
      const m2 = await sharp(resized).metadata();
      base.shot = {
        file: path.join(opts.shotDir, `${slugFromUrl(url)}.jpg`),
        width: m2.width ?? 0,
        height: m2.height ?? 0,
        bytes: resized.length,
        resized: true,
        format: "jpeg",
        body: resized,
      };
    } else {
      await writeShot(repoRoot, opts.shotDir, `${slugFromUrl(url)}.jpg`, shotBuffer);
      base.shot = {
        file: path.join(opts.shotDir, `${slugFromUrl(url)}.jpg`),
        width,
        height,
        bytes: shotBuffer.length,
        resized: plan.needsResize,
        format: "jpeg",
        body: shotBuffer,
      };
    }

    // 下载资源（A 路径需要；B 路径可跳过）
    const finalAssets = opts.downloadAssets
      ? await Promise.all(
          assets.map(async (asset) => {
            const result = await downloadAsset(asset.url, opts.timeoutMs);
            return "error" in result
              ? { ...asset, error: result.error }
              : { ...asset, bytes: result.bytes };
          }),
        )
      : assets;

    return {
      ...base,
      title,
      html,
      assets: finalAssets,
      // 素材沉淀：只读我们已经量到的尺寸，不额外发请求。
      // 放在最后算，是因为它要的是**最终**的 assets（含下载结果）。
      ...(opts.collectLibraryAssets ? { library: collectLibraryAssets(finalAssets) } : {}),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Playwright 的原始错误里混着方法名、Chromium 错误码、调用日志和 ANSI 转义码，
    // 客户看不懂也不知道该改什么——统一翻成人话（见 `humanizeCaptureError` 的说明）。
    return { ...base, failure: humanizeCaptureError(message), elapsedMs: Date.now() - startedAt };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function writeShot(repoRoot: string, shotDir: string, fileName: string, buffer: Buffer): Promise<void> {
  const dir = path.join(repoRoot, shotDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buffer);
}

/** 从 URL 造一个安全的文件名。**中文域名/路径要能落地**，所以不做 ascii 化。 */
export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const raw = `${u.host}${u.pathname}`.replace(/\/+$/, "");
    return raw.replace(/[^\w.-]+/g, "_").slice(0, 80) || "page";
  } catch {
    return "page";
  }
}

export type { SiteCaptureShot };
