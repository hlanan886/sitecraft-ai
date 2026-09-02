import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationPlan, generateDraftOperations, regenerateSectionOperations, type DraftOpsProvider } from "../lib/site-generator.ts";
import type { SiteIntent } from "../lib/site-intent.ts";
import { defaultDraft } from "../lib/site-document.ts";
import type { SiteOperation } from "../lib/site-operations.ts";

const intent: SiteIntent = {
  businessType: "trade",
  companyName: "华辰光伏",
  industry: "光伏组件出口",
  targetAudience: "overseasB2b",
  tone: "professional",
  colorTone: "green",
  coreSections: ["about", "features", "products", "contact"],
  recommendedTemplateId: "atlas",
  summary: "光伏出口企业的双语官网",
};

test("buildGenerationPlan: adds set_template when template is not forge", () => {
  const plan = buildGenerationPlan(intent, "atlas", []);
  assert.equal(plan.leadingOps.length, 2);
  assert.deepEqual(plan.leadingOps[0], { op: "set_template", templateId: "atlas" });
  assert.equal(plan.leadingOps[1].op, "set_design_tokens");
  assert.equal(plan.baseDraft.templateId, "forge"); // base 是默认草稿
  assert.equal(plan.scope.sections.length, 4);
  assert.equal(plan.hideOps.length, 0);
});

test("buildGenerationPlan: no set_template when forge (default)", () => {
  const plan = buildGenerationPlan(intent, "forge", []);
  assert.equal(plan.leadingOps.filter((operation) => operation.op === "set_template").length, 0);
  assert.equal(plan.leadingOps.filter((operation) => operation.op === "set_design_tokens").length, 1);
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
    assert.equal(out.operations.length, 2); // 设计变量 + 批 A
    assert.match(out.summary, /骨架/);
    assert.deepEqual(out.completedSections, ["hero"]);
  }
});

test("generateDraftOperations: batchA failure returns error", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({ ok: false, code: "timeout", error: "超时" });
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "timeout");
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
    assert.equal(out.operations.length, 2);
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

// ===== B2 首稿自评（注入 mock，保不触网） =====

test("generateDraftOperations: selfEval runs when operations >= 3, issues returned", async () => {
  // 3 个操作 → shouldSelfEvaluate 触发 → 注入 mock 返回 issues
  const fakeProvider: DraftOpsProvider = async (args) => {
    const ops: SiteOperation[] = args.attemptHint?.includes("第一批")
      ? [{ op: "set_text", target: "hero.title", locale: "zh", value: "可靠制造" }]
      : [
          { op: "set_text", target: "about.title", locale: "zh", value: "关于我们" },
          { op: "set_text", target: "features.title", locale: "zh", value: "核心优势" },
        ];
    return { ok: true, summary: "s", operations: ops, model: "test" };
  };
  let selfEvalCalls = 0;
  const out = await generateDraftOperations({
    intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider,
    selfEval: async (args) => {
      selfEvalCalls += 1;
      assert.ok(args.operations.length >= 3); // 自评收到合并后的操作
      return [{ severity: "warning", code: "copy", message: "首屏文案偏短" }];
    },
  });
  assert.equal(out.ok, true);
  assert.equal(selfEvalCalls, 1);
  if (out.ok) assert.equal(out.selfEvalIssues.length, 1);
});

test("generateDraftOperations: selfEval skipped when only deterministic design tokens are produced", async () => {
  const fakeProvider: DraftOpsProvider = async () => ({
    ok: true,
    summary: "s",
    operations: [],
    model: "test",
  });
  let selfEvalCalls = 0;
  const out = await generateDraftOperations({
    intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider,
    selfEval: async () => { selfEvalCalls += 1; return []; },
  });
  assert.equal(out.ok, true);
  assert.equal(selfEvalCalls, 0); // 操作 < 3 不触发
  if (out.ok) assert.deepEqual(out.selfEvalIssues, []);
});

test("generateDraftOperations: selfEval failure is fail-open", async () => {
  const fakeProvider: DraftOpsProvider = async (args) => {
    const ops: SiteOperation[] = args.attemptHint?.includes("第一批")
      ? [{ op: "set_text", target: "hero.title", locale: "zh", value: "标题" }]
      : [
          { op: "set_text", target: "about.title", locale: "zh", value: "关于" },
          { op: "set_text", target: "features.title", locale: "zh", value: "优势" },
        ];
    return { ok: true, summary: "s", operations: ops, model: "test" };
  };
  // 自评抛异常 → 不应阻塞生成
  const out = await generateDraftOperations({
    intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider,
    selfEval: async () => { throw new Error("自评挂了"); },
  });
  assert.equal(out.ok, true); // fail-open：生成不失败
});

// ===== B4 并行生成：两批同时请求，批 A 仍决定整体是否可提交 =====

test("generateDraftOperations: batchA failure does not commit even when parallel batchB succeeds", async () => {
  let batchBCalled = false;
  const fakeProvider: DraftOpsProvider = async (args) => {
    if (args.attemptHint?.includes("第一批")) {
      return { ok: false, code: "timeout", error: "批 A 超时" };
    }
    batchBCalled = true;
    return { ok: true, summary: "不应执行", operations: [], model: "test" };
  };
  const out = await generateDraftOperations({ intent, templateId: "forge", hiddenSections: [], draftOps: fakeProvider });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "timeout");
  assert.equal(batchBCalled, true);
});

test("generateDraftOperations: batchA and batchB run concurrently", async () => {
  let active = 0;
  let maxActive = 0;
  const progress: Array<{ phase: string; completedSections: string[] }> = [];
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
  assert.equal(maxActive, 2);
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
        { op: "update_card", section: "features", index: 0, locale: "zh", title: "新卡片标题" },
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
