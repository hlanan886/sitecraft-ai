/**
 * 「截图 → 模板」的编排层。
 *
 * ## 它在整条链路里的位置
 *
 * ```
 * 用户传图 / capture 的截图
 *      ↓  lib/site-vision.ts        尺寸闸 + 提示词 + 模型输出归一
 *      ↓  lib/ai-provider.ts        多模态调用（关推理）
 *      ↓  lib/site-vision.ts        拧成合法 DSL
 *      ↓  lib/template-composer.ts  拼成带槽位的 HTML   ← 产出物由代码决定
 *      ↓  lib/site-screenshot.ts    按真实坐标裁出产品图（可选）
 *      ↓  本文件                     产出 TemplateBundle
 *      ↓  POST /api/templates/runtime   落盘 + 补槽位 + 质量门 + 热注册
 *      ↓  POST /api/sites               建站 → 进工作台
 * ```
 *
 * **本文件不落盘、不建站**——它只负责把"图"变成"一份可以登记的东西"。
 * 落盘与登记走**已有的** `/api/templates/runtime`（补槽位、质量门、热注册全在那里），
 * 建站走**已有的** `/api/sites`。这样这条新链路**一行下游代码都不用改**，
 * 也不会长出一套平行的登记逻辑。
 *
 * ## 为什么单独一层，而不是塞进路由
 *
 * 路由要做鉴权、解析请求体、决定返回什么状态码；这些和"图怎么变成模板"无关。
 * 分开之后，整条链路可以在**没有 HTTP 的情况下**被脚本直接跑通——
 * 这正是本阶段验收方式（见 `.sitecraft-data/composer/` 下的实测脚本）。
 */
import type { Product } from "./site-document.ts";
import { readStoredImage } from "./product-image-store.ts";
import { requestVisionDsl } from "./ai-provider.ts";
import { getPromptDefinition } from "./prompt-registry.ts";
import {
  coerceVisionDsl,
  buildVisionSystemPrompt,
  buildVisionUserPrompt,
  dedupeProducts,
  estimateSectionRange,
  judgeScreenshot,
  planProductShots,
  toDataUrl,
  type DslFromVision,
} from "./site-vision.ts";
import { composeTemplate } from "./template-composer.ts";
import { captureSite } from "./site-capture-browser.ts";
import { isShotUsable } from "./site-capture.ts";
import { takeProductShots } from "./site-screenshot.ts";

/**
 * 可注入的副作用点（**只为可测性存在**，与 A 轨同一条范式）。
 *
 * ⚠️ **默认值就是真实实现**——不传 `deps` 时行为与从前逐字节相同。
 * 测试里才传 fake，生产/路由一律不传。
 *
 * ## 为什么只注入这四个，不注入 `sharp`
 *
 * 注入面**只收副作用点**（网络 + 磁盘 IO）：抓页面、读已存图、调模型、裁产品图。
 * `sharp` 虽然重，但它是**确定性的本地库**——造一张真图就能把尺寸闸的两向都跑实，
 * 不需要桩。把它也提成参数只会让函数体多一层间接，换不来任何可测性。
 *
 * ## 为什么是四个，不是五个
 *
 * 被测的是**编排层**（分支与文案），不是纯逻辑：
 * `coerceVisionDsl` / `dedupeProducts` / `planProductShots` / `composeTemplate`
 * 都已有专门测试，在这一层继续打桩只会测到"桩接对了没"。
 * 所以它们走真实实现，注入的 fake 只需喂它们**合法输入**。
 */
export type CreateFromScreenshotDeps = {
  readStoredImage: typeof readStoredImage;
  requestVisionDsl: typeof requestVisionDsl;
  takeProductShots: typeof takeProductShots;
  captureSite: typeof captureSite;
};

/**
 * 默认实现——**导出是为了让测试能断言它没被换成桩**。
 *
 * ⚠️ 同 A 轨的教训：不导出的话，测试只能靠行为间接推断，而那拦不住桩
 * （A 轨第一版就是假门禁，见 `tests/template-from-url.test.ts` 的「默认 deps」用例）。
 */
export const DEFAULT_DEPS: CreateFromScreenshotDeps = {
  readStoredImage,
  requestVisionDsl,
  takeProductShots,
  captureSite,
};

/** 一次生成的产物——**已经是可以直接交给登记接口的东西**。 */
export type TemplateBundle = {
  templateId: string;
  name: string;
  category: string;
  description: string;
  /** 带 `data-sitecraft-slot` 的自包含 HTML（含首页 + 全部内容） */
  html: string;
  /** 模板自带资源：`{ "styles.css": "..." }` */
  assets: Record<string, string>;
  /** 二进制资源：`{ "assets/p1.jpg": "data:image/jpeg;base64,..." }`（存图接口用的就是这个形状） */
  binaryAssets: Record<string, string>;
  /** 站点初始草稿——建站时原样传给 `POST /api/sites` */
  initialDraft: DslFromVision["content"];
  tokens: DslFromVision["tokens"];
  /** 给用户/日志看的一句话 */
  summary: string;
  warnings: string[];
  /** 观察数据：成本与耗时 */
  stats: { model: string; latencyMs: number; visionMs: number; composeMs: number; shotMs: number };
};

export type CreateFromScreenshotInput = {
  /** 截图的来源，二选一 */
  source: { kind: "upload"; urlPath: string } | { kind: "url"; url: string };
  /** 用户补充的话（可为空） */
  note?: string;
  /** 站点形态 */
  siteModel?: "corporate" | "portfolio" | "blog";
  /** 是否自动从页面裁产品图（只有 `url` 来源能做，因为要 DOM 坐标） */
  withProductImages?: boolean;
  /** 模板名后缀，避免与已有模板撞名（调用方给时间戳或随机短码） */
  suffix?: string;
  signal?: AbortSignal;
};

export type CreateFromScreenshotResult =
  | { ok: true; bundle: TemplateBundle; understanding: DslFromVision }
  /**
   * 每一步都**说人话**。自助场景下没有人兜底——
   * 客户有疑问不会问我们，**他只会关掉页面**（见计划 §13.4 铁律 1）。
   */
  | { ok: false; step: "read" | "capture" | "vision" | "compose"; message: string; detail?: string };

const CATEGORIES = ["制造业", "外贸目录", "科技企业", "专业服务", "其他"] as const;
type Category = (typeof CATEGORIES)[number];

function pickCategory(raw: unknown): Category {
  const value = typeof raw === "string" ? raw.trim() : "";
  return (CATEGORIES as readonly string[]).includes(value) ? (value as Category) : "其他";
}

/**
 * 主流程：一张图 → 一份可登记的模板。
 *
 * **永不抛异常**——所有失败都变成 `{ ok: false, step, message }`，
 * 且 message 是**给客户看的中文**。调用方（路由）直接把它转成响应，
 * 不需要再包一层 try/catch。
 */
export async function createTemplateFromScreenshot(
  input: CreateFromScreenshotInput,
  deps: CreateFromScreenshotDeps = DEFAULT_DEPS,
): Promise<CreateFromScreenshotResult> {
  const startedAt = Date.now();

  // ---- 1. 取到那张图 ----
  let imageBuffer: Buffer;
  let captureResult: Awaited<ReturnType<typeof captureSite>> | null = null;
  /**
   * 网址来源时页面标题给的**免费上下文**。
   *
   * 它是唯一一个"不花模型钱就能拿到"的站点信息——图里读公司名要模型猜，
   * 而 `document.title` 是原站自己写的。喂给模型能显著提高公司名读对的概率。
   */
  let titleHint = "";

  if (input.source.kind === "upload") {
    const stored = await deps.readStoredImage(input.source.urlPath);
    if (!stored) {
      return { ok: false, step: "read", message: "找不到这张图，可能上传时出错了。请重新上传一次。" };
    }
    imageBuffer = stored;
  } else {
    const captured = await deps.captureSite(input.source.url, {
      shotDir: ".sitecraft-data/captures",
      // 只有要配图时才下载资源——不配图时省掉这一步（实测整页抓取 5.5s，下载是其中大头）
      downloadAssets: Boolean(input.withProductImages),
    });
    if (captured.failure) {
      return { ok: false, step: "capture", message: captured.failure };
    }
    if (!captured.shot) {
      return { ok: false, step: "capture", message: "这个网址没能截出图来。可以改成直接把截图传给我。" };
    }
    // 直接用 capture 返回的 buffer，**不从磁盘读回来**——
    // `readFile(path.resolve(process.cwd(), 动态路径))` 会让 Turbopack 把整个项目
    // 追踪进部署产物（实测警告 `Dynamic filesystem access causes tracing of the whole project`）。
    imageBuffer = captured.shot.body;
    captureResult = captured;
    // 网址来源时**页面标题是免费的上下文**——比图里读出来的公司名可靠得多，
    // 而且能让模型少猜一步。上传截图没有这一项。
    titleHint = captured.title || "";
  }

  // ---- 2. 尺寸闸 ----
  // 链接来源的图已经过 capture 的缩放（`planCaptureSize`），上传来源的还没有——
  // 这里再判一次，是为了让"这张图能不能用"的答案**只由一个地方给出**。
  const { default: sharp } = await import("sharp");
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const verdict = judgeScreenshot(width, height);
  if (!verdict.ok) {
    return { ok: false, step: "read", message: verdict.message };
  }

  // ---- 3. 看图出 DSL ----
  const visionStartedAt = Date.now();
  // 统一转 JPEG：模型对 PNG 长图同样接受，但 JPEG 体积小一半以上，
  // 上传耗时直接减半（实测 1440×4529 的 PNG 是 JPEG 的 3 倍大小）。
  const modelBuffer = meta.format === "jpeg" ? imageBuffer : await sharp(imageBuffer).jpeg({ quality: 88 }).toBuffer();
  const mime = meta.format === "jpeg" ? "image/jpeg" : "image/jpeg";

  const prompt = getPromptDefinition("vision_dsl");
  const called = await deps.requestVisionDsl({
    imageDataUrl: toDataUrl(modelBuffer.toString("base64"), mime),
    systemPrompt: buildVisionSystemPrompt(),
    userPrompt: buildVisionUserPrompt({ siteModel: input.siteModel, note: input.note, titleHint }),
    signal: input.signal,
  });
  const visionMs = Date.now() - visionStartedAt;

  if (!called.ok) {
    return {
      ok: false,
      step: "vision",
      message: `读这张图时出错了（${prompt.id}@${prompt.version}）：${called.error}`,
      detail: called.code,
    };
  }

  const coerced = coerceVisionDsl(called.raw, { locale: "zh" });
  if (!coerced.ok) {
    return {
      ok: false,
      step: "vision",
      message: `没能从这张图里读出一份完整的版面。可能截图内容太杂，或者只截了一部分。建议换一张完整的整页截图。`,
      detail: coerced.issues.join("；"),
    };
  }

  // ---- 4. 配图（在拼装**之前**跑，因为图片路径要写进 HTML） ----
  //
  // 顺序很关键：`composeTemplate` 会读 `product.image` 决定渲染 `<img>` 还是色块，
  // 所以必须先拿到图、写回草稿、再拼装。反过来做就只能事后改 HTML 字符串——
  // 那条路要正则改标签，而正则改 HTML 正是这个项目已经踩过坑的地方。
  const shotStartedAt = Date.now();
  const binaryAssets: Record<string, string> = {};
  const warnings: string[] = [];
  // ⚠️ `coerced.dsl.content` 是**新对象**（coerceVisionDsl 里 structuredClone 过），
  // 改它不会污染 `understanding`——但为免读者误会，下面统一用 `draft` 这个名字。
  const draft = coerced.dsl.content;
  warnings.push(...coerced.warnings);

  // 同型号合并。真实模板的演示数据经常 8 张卡全是同一个型号（实测），
  // 全留会让成品站的产品区**看起来像 bug**；全去重又只剩 1 个，比原站少太多。
  //
  // ⚠️ 但在去重**之前**要先解决一个上游问题：模型经常把 8 张卡的型号全读成同一个，
  // 而**产品名各不相同**（"单吸风机"/"双吸风机"/"防爆风机"）。那是 4 个不同的产品，
  // 只是型号栏被模板作者抄了同一串字。此时"同型号"不是真的同型号——
  // 留着会让槽位撞车（4 个 `products.TDS-48RD.name`，就地编辑必然改错一个），
  // 所以按**产品名**改写成互不相同的 SKU。
  const distinctNames = new Set(draft.products.map((product) => product.name.zh.trim()).filter(Boolean));
  if (distinctNames.size > 1 && distinctNames.size === draft.products.length) {
    const bySku = new Map<string, Product[]>();
    for (const product of draft.products) {
      bySku.set(product.sku, [...(bySku.get(product.sku) ?? []), product]);
    }
    const collide = [...bySku.entries()].filter(([, group]) => group.length > 1);
    if (collide.length > 0) {
      for (const [sku, group] of collide) {
        group.forEach((product, index) => {
          // 第一个保留原型号，其余按产品名派生——`TDS-48RD` → `TDS-48RD-P2`…
          // 这样既保住了模型读对的型号，又保证槽位唯一。
          if (index === 0) return;
          const slug = product.name.zh.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "");
          product.sku = `${sku}-${slug || `p${index + 1}`}`.slice(0, 120);
        });
      }
      warnings.push(`有 ${collide.length} 组产品型号相同但名称不同，已按名称拆分型号（否则就地编辑会改错卡片）`);
    }
  }

  const deduped = dedupeProducts(draft.products);
  if (deduped.merged > 0) {
    draft.products = deduped.products;
    warnings.push(`截图里有 ${deduped.merged} 个产品的型号重复（${deduped.mergedSkus.slice(0, 3).join("、")}），已合并为 ${deduped.products.length} 个互不相同的型号`);
  }

  if (input.withProductImages && captureResult?.shot) {
    const needed = draft.products.length;
    const pageHeight = captureResult.shot.height;
    const candidates = captureResult.assets
      .filter((asset) => asset.kind === "image" && !asset.decorative && asset.natural && asset.box)
      .map((asset) => ({
        url: asset.url,
        width: asset.natural?.width ?? 0,
        height: asset.natural?.height ?? 0,
        // 页面纵向位置——用来把选出的一组图按页面上的先后排序
        y: asset.box?.y,
      }));

    // 🔴 先看模型对"这是不是一张企业官网截图"有多大把握。
    //
    // 这一步是**三次失败之后加的**（见 site-vision.ts 里 planProductShots 的说明）：
    // 按面积最大、按同尺寸成组、按落进产品区——三种启发式在资源站页面上全失败，
    // 因为那种页面的"产品区"里放的是**模板推荐卡**，尺寸一致、位置也对。
    // 没有公式能兜住；唯一可靠的信号是"这张图本身是不是企业官网"。
    if (coerced.dsl.confidence === "low") {
      warnings.push("这张图看起来不是企业官网的截图（可能是模板展示页或设计稿），所以没有自动配图——产品卡先用色块，你可以在工作台里换成自己的图");
    } else {
      // 产品区在页面上的纵向范围。按模型给的板块顺序等分页面高度——
      // 这是个粗筛，只用来排掉明显不属于产品区的大图（广告横幅、页脚二维码）。
      const productsRange = estimateSectionRange(coerced.dsl.blocks.map((block) => block.type), "products", pageHeight);
      if (!productsRange) {
        warnings.push("没能确定产品区在页面上的位置，为避免放错图，产品卡先用色块占位——你可以在工作台里手动换成自己的图");
      }
      const plan = planProductShots({ available: candidates, needed, productsRange });
    if (plan.length > 0) {
      const captured = await deps.takeProductShots({
        pageUrl: input.source.kind === "url" ? input.source.url : "",
        // 裁图要按**页面里的真实坐标**，所以必须重新打开页面——
        // 用截图文件的像素坐标去裁是错的（实测差 1.8 倍）。
        items: plan.map((item) => ({ url: item.url, rank: item.rank })),
      });
      for (const shot of captured.shots) {
        // 路径**相对模板目录**：登记时按这个相对路径落盘，服务端
        // `/api/templates/<id>/assets/...` 也按同一相对路径读回来（已核实：
        // `readTemplateStaticFile` 经 `allTemplates()` 覆盖运行时模板）。
        const relative = `assets/product-${shot.rank + 1}.jpg`;
        binaryAssets[relative] = `data:image/jpeg;base64,${shot.base64}`;
        // 把图挂到对应的产品上——顺序即对应关系（plan 的第 k 张给第 k 个产品）
        const target = draft.products[shot.rank];
        if (target) target.image = relative;
      }
      if (captured.shots.length > 0) {
        warnings.push(`已从原站裁出 ${captured.shots.length} 张产品图（按页面里的真实坐标裁，未经二次压缩）`);
      }
      if (captured.shots.length < needed) {
        warnings.push(`${needed - captured.shots.length} 个产品没配上图，先用色块占位`);
      }
      // 裁图失败的原因**如实带出去**——此前被空 catch 吞掉，
      // 表现为"一张图都没裁出来"却毫无线索（实测踩过，见 site-screenshot.ts 的说明）
      for (const failure of captured.failures.slice(0, 3)) {
        warnings.push(`有张图没裁成：${failure.reason}`);
      }
      } else if (needed > 0) {
        // 走得到这里说明 confidence 不是 low（上面那个分支已经排除了）——
        // 所以这句只在"确实是企业官网、但产品区里没凑出一组产品图"时说。
        warnings.push("原站没有找到可用的产品图，产品卡片会先用色块占位");
      }
    }
  } else if (draft.products.length > 0) {
    warnings.push("产品卡片暂用色块占位——链接来源可以自动配图，上传截图则需要手动换图");
  }
  const shotMs = Date.now() - shotStartedAt;

  // ---- 5. 拼装 ----
  const composeStartedAt = Date.now();
  const composed = composeTemplate({
    templateId: coerced.dsl.templateId,
    name: coerced.dsl.name,
    siteName: coerced.dsl.siteName,
    tokens: coerced.dsl.tokens,
    blocks: coerced.dsl.blocks,
    content: draft,
  });
  const composeMs = Date.now() - composeStartedAt;

  if (!composed.ok) {
    return {
      ok: false,
      step: "compose",
      message: "版面拼装失败，这份说明书的某些字段不合法。",
      detail: composed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"),
    };
  }

  warnings.push(...composed.warnings);

  // ---- 6. 组装产物 ----
  const suffix = input.suffix?.trim() ? `-${input.suffix.trim().replace(/[^a-z0-9-]/gi, "").toLowerCase()}` : "";
  const candidateId = `${coerced.dsl.templateId}${suffix}`.slice(0, 40).replace(/-+$/, "");
  const finalId = /^[a-z0-9][a-z0-9-]*$/.test(candidateId) ? candidateId : `tpl${suffix}`;

  return {
    ok: true,
    understanding: coerced.dsl,
    bundle: {
      templateId: finalId,
      name: `${coerced.dsl.name}${suffix}`.slice(0, 120),
      category: categoryFor(draft.industry),
      description: `由截图生成的模板（${coerced.dsl.blocks.length} 个板块）。`,
      html: composed.html,
      assets: { "styles.css": composed.css },
      binaryAssets,
      initialDraft: { ...draft, templateId: finalId },
      tokens: coerced.dsl.tokens,
      summary: `${coerced.dsl.siteName} · ${coerced.dsl.blocks.length} 个板块 · ${draft.products.length} 个产品${Object.keys(binaryAssets).length ? ` · 配图 ${Object.keys(binaryAssets).length} 张` : ""}`,
      warnings,
      stats: { model: called.model, latencyMs: Date.now() - startedAt, visionMs, composeMs, shotMs },
    },
  };
}

/** 登记接口需要的分类——由行业名推，推不出来归"其他"。 */
export function categoryFor(industry: string): Category {
  const text = industry.toLowerCase();
  if (/制造|机械|设备|五金|模具|风机|泵|阀|电气/.test(text)) return "制造业";
  if (/外贸|出口|贸易|跨境/.test(text)) return "外贸目录";
  if (/科技|软件|信息|智能|数据|互联网/.test(text)) return "科技企业";
  if (/服务|咨询|设计|法律|会计|广告/.test(text)) return "专业服务";
  return "其他";
}

export { isShotUsable };
