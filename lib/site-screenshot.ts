/**
 * 产品图裁剪（Playwright 层）。
 *
 * ## 本文件与 `site-capture-browser.ts` 同一条纪律
 *
 * **唯一允许 import `playwright` 的模块**之一。重依赖一旦进客户端 bundle，
 * Turbopack 直接报 `does not support external modules` 而构建失败（实测）。
 * 所以调用方（`template-from-screenshot.ts`）只 import 类型与纯函数，
 * playwright 只在这里出现。
 *
 * ## 这个模块存在的理由：**坐标只能来自浏览器，不能猜**
 *
 * 实测教训（2026-09-11，被用户当场指出）：
 * 按百分比等分切图（宽 1009 ÷ 4 = 每格 252px），每张"产品图"里塞进了
 * 两三个产品加文字——**完全不可用**。
 *
 * 根因不是精度不够，是**方法错**：页面栅格有间距、元素大小不一、
 * 还有滚动偏移，任何"按比例推算"都必然错位。
 *
 * 所以这里的流程是：
 *   ① 打开页面 → ② 按 URL 找到那个元素 → ③ 读 `getBoundingClientRect()`
 *   → ④ **就在同一个标签页里** `clip` 截图。
 *
 * ③④ 必须在同一个标签页内完成，因为 `clip` 用的是**页面坐标**——
 * 换一个标签页、或者用整页截图的像素坐标，都会因为缩放/滚动而错位
 * （实测同一条链路差 1.8 倍）。
 */
import { chromium, type Browser, type Page } from "playwright";

export type ProductShotPlanItem = {
  /** 原始图片 URL（来自 capture 的 DOM 探针） */
  url: string;
  /** 序号——决定落盘文件名 `assets/product-<rank+1>.jpg`，也决定配给第几个产品 */
  rank: number;
};

export type ProductShot = {
  rank: number;
  sourceUrl: string;
  /** 裁出图的 base64（JPEG） */
  base64: string;
  width: number;
  height: number;
  /** 实际用于裁剪的页面坐标——出问题时这是唯一能对账的数字 */
  box: { x: number; y: number; width: number; height: number };
};

export type TakeProductShotsOptions = {
  pageUrl: string;
  items: ProductShotPlanItem[];
  viewportWidth?: number;
  viewportHeight?: number;
  /** 单张最大边长（像素）。产品卡图不需要原图那么大 */
  maxEdge?: number;
  timeoutMs?: number;
};

const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * 页内脚本：按 URL 精确匹配元素，**返回元素在页面上第几个**。
 *
 * ⚠️ 只返回序号，不返回坐标。原因见文件顶部：`page.screenshot({clip})` 的
 * `clip` 是**视口坐标**，而元素多半在视口之外——拿页面坐标去 clip 会裁到别处，
 * 拿视口坐标去 clip 又要求元素当前就在视口里。两个都不对。
 *
 * 正确做法是 `elementHandle.screenshot()`——Playwright 自己会滚动、定位、裁剪。
 * 所以这里只需要把元素找出来，坐标的事交给它。
 *
 * ⚠️ 必须是**函数**，不能是字符串。Playwright 的 `page.evaluate(字符串, 参数)`
 * **不会把参数传进去**——字符串会被当表达式求值，参数被丢掉。
 * 实测（2026-09-11）：写成字符串时 `targetUrl` 永远是 `undefined`，
 * 每张图都"定位不到"而**静默跳过**，最后表现为"一张图都没裁出来"，
 * 且因为外层有 catch，连个错都不报。
 *
 * ⚠️ 匹配要用 `currentSrc || src`：`<picture>`/`srcset` 的场景下
 * `src` 是回退值，浏览器实际加载的是 `currentSrc`。用 `src` 匹配会找不到。
 */
const findImageIndex = (targetUrl: string) => {
  const abs = (u: string) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return "";
    }
  };
  const elements = Array.from(document.querySelectorAll("img, picture, source"));
  for (let index = 0; index < elements.length; index += 1) {
    const el = elements[index];
    const current =
      el.tagName === "SOURCE"
        ? abs((el as HTMLSourceElement).srcset?.split(",")[0]?.trim().split(" ")[0] || "")
        : abs((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
    if (current !== targetUrl) continue;
    // `<source>` 没有布局盒，图实际由它所属的 `<picture>` 或 `<img>` 呈现——
    // 交给调用方去取那个可截图的元素
    if (el.tagName === "SOURCE") {
      const owner = el.closest("picture") ?? el.parentElement;
      if (!owner) continue;
      const ownerIndex = elements.indexOf(owner as Element);
      return ownerIndex >= 0 ? ownerIndex : index;
    }
    return index;
  }
  return -1;
};

/**
 * 页内脚本：把一个不在视口里的元素滚进视口（居中），并返回它当前的位置。
 * 只用来**取位置做记录**，不再用来裁剪。
 */
const centerElement = (selectorIndex: number) => {
  const elements = Array.from(document.querySelectorAll("img, picture, source"));
  const el = elements[selectorIndex] as HTMLElement | undefined;
  if (!el) return null;
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
};

export type ProductShotFailure = {
  rank: number;
  url: string;
  reason: string;
};

/** 等图片解码完——`complete === false` 时截出来是空白（与 capture 同一个坑）。 */
async function waitForImages(page: Page): Promise<void> {
  await page
    .waitForFunction(() => Array.from(document.querySelectorAll("img")).every((img) => img.complete), { timeout: 5000 })
    .catch(() => {
      // 超时不算失败：有些图本来就 404，让它如实裁出空白比整条链路失败好
    });
}

export type TakeProductShotsResult = {
  shots: ProductShot[];
  /**
   * 每张没裁到的图**为什么**没裁到。
   *
   * ⚠️ 这个字段是必需的，不是可选的好东西。此前失败被一个空 `catch` 吞掉，
   * 表现为"一张图都没裁出来"而**没有任何线索**——排查时只能靠重写一遍代码复现。
   * 自助场景下没有人能帮客户查，所以"哪里失败了、为什么"必须能说出来。
   */
  failures: ProductShotFailure[];
};

/**
 * 按真实坐标裁出产品图。
 *
 * **永不抛异常**——单张裁不到就少一张，其余照常返回，并把原因收进 `failures`。
 * 理由和 capture 一致：自助场景下，一个未捕获的异常等于"页面崩了"。
 */
export async function takeProductShots(options: TakeProductShotsOptions): Promise<TakeProductShotsResult> {
  const failures: ProductShotFailure[] = [];
  if (!options.pageUrl || options.items.length === 0) return { shots: [], failures };

  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let browser: Browser | null = null;
  const shots: ProductShot[] = [];

  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: options.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH, height: options.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });
    await page.goto(options.pageUrl, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForTimeout(1500);
    // 产品图基本都在页面中段，多半是懒加载——不滚下去它们根本没解码
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForImages(page);

    const { default: sharp } = await import("sharp");
    for (const item of options.items) {
      try {
        // ⚠️ 传**函数**而不是字符串——见 `findImageIndex` 上方的说明
        const elementIndex = (await page.evaluate(findImageIndex, item.url)) as number;
        if (elementIndex < 0) {
          failures.push({ rank: item.rank, url: item.url, reason: "页面上找不到这张图（可能被懒加载替换了 URL）" });
          continue;
        }

        // 滚到它、等稳定，再取一个"位置"仅用于**记录**（不是用来裁剪）
        await page.evaluate(centerElement, elementIndex).catch(() => null);
        await page.waitForTimeout(250);

        const handle = (await page.$$("img, picture, source"))[elementIndex];
        if (!handle) {
          failures.push({ rank: item.rank, url: item.url, reason: "元素已从页面上消失" });
          continue;
        }

        // 🔴 关键：用 `elementHandle.screenshot()` 而不是 `page.screenshot({clip})`。
        //
        // 实测（2026-09-11，两次踩坑）：
        //  - `clip` 是**视口坐标**，不是页面坐标。元素在视口外时，
        //    拿页面坐标去 clip 会裁到完全无关的地方（表现为"产品图是横幅的一段"）。
        //  - 加 `fullPage: true` 并不改变这一点——它只是让截图包含整页，
        //    clip 仍在视口坐标系里解释。
        //
        // `elementHandle.screenshot()` 把"滚动到元素 + 按它的盒模型裁剪"一次性做对，
        // 这正是我们要的语义。**不要换回 clip。**
        const box = await handle.boundingBox();
        if (!box || box.width < 40 || box.height < 40) {
          failures.push({ rank: item.rank, url: item.url, reason: `元素太小或不可见（${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}）` });
          continue;
        }

        const buffer = await handle.screenshot({ type: "jpeg", quality: 88 });

        // 缩小到合理尺寸——产品卡图 1600px 足够，原图动辄 3000px 白占体积
        const meta = await sharp(buffer).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        const longest = Math.max(width, height);
        const finalBuffer =
          longest > maxEdge
            ? await sharp(buffer)
                .resize({ width: Math.round(width * (maxEdge / longest)), height: Math.round(height * (maxEdge / longest)) })
                .jpeg({ quality: 88 })
                .toBuffer()
            : buffer;
        const finalMeta = await sharp(finalBuffer).metadata();

        shots.push({
          rank: item.rank,
          sourceUrl: item.url,
          base64: finalBuffer.toString("base64"),
          width: finalMeta.width ?? 0,
          height: finalMeta.height ?? 0,
          // 记的是**视口内的位置**（滚到居中之后）。只用于排查，不作为裁剪依据。
          box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        });
      } catch (error) {
        failures.push({ rank: item.rank, url: item.url, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    // 整个浏览器起不来（没装 chromium、内存不够）——**如实报告**，
    // 而不是返回一个空的 shots 让调用方以为"原站没有图"
    const reason = error instanceof Error ? error.message : String(error);
    failures.push({ rank: -1, url: options.pageUrl, reason: `浏览器启动或打开页面失败：${reason}` });
  } finally {
    await browser?.close().catch(() => {});
  }

  return { shots: shots.sort((a, b) => a.rank - b.rank), failures };
}
