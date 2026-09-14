import assert from "node:assert/strict";
import test from "node:test";
import { defaultDraft, MAX_COLLECTION_ITEMS, siteDraftSchema } from "../lib/site-document.ts";
import { SLOT_MAX_LENGTH } from "../lib/template-slot-contract.ts";
import {
  applySiteOperations,
  aiChangeSchema,
  checkCopyLength,
  describeDestructive,
  describeSlot,
  isDestructiveOperation,
  slotForQualityIssue,
  validateAIOperations,
  validateGenerationOperations,
  type AIOperation,
  type SiteOperation,
} from "../lib/site-operations.ts";

const templateIds = new Set(["forge", "kindred", "signal"]);

test("updates only the requested service card and creates a reversible operation", () => {
  const original = structuredClone(defaultDraft);
  const result = applySiteOperations(original, [{
    op: "update_item",
    section: "services",
    index: 1,
    locale: "zh",
    title: "智能产线集成",
  }], { templateIds, lastChange: "AI saved" });

  assert.equal(result.changed, true);
  assert.equal(result.draft.templateId, "forge");
  assert.equal(result.draft.content.services.items[1].title.zh, "智能产线集成");
  assert.equal(result.draft.content.services.items[0].title.zh, original.content.services.items[0].title.zh);
  assert.deepEqual(result.appliedTargets, ["services.items.1.title.zh"]);
  assert.equal(result.draft.revision, original.revision + 1);

  const restored = applySiteOperations(result.draft, result.inverseOperations, { templateIds, lastChange: "Undo" });
  assert.equal(restored.draft.content.services.items[1].title.zh, original.content.services.items[1].title.zh);
  assert.equal(restored.draft.templateId, original.templateId);
});

test("rejects an unsolicited template switch", () => {
  const validated = validateAIOperations("只修改第二个服务标题", [
    { op: "set_template", templateId: "kindred" },
    { op: "update_item", section: "services", index: 1, locale: "zh", title: "智能产线集成" },
  ], templateIds);
  assert.equal(validated.operations.length, 1);
  assert.equal(validated.operations[0].op, "update_item");
  assert.match(validated.rejected[0], /拒绝模板切换/);
});

test("allows a whitelisted template switch only when explicitly requested", () => {
  const validated = validateAIOperations("请切换模板为 kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("allows a template switch in '模板换成' word order", () => {
  // 回归：实测中"请把模板换成 atlas"被正则误拒（名词在前语序未匹配）
  const validated = validateAIOperations("请把模板换成 kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("allows a template switch with English 'switch template' order", () => {
  const validated = validateAIOperations("switch template to kindred", [
    { op: "set_template", templateId: "kindred" },
  ], templateIds);
  assert.deepEqual(validated.rejected, []);
  assert.equal(validated.operations[0].op, "set_template");
});

test("rejects english operations when user says 别动英文", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const validated = validateAIOperations("别动英文，把中文首屏改好", ops, templateIds);
  assert.equal(validated.operations.length, 1);
  const [zhOp] = validated.operations;
  assert.ok(zhOp.op === "set_text");
  assert.equal(zhOp.locale, "zh");
  assert.match(validated.rejected[0], /英文/);
});

test("allows only zh operations when user says 只改中文", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const validated = validateAIOperations("只改中文，别动英文", ops, templateIds);
  assert.equal(validated.operations.length, 1);
  const [zhOp2] = validated.operations;
  assert.ok(zhOp2.op === "set_text");
  assert.equal(zhOp2.locale, "zh");
});

test("does not over-restrict on bilingual or normal instructions", () => {
  const ops: AIOperation[] = [
    { op: "set_text", target: "hero.title", locale: "en", value: "x" },
    { op: "set_text", target: "hero.title", locale: "zh", value: "y" },
  ];
  const both = validateAIOperations("中英文都改一下首屏", ops, templateIds);
  assert.equal(both.operations.length, 2);
  const normal = validateAIOperations("把首屏标题改一下", ops, templateIds);
  assert.equal(normal.operations.length, 2);
});

test("does not increment revision for a no-op", () => {
  const operation: SiteOperation = {
    op: "set_text",
    target: "hero.title",
    locale: "zh",
    value: defaultDraft.content.hero.title.zh,
  };
  const result = applySiteOperations(defaultDraft, [operation], { templateIds, lastChange: "No-op" });
  assert.equal(result.changed, false);
  assert.equal(result.draft.revision, defaultDraft.revision);
  assert.deepEqual(result.appliedTargets, []);
});

test("resolves a reordered service card by itemId instead of stale index", () => {
  const draft = structuredClone(defaultDraft);
  const target = draft.content.services.items[1];
  draft.content.services.items = [draft.content.services.items[2], target, draft.content.services.items[0]];

  const result = applySiteOperations(draft, [{
    op: "update_item",
    section: "services",
    index: 0,
    itemId: target.id,
    locale: "zh",
    title: "按稳定 ID 修改",
  }], { templateIds, lastChange: "AI saved" });

  assert.equal(result.draft.content.services.items[1].title.zh, "按稳定 ID 修改");
  assert.notEqual(result.draft.content.services.items[0].title.zh, "按稳定 ID 修改");
});

test("accepts a card operation carrying itemId and expectedValue", () => {
  const parsed = aiChangeSchema.safeParse({
    summary: "更新服务",
    operations: [{
      op: "update_item",
      section: "services",
      itemId: "integration",
      locale: "zh",
      title: "方案与实施",
      expectedValue: "旧标题",
    }],
  });
  assert.equal(parsed.success, true);
  if (parsed.success && parsed.data.operations[0].op === "update_item") {
    assert.equal(parsed.data.operations[0].index, 0);
    assert.equal(parsed.data.operations[0].itemId, "integration");
  }
});

test("rejects an expectedValue mismatch without changing the draft revision", () => {
  const operation: SiteOperation = {
    op: "set_text",
    target: "hero.title",
    locale: "zh",
    value: "新标题",
    expectedValue: "旧标题已经不存在",
  };

  assert.throws(
    () => applySiteOperations(defaultDraft, [operation], { templateIds, lastChange: "AI saved" }),
    /前置条件不满足/,
  );
  assert.equal(defaultDraft.revision, 1);
  assert.equal(defaultDraft.content.hero.title.zh, "为下一代标准而造。");
});

test("applies design tokens as one reversible draft change", () => {
  const tokens = {
    primary: "#18385f",
    secondary: "#e7eef7",
    accent: "#f0bd59",
    fontStyle: "technical" as const,
    radius: "sharp" as const,
    density: "compact" as const,
  };
  const result = applySiteOperations(defaultDraft, [{ op: "set_design_tokens", tokens }], { templateIds, lastChange: "Design variant" });
  assert.equal(result.changed, true);
  assert.deepEqual(result.draft.designTokens, tokens);
  assert.deepEqual(result.appliedTargets, ["design.tokens"]);
  const restored = applySiteOperations(result.draft, result.inverseOperations, { templateIds, lastChange: "Undo" });
  assert.equal(restored.draft.designTokens, null);
});

test("replaces imported products as one reversible draft change", () => {
  const products = [{
    sku: "NEW-001",
    name: { zh: "测试产品", en: "Test Product" },
    summary: { zh: "测试简介", en: "Test description" },
    category: "测试",
    status: "draft" as const,
    imageColor: "#ffffff",
  }];
  const result = applySiteOperations(defaultDraft, [{ op: "replace_products", products }], { templateIds, lastChange: "Imported" });
  assert.equal(result.draft.products.length, 1);
  assert.equal(result.draft.products[0].sku, "NEW-001");
  const restored = applySiteOperations(result.draft, result.inverseOperations, { templateIds, lastChange: "Undo" });
  assert.deepEqual(restored.draft.products, defaultDraft.products);
});

test("detects destructive operations that need confirmation", () => {
  const removeCard: SiteOperation = { op: "remove_item", section: "features", itemId: "quality" };
  const hideSection: SiteOperation = { op: "set_section_visibility", section: "about", visible: false };
  const showSection: SiteOperation = { op: "set_section_visibility", section: "about", visible: true };
  const switchTemplate: SiteOperation = { op: "set_template", templateId: "kindred" };
  const reorder: SiteOperation = { op: "reorder_sections", order: ["about", "features", "services", "products", "contact"] };
  const editText: SiteOperation = { op: "set_text", target: "hero.title", locale: "zh", value: "x" };

  assert.equal(isDestructiveOperation(removeCard), true);
  assert.equal(isDestructiveOperation(hideSection), true);
  assert.equal(isDestructiveOperation(showSection), false); // 显示区块不破坏
  assert.equal(isDestructiveOperation(switchTemplate), true);
  assert.equal(isDestructiveOperation(reorder), true);
  assert.equal(isDestructiveOperation(editText), false);

  assert.match(describeDestructive(removeCard), /删除/);
  assert.match(describeDestructive(hideSection), /隐藏/);
  assert.match(describeDestructive(switchTemplate), /切换模板/);

  // 精确字符串断言：删除和卡片之间不得有多余空格（Codex 验收反馈 D1）
  assert.equal(describeDestructive(removeCard), "删除核心优势卡片「quality」");
  const removeService: SiteOperation = { op: "remove_item", section: "services", itemId: "delivery" };
  assert.equal(describeDestructive(removeService), "删除服务卡片「delivery」");
});

test("rejects hero subtitle exceeding 40 Chinese chars (Q2)", () => {
  const longSubtitle = "可靠制造，从关键部件到整线交付，覆盖精密模块、复合材料与智能检测单元，提供全面质量保障和稳定交付服务，满足不同客户的多样化需求，欢迎咨询合作洽谈业务往来沟通联系。";
  const validated = validateAIOperations("把首屏优化一下", [
    { op: "set_text", target: "hero.subtitle", locale: "zh", value: longSubtitle },
  ], templateIds);
  assert.equal(validated.operations.length, 0);
  assert.match(validated.rejected[0], /超出长度限制/);
});

test("accepts hero subtitle within 40 Chinese chars (Q2)", () => {
  const okSubtitle = "覆盖关键部件与智能检测，支持复杂制造稳定交付。";
  const validated = validateAIOperations("把首屏优化一下", [
    { op: "set_text", target: "hero.subtitle", locale: "zh", value: okSubtitle },
  ], templateIds);
  assert.equal(validated.operations.length, 1);
  assert.equal(validated.rejected.length, 0);
});

// ===== 文案长度闸门的单一判定源（2026-09-11） =====
//
// 背景：这段逻辑此前在 validateAIOperations 与 validateGenerationOperations
// 里**逐字重复两遍**，而就地编辑路径（PUT /draft）**完全没有**这道校验——
// 于是用户能在编辑框把标题存成超长、发布时才被 content-quality 拦下，
// 中间只提示"已保存"。提取为 checkCopyLength 后三条入口共用一个口径。

test("checkCopyLength 是唯一判定源：与两个校验器结论一致", () => {
  /**
   * 超限样例按**契约容量**构造（2026-09-12）。
   *
   * 之前这里是 20 字的标题——当时手写的可读长度是 15，所以它"超长"。
   * 那组手写数字已删除，长度只剩 `SLOT_MAX_LENGTH`（`hero.title` = 160）一个来源，
   * 20 字按新口径是**合规**的。要测拦截就得真的越过契约线。
   */
  const over: SiteOperation = { op: "set_text", target: "hero.title", locale: "zh", value: "一".repeat(SLOT_MAX_LENGTH["hero.title"]! + 1) };
  const ok: SiteOperation = { op: "set_text", target: "hero.title", locale: "zh", value: "精密制造与交付" };

  const aiOver = validateAIOperations("改标题", [over], templateIds);
  const genOver = validateGenerationOperations([over], templateIds);
  assert.equal(aiOver.rejected.length, 1, "chat 路径应拒绝超长标题");
  assert.equal(genOver.rejected.length, 1, "生成路径应拒绝超长标题");
  assert.equal(aiOver.rejected[0], genOver.rejected[0], "两条路径的拒绝原因必须逐字一致");
  assert.equal(aiOver.rejected[0], checkCopyLength(over), "拒绝原因来自 checkCopyLength");

  assert.equal(checkCopyLength(ok), null, "合规标题不应被拒");
  const aiOk = validateAIOperations("改标题", [ok], templateIds);
  assert.equal(aiOk.operations.length, 1);
});

test("checkCopyLength 只管可读性受限的 5 个目标，不误伤邮箱/联系方式", () => {
  // contact.email 曾被断言"无论如何都不受长度限制"（见上一个用例），这里锁住同一口径
  const email: SiteOperation = { op: "set_text", target: "contact.email", locale: "zh", value: "very-long-contact-address-for-a-factory@example.com" };
  assert.equal(checkCopyLength(email), null);
});

test("checkCopyLength 对非 set_text 操作直接放行", () => {
  assert.equal(checkCopyLength({ op: "set_section_visibility", section: "features", visible: false }), null);
});

test("accepts non-length-limited targets regardless of length (Q2)", () => {  const validated = validateAIOperations("改公司简介", [
    { op: "set_text", target: "contact.email", locale: "zh", value: "a-very-long-email-but-no-limit@example.com" },
  ], templateIds);
  assert.equal(validated.operations.length, 1);
});

// ===== 生成路径白名单 + 容量（2026-09-08 审计修复） =====

test("generation path rejects chat-only ops (reorder_sections) in draft scope", () => {
  const validated = validateGenerationOperations([
    { op: "reorder_sections", order: ["about", "features", "services", "products", "contact"] },
  ], templateIds);
  assert.equal(validated.operations.length, 0);
  assert.match(validated.rejected[0], /不允许操作 reorder_sections/);
});

test("draft scope rejects add_item (structure changes need explicit user request)", () => {
  const validated = validateGenerationOperations([
    { op: "add_item", section: "features", item: { id: "x", title: { zh: "新", en: "new" }, body: { zh: "内容", en: "body" } } },
  ], templateIds);
  assert.equal(validated.operations.length, 0);
  assert.match(validated.rejected[0], /不允许操作 add_item/);
});

test("regenerate-structure scope allows add_item but caps at template capacity", () => {
  /**
   * ⚠️ `slot` 必须用**生产真实形态**（裸段名 `"features"`），不是 `"features.items"`。
   *
   * 2026-09-12 裁决（阶段 1 冲突 #1）：此前三条容量用例都喂 `"features.items"`，
   * 而生产传的是 `getTemplatePresentation()` 的 `p.slot`——**裸段名**
   * （`site-generator.ts:405/891`，实例见 `template-manifests/forge.ts:25-67`）。
   * 校验器按 `${section}.items` 查（`site-operations.ts:778/795`）→ 永远匹配不上
   * → `overCapacity` 恒为空 → **越界从不被拦，而测试一直是绿的**。
   *
   * 用户裁定：**先改成生产形态、确认测试先红，再修代码**。
   * 所以这个 fixture 是"把门焊在真实位置上"，不是换个写法让它过。
   */
  const capacity = {
    presentation: [{ presentationSlot: "features", capacityMax: 3 }],
    baseCounts: { features: 3, services: 0 },
  };
  const card = (id: string) => ({ op: "add_item" as const, section: "features" as const, item: { id, title: { zh: "新", en: "new" }, body: { zh: "内容", en: "body" } } });
  const validated = validateGenerationOperations(
    [card("a")],
    templateIds,
    capacity,
    "regenerate-structure",
  );
  assert.equal(validated.operations.length, 0, "3 条已满，再加即超容");
  assert.match(validated.rejected[0], /超出模板原生容量/);
});

test("regenerate-structure scope allows add_item when remove keeps count within capacity", () => {
  const capacity = {
    presentation: [{ presentationSlot: "features", capacityMax: 3 }],
    baseCounts: { features: 3, services: 0 },
  };
  const validated = validateGenerationOperations([
    { op: "remove_item", section: "features", itemId: "quality" },
    { op: "add_item", section: "features", item: { id: "n", title: { zh: "新", en: "new" }, body: { zh: "内容", en: "body" } } },
  ], templateIds, capacity, "regenerate-structure");
  assert.equal(validated.operations.length, 2, "一增一减净增 0，不应误杀");
  assert.equal(validated.rejected.length, 0);
});

// ===== update_item 越界防护（2026-09-10 真机修复） =====
//
// 真机证据：一句话建站的真实流程里，AI 输出 `update_item index 4`，
// 而 baseDraft.content.features.items 只有 3 条 → applySiteOperations 抛
// `features item 4 does not exist` → 整份 commitOperations 回滚，
// **用户 66 秒生成全部丢弃，界面显示英文技术错误**。
// 复现路径见 e2e/specs/smoke-real.spec.ts（真 DeepSeek 全流程）。
//
// 根因：prompt 告诉 AI「features 约6条(至多12条)」（来自模板 capacity），
// 而让 AI 读的草稿只有 3 条，两个数字不一致 → AI 按容量写。
// validateGenerationOperations 此前只拦 add_item 超容，update_item 完全不校验。

test("draft scope rejects update_item beyond existing items (真机 bug 回归)", () => {
  // slot 用生产真实形态（裸段名），理由见上方 regenerate-structure 用例的注释。
  const capacity = {
    presentation: [{ presentationSlot: "features", capacityMax: 12 }],
    baseCounts: { features: 3, services: 3 },
  };
  const validated = validateGenerationOperations([
    { op: "update_item", section: "features", index: 0, locale: "zh", title: "有效修改" },
    { op: "update_item", section: "features", index: 4, locale: "zh", title: "越界" },
  ], templateIds, capacity, "draft");
  assert.equal(validated.operations.length, 1, "只保留合法的 index 0，越界的被拒");
  const [kept] = validated.operations;
  assert.ok(kept.op === "update_item", "保留的应是 update_item");
  assert.equal(kept.index, 0);
  // 拒绝原因要面向用户可读：index 4 即「第 5 条」（人类计数从 1 开始），
  // 且要说明"当前仅 N 条"——直接抛英文 `features item 4 does not exist` 正是真机缺陷之一。
  assert.ok(
    validated.rejected.some((r) => /第 5 条/.test(r) && /当前仅 3 条/.test(r)),
    `应给出可读的拒绝原因，实际：${JSON.stringify(validated.rejected)}`,
  );
});

test("update_item 越界不是整批失败：合法操作照常保留", () => {
  // slot 用生产真实形态（裸段名），理由见上方 regenerate-structure 用例的注释。
  const capacity = {
    presentation: [{ presentationSlot: "features", capacityMax: 12 }],
    baseCounts: { features: 3, services: 0 },
  };
  const validated = validateGenerationOperations([
    { op: "set_text", target: "hero.title", locale: "zh", value: "精密五金件加工" },
    { op: "update_item", section: "features", index: 7, locale: "zh", title: "越界" },
    { op: "update_item", section: "features", index: 2, locale: "zh", title: "最后一条是合法的" },
  ], templateIds, capacity, "draft");
  assert.equal(validated.operations.length, 2, "第 5 条越界不该拖垮整批");
  assert.ok(validated.rejected.length >= 1);
});

test("没有 capacity 上下文时不误杀 update_item（向后兼容）", () => {
  const validated = validateGenerationOperations([
    { op: "update_item", section: "features", index: 9, locale: "zh", title: "无 capacity 时不做越界判定" },
  ], templateIds);
  assert.equal(validated.operations.length, 1, "缺 capacity 上下文时应放行，由应用层兜底");
});

test("draft scope allows set_design_tokens (deterministic design variant)", () => {
  const validated = validateGenerationOperations([
    { op: "set_design_tokens", tokens: { primary: "#123456", secondary: "#234567", accent: "#345678", fontStyle: "sans", radius: "soft", density: "balanced" } },
  ], templateIds);
  assert.equal(validated.operations.length, 1);
  assert.equal(validated.rejected.length, 0);
});

// ===== 质检槽位可读化 / 可定位（2026-09-10）=====
// 背景：工作台此前把 `hero.title` 这类原始槽位 id 直接列给用户，看不懂也点不了。
// 用户答复「不点（细节面板），我直接进工作台看」——因此工作台提示必须可读 + 可定位。

test("describeSlot: 把槽位 id 翻译成中文位置", () => {
  assert.equal(describeSlot("hero.title"), "首屏的标题");
  assert.equal(describeSlot("about.body"), "关于我们的正文");
  assert.equal(describeSlot("contact.email"), "联系模块的邮箱");
  assert.equal(describeSlot("products.FM-2401.summary"), "产品「FM-2401」的简介");
});

test("describeSlot: 未知字段退化成可读兜底而非抛错", () => {
  // 不认识的字段不应崩：板块名仍翻译，字段名原样保留（好过显示一串 id）
  assert.equal(describeSlot("features.unknownField"), "核心优势的unknownField");
  assert.equal(describeSlot("unknownSection.foo"), "unknownSection的foo");
  // 空输入等退化形态也不得抛错
  assert.equal(describeSlot(""), "");
});

test("slotForQualityIssue: 可定位的槽位映射到预览目标", () => {
  assert.equal(slotForQualityIssue("hero.title"), "hero.title");
  assert.equal(slotForQualityIssue("about.body"), "about.body");
  assert.equal(slotForQualityIssue("hero.cta"), "hero.cta");
  // 不可定位的（如商品分类）必须返回 null，调用方只显示描述、不给出会点了没反应的气泡
  assert.equal(slotForQualityIssue("products.FM-2401.category"), null);
  assert.equal(slotForQualityIssue("contact.email"), null);
});

/**
 * ===== 阶段 1 冲突 #8：`add_item` 满员时构成越界路径 =====
 *
 * ## 病史
 *
 * `addCardOperationSchema` 的 `index` 上限曾是字面量 `12`（与 `MAX_COLLECTION_ITEMS`
 * 无 import 关系），而插入点是 `Math.min(index ?? len, len)`——满员 12 条时
 * `index=12` 被夹到尾部，**插入成第 13 条** → `siteDraftSchema` 的 `.max(12)` 解析失败
 * → 下次读取走 `normalizeDraft` 的 destructive 兜底，**整站回退成演示文案**。
 *
 * 2026-09-12 实跑复现的输出原文：
 *
 *     [冲突#8 观察] 插入前 12 条 → 插入后 13 条；schema 可解析 = false
 *     [冲突#8 结论] **真实触发**
 *
 * ## 修法（用户裁决：A+B 一起修，B 为主防线）
 *
 * A：`index` 上限改读 `MAX_COLLECTION_ITEMS - 1`（消"同值不同源"）；
 * B：**插入点加容量前置校验**——满员时抛带中文说明的 Error。
 *
 * B 是主防线，因为它挡得住 A 挡不住的形态：**多条独立 add_item 累计溢出**
 * （每条各自都没超 index 上限，加起来照样越界）。本测试覆盖的正是这一形态。
 */
test("冲突 #8：满员后 add_item 被拒，草稿保持可解析", () => {
  const draft = structuredClone(defaultDraft);
  draft.content.features.items = Array.from({ length: MAX_COLLECTION_ITEMS }, (_, i) => ({
    id: `f${i}`,
    title: { zh: `优势${i}`, en: `F${i}` },
    body: { zh: `说明${i}`, en: `B${i}` },
  }));

  /**
   * 验收标准：
   *  1. 满员后 add_item 必须**被拒**（不是静默插进去）；
   *  2. 被拒之后草稿仍能通过 schema——否则下次读取会走 `normalizeDraft` 的
   *     destructive 兜底，**整站回退成演示文案**（这才是本冲突真正的危害）；
   *  3. 拒绝要给可读的中文原因（`applySiteOperations` 的既有约定，见同文件其它越界用例）。
   */
  assert.throws(
    () => applySiteOperations(
      draft,
      [{ op: "add_item", section: "features", index: 12, item: { id: "overflow2", title: { zh: "溢出", en: "X" }, body: { zh: "溢出", en: "X" } } } as never],
      { templateIds: new Set(["forge"]), lastChange: "冲突#8验收" },
    ),
    /容量|上限|最多|条/,
    "满员后 add_item 必须被拒，并给出可读的中文原因",
  );

  // 第 2 条：被拒后原草稿必须完好（未被写坏）
  assert.equal(draft.content.features.items.length, MAX_COLLECTION_ITEMS);
  assert.equal(siteDraftSchema.safeParse(draft).success, true, "满员草稿本身必须仍能通过 schema");
});

test("冲突 #8 主防线场景：满员前一格连插两条，第二条必须被拒", () => {
  /**
   * 这正是 **A 项挡不住、必须靠 B** 的形态。
   *
   * 11 条时（上限 12），两条 add_item 的 `index` **各自**都没超 A 项的上限，
   * 但**累计**会到 13。A 只看单条的 index，看不出来；B 在插入点逐条判当前条数，
   * 所以第二条会被拦下，草稿停在第 12 条、schema 仍可解析。
   */
  const draft = structuredClone(defaultDraft);
  draft.content.features.items = Array.from({ length: MAX_COLLECTION_ITEMS - 1 }, (_, i) => ({
    id: `g${i}`,
    title: { zh: `优势${i}`, en: `G${i}` },
    body: { zh: `说明${i}`, en: `B${i}` },
  }));

  const card = (id: string) => ({
    op: "add_item" as const,
    section: "features" as const,
    item: { id, title: { zh: "新", en: "new" }, body: { zh: "内容", en: "body" } },
  });

  // 一条一条来：第一条必须成功（还没满），第二条必须被拒（满了）
  const first = applySiteOperations(draft, [card("a")], { templateIds: new Set(["forge"]), lastChange: "step1" });
  assert.equal(first.draft.content.features.items.length, MAX_COLLECTION_ITEMS, "第一条应插入成功，正好满员");
  assert.equal(siteDraftSchema.safeParse(first.draft).success, true, "满员草稿必须仍可解析");

  assert.throws(
    () => applySiteOperations(first.draft, [card("b")], { templateIds: new Set(["forge"]), lastChange: "step2" }),
    /上限|最多/,
    "满员后再加必须被拒——这是 A 项（单条 index 上限）挡不住的累计形态",
  );
});
