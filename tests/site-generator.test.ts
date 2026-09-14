import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationPlan, buildSourceMaterialBlock, generateDraftOperations, regenerateMissingSectionsOperations, regenerateSectionOperations, SOURCE_MATERIAL_BUDGET, type DraftOpsProvider } from "../lib/site-generator.ts";
import type { SiteIntent } from "../lib/site-intent.ts";
import { defaultDraft } from "../lib/site-document.ts";
import { applySiteOperations, type SiteOperation } from "../lib/site-operations.ts";
import { GENERATION_BUDGET } from "../lib/generation-budget.ts";

const intent: SiteIntent = {
  businessType: "trade",
  companyName: "华辰光伏",
  industry: "光伏组件出口",
  targetAudience: "overseasB2b",
  tone: "professional",
  coreSections: ["about", "features", "products", "contact"],
  recommendedTemplateId: "atlas",
  summary: "光伏出口企业的双语官网",
};

test("buildGenerationPlan: adds set_template when template is not forge", () => {
  const plan = buildGenerationPlan(intent, "atlas", []);
  assert.equal(plan.leadingOps.length, 1);
  assert.deepEqual(plan.leadingOps[0], { op: "set_template", templateId: "atlas" });
  assert.equal(plan.baseDraft.templateId, "forge"); // base 是默认草稿
  assert.equal(plan.scope.sections.length, 4);
  assert.equal(plan.hideOps.length, 0);
});

test("buildGenerationPlan: no set_template when forge (default)", () => {
  const plan = buildGenerationPlan(intent, "forge", []);
  assert.equal(plan.leadingOps.filter((operation) => operation.op === "set_template").length, 0);
  // 2026-09-09 产品决策：不再生成 design tokens（避免 !important 抹平模板设计特征）
  assert.equal(plan.leadingOps.filter((operation) => operation.op === "set_design_tokens").length, 0);
});

test("buildGenerationPlan: siteLanguage defaults zh, passes en through", () => {
  const zh = buildGenerationPlan(intent, "forge", []);
  assert.equal(zh.scope.siteLanguage, "zh");
  const en = buildGenerationPlan(intent, "forge", [], "en");
  assert.equal(en.scope.siteLanguage, "en");
  assert.equal(en.scope.bilingual, true);
});

test("generateDraftOperations: batch hints follow siteLanguage (en)", async () => {
  const seen: string[] = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seen.push(args.attemptHint ?? "");
    return args.attemptHint?.includes("第一批")
      ? { ok: true, summary: "skeleton", operations: [{ op: "set_text", target: "hero.title", locale: "en", value: "Reliable Manufacturing" }], model: "test" }
      : { ok: true, summary: "sections", operations: [{ op: "set_text", target: "about.title", locale: "en", value: "About Us" }], model: "test" };
  };
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], siteLanguage: "en", draftOps: fakeProvider });
  assert.equal(out.ok, true);
  // 批 A 提示含英文指引、批 B 提示要求英文书写
  assert.match(seen[0], /英文/);
  assert.match(seen[1], /英文/);
  assert.doesNotMatch(seen[0], /板块只写中文/);
});

test("buildGenerationPlan: excludes hidden sections and generates hideOps", () => {
  const plan = buildGenerationPlan(intent, "atlas", ["products", "contact"]);
  assert.deepEqual(plan.scope.sections, ["about", "features"]);
  assert.equal(plan.hideOps.length, 2);
  assert.deepEqual(plan.hideOps[0], { op: "set_section_visibility", section: "products", visible: false });
});

test("generateDraftOperations: merges leading + batchA + batchB + hideOps in order", async () => {
  const fakeProvider: DraftOpsProvider = async (args) => {
    const ops: SiteOperation[] = args.attemptHint?.includes("第一批")
      ? [
          { op: "set_text", target: "companyName", locale: "zh", value: "华辰光伏" },
          { op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" },
        ]
      : [
          { op: "set_text", target: "about.title", locale: "zh", value: "关于我们" },
        ];
    return { ok: true, summary: args.attemptHint?.includes("第一批") ? "骨架" : "板块", operations: ops, model: "test" };
  };
  const out = await generateDraftOperations({ intent, templateId: "atlas", hiddenSections: ["products"], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    const ops = out.operations;
    // 顺序：set_template → 批A(2) → 批B(1) → hideOps(1)
    assert.equal(ops[0].op, "set_template");
    assert.equal(ops.filter((o) => o.op === "set_text").length, 3);
    assert.equal(ops.filter((o) => o.op === "set_section_visibility").length, 1);
  }
});

test("generateDraftOperations: batchB failure fail-open only commits batchA", async () => {
  let calls = 0;
  const fakeProvider: DraftOpsProvider = async (args) => {
    calls += 1;
    if (args.attemptHint?.includes("第一批")) {
      return { ok: true, summary: "骨架", operations: [{ op: "set_text", target: "companyName", locale: "zh", value: "华辰光伏" }], model: "test" };
    }
    return { ok: false, code: "timeout", error: "超时" };
  };
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    // 批 A 的 1 条 + 首屏标题兜底 1 条（2026-09-10）。
    // 这里的假 provider **故意只返回 companyName 不返回 hero.title**——正是线上
    // 实测到的偶发形态（同一输入两次调用，一次写了 hero.title、一次没写）。
    // 兜底保证「模型漏写首屏标题」不会变成「站点带着模板演示标题、发布被拦」。
    assert.equal(out.operations.length, 2);
    assert.ok(
      out.operations.some((op) => op.op === "set_text" && op.target === "hero.title"),
      "必须保证 hero.title 存在，否则站点会残留模板演示标题且无法发布",
    );
    // 批 B 失败 → 它一条操作都不该出现
    assert.ok(out.operations.every((op) => op.op === "set_text" || op.op === "set_section_visibility"));
    assert.match(out.summary, /骨架/);
    assert.deepEqual(out.completedSections, ["hero"]);
  }
});

test("generateDraftOperations: batchA failure returns a fast partial fallback", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({ ok: false, code: "timeout", error: "超时" });
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.partial, true);
    assert.deepEqual(out.completedSections, ["hero"]);
    assert.deepEqual(out.missingSections, ["about", "features", "products", "contact"]);
  }
});

test("generateDraftOperations: slow model still returns a usable partial skeleton", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({ ok: false, code: "timeout", error: "超时" });
  const out = await generateDraftOperations({ intent, templateId: "atlas", hiddenSections: [], draftOps: fakeProvider });

  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.partial, true);
    assert.deepEqual(out.missingSections, ["about", "features", "products", "contact"]);
    assert.equal(out.appliedTemplateId, "forge");
    assert.match(out.templateFallbackReason ?? "", /兼容模板/);
    assert.deepEqual(
      out.operations.filter((operation) => operation.op === "set_text").map((operation) => operation.target),
      ["siteName", "companyName", "industry", "goal", "hero.title", "hero.subtitle", "hero.cta"],
    );
  }
});

test("generateDraftOperations: strips operations exceeding length limits (Q2)", async () => {
  const longSubtitle = "可靠制造从关键部件到整线交付覆盖精密模块复合材料与智能检测单元提供全面质量保障和稳定交付服务满足不同客户多样化需求欢迎咨询洽谈业务往来沟通联系";
  const fakeProvider: DraftOpsProvider = async (args) => {
    const ops: SiteOperation[] = args.attemptHint?.includes("第一批")
      ? [
          { op: "set_text", target: "hero.subtitle", locale: "zh", value: longSubtitle },
          { op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" },
        ]
      : [];
    return { ok: true, summary: "s", operations: ops, model: "test" };
  };
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    // 超长 subtitle 被剔除，只留 title
    assert.equal(out.operations.length, 1);
    const op = out.operations.find((operation) => operation.op === "set_text");
    assert.ok(op);
    assert.ok(op.op === "set_text");
    assert.equal(op.target, "hero.title");
  }
});

test("generateDraftOperations: uses defaultDraft as base (templateId stays forge)", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({ ok: true, summary: "s", operations: [], model: "test" });
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  assert.equal(defaultDraft.templateId, "forge");
});

// ===== B4 并行生成：两批同时请求，批 A 仍决定整体是否可提交 =====

test("generateDraftOperations: batchA failure preserves successful parallel batchB content", async () => {
  let batchBCalled = false;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return { ok: false, code: "timeout", error: "批 A 超时" };
    }
    batchBCalled = true;
    return {
      ok: true,
      summary: "关于板块完成",
      operations: [{ op: "set_text", target: "about.title", locale: "zh", value: "关于我们" }],
      model: "test",
    };
  };
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.partial, true);
    assert.ok(out.operations.some((operation) => operation.op === "set_text" && operation.target === "about.title"));
    assert.deepEqual(out.missingSections, ["features", "products", "contact"]);
  }
  assert.equal(batchBCalled, true);
});

test("generateDraftOperations: batchA and batchB run concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const progress: Array<{ phase: string; completedSections: string[] }> = [];
  // 2026-09-10：分组并发从写死的 1 提到 GENERATION_BUDGET.groupConcurrency(2)。
  // 此前分组**串行**执行，而预算公式按并发 2 估算 → 每次生成必然砍掉尾部板块。
  // 但**全局在途仍受 ≤2 约束**（原注释「并发过多会互相拖慢、加剧超时」）——
  // 通过「batchA 返回后再启动分组」实现，故峰值在途 ≤2。
  const fakeProvider: DraftOpsProvider = async (args) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return {
      ok: true,
      summary: args.attemptHint?.includes("第一批") ? "首屏" : "板块",
      operations: args.attemptHint?.includes("第一批")
        ? [{ op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" }]
        : [{ op: "set_text", target: "about.title", locale: "zh", value: "关于我们" }],
      model: "test",
    };
  };
  const out = await generateDraftOperations({
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
    onProgress: (item) => progress.push(item),
  });
  assert.equal(out.ok, true);
  // batchA 与 batchB 必须并发在途（拒绝退回全串行）
  assert.ok(maxActive >= 2, `batchA 与 batchB 应并发在途，实测峰值 ${maxActive}`);
  // 全局在途不超过并发上限（batchA 返回后才启动分组 → 峰值=groupConcurrency）
  assert.ok(maxActive <= GENERATION_BUDGET.groupConcurrency, `在途请求 ${maxActive} 超过上限 ${GENERATION_BUDGET.groupConcurrency}`);
  // 分组并发必须 >1，否则预算公式会低估一半（这正是修复的 bug）
  assert.ok(GENERATION_BUDGET.groupConcurrency > 1, "分组并发必须 >1，否则预算公式低估一半");
  assert.ok(progress.some((item) => item.phase === "content" && item.completedSections.includes("hero")));
  assert.ok(progress.some((item) => item.phase === "review" && item.completedSections.includes("about")));
  if (out.ok) assert.deepEqual(out.completedSections, ["hero", "about", "features", "products", "contact"]);
});

test("generateDraftOperations: one hanging section times out without blocking completed sibling sections", async () => {
  const progress: Array<{ activeSections: string[]; failedSections: string[] }> = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return {
        ok: true,
        summary: "首屏完成",
        operations: [{ op: "set_text", target: "companyName", locale: "zh", value: "华辰光伏" }],
        model: "test",
      };
    }
    if (args.scope.sections.includes("about")) {
      return new Promise<never>(() => {});
    }
    return { ok: true, summary: `${args.scope.sections[0]} 完成`, operations: [], model: "test" };
  };

  const out = await Promise.race([
    generateDraftOperations({
      intent,
      templateId: "forge",
      hiddenSections: [],
      draftOps: fakeProvider,
      taskTimeoutMs: 20,
      onProgress: (item) => progress.push(item),
    }),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 100)),
  ]);

  assert.notEqual(out, "hung");
  if (out === "hung") return;
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.partial, true);
    assert.deepEqual(out.missingSections, ["about"]);
    assert.deepEqual(out.completedSections, ["hero", "features", "products", "contact"]);
    assert.ok(progress.some((item) => item.failedSections.includes("about") && !item.activeSections.includes("about")));
  }
});

/**
 * 2026-09-10 修复「每次生成必然砍掉尾部板块」后的关键行为：
 * 共享并发池必须让**分组在 batchA 仍挂起时就开始跑**（而不是等 batchA 结束）。
 * 这正是修复的核心——此前分组串行，batchA 卡 60s 会让 4 个分组再等 60s。
 */
test("generateDraftOperations: sections start while batchA is still pending (shared pool)", async () => {
  let batchAStarted = false;
  let batchAResolved = false;
  let batchBSawBatchAPending = false;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      batchAStarted = true;
      // batchA 挂起，直到分组观察到它在途
      while (!batchBSawBatchAPending) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      batchAResolved = true;
      return { ok: true, summary: "首屏完成", operations: [], model: "test" };
    }
    // 任一分组被调用时，若 batchA 仍未返回 → 证明两者在共享池下并行
    if (batchAStarted && !batchAResolved) batchBSawBatchAPending = true;
    return { ok: true, summary: `${args.scope.sections[0]} 完成`, operations: [], model: "test" };
  };

  const out = await Promise.race([
    generateDraftOperations({
      intent,
      templateId: "forge",
      hiddenSections: [],
      draftOps: fakeProvider,
      taskTimeoutMs: 500,
    }),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 3000)),
  ]);

  assert.notEqual(out, "hung", "不应死锁：分组必须在 batchA 挂起时就能推进");
  assert.equal(batchBSawBatchAPending, true, "分组应在 batchA 返回前启动（共享池，而非串行等待）");
  assert.equal(batchAResolved, true, "batchA 应在分组让路后正常返回");
});

test("generateDraftOperations: provider exceptions are isolated to the failed section", async () => {
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return { ok: true, summary: "首屏完成", operations: [], model: "test" };
    }
    if (args.scope.sections.length > 1) throw new Error("整批异常");
    if (args.scope.sections[0] === "about") throw new Error("关于板块异常");
    return { ok: true, summary: `${args.scope.sections[0]} 完成`, operations: [], model: "test" };
  };

  const out = await generateDraftOperations({
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
    taskTimeoutMs: 20,
  });

  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.partial, true);
    assert.deepEqual(out.missingSections, ["about"]);
    assert.deepEqual(out.completedSections, ["hero", "features", "products", "contact"]);
  }
});

test("generateDraftOperations: unknown template explicitly falls back to forge", async () => {
  const seenTemplates: string[] = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seenTemplates.push(args.templateId);
    return { ok: true, summary: "完成", operations: [], model: "test" };
  };

  const out = await generateDraftOperations({
    intent,
    templateId: "missing-template",
    hiddenSections: [],
    draftOps: fakeProvider,
  });

  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.requestedTemplateId, "missing-template");
    assert.equal(out.appliedTemplateId, "forge");
    assert.match(out.templateFallbackReason ?? "", /不可用/);
  }
  assert.deepEqual([...new Set(seenTemplates)], ["forge"]);
});

test("generateDraftOperations: provider fallback includes the compatible template operation", async () => {
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.templateId === "atlas") return { ok: false, code: "timeout", error: "原模板超时" };
    return { ok: true, summary: "兼容模板首屏", operations: [], model: "test" };
  };

  const out = await generateDraftOperations({ intent, templateId: "atlas", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.appliedTemplateId, "forge");
    assert.ok(out.operations.some((operation) => operation.op === "set_template" && operation.templateId === "forge"));
  }
});

test("generateDraftOperations: parent signal aborts both active batches", async () => {
  const controller = new AbortController();
  let abortedCalls = 0;
  const fakeProvider: DraftOpsProvider = async (args) => new Promise((resolve) => {
    args.signal?.addEventListener("abort", () => {
      abortedCalls += 1;
      resolve({ ok: false, code: "aborted", error: "已取消" });
    }, { once: true });
  });
  const generationArgs = {
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
    taskTimeoutMs: 100,
    signal: controller.signal,
  };

  const pending = generateDraftOperations(generationArgs);
  setTimeout(() => controller.abort(new Error("客户端已取消")), 2);
  const out = await Promise.race([
    pending,
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 40)),
  ]);

  assert.notEqual(out, "hung");
  assert.equal(abortedCalls, 2);
});

test("generateDraftOperations: template fallback shares the original deadline", async () => {
  const seenTemplates: string[] = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seenTemplates.push(args.templateId);
    if (args.templateId === "atlas") return new Promise<never>(() => {});
    return { ok: true, summary: "兼容模板完成", operations: [], model: "test" };
  };
  const generationArgs = {
    intent,
    templateId: "atlas",
    hiddenSections: [],
    draftOps: fakeProvider,
    taskTimeoutMs: 30,
    deadlineAt: Date.now() + 8,
  };

  await generateDraftOperations(generationArgs);

  assert.equal(seenTemplates.includes("forge"), false);
});

test("generateDraftOperations: fallback cancellation returns the fallback terminal reason", async () => {
  const controller = new AbortController();
  let forgeStarted = false;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.templateId === "atlas") {
      return args.attemptHint?.includes("第一批")
        ? { ok: false, code: "provider_error", error: "原模板失败" }
        : { ok: true, summary: "板块完成", operations: [], model: "test" };
    }
    forgeStarted = true;
    return new Promise((resolve) => {
      args.signal?.addEventListener("abort", () => resolve({ ok: false, code: "aborted", error: "兼容模板已取消" }), { once: true });
    });
  };

  const pending = generateDraftOperations({
    intent,
    templateId: "atlas",
    hiddenSections: [],
    draftOps: fakeProvider,
    signal: controller.signal,
  });
  while (!forgeStarted) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort(new Error("客户端取消"));
  const out = await pending;

  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "aborted");
});

test("generateDraftOperations: recovery concurrency is limited to two sections", async () => {
  let activeRecoveries = 0;
  let maxActiveRecoveries = 0;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return { ok: true, summary: "首屏完成", operations: [], model: "test" };
    }
    if (args.scope.sections.length > 1) {
      return { ok: false, code: "batch_failed", error: "整批失败" };
    }
    activeRecoveries += 1;
    maxActiveRecoveries = Math.max(maxActiveRecoveries, activeRecoveries);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeRecoveries -= 1;
    return { ok: true, summary: `${args.scope.sections[0]} 完成`, operations: [], model: "test" };
  };

  const out = await generateDraftOperations({
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
  });

  assert.equal(out.ok, true);
  assert.ok(maxActiveRecoveries <= 2, `恢复并发达到 ${maxActiveRecoveries}`);
});

test("generateDraftOperations: insufficient remaining budget skips recovery", async () => {
  let recoveryCalls = 0;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return { ok: true, summary: "首屏完成", operations: [], model: "test" };
    }
    if (args.scope.sections.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return { ok: false, code: "batch_failed", error: "整批失败" };
    }
    recoveryCalls += 1;
    return { ok: true, summary: "恢复完成", operations: [], model: "test" };
  };
  const generationArgs = {
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
    taskTimeoutMs: 40,
    deadlineAt: Date.now() + 15,
  };

  const out = await generateDraftOperations(generationArgs);

  assert.equal(out.ok, true);
  assert.equal(recoveryCalls, 0);
  if (out.ok) assert.equal(out.partial, true);
});

test("generateDraftOperations: compatible fallback is skipped below the 25 second budget floor", async () => {
  const seenTemplates: string[] = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seenTemplates.push(args.templateId);
    if (args.templateId === "atlas" && args.attemptHint?.includes("第一批")) {
      return { ok: false, code: "provider_error", error: "原模板失败" };
    }
    return { ok: true, summary: "完成", operations: [], model: "test" };
  };

  await generateDraftOperations({
    intent,
    templateId: "atlas",
    hiddenSections: [],
    draftOps: fakeProvider,
    deadlineAt: Date.now() + 24_999,
  });

  assert.equal(seenTemplates.includes("forge"), false);
});

// ===== C1 局部重生成（板块级） =====

test("regenerateSectionOperations: scope limited to target section, hint has guardrails", async () => {
  const seen: Array<{ scope: string[]; hint: string }> = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seen.push({ scope: args.scope.sections, hint: args.attemptHint ?? "" });
    return {
      ok: true,
      summary: "重生成优势板块",
      operations: [
        { op: "set_text", target: "features.title", locale: "zh", value: "核心优势（重写）" },
        { op: "update_item", section: "features", index: 0, locale: "zh", title: "新卡片标题" },
      ],
      model: "test",
    };
  };
  const out = await regenerateSectionOperations({
    intent, templateId: "forge", baseDraft: defaultDraft,
    section: "features", direction: "改成环保主题", siteLanguage: "zh",
    draftOps: fakeProvider,
  });
  assert.equal(out.ok, true);
  // scope 只含目标板块
  assert.deepEqual(seen[0].scope, ["features"]);
  // hint 含视觉护栏 + 方向
  assert.match(seen[0].hint, /只重生成 features/);
  assert.match(seen[0].hint, /视觉护栏/);
  assert.match(seen[0].hint, /改成环保主题/);
  // 操作校验通过
  if (out.ok) assert.equal(out.operations.length, 2);
});

test("regenerateSectionOperations: hero section maps to hero targets", async () => {
  const seen: Array<{ scope: string[]; hint: string }> = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seen.push({ scope: args.scope.sections, hint: args.attemptHint ?? "" });
    return {
      ok: true, summary: "重生成首屏",
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "新首屏标题" }],
      model: "test",
    };
  };
  const out = await regenerateSectionOperations({
    intent, templateId: "forge", baseDraft: defaultDraft, section: "hero", draftOps: fakeProvider,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(seen[0].scope, ["hero"]);
  assert.match(seen[0].hint, /hero.title、hero.subtitle、hero.cta/);
  // 无方向 + 默认 text 模式 → hint 含"未指定方向"和"保持卡片数量"
  assert.match(seen[0].hint, /未指定方向/);
  assert.match(seen[0].hint, /保持现有卡片数量不变/);
});

test("regenerateSectionOperations: all mode allows card changes", async () => {
  const seen: Array<{ hint: string }> = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seen.push({ hint: args.attemptHint ?? "" });
    return { ok: true, summary: "s", operations: [{ op: "set_text", target: "services.title", locale: "zh", value: "服务" }], model: "test" };
  };
  await regenerateSectionOperations({
    intent, templateId: "forge", baseDraft: defaultDraft, section: "services", mode: "all", draftOps: fakeProvider,
  });
  assert.match(seen[0].hint, /允许增删该板块的卡片/);
});

test("regenerateSectionOperations: provider failure propagates", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({ ok: false, code: "timeout", error: "超时" });
  const out = await regenerateSectionOperations({
    intent, templateId: "forge", baseDraft: defaultDraft, section: "about", draftOps: fakeProvider,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "timeout");
});

test("regenerateSectionOperations: propagates parent signal and remaining deadline", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const fakeProvider: DraftOpsProvider = async (args) => {
    receivedSignal = args.signal;
    return new Promise((resolve) => {
      args.signal?.addEventListener("abort", () => resolve({ ok: false, code: "timeout", error: "局部生成超时" }), { once: true });
    });
  };
  const regenerateArgs = {
    intent,
    templateId: "forge",
    baseDraft: defaultDraft,
    section: "about" as const,
    draftOps: fakeProvider,
    signal: controller.signal,
    deadlineAt: Date.now() + 8,
  };

  const out = await Promise.race([
    regenerateSectionOperations(regenerateArgs),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 30)),
  ]);

  assert.notEqual(out, "hung");
  assert.equal(receivedSignal?.aborted, true);
  if (out !== "hung") {
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.code, "timeout");
  }
});

test("regenerateMissingSectionsOperations: limits concurrency, shares one deadline, and preserves unrelated content", async () => {
  let active = 0;
  let maxActive = 0;
  let releaseWave!: () => void;
  const wave = new Promise<void>((resolve) => { releaseWave = resolve; });
  const seenDeadlines: number[] = [];
  const seenSections: string[] = [];
  const deadlineAt = Date.now() + 10_000;
  const baseDraft = structuredClone(defaultDraft);
  const originalHero = JSON.stringify(baseDraft.content.hero);
  const fakeProvider: DraftOpsProvider = async (args) => {
    const section = args.scope.sections[0];
    seenSections.push(section);
    seenDeadlines.push(args.deadlineAt ?? 0);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (active === 2) releaseWave();
    await wave;
    active -= 1;
    if (section === "contact") return { ok: false, code: "provider_error", error: "联系板块失败" };
    if (section === "about") {
      return {
        ok: true,
        summary: "关于完成",
        operations: [{ op: "set_text", target: "about.body", locale: "zh", value: "新的公司介绍" }],
        model: "test",
      };
    }
    return {
      ok: true,
      summary: "产品完成",
      operations: [
        { op: "set_text", target: "products.title", locale: "zh", value: "新的产品能力" },
        { op: "set_text", target: "hero.title", locale: "zh", value: "越界修改首屏" },
      ],
      model: "test",
    };
  };

  const outcome = await regenerateMissingSectionsOperations({
    intent,
    templateId: "forge",
    baseDraft,
    sections: ["about", "products", "contact"],
    siteLanguage: "zh",
    draftOps: fakeProvider,
    deadlineAt,
  });

  assert.equal(outcome.ok, true);
  assert.equal(maxActive, 2);
  assert.deepEqual(seenSections.sort(), ["about", "contact", "products"]);
  assert.deepEqual([...new Set(seenDeadlines)], [deadlineAt]);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.completedSections, ["about", "products"]);
  assert.deepEqual(outcome.missingSections, ["contact"]);
  assert.equal(outcome.partial, true);
  assert.equal(outcome.operations.some((operation) => operation.op === "set_text" && operation.target === "hero.title"), false);

  const applied = applySiteOperations(baseDraft, outcome.operations, {
    templateIds: new Set(["forge"]),
    lastChange: "补全缺失板块",
  });
  assert.equal(applied.draft.revision, baseDraft.revision + 1);
  assert.equal(JSON.stringify(applied.draft.content.hero), originalHero);
  assert.equal(applied.draft.content.about.body.zh, "新的公司介绍");
  assert.equal(applied.draft.content.products.title.zh, "新的产品能力");
});

test("regenerateMissingSectionsOperations: returns an error and no operations when every section fails", async () => {
  const outcome = await regenerateMissingSectionsOperations({
    intent,
    templateId: "forge",
    baseDraft: defaultDraft,
    sections: ["about", "products"],
    draftOps: async () => ({ ok: false, code: "timeout", error: "补全超时" }),
    deadlineAt: Date.now() + 10_000,
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.code, "timeout");
});

/**
 * 2026-09-10 回归：站点没有商品时，生成应**隐藏产品板块**。
 *
 * 三件事叠加造成的回归：`products` 在模板契约里是 `required: true`、
 * 生成链路写不出商品（`replace_products` 不在生成白名单）、
 * `defaultDraft.products` 不再预置演示商品 →
 * **新站生成后商品为空 → 发布被 422 拦下**。
 *
 * 修法：不编造商品、也不强制用户先导入，而是隐藏该板块
 * （`products` 是模板级必填，不是业务级必填——政府站/律所本就没有产品目录）。
 */
test("buildGenerationPlan: 无商品时隐藏产品板块", () => {
  const withProducts = buildGenerationPlan(intent, "forge", [], "zh", true);
  assert.ok(withProducts.scope.sections.includes("products"), "有商品时应正常生成产品板块");
  assert.equal(withProducts.hideOps.length, 0);

  const withoutProducts = buildGenerationPlan(intent, "forge", [], "zh", false);
  assert.ok(!withoutProducts.scope.sections.includes("products"), "无商品时不应生成产品板块");
  assert.ok(
    withoutProducts.hideOps.some((op) => op.op === "set_section_visibility" && op.section === "products" && op.visible === false),
    "无商品时应产出隐藏产品板块的操作",
  );
  // 其他板块不受影响
  assert.ok(withoutProducts.scope.sections.includes("about"));
  assert.ok(withoutProducts.scope.sections.includes("contact"));
});

test("buildGenerationPlan: hasProducts 缺省保持既有行为（向后兼容）", () => {
  const plan = buildGenerationPlan(intent, "forge", []);
  assert.ok(plan.scope.sections.includes("products"), "缺省应视为「有商品」，不隐藏");
});

// ===== 方向 2：粘贴素材 → 生成（2026-09-10）=====
//
// 背景：`extraContext` 此前只随 analyze 发送，execute 请求体根本没有它，
// 生成层 prompt 也只拼了 intent 的 5 个字段摘要 →
// **用户粘的东西从不参与内容生成**，这是「内容精度不够」最直接的原因。

test("buildSourceMaterialBlock: 素材进入提示，且带「不编造」约束", () => {
  const block = buildSourceMaterialBlock("华辰光伏成立于 2001 年，通过 ISO 9001 认证。");
  assert.match(block, /华辰光伏成立于 2001 年/);
  assert.match(block, /以此为准/);
  assert.match(block, /不要编造/);
});

test("buildSourceMaterialBlock: 空/空白素材不产生注入块（不污染提示）", () => {
  assert.equal(buildSourceMaterialBlock(undefined), "");
  assert.equal(buildSourceMaterialBlock(""), "");
  assert.equal(buildSourceMaterialBlock("   \n  "), "");
});

test("buildSourceMaterialBlock: 超预算截断并明确标注（避免模型以为看到了全文）", () => {
  const long = "企".repeat(SOURCE_MATERIAL_BUDGET + 500);
  const block = buildSourceMaterialBlock(long);
  assert.ok(block.includes("已截断"), "超预算必须标注已截断");
  // 正文不应超过预算
  assert.ok(block.length < long.length, "应确实截断，而非原样传入");
});

test("generateDraftOperations: sourceMaterial 真的进了批次提示", async () => {
  const seen: string[] = [];
  const fakeProvider: DraftOpsProvider = async (args) => {
    seen.push(args.attemptHint ?? "");
    return args.attemptHint?.includes("第一批")
      ? { ok: true, summary: "s", operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" }], model: "test" }
      : { ok: true, summary: "s", operations: [{ op: "set_text", target: "about.title", locale: "zh", value: "关于" }], model: "test" };
  };
  await generateDraftOperations({
    intent,
    templateId: "forge",
    hiddenSections: [],
    draftOps: fakeProvider,
    sourceMaterial: "华辰光伏：专注光伏组件制造，通过 ISO 9001 认证。",
  });
  assert.ok(seen.length >= 2, "批A + 批B 都应被调用");
  for (const hint of seen) {
    assert.match(hint, /华辰光伏/, "每个批次提示都应带上素材");
  }
});

test("ensureHeroTitle 兜底：模型漏写 hero.title 时用企业名补上，写了则不覆盖", async () => {
  const provider = (batchAOps: SiteOperation[]): DraftOpsProvider => async (args) => {
    if (args.attemptHint?.includes("第一批")) return { ok: true, summary: "骨架", operations: batchAOps, model: "test" };
    return { ok: false, code: "timeout", error: "超时" };
  };

  // 漏写 → 用企业名补（intent.companyName = "华辰光伏"）
  const missing = await generateDraftOperations({
    intent, templateId: "forge", hiddenSections: [],
    draftOps: provider([{ op: "set_text", target: "hero.subtitle", locale: "zh", value: "副文" }]),
  });
  assert.equal(missing.ok, true);
  if (missing.ok) {
    const hero = missing.operations.find((op) => op.op === "set_text" && op.target === "hero.title");
    assert.ok(hero, "漏写时必须兜底");
    assert.equal(hero.op === "set_text" ? hero.value : "", "华辰光伏");
  }

  // 写了 → 原样保留，不覆盖
  const present = await generateDraftOperations({
    intent, templateId: "forge", hiddenSections: [],
    draftOps: provider([{ op: "set_text", target: "hero.title", locale: "zh", value: "模型写的标题" }]),
  });
  assert.equal(present.ok, true);
  if (present.ok) {
    const heroes = present.operations.filter((op) => op.op === "set_text" && op.target === "hero.title");
    assert.equal(heroes.length, 1, "不得重复下发 hero.title");
    assert.equal(heroes[0].op === "set_text" ? heroes[0].value : "", "模型写的标题");
  }
});
