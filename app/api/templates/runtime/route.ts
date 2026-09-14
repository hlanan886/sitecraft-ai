import { z } from "zod";
import { accessErrorResponse, authorizeRequest } from "@/lib/request-context";
import { allTemplates, findTemplate } from "@/lib/site-model";
import { ensureRuntimeTemplateManifests } from "@/lib/template-runtime-server";
import {
  RUNTIME_TEMPLATE_DIR,
  getRuntimeTemplateRegistration,
  isRuntimeTemplatePath,
  resetRuntimeTemplatesForTest,
} from "@/lib/template-runtime";
import {
  collectSlotTargetsFromHtmlString,
  loadRuntimeTemplatesFromDisk,
  readTemplateEntryHtml,
  resetRuntimeTemplateLoaderForTest,
} from "@/lib/template-runtime-loader";
import { postProcessPrecipitatedTemplateHtml } from "@/lib/template-slot-injection";
import { evaluateTemplateQuality } from "@/lib/template-quality-gate";

export const runtime = "nodejs";

/**
 * 当前可见的运行时模板 id。
 *
 * 抽出来是因为 POST 与 GET 都要用同一份判定——两处各写一遍筛选，
 * 正是 Windows 上那个反斜杠 bug 能藏身的地方（一处按目录前缀、一处按注册表）。
 */
function listRuntimeTemplateIds(): string[] {
  return allTemplates().filter((item) => isRuntimeTemplatePath(item.source.localPath)).map((item) => item.id);
}

const registerSchema = z.object({
  /**
   * 模板 id。同时是**目录名**——装载器用目录名当权威 id，
   * 两者不一致会在装载时被拒（防「按 A 查到、资源从 B 读」的静默错位）。
   */
  templateId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "只允许小写字母、数字与短横线"),
  name: z.string().min(1).max(120),
  category: z.enum(["制造业", "外贸目录", "科技企业", "专业服务", "其他"]),
  description: z.string().min(1).max(500),
  /** 模板入口 HTML。**会经过槽位补全**（见 `postProcessPrecipitatedTemplateHtml`）。 */
  html: z.string().min(1).max(2_000_000),
  /** 模板自带资源，路径相对模板目录（如 `assets/style.css`）。 */
  assets: z.record(z.string().max(200), z.string().max(4_000_000)).optional(),
  /**
   * 二进制资源（图片/字体），**base64**，形如 `{ "assets/header.jpg": "data:image/jpeg;base64,..." }`。
   *
   * 单独一个字段而不是让 `assets` 自己认 `data:` 前缀：文本走 JSON 字符串、
   * 二进制走 base64，两者的体积差 33%，混在一起会让调用方每次都赌「这个键是哪种」，
   * 而赌错的后果是图片被当成 UTF-8 文本写坏（浏览器只显示裂图，不报错）。
   * 白名单扩展名，避免把 .html/.js 从这条路径写进去绕过上面的槽位补全。
   */
  binaryAssets: z
    .record(
      z.string().max(200).regex(/\.(png|jpe?g|webp|gif|svg|avif|ico|woff2?|ttf|otf)$/i, "只允许图片与字体扩展名"),
      z.string().max(8_000_000),
    )
    .optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  colors: z.object({
    primary: z.string().max(32),
    secondary: z.string().max(32),
    accent: z.string().max(32),
  }).optional(),
  /**
   * 跳过质量门（默认 false）。
   *
   * 存在两个**正当**用途，所以保留开关而不是永远强制：
   *  1. 阶段 A 那种"把现成静态站先接进来验证链路"的骨架模板；
   *  2. 人工复核确认某个 blocker 是误判时。
   *
   * 但它**不是后门**：跳过的模板会被标成 `recommendation: "isolated"`，
   * 排除在 AI 推荐之外（见 `template-runtime-server.ts`）——能建站、能被显式选用，
   * 但不会被自动推给用户。这样"我知道它有毛病，先放着"与"它和验证过的模板一样好"
   * 就不是一回事了。
   */
  skipQualityGate: z.boolean().optional(),
});

/**
 * 运行时模板的登记入口（方向 3 阶段 A）。
 *
 * 阶段 A 不做 AI：调用方（开发者脚本、e2e）直接把一份静态站交进来，
 * 由这里落盘 + 登记，验证「运行时注册的模板能被预览、能被生成、过门禁」。
 * 阶段 B 的「截图/网址 → 模板」产出物走的是**同一个入口**——
 * AI 只负责产出 HTML，落盘与契约注册这段复用，不另立一套。
 */
export async function POST(request: Request) {
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid template payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { templateId, name, category, description, html, assets, binaryAssets, tags, colors, skipQualityGate } = parsed.data;
  /**
   * 结构化失败原因，随响应回传。
   *
   * 为什么单独攒一份：`getRuntimeTemplateRegistration` 只能区分「注册上了/没注册上」，
   * 说不清是**被拒收**（id 冲突、目录名不符、缺 index.html）还是**根本没有**（写盘失败），
   * 而这两种对调用方意味着完全不同的下一步。没有它，接口只能回一句含糊的
   * 「模板装载失败」——正是之前那版的表现。
   */
  const failures: string[] = [];

  // 不允许覆盖已有 id：基线模板覆盖会破坏 22 个契约测试；运行时模板覆盖会
  // 在用户没预期的情况下换掉已有站点正在用的模板（站点只存 templateId）。
  if (allTemplates().some((item) => item.id === templateId)) {
    return Response.json({ error: "template_exists", message: `模板 ${templateId} 已存在，请换一个 id。` }, { status: 409 });
  }

  const { mkdir, writeFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const templateDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), RUNTIME_TEMPLATE_DIR, templateId);

  // 槽位补全：AI 产出的 HTML 未必带 `data-sitecraft-slot`，而整套就地编辑、
  // 覆盖统计、忠实度门禁都依赖它。写入前补齐是**唯一**能保证契约成立的位置——
  // 放到读取时补，会让「磁盘上的模板」和「运行时的模板」不是同一份。
  const processed = postProcessPrecipitatedTemplateHtml(html);

  // 质量门（阶段 C）：**在写任何文件之前**判。
  // 顺序很重要——先写盘再判，不合格的模板会留下一个目录，装载器每轮都要
  // 重新拒收它一次，而且"磁盘上有、注册表里没有"这种状态最难排查。
  const quality = evaluateTemplateQuality({ html: processed.html, templateId });
  if (!quality.passed && !skipQualityGate) {
    return Response.json(
      {
        error: "quality_gate_failed",
        message: "模板未通过入库质量门，未写入磁盘。",
        blockers: quality.blockers,
        warnings: quality.warnings,
        slotTargets: quality.slotTargets,
        // 明确告诉调用方出路，否则他只会看到"被拒"而不知道该改什么。
        hint: "补齐 data-sitecraft-slot 后重试；确属误判可带 skipQualityGate:true（该模板不会被 AI 推荐）。",
      },
      { status: 422 },
    );
  }

  const written: string[] = [];
  /** 解析出资源落点，顺带做防穿越——两条资源路径共用，避免只在这边校验、那边漏。 */
  const resolveAssetTarget = (relativePath: string): string => {
    const target = path.resolve(/* turbopackIgnore: true */ templateDir, relativePath);
    if (!target.startsWith(`${templateDir}${path.sep}`)) {
      throw new Error(`unsafe asset path: ${relativePath}`);
    }
    return target;
  };
  try {
    await mkdir(/* turbopackIgnore: true */ templateDir, { recursive: true });
    await writeFile(/* turbopackIgnore: true */ path.join(templateDir, "index.html"), processed.html, "utf8");
    written.push("index.html");
    for (const [relativePath, body] of Object.entries(assets ?? {})) {
      const target = resolveAssetTarget(relativePath);
      await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ target, body, "utf8");
      written.push(relativePath);
    }
    for (const [relativePath, encoded] of Object.entries(binaryAssets ?? {})) {
      const target = resolveAssetTarget(relativePath);
      // 接受两种写法：带 `data:<type>;base64,` 前缀的 data URL，或裸 base64。
      // 前缀里的 MIME 不参与写盘（`template-static` 按扩展名推 content-type），
      // 但要求调用方给出去掉前缀的纯 base64 会更容易出错，所以两种都收。
      const payload = encoded.includes(",") && encoded.startsWith("data:") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
      await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ target, Buffer.from(payload, "base64"));
      written.push(relativePath);
    }
    await writeFile(
      /* turbopackIgnore: true */ path.join(templateDir, "sitecraft.template.json"),
      JSON.stringify(
        {
          template: {
            id: templateId,
            name,
            category,
            description,
            tags: tags ?? [],
            ...(colors ? { colors } : {}),
            source: { name: "Sitecraft 沉淀模板", license: "Internal", framework: "Static HTML" },
          },
          // 槽位声明留空 = 让装载器从 HTML 里实际存在的 `data-sitecraft-slot` 推导。
          // 手写一份清单反而会与 HTML 漂移（见 `collectSlotTargetsFromHtml` 的说明）。
          quality: { passed: quality.passed, skipped: Boolean(skipQualityGate), blockers: quality.blockers },
        },
        null,
        2,
      ),
      "utf8",
    );
    written.push("sitecraft.template.json");
  } catch (error) {
    // 半成品模板比没有模板更危险（装载器会拒收它，但目录会留在磁盘上让人困惑）。
    await rm(/* turbopackIgnore: true */ templateDir, { recursive: true, force: true }).catch(() => {});
    return Response.json(
      { error: "template_write_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  // 让新模板立刻可用：重置 loader 标记后重新扫描，再展开 manifest。
  // 不重启进程是有意的——阶段 B 的流程是「用户上传 → 立刻预览」，
  // 要求重启 dev server 会让整个功能不可用。
  resetRuntimeTemplateLoaderForTest();
  const scan = loadRuntimeTemplatesFromDisk(true);
  for (const error of scan.errors) failures.push(error.reason);
  const manifests = ensureRuntimeTemplateManifests();
  const registered = getRuntimeTemplateRegistration(templateId);

  if (!registered) {
    return Response.json(
      { error: "template_rejected", message: failures[0] ?? "模板装载后未出现在注册表中" },
      { status: 422 },
    );
  }

  return Response.json(
    {
      ok: true,
      templateId,
      written,
      // 槽位是**从写入后的 HTML 里清点出来的事实**，不是"我们注入了什么"的意图。
      // 区分这两者很重要：模板能预览 ≠ 能被 AI 填充，后者取决于 HTML 里有没有槽位。
      slots: processed.slots,
      warnings: processed.warnings,
      /** 槽位契约是否已在**本进程**注册（false = 下一次请求时注册，见 GET 的诊断）。 */
      manifestRegistered: manifests.registered.includes(templateId),
      /** 本进程当前可见的全部运行时模板（判断是否需要重启/换进程）。 */
      runtimeTemplates: listRuntimeTemplateIds(),
    },
    { status: 201 },
  );
}

/**
 * 数一个运行时模板 HTML 里**实际存在**的槽位。
 *
 * 为什么不用注册表里的 `slots` 字段：那个字段是**可选的**——登记单缺省时
 * 装载器从 HTML 推导（见 `RuntimeTemplateRegistration.slots` 的说明）。
 * 实测（2026-09-11）：所有模板的 `slots` 都是 `undefined`，一律显示 0，
 * 而这个数字正是"能改几个字段"的**唯一线索**，显示 0 等于告诉用户"完全不能改"。
 *
 * 所以直接读 HTML 数——`collectSlotTargetsFromHtmlString` 是装载器用的同一个函数，
 * 口径与"能被 AI 填充/就地编辑"完全一致。
 */
function countSlots(templateId: string): number {
  const template = findTemplate(templateId);
  if (!template?.source.localPath) return 0;
  const html = readTemplateEntryHtml(template.source.localPath);
  return html ? collectSlotTargetsFromHtmlString(html).length : 0;
}

/**
 * 列出当前可用的运行时模板（含装载失败项），供诊断与阶段 C 的质量门使用。
 *
 * 2026-09-11：**补上卡片需要的字段**。此前只回 `{id,name,category}`，
 * 于是 `/templates` 页想展示"你自己做的模板"时拿不到描述、标签、来源——
 * 要么再开一个接口（两处筛选逻辑必然漂移），要么干脆不展示（用户做完模板找不到它）。
 * 这里一次给全，页面上直接画。
 */
export async function GET(request: Request) {
  const access = authorizeRequest(request, "read");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  const load = loadRuntimeTemplatesFromDisk();
  ensureRuntimeTemplateManifests();
  return Response.json(
    {
      dir: RUNTIME_TEMPLATE_DIR,
      registered: load.registered,
      errors: load.errors,
      templates: allTemplates()
        .filter((item) => isRuntimeTemplatePath(item.source.localPath))
        .map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          description: item.description,
          tags: item.tags,
          colors: item.colors,
          source: { name: item.source.name, framework: item.source.framework },
          /**
           * 可编辑程度——**A 路径的产物与 B 的产物差别最大的地方**。
           *
           * 搬来的站往往只有 1 个编辑位，而这个数字客户看不见就以为"能改"。
           * 放在列表里让它一眼可见，是"如实告知"的落点。
           */
          slots: countSlots(item.id),
        })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** 测试用：清空运行时注册表（仅测试环境可达）。 */
export async function DELETE(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const access = authorizeRequest(request, "edit");
  const denied = accessErrorResponse(access);
  if (denied) return denied;
  resetRuntimeTemplatesForTest();
  resetRuntimeTemplateLoaderForTest();
  return Response.json({ ok: true });
}
