/**
 * 运行时模板的 **manifest + 门禁注册**（2026-09-10，方向 3 阶段 A）。
 *
 * 与 `template-runtime-loader.ts` 的分工：
 *   - loader：只负责「磁盘上有哪些模板」→ 纯模板记录（目录、白名单够用）
 *   - 本文件：把模板记录**展开成完整契约** → manifest（槽位/覆盖/注入桥）
 *     + 忠实度门禁的节注册
 *
 * ## 为什么分两段
 *
 * 纯模板记录必须是**同步且轻量**的：`getTemplate()` 被 20+ 处调用、且在客户端
 * bundle 里。而完整契约要拖进 `template-manifests/index.ts`（22 个 manifest 的
 * 静态 import 表）与忠实度门禁——两者只对服务端渲染/发布有意义。
 *
 * ## 为什么这里**不**注册 adapter
 *
 * `getTemplateAdapter()` 未命中时返回 `undefined`，bridge 侧全部用 `?? ""` 取值，
 * 通用槽位引擎接管。运行时模板的 HTML 是我们生成的、**自带 `data-sitecraft-slot`**，
 * 通用引擎靠属性选择器就能定位，根本不需要模板专属适配代码——
 * 这正是方向 3 相对「接一个开源模板要写 200 行适配器」的核心成本优势。
 * 所以这里**刻意不提供** adapter 注册入口：一旦提供，就会有人开始给沉淀模板写
 * 适配器，把线性成本又请回来。
 */
import type {
  TemplateManifest,
  TemplatePresentationBlock,
  TemplateSlotBinding,
} from "./template-manifests/types.ts";
import { registerTemplateManifest } from "./template-manifests/index.ts";
import { registerSectionType } from "./template-fidelity-guard.ts";
import { getTargetResolvers, registerTargetResolver } from "./template-content-coverage.ts";
import type { Locale } from "./site-model.ts";
import type { LocalizedText, SiteDraft } from "./site-document.ts";
import { allTemplates } from "./site-model.ts";
import {
  RUNTIME_TEMPLATE_DIR,
  defaultRuntimeSlots,
  getRuntimeTemplateRegistration,
  isCollectionTarget,
  type RuntimeTemplateRegistration,
} from "./template-runtime.ts";
import { collectSlotTargetsFromHtmlString, loadRuntimeTemplatesFromDisk, readTemplateEntryHtml } from "./template-runtime-loader.ts";

function toSlotBindings(
  targets: readonly string[],
  declared: RuntimeTemplateRegistration["slots"],
): TemplateSlotBinding[] {
  const defaults = new Map(defaultRuntimeSlots(targets).map((slot) => [slot.target, slot]));
  const byTarget = new Map((declared ?? []).map((slot) => [slot.target, slot]));
  return targets.map((target) => {
    const fallback = defaults.get(target);
    const slot = byTarget.get(target);
    return {
      target: target as TemplateSlotBinding["target"],
      // 运行时模板由我们生成、节点自带属性，选择器退化为恒成立的前缀匹配。
      selector: slot?.selector ?? fallback?.selector ?? `[data-sitecraft-slot^="${target}."]`,
      contentType: isCollectionTarget(target) ? "collection" : "text",
      semanticType: target.replace(/\./g, "_"),
      aliases: [] as readonly string[],
      locales: ["zh", "en"] as const,
      required: slot?.required ?? fallback?.required ?? true,
      editable: true,
      maxLength: slot?.maxLength ?? fallback?.maxLength ?? 2000,
      demoFingerprints: slot?.demoFingerprints ?? [],
    };
  });
}

function toPresentation(
  declared: RuntimeTemplateRegistration["presentation"],
): TemplatePresentationBlock[] | undefined {
  if (!declared?.length) return undefined;
  return declared.map((block) => ({
    presentationSlot: block.presentationSlot,
    role: block.role as TemplatePresentationBlock["role"],
    presentAs: block.presentAs,
    capacity: block.capacity,
    itemShape: block.itemShape,
    anchor: block.anchor ?? "",
  }));
}

/**
 * 装载运行时模板并注册它们的 manifest / 节类型。
 *
 * 幂等（loader 有进程级标志，manifest 注册是覆盖写）。返回装载结果供调用方
 * 记录或回显，但**调用方不应因 `errors` 非空而失败**——一个坏模板不该让整站不可用。
 */
export function ensureRuntimeTemplateManifests(): {
  registered: string[];
  errors: Array<{ templateId: string; reason: string }>;
} {
  const { registered, errors } = loadRuntimeTemplatesFromDisk();
  for (const templateId of registered) {
    const reg = getRuntimeTemplateRegistration(templateId);
    if (!reg) continue;

    // 槽位清单以 HTML 里实际存在的属性为准；HTML 里一个槽都没打（阶段 A 的手工
    // 静态站就是这种情况）时退回登记单声明的 targets，避免生成层拿到空槽位表。
    const entryHtml = readTemplateEntryHtml(reg.template.source.localPath);
    const fromHtml = entryHtml ? collectSlotTargetsFromHtmlString(entryHtml) : [];
    const declaredTargets = (reg.slots ?? []).map((slot) => slot.target);
    const targets = fromHtml.length ? fromHtml : declaredTargets;
    // 让覆盖统计认得这些新槽位，否则它们全被判“缺失”（见文件末尾的函数说明）。
    registerTemplateSlotResolvers(targets);

    const manifest: TemplateManifest = {
      templateId,
      displayName: reg.template.name,
      manifestVersion: 1,
      // 沉淀模板的产物形态是「静态 HTML + 自带槽位属性」，不经过 Astro/Vite 构建。
      runtime: "static-html",
      nativeLocales: ["zh"],
      outputLocales: ["zh", "en"],
      localizedUi: ["navigation", "form", "footer"],
      requiredVisibleTargets: reg.requiredVisibleTargets ?? ["hero.title"],
      slots: toSlotBindings(targets, reg.slots),
      // 运行时模板的 logo / 首屏图由模板自己带，不参与内容覆盖统计；
      // 询盘表单交给 sitecraft-hosted（bridge 统一拦截），与基线契约一致。
      nonContentSlots: [
        { target: "brand.logo", selector: "header img, nav img", slotType: "asset", coverage: "excluded", support: "template-owned" },
        { target: "hero.image", selector: "[data-sitecraft-slot^='hero.image']", slotType: "asset", coverage: "excluded", support: "template-owned" },
        { target: "contact.formAction", selector: "[data-sitecraft-slot^='contact.form']", slotType: "behavior", coverage: "excluded", support: "sitecraft-hosted" },
      ],
      presentation: toPresentation(reg.presentation),
      /**
       * 推荐资格由**入库时的质量门结论**决定（阶段 C）。
       *
       * 通过门禁 → `eligible`，与 22 个基线模板同等参与 AI 推荐排序；
       * 靠 `skipQualityGate` 进来的 → `isolated`，**不会被推荐**。
       *
       * 这样"我知道它有毛病，先放进来看效果"与"它和验证过的一样好"
       * 就不是一回事了——前者能建站、能被显式选用，但不会在用户不知道的情况下
       * 被推上去。没有这个区分，`skipQualityGate` 就变成了后门。
       */
      recommendation: reg.quality?.passed ? "eligible" : "isolated",
    };
    registerTemplateManifest(manifest);

    // 节类型注册：把该模板的节注册进忠实度门禁，否则 L3 结构层会认为
    // 这些节「未注册」而一律判 FAIL。
    for (const target of targets) {
      const sectionKey = target.split(".")[0];
      const sectionTargets = targets.filter((item) => item.split(".")[0] === sectionKey);
      if (!sectionKey || !sectionTargets.length) continue;
      registerSectionType({
        key: sectionKey,
        label: sectionKey,
        // generated 兜底不算违规：运行时模板本就由通用引擎渲染，
        // 强制 requiresNative 会让每个沉淀模板都卡在门禁上（正是要避免的形而上约束）。
        requiresNative: false,
        targets: sectionTargets,
        presentationRole: isCollectionTarget(target) ? "card_grid" : "split_text_media",
      });
    }
  }
  return { registered, errors: errors.map((item) => ({ templateId: item.templateId, reason: item.reason })) };
}

export { RUNTIME_TEMPLATE_DIR };

/**
 * 模板匹配用的完整目录（基线 + 运行时），**同步且不触发 manifest 展开**。
 *
 * 为什么单独导出而不是复用 `allTemplates()`：`site-intent.ts` 的排序只读
 * `category / tags / promptProfile` 等元数据，不需要槽位契约。让它走轻量的
 * 「模板记录」层，可以避免把 manifest 表与忠实度门禁拖进调用图
 * （`site-intent.ts` 还被若干纯函数测试直接 import）。
 */
export function runtimeTemplateCatalog() {
  return allTemplates();
}

/**
 * 把模板扫到的**全部**槽位补上取值解析器（幂等）。
 *
 * ## 为什么必须做
 *
 * 覆盖统计（`classifyDraftCoverage`）按 target 查注册表取值；查不到就返回
 * `undefined`，而它对 `required` 槽位的处理是「推入 `unmappedRequiredTargets`」
 * ——也就是**判缺失**。于是只要模板声明了一个解析器表里没有的槽位，它必然被判缺失：
 * 内容明明填进去了、页面也显示了，质量分却上不去、发布会一直被拦（实测踩到：
 * `about.title` / `features.title` / `hero.subtitle` 三个槽位始终"缺"，分数 34 分不能发布）。
 *
 * ## 为什么补成"同一字段喂多个槽位"而不是"删掉这些槽位"
 *
 * 槽位是**模板契约**——模板 HTML 里确实有 `about.title` 这个位置，删掉它，
 * 注入桥就找不到那个节点了。解析器只回答"这个槽位的内容该从草稿的哪里取"，
 * 而同一个源字段在不同模板里叫不同名字（有的 `about.title`、有的 `about.heading`），
 * 指向同一个值是**正确**的映射，不是将就。
 *
 * ## 范围刻意收窄
 *
 * 只补各节的**标题类**槽位（`about.title` / `features.title` / `hero.subtitle` …）。
 * 未知 target（如 `products.0.name`——商品名按 SKU 动态生成）**不补**：
 * 那类槽位本该由更精确的解析器处理，用兜底值喂进去反而会掩盖真实的映射缺口。
 */
function knownTitleSource(target: string): ((draft: SiteDraft, locale: Locale) => string[]) | undefined {
  if (!/^(about|features|services|hero|contact)\.(title|subtitle)$/.test(target)) return undefined;
  const [section, field] = target.split(".");
  return (draft, locale) => {
    const block = (draft.content as unknown as Record<string, Record<string, LocalizedText | string>>)[section];
    const value = block?.[field];
    if (value === undefined) return [];
    return typeof value === "string" ? [value] : [value[locale] ?? ""];
  };
}

export function registerTemplateSlotResolvers(targets: readonly string[]): void {
  for (const target of targets) {
    if (getTargetResolvers().has(target)) continue;
    const resolve = knownTitleSource(target);
    if (resolve) registerTargetResolver(target, resolve);
  }
}
