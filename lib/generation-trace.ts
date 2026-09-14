/**
 * 生成全过程痕迹（P0 诊断可运行）。
 *
 * env `SITECRAFT_LOG_GENERATION=1` 开启后，把每次 AI 生成的关键过程事件
 * 以单行 JSON 追加到 `.sitecraft-data/logs/generation/<runId>.jsonl`：
 *   run.begin → batch.start → model.request(完整 system+user) → model.response(原始返回)
 *   → batch.adopted(逐槽 slotMap+容量) → fallback → run.outcome
 *
 * 设计约束：
 *  - flag 默认关，关闭时所有函数立即返回，零开销；
 *  - fail-open：任何写盘/序列化错误都不抛给调用方；
 *  - 模块内禁收 apiKey/任何鉴权信息；日志路径不可由请求参数控制（防 SSRF/目录注入）；
 *  - 目录 `.sitecraft-data/logs/generation/` 已在 .gitignore，不会进版本库；
 *  - 含用户简介与草稿全文，仅本地诊断，勿上传、勿在生产开此 flag。
 *
 * 同时承载 reconcileSectionUnderstanding 纯函数（对账模型声明 vs 实际操作/容量），
 * 供 generation_records 存证与离线单测。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOG_ROOT = path.join(".sitecraft-data", "logs", "generation");

export type TraceBatchId = "batchA" | "batchB" | "recovery" | "regenerate";

export type GenerationTraceEvent =
  | {
      kind: "run.begin";
      runId: string;
      mode: "full" | "regenerate";
      siteId?: string;
      requestedTemplateId: string;
      appliedTemplateId: string;
      templateFallbackReason?: string;
      sections: string[];
      siteLanguage: string;
      deadlineAt?: number;
      ts: number;
    }
  | {
      kind: "batch.start";
      runId: string;
      batch: TraceBatchId;
      sections: string[];
      templateId: string;
      manifestVersion: number;
      ts: number;
    }
  | {
      kind: "model.request";
      runId: string;
      batch: TraceBatchId;
      attempt: number;
      promptId: string;
      promptVersion: number;
      maxTokens: number;
      messages: Array<{ role: string; content: string }>;
      ts: number;
    }
  | {
      kind: "model.response";
      runId: string;
      batch: TraceBatchId;
      attempt: number;
      finishReason?: string;
      rawContent?: string;
      parseOk: boolean;
      parseError?: string;
      latencyMs: number;
      model?: string;
      ts: number;
    }
  | {
      kind: "batch.result";
      runId: string;
      batch: TraceBatchId;
      ok: boolean;
      code?: string;
      error?: string;
      opCount?: number;
      model?: string;
      latencyMs?: number;
      ts: number;
    }
  | {
      kind: "batch.adopted";
      runId: string;
      batch: TraceBatchId;
      slotMap: Array<{
        slot: string;
        opType: string;
        targetCount: number;
        displayTargets: string[];
        presentationRole?: string;
        capacityMax?: number;
        withinCapacity?: boolean;
      }>;
      ts: number;
    }
  | {
      kind: "fallback";
      runId: string;
      fallbackKind: "template_unavailable" | "template_switch" | "local_fast" | "section_timeout" | "section_failed";
      reason: string;
      requestedTemplateId?: string;
      appliedTemplateId?: string;
      ts: number;
    }
  | {
      kind: "run.outcome";
      runId: string;
      outcome: "complete" | "partial" | "error" | "conflict";
      model?: string;
      partial?: boolean;
      missingSections?: string[];
      requestedTemplateId?: string;
      appliedTemplateId?: string;
      templateFallbackReason?: string;
      validatedRejectedCount?: number;
      ts: number;
    };

export function isGenerationTraceEnabled(): boolean {
  return process.env.SITECRAFT_LOG_GENERATION === "1";
}

export function createTraceRunId(): string {
  return randomUUID();
}

/** 附加一行事件（单行 JSON）。flag 关或出错时静默返回。 */
export function appendGenerationTrace(event: GenerationTraceEvent): void {
  if (!isGenerationTraceEnabled()) return;
  try {
    fs.mkdirSync(LOG_ROOT, { recursive: true });
    fs.appendFileSync(
      path.join(LOG_ROOT, `${event.runId}.jsonl`),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  } catch {
    // fail-open：痕迹日志失败不影响生成主流程
  }
}

/** 简化 event 的 runId 计算指纹（调试用，不进日志）。 */
export function shortFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// ===== 对账：模型"逐节理解声明" vs 实际操作/容量 =====

export type SectionUnderstandingVerdict =
  | "declared_ok"        // 声明 + 操作贴合容量
  | "role_mismatch"      // 声明的 nativeRole ≠ 模板 presentation role（软信号）
  | "overflow"           // 操作数超出模板容量（硬指标失败）
  | "fallback_inconsistent" // 声明 fallbackDeclared=false 却实际走了 generated 兜底（不诚实）
  | "no_declaration"     // 有操作但无该节声明
  | "no_ops"             // 无操作（可能该节本就 hidden/失败）
  | "local_fallback";    // 走了本地快速初稿（无模型声明可对）

export type SectionUnderstandingReport = {
  section: string;
  expectedRole?: string;
  declaredRole?: string;
  roleMatch: boolean;
  opCount: number;
  itemCountEstimate: number;
  capacityMax?: number;
  withinCapacity?: boolean;
  fallbackDeclared?: boolean;
  actualFallback: boolean;
  verdict: SectionUnderstandingVerdict;
};

export type SectionAwarenessDeclaration = {
  section: string;
  nativeRole?: string;
  plannedItems?: number;
  fallbackDeclared?: boolean;
  reason?: string;
};

/**
 * 从模型原始返回 JSON 中 lenient 提取 templateAwareness。
 * 缺字段/畸形一律返回 []（不回退旧行为、不抛错）。
 */
export function extractSectionAwareness(rawContent: unknown): SectionAwarenessDeclaration[] {
  if (typeof rawContent !== "string") return [];
  try {
    const parsed = JSON.parse(rawContent) as { templateAwareness?: unknown };
    if (!Array.isArray(parsed?.templateAwareness)) return [];
    return parsed.templateAwareness
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        section: typeof item.section === "string" ? item.section : "",
        nativeRole: typeof item.nativeRole === "string" ? item.nativeRole : undefined,
        plannedItems: typeof item.plannedItems === "number" ? item.plannedItems : undefined,
        fallbackDeclared: typeof item.fallbackDeclared === "boolean" ? item.fallbackDeclared : undefined,
        reason: typeof item.reason === "string" ? item.reason : undefined,
      }))
      .filter((item) => item.section.length > 0);
  } catch {
    return [];
  }
}

/**
 * 对账：对每个业务板块，把「模型声明」与「实际采用的操作」比对，判定理解与容量是否贴合。
 * 纯函数（不触网/不落盘），供 generation_records 存证与离线单测。
 *
 * @param sections         本次实际生成/恢复覆盖的板块（如 plan.scope.sections）
 * @param ops              实际采用的操作（合并后）
 * @param presentation     capabilitySummary.presentation（含 slot/role/capacityMax）
 * @param declarations     模型声明的 templateAwareness（lenient 提取结果）
 * @param hiddenSections   本次被隐藏的板块（有 ops 的板块不因 hidden 判 no_ops）
 */
export function reconcileSectionUnderstanding(args: {
  sections: string[];
  ops: readonly unknown[];
  presentation?: Array<{ presentationSlot: string; role?: string; capacityMax?: number }>;
  declarations?: SectionAwarenessDeclaration[];
  hiddenSections?: string[];
  localFallback?: boolean;
}): SectionUnderstandingReport[] {
  const hidden = new Set(args.hiddenSections ?? []);
  const presentationBySlot = new Map((args.presentation ?? []).map((p) => [p.presentationSlot, p]));
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return args.sections
    .filter((section) => !hidden.has(section))
    .map((section): SectionUnderstandingReport => {
      const block = presentationBySlot.get(section);
      const declaration = (args.declarations ?? []).find((d) => d.section === section);
      const sectionOps = (args.ops ?? []).filter((rawOp) => {
        const op = asRecord(rawOp);
        if (typeof op.target === "string") return op.target.startsWith(`${section}.`);
        if (typeof op.section === "string") return op.section === section;
        return false;
      });
      // 估算条目数：带 section 的卡片类操作算一条
      const itemCountEstimate = sectionOps.filter((rawOp) => {
        const op = asRecord(rawOp);
        return typeof op.section === "string" && op.section === section;
      }).length;

      const base: SectionUnderstandingReport = {
        section,
        expectedRole: block?.role,
        declaredRole: declaration?.nativeRole,
        roleMatch: Boolean(block?.role && declaration?.nativeRole && declaration.nativeRole === block.role),
        opCount: sectionOps.length,
        itemCountEstimate,
        capacityMax: block?.capacityMax,
        withinCapacity: block?.capacityMax !== undefined ? itemCountEstimate <= block.capacityMax : undefined,
        fallbackDeclared: declaration?.fallbackDeclared,
        actualFallback: args.localFallback ?? false,
        verdict: "no_ops",
      };

      if (args.localFallback) {
        base.verdict = "local_fallback";
        return base;
      }
      if (sectionOps.length === 0) {
        base.verdict = "no_ops";
        return base;
      }
      if (!declaration) {
        base.verdict = "no_declaration";
        return base;
      }
      const roleMismatch = Boolean(block?.role && declaration.nativeRole !== block.role);
      if (base.withinCapacity === false) {
        base.verdict = "overflow";
        return base;
      }
      if (roleMismatch) {
        base.verdict = "role_mismatch";
        return base;
      }
      base.verdict = "declared_ok";
      return base;
    });
}
