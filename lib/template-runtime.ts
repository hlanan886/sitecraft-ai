/**
 * 运行时模板注册表（2026-09-10，方向 3 阶段 A）。
 *
 * ## 为什么需要它
 *
 * 改造前，模板是**编译期静态产物**：`templateCatalog` 是 `export const` 数组，
 * manifest / adapter 是编译期静态 import 表，`template-static.ts` 只认
 * `process.cwd()/<localPath>`。三处共同造成一个结果——
 * **模板只能由开发者在构建前塞进 vendor/ 并重新部署**。
 *
 * 而方向 3 要的是「截图/网址 → 沉淀成模板」，产物在**用户操作时**才产生。
 * 所以这里把「模板从哪来」从编译期常量改成**静态基线 + 运行时注册表**：
 *
 *   templateCatalog（22 个开源基线，编译期）
 *        +
 *   runtimeTemplates（沉淀出的行业模板，运行期注册）
 *        ↓
 *   allTemplates() —— 全链路统一入口（目录、白名单、预览、生成）
 *
 * ## 模块边界（本文件**不碰 fs**）
 *
 * `site-model.ts` 的 `allTemplates()` 会读本模块，而 `site-model.ts` 同时位于
 * **客户端 bundle**（工作台、模板页都是 client component）。所以本文件只做两件事：
 * 定义类型、维护注册表。磁盘装载在 `template-runtime-loader.ts`（仅服务端）。
 *
 * 客户端不注册任何东西 → 自动退化为「只有基线」，这正是想要的：
 * 客户端本来就不该自己发现模板，它拿服务端给的 `draft.templateId` 即可。
 */
import type { Locale, Template } from "./site-model.ts";
import { slotMaxLength } from "./template-slot-contract.ts";

/** 运行时模板在磁盘上的落点（随 `.sitecraft-data` 一起 gitignore）。 */
export const RUNTIME_TEMPLATE_DIR = ".sitecraft-data/generated-templates";

/** 每个运行时模板根目录下必须存在这份注册单，装载器才认它。 */
export const RUNTIME_TEMPLATE_MANIFEST_FILE = "sitecraft.template.json";

/**
 * 槽位声明的最小可用形态。
 *
 * 刻意**不 import** `template-manifests/types.ts` 的 `TemplateManifest`：
 * 那样会把 `template-manifests/index.ts`（22 个 manifest 静态 import 表）
 * 拖进任何使用本模块的模块图。结构上仍是其子集，赋值处由 TS 结构类型保证兼容。
 */
export type RuntimeTemplateSlot = {
  target: string;
  selector: string;
  required?: boolean;
  maxLength?: number;
  demoFingerprints?: readonly string[];
};

export type RuntimeTemplatePresentation = {
  presentationSlot: string;
  role: string;
  presentAs: string;
  capacity: { min?: number; default?: number; max: number };
  itemShape: "title_body" | "metric_value_label" | "media_caption";
  anchor?: string;
};

export type RuntimeTemplateRegistration = {
  /** 模板元数据，形状与 `templateCatalog` 的元素一致。 */
  template: Template;
  /** 槽位声明；缺省时按 HTML 里实际存在的 `data-sitecraft-slot` 推导。 */
  slots?: readonly RuntimeTemplateSlot[];
  /** 原生排版声明；缺省 = 全 card_grid 兜底（与未手写 presentation 的基线模板同行为）。 */
  presentation?: readonly RuntimeTemplatePresentation[];
  requiredVisibleTargets?: readonly string[];
  /**
   * 入库时的质量门结论（阶段 C，2026-09-10）。
   *
   * 写在登记单里而不是每次装载时重算，是因为**门禁的判定依赖当时的 HTML**：
   * 重算只能看到磁盘上的最终产物，说不出"它是靠开关绕过才进来的"。
   * 而这件事决定了它该不该被 AI 推荐——正是下面 `recommendation` 的依据。
   */
  quality?: {
    /** 是否通过静态质量门。 */
    passed: boolean;
    /** 是否由调用方显式跳过门禁（`skipQualityGate`）。 */
    skipped: boolean;
    /** 未通过的阻断项（进库后留档，便于日后回捞与复核）。 */
    blockers?: readonly string[];
  };
};

export type RuntimeTemplateLoadError = {
  /** 出错的模板目录名（即期望的 templateId）。 */
  templateId: string;
  path: string;
  reason: string;
};

const registryHost = globalThis as typeof globalThis & {
  __sitecraftRuntimeTemplates?: Map<string, RuntimeTemplateRegistration>;
};

/**
 * 注册表挂在 globalThis 上。
 *
 * 理由与 `site-store.ts` 的锁表一致：Next.js 在 dev 下会**重复求值模块**
 * （Turbopack HMR、route 与 page 各自一个模块图），模块级 `new Map()`
 * 会出现「注册在 A 图、查询在 B 图」的空注册。
 */
const runtimeRegistry = registryHost.__sitecraftRuntimeTemplates ?? new Map<string, RuntimeTemplateRegistration>();
registryHost.__sitecraftRuntimeTemplates = runtimeRegistry;

/** 编译期基线的 id 集合——运行时模板**不得**覆盖基线，否则 22 个模板的
 *  契约测试与实际预览会指向两份不同的 manifest，且无法回滚。 */
const baselineIds = new Set<string>();
export function markBaselineTemplateIds(ids: Iterable<string>): void {
  for (const id of ids) baselineIds.add(id);
}

export function registerRuntimeTemplate(reg: RuntimeTemplateRegistration): void {
  const id = reg.template?.id;
  if (!id) throw new Error("Runtime template registration requires template.id");
  if (baselineIds.has(id)) throw new Error(`Runtime template ${id} collides with a baseline template id`);
  runtimeRegistry.set(id, reg);
}

export function getRuntimeTemplates(): Template[] {
  return [...runtimeRegistry.values()].map((item) => item.template);
}

export function getRuntimeTemplateRegistration(templateId: string): RuntimeTemplateRegistration | undefined {
  return runtimeRegistry.get(templateId);
}

export function isRuntimeTemplate(templateId: string): boolean {
  return runtimeRegistry.has(templateId);
}

/** 测试用：清空运行时注册表（不动基线）。 */
export function resetRuntimeTemplatesForTest(): void {
  runtimeRegistry.clear();
}

// ---------------------------------------------------------------------------
// 槽位 / 排版默认值
// ---------------------------------------------------------------------------

// 注：原 `RUNTIME_BOTH_LOCALES` 与 `DEFAULT_RUNTIME_TARGETS` 已删（2026-09-11 阶段 4）。
// 两者均为**导出但全库零引用**的死代码，且分别与 `template-manifests/shared.ts` 的
// `BOTH_LOCALES`、`KNOWN_TARGETS` 重复——留着只会成为下一个"哪份算数"的陷阱。
// 如确需"运行时模板可承载的业务槽（顺序即优先级）"，应直接复用 `KNOWN_TARGETS`。

// 槽位上限**不再在此重复定义**（2026-09-11 契约收敛）。
// 此前这里有一份与 `template-manifests/shared.ts` 逐项相同的拷贝，无交叉校验，
// 改一处必漂。现统一到 `lib/template-slot-contract.ts` 的 `slotMaxLength()`。
// 同时新增 `hero.cta`：它此前不在 KNOWN_TARGETS 里，导致客户模板声明的该槽
// 在 `collectSlotTargetsFromHtmlString` 里被**静默丢弃**（见下方 KNOWN_TARGETS 说明）。

/**
 * 「缺了站就残」的槽位——只有这些算必填。
 *
 * 为什么不能把扫到的槽位全标必填：那样「少一个板块小标题」会直接**卡住发布**。
 * 实测踩到 —— 模板声明了 `about.title`，AI 没写，发布被判 `missingSlots` 拦下，
 * 而那个标题在页面上本来就可有可无。
 *
 * 判定口径与入库质量门一致（`lib/template-quality-gate.ts` 的 REQUIRED_SLOT_RULES）：
 * **首屏标题 + 集合内容**。集合内容决定"页面有没有实质信息"，首屏标题决定"说不说得清是什么"，
 * 其余（各节小标题、副标题、联系方式）都是可选的——模板本来就可能没有。
 */
const REQUIRED_RUNTIME_SLOTS = new Set(["hero.title"]);

/**
 * 运行时模板的槽位默认声明。
 *
 * 关键差别：基线模板的 `contentSlots()` 用**语义 id 选择器**（`#about p`），
 * 因为模板由别人写、结构不可控；而运行时模板由我们生成，**节点上直接带
 * `data-sitecraft-slot`**（方向 3 的核心洞察），所以选择器退化成
 * 「恒成立的属性前缀匹配」，不依赖任何 class/id 约定。
 */
export function defaultRuntimeSlots(targets: readonly string[]): readonly RuntimeTemplateSlot[] {
  return targets.map((target) => ({
    target,
    // 前缀 + 点号，避免 `hero.title` 误匹配 `hero.titleX`；用 `^=` 而非 `=`
    // 是因为 bridge 写槽时会追加语言后缀（实测形如 `hero.title.zh`）。
    selector: `[data-sitecraft-slot^="${target}."]`,
    // 集合槽与首屏标题必填，其余可选（见 REQUIRED_RUNTIME_SLOTS 的说明）。
    required: REQUIRED_RUNTIME_SLOTS.has(target) || isCollectionTarget(target),
    maxLength: slotMaxLength(target),
    demoFingerprints: [],
  }));
}

/**
 * 判断一个模板的 `localPath` 是否落在运行时模板目录下。
 *
 * 为什么单独一个函数而不是让调用方自己 `startsWith`：
 * **Windows 上 `path.join` 返回反斜杠**（实测 `.sitecraft-data\\generated-templates\\jinggong`），
 * 而 `RUNTIME_TEMPLATE_DIR` 写的是正斜杠。直接前缀比对在 Windows 上**恒为 false**，
 * 表现为「模板注册成功了，但任何按目录筛选的地方都列不出它」——不报错、只是空，
 * 是这一整轮里反复出现的那类静默失效（别名错位、早退返回空数组都是同一种病）。
 *
 * 统一在这里归一化，后续所有"按目录筛选"的调用点都用它，不再各写一份比较。
 */
export function isRuntimeTemplatePath(localPath: string | undefined): boolean {
  if (!localPath) return false;
  const normalized = normalizeToForwardSlashes(localPath);
  const root = normalizeToForwardSlashes(RUNTIME_TEMPLATE_DIR);
  return normalized === root || normalized.startsWith(`${root}/`);
}

/**
 * 归一化成「正斜杠 + 无尾随分隔符」。
 *
 * 尾随分隔符**两种都要剥**：只剥正斜杠的话，Windows 写法
 * （`...generated-templates\jinggong\`）会剩下一个反斜杠，
 * 前缀匹配依然失败——等于这个修复只做了一半（自己写的回归测试当场抓到）。
 */
function normalizeToForwardSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// 槽位值解析（纯字符串，无 fs）
// ---------------------------------------------------------------------------

/**
 * `TemplateContentTarget` 的合法取值（两段式）。
 *
 * 单独列出而不是从桥接脚本反推：槽位值形如 `features.items.2.title`，
 * 需要**从长到短匹配**才能切出 `features.items`；没有这张表就只能猜切几段。
 */
/**
 * 运行时模板可承载的业务槽白名单。
 *
 * ⚠️ **2026-09-11 新增 `hero.cta`**：它此前**不在这张表里**，而
 * `collectSlotTargetsFromHtmlString` → `normalizeSlotTarget` 用它做白名单过滤，
 * 于是客户模板 HTML 里声明的 `data-sitecraft-slot="hero.cta.zh"` 被**静默丢弃**。
 * 同时 `template-slot-guard.ts:366` 又把 `primaryCta → hero.cta` 登记为必需前缀、
 * `inline-edit-mapping.ts:30` 也支持就地编辑它——**三处对同一个槽的认知互不相同**：
 * 一处说必需、一处说没有、一处真实存在。
 *
 * 补进白名单是**有界且零回归**的：只是一次 `.find` 命中，不改变任何既有行为。
 * 注意 `TemplateContentTarget`（manifest 侧）仍不含它——那是**基线模板契约**
 * 与**运行时模板契约**的区别，两者本就不是同一张表（见本文件顶部说明）。
 */
const KNOWN_TARGETS = [
  "hero.title",
  "hero.subtitle",
  "hero.cta",
  "about.title",
  "about.body",
  "features.title",
  "features.items",
  "services.title",
  "services.items",
  /**
   * 2026-09-11（④）新增。**不加进这里的后果与 `hero.cta` 一模一样**：
   * 拼装器把 `faq.items.0.title` 刻进 HTML，装载器却在白名单过滤时**静默丢掉**它，
   * 于是"页面上明明是问答，就是点不动"——不报错、不提示，最难查的那种失效。
   *
   * **只登记真正可写的**：`faq.items` / `testimonials.items` 有就地编辑与写回
   * （走 `update_item` 那条链的扩展），而 `faq.title` / `testimonials.title`
   * **故意不登记**——见 `template-composer.ts` 的 `sectionHead` 说明：
   * 打了槽位但改不动，比不打更糟。等 ⑥ 扩 `site-operations` 契约时一起补。
   *
   * ⚠️ `logos.name` 只是**登记**用的：真实槽位值形如 `logos.0.name`，
   * 前缀匹配落空，所以 `normalizeSlotTarget` 里另有一条（同 `products`）。
   */
  "faq.items",
  "testimonials.items",
  "logos.name",
  "contact.title",
  "contact.body",
  "contact.email",
  "contact.phone",
  "contact.address",
] as const;

/** `products` / `logos` / `navigation` 的中段是变量（sku、序号、id），单独处理。 */
const KNOWN_PREFIXES = [...KNOWN_TARGETS, "products", "logos", "navigation"] as const;

/**
 * 把 HTML 里的槽位值（如 `features.items.2.title`）归一到两段式 target。
 *
 * ## 中段带变量的槽位必须单独列一条（本文件已踩到**第四次**）
 *
 * `startsWith(\`${target}.\`)` 只认"target 后面直接跟点号"的形态。
 * 只要槽位中段是变量（sku、序号、导航 id），前缀匹配就**一定落空**，
 * 而落空的后果是**静默丢弃**——页面看着对，那几个字段一个字都改不了。
 *
 * 已踩过的四次：
 *  1. `hero.cta` —— 压根没进过白名单
 *  2. `products.<sku>.name` —— 中段是 SKU
 *  3. `logos.<序号>.name` —— 中段是序号
 *  4. `navigation.<id>.label` —— 中段是导航项 id（⑥）
 *
 * **往拼装器加这类槽位时，只加 `KNOWN_TARGETS` 是不够的，这里也必须加一条。**
 */
export function normalizeSlotTarget(slotValue: string): string | null {
  if (slotValue === "products" || slotValue.startsWith("products.")) return "products";
  if (slotValue === "logos" || slotValue.startsWith("logos.")) return "logos";
  if (slotValue === "navigation" || slotValue.startsWith("navigation.")) return "navigation";
  return KNOWN_TARGETS.find((target) => slotValue === target || slotValue.startsWith(`${target}.`)) ?? null;
}

/** 按已知顺序（而非发现顺序）输出 target 列表，保证生成层的板块序稳定。 */
export function orderKnownTargets(targets: Iterable<string>): string[] {
  const found = new Set(targets);
  return KNOWN_PREFIXES.filter((target) => found.has(target));
}

export function isCollectionTarget(target: string): boolean {
  return target === "products" || target.endsWith(".items");
}

// ---------------------------------------------------------------------------
// 登记单校验 / 归一化（纯数据，无 fs）
// ---------------------------------------------------------------------------

const REQUIRED_TEMPLATE_FIELDS = ["id", "name", "category", "description"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 校验注册单里最小必要的字段。
 *
 * 只强制「缺了整个站就渲染不出来」的字段：模板目录/名称/分类/描述。
 * `colors` / `headline` / `promptProfile` 缺失时由 `normalizeRuntimeTemplate`
 * 补默认值——登记单是**人写的**，不该因为没填一个装饰字段就整包拒绝。
 */
export function assertRuntimeTemplateShape(raw: unknown, registrationPath: string): Template {
  if (!raw || typeof raw !== "object") {
    throw new Error(`registration is not an object (${registrationPath})`);
  }
  const value = raw as Record<string, unknown>;
  for (const field of REQUIRED_TEMPLATE_FIELDS) {
    if (!isNonEmptyString(value[field])) {
      throw new Error(`missing required field "${field}" (${registrationPath})`);
    }
  }
  return raw as Template;
}

/** 补齐可选字段。**必须**与 `templateCatalog` 的元素同形，否则 UI 与匹配排序会拿到 undefined。 */
export function normalizeRuntimeTemplate(raw: Template, fallbackLocalPath: string): Template {
  const source = raw.source ?? ({} as Template["source"]);
  return {
    ...raw,
    colors: raw.colors ?? { primary: "#334155", secondary: "#f1f5f9", accent: "#f59e0b" },
    headline: raw.headline ?? raw.name,
    subtitle: raw.subtitle ?? raw.description,
    source: {
      name: source.name ?? "Sitecraft 沉淀模板",
      repoUrl: source.repoUrl ?? "",
      license: source.license ?? "Internal",
      framework: source.framework ?? "Static HTML",
      demoUrl: source.demoUrl ?? "",
      // localPath 决定 static root 与资源路由，**不允许**登记单自己指定——
      // 否则一份被改坏的注册单就能让读文件跳出模板目录（防穿越要求）。
      localPath: fallbackLocalPath,
    },
    promptProfile: raw.promptProfile ?? {
      role: "企业官网内容编辑，按模板既有排版填充真实企业事实",
      structure: [],
      visualRules: [],
      targets: [],
      guardrails: [],
      starters: [],
    },
  };
}
