/**
 * 「网址 → 静态模板」的编排层（A 路径）。
 *
 * ## 它与 B 路径的关系：**完全解耦，但汇合在同一扇门**
 *
 * ```
 *                    ┌─ A：capture → 资源本地化 + 清洗 → 原样搬运
 *   一个网址 ─capture─┤
 *                    └─ B：capture 的截图 → 模型出 DSL → 拼装
 *                                          ↓
 *                              两者都产出 TemplateBundle
 *                                          ↓
 *                              POST /api/templates/runtime（同一扇门）
 * ```
 *
 * `capture` 那一步 100% 复用——这正是"两条路共用一个抓取、两个解耦的出口"的落点。
 * 但**从 capture 之后，A 和 B 一行代码都不共享**：A 不碰 DSL 与拼装器，
 * B 不碰清洗与本地化。强行合并会让 A 去处理"翻译不了的版式"、
 * 让 B 去处理"有些站是搬来的"。
 *
 * ## 本文件不落盘、不建站
 *
 * 与 `template-from-screenshot.ts` 同一条纪律：产出 `TemplateBundle`，
 * 落盘走**已有的** `/api/templates/runtime`，建站走**已有的** `/api/sites`。
 */
import { captureSite } from "./site-capture-browser.ts";
import { exportStaticTemplate, toRegisterAssets } from "./template-static-export-browser.ts";
import { describeStaticExport } from "./template-static-export.ts";
import { summarizeLibrary, isShotUsable } from "./site-capture.ts";
import type { LibraryAsset, SiteCaptureResult } from "./site-capture.types.ts";
import { postProcessPrecipitatedTemplateHtml } from "./template-slot-injection.ts";
import { collectSlotTargetsFromHtmlString } from "./template-runtime-loader.ts";

/** A 路径的产出：**形状与 B 的 TemplateBundle 一致**，所以登记接口不用改。 */
export type StaticTemplateBundle = {
  templateId: string;
  name: string;
  category: string;
  description: string;
  html: string;
  assets: Record<string, string>;
  binaryAssets: Record<string, string>;
  /** A 路径**没有**初始草稿——搬来的站与原站内容一致，不需要另给一份 */
  initialDraft: null;
  summary: string;
  warnings: string[];
  /** 沉淀下来的素材库（可空）。**这是 A 路径的额外收益**，见文件底部说明。 */
  library: LibraryAsset[];
  stats: {
    captureMs: number;
    downloadMs: number;
    totalMs: number;
    resourceCount: number;
    totalBytes: number;
    rewritten: number;
  };
};

export type CreateFromUrlInput = {
  url: string;
  /** 模板名后缀，避免与已有模板撞名（调用方给时间戳或随机短码） */
  suffix?: string;
  /** 是否沉淀素材库（默认 true——见文件底部"为什么 A 顺带沉淀素材"） */
  collectLibrary?: boolean;
  /** 单资源大小上限 */
  maxAssetBytes?: number;
};

export type CreateFromUrlResult =
  | { ok: true; bundle: StaticTemplateBundle; capture: SiteCaptureResult }
  /**
   * 与 B 路径同样的形状：**每一步都说人话**。
   * 自助场景下没有人兜底，失败信息是客户唯一能拿到的东西。
   */
  | { ok: false; step: "capture" | "export" | "slots"; message: string; detail?: string };

/**
 * 可注入的副作用点（**只为可测性存在**，见文件末尾「为什么加 deps」）。
 *
 * ⚠️ **默认值就是真实实现**——不传 `deps` 时行为与从前逐字节相同。
 * 测试里才传 fake，生产/路由一律不传。
 */
export type CreateFromUrlDeps = {
  captureSite: typeof captureSite;
  exportStaticTemplate: typeof exportStaticTemplate;
};

/**
 * 默认实现——**导出是为了让测试能断言它没被换成桩**。
 *
 * ⚠️ 不导出的话，测试只能靠行为间接推断，而那已经被证明拦不住桩
 * （见 `tests/template-from-url.test.ts` 的「默认 deps」用例，第一版就是假门禁）。
 */
export const DEFAULT_DEPS: CreateFromUrlDeps = { captureSite, exportStaticTemplate };

const CATEGORIES = ["制造业", "外贸目录", "科技企业", "专业服务", "其他"] as const;
type Category = (typeof CATEGORIES)[number];

/** 从抓到的页面标题推分类——A 路径没有模型，这是唯一能拿到"这是什么站"的地方。 */
export function categoryFromTitle(title: string): Category {
  const text = title.toLowerCase();
  if (/制造|机械|设备|五金|模具|风机|泵|阀|电气|工业|材料/.test(text)) return "制造业";
  if (/外贸|出口|贸易|跨境|export|import/.test(text)) return "外贸目录";
  if (/科技|软件|信息|智能|数据|互联网|tech|software|digital/.test(text)) return "科技企业";
  if (/服务|咨询|设计|法律|会计|广告|service|consult/.test(text)) return "专业服务";
  return "其他";
}

/** 页面的站点名：优先用标题的第一段，去掉常见的后缀噪音。 */
export function siteNameFromTitle(title: string, url: string): string {
  const cleaned = title
    .split(/[-|_–—]/)
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (cleaned && cleaned.length >= 2) return cleaned.slice(0, 60);
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "未命名站点";
  }
}

/** 从 URL 造一个合法模板 id。 */
export function templateIdFromUrl(url: string, suffix?: string): string {
  let host = "site";
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    // 用不上——下面的兜底会处理
  }
  const base = host
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
  const tail = suffix?.trim() ? `-${suffix.trim().replace(/[^a-z0-9-]/gi, "").toLowerCase()}` : "";
  const combined = `${base || "site"}${tail}`.slice(0, 40).replace(/-+$/, "");
  return /^[a-z0-9]/.test(combined) ? combined : `site${tail}`;
}

/**
 * 主流程：一个网址 → 一份可登记的静态模板。
 *
 * **永不抛异常**——与 B 路径同一个契约。所有失败变成 `{ ok: false, step, message }`。
 */
export async function createTemplateFromUrl(
  input: CreateFromUrlInput,
  deps: CreateFromUrlDeps = DEFAULT_DEPS,
): Promise<CreateFromUrlResult> {
  const startedAt = Date.now();

  // ---- ① 抓（与 B 路径 100% 复用这一步） ----
  const captured = await deps.captureSite(input.url, {
    shotDir: ".sitecraft-data/captures",
    // A 要下载资源（搬站本体），所以要全量抓；素材沉淀只读尺寸，不额外发请求
    downloadAssets: true,
    collectLibraryAssets: input.collectLibrary !== false,
  });
  if (captured.failure) {
    return { ok: false, step: "capture", message: captured.failure };
  }
  const captureMs = captured.elapsedMs;

  // ---- ② 本地化 + 清洗 ----
  const downloadStartedAt = Date.now();
  let exported: Awaited<ReturnType<typeof exportStaticTemplate>>;
  try {
    exported = await deps.exportStaticTemplate({
      html: captured.html,
      pageUrl: captured.url,
      assets: captured.assets,
      maxBytes: input.maxAssetBytes,
    });
  } catch (error) {
    return {
      ok: false,
      step: "export",
      message: `整理这个页面时出错了：${error instanceof Error ? error.message : "未知错误"}。可以稍后重试，或者直接把截图传给我。`,
    };
  }
  const downloadMs = Date.now() - downloadStartedAt;

  // ---- ③ 补槽位 ----
  // 用**现成的** `postProcessPrecipitatedTemplateHtml`（与 B 路径同一扇门）。
  // 它只做"判定规则唯一"的那几个：h1 → hero.title、mailto → contact.email…
  // 集合型槽位**刻意不猜**——挑错容器会让编辑与统计都落在错误节点上。
  const processed = postProcessPrecipitatedTemplateHtml(exported.html);
  const slots = collectSlotTargetsFromHtmlString(processed.html);
  const warnings = [...exported.warnings, ...processed.warnings];

  // 如实说明可编辑程度——这是 A 路径与 B 路径**最重要的区别**，
  // 不能让客户以为搬来的站能像 B 那样改。
  if (slots.length === 0) {
    warnings.push("这个页面没有可识别的编辑位——搬来的站**只能看、不能改**。要能改请改用截图生成。");
  } else {
    warnings.push(`可编辑程度有限：只识别出 ${slots.length} 个编辑位（${slots.slice(0, 5).join("、")}${slots.length > 5 ? "…" : ""}），其余内容改不了。想要能改的站请改用「截图生成模板」。`);
  }

  // ---- ④ 组装 ----
  const library = captured.library ?? [];
  if (library.length > 0) {
    warnings.push(`${summarizeLibrary(library)}——已存进素材库，之后建站可以直接用`);
  }

  const title = captured.title || "";
  const registerAssets = toRegisterAssets(exported.resources);
  const bundle: StaticTemplateBundle = {
    templateId: templateIdFromUrl(captured.url, input.suffix),
    name: (title ? siteNameFromTitle(title, captured.url) : "静态站").slice(0, 120),
    category: categoryFromTitle(title),
    description: `由网址搬下来的静态模板（${exported.resources.length} 个本地化资源）。保真度高，可编辑程度有限。`,
    html: processed.html,
    assets: registerAssets.assets,
    binaryAssets: registerAssets.binaryAssets,
    initialDraft: null,
    summary: describeStaticExport(exported.plan, exported.totalBytes),
    warnings,
    library,
    stats: {
      captureMs,
      downloadMs,
      totalMs: Date.now() - startedAt,
      resourceCount: exported.resources.length,
      totalBytes: exported.totalBytes,
      rewritten: exported.rewritten,
    },
  };

  return { ok: true, bundle, capture: captured };
}

export { isShotUsable };

/**
 * ## 为什么加 `deps`（2026-09-12）
 *
 * 本文件此前**零单测**——因为它直接 import `captureSite`（要开浏览器）。
 * 而它承载的正是"抓取失败怎么说人话""搬来的站可编辑到什么程度"这类
 * **面向客户的判断**，恰恰是最该被钉住的部分。
 *
 * 所以把两个副作用点提成参数：**默认值就是真实实现**（`DEFAULT_DEPS`），
 * 不传时行为与从前逐字节相同；测试传 fake 就能在没有浏览器的情况下
 * 跑完整条编排，包括每一条失败分支。
 *
 * ⚠️ 这不是"为了测试改生产代码"的妥协——它是把**已经存在的**依赖
 * 从模块级常量提成显式参数，调用方一行都不用改。
 * 同一条范式在 `lib/release-store.ts:75` 的构造注入里已经在用。
 */
