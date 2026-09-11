/**
 * 生成存证（Q3）
 *
 * 每次 AI 生成（execute）成功时，把关键信息落 PG 表，供人工抽查/质量回溯。
 * 存"关键字段"不含完整草稿（省空间）：输入、意图、操作数、耗时、模型、模板、状态。
 * 生产用 PG，开发（SITE_STORE != postgres 且非 production）退化为内存/无操作，避免本地无 DB 时崩。
 */

import { createHash } from "node:crypto";
import { getDatabasePool, ensureDatabaseSchema } from "./postgres.ts";
import type { SiteIntent } from "./site-intent.ts";
import type { SiteOperation } from "./site-operations.ts";
import { getPromptDefinition, type PromptKey } from "./prompt-registry.ts";

export type GenerationProvenance = {
  provider: string;
  model: string;
  promptId: string;
  promptVersion: string;
  promptFingerprint: string;
  manifestVersion: number;
  templateId: string;
  buildRevision: number;
  inputHash: string;
};

export type GenerationProvenanceInput = {
  provider: string;
  model: string;
  promptKey: PromptKey;
  manifestVersion: number;
  templateId: string;
  buildRevision: number;
  inputText: string;
};

export function createGenerationProvenance(input: GenerationProvenanceInput): GenerationProvenance {
  const prompt = getPromptDefinition(input.promptKey);
  if (!input.provider.trim() || !input.model.trim()) throw new Error("Generation provenance requires provider and model");
  if (!Number.isInteger(input.manifestVersion) || input.manifestVersion < 0) throw new Error("Invalid manifest version");
  if (!Number.isInteger(input.buildRevision) || input.buildRevision < 0) throw new Error("Invalid build revision");
  return {
    provider: input.provider,
    model: input.model,
    promptId: prompt.id,
    promptVersion: prompt.version,
    promptFingerprint: prompt.fingerprint,
    manifestVersion: input.manifestVersion,
    templateId: input.templateId,
    buildRevision: input.buildRevision,
    inputHash: createHash("sha256").update(input.inputText, "utf8").digest("hex"),
  };
}

export type GenerationRecordInput = {
  siteId: string;
  inputText: string;
  intent: SiteIntent;
  operations: SiteOperation[];
  templateId: string;
  latencyMs: number;
  model: string;
  status: "applied" | "no_change" | "conflict" | "error";
  /** 用户最终拿到的结果，不与传输层 status 混用。 */
  outcome: "complete" | "partial" | "no_change" | "conflict" | "error";
  /** 完整建站与局部重生成必须分开统计。 */
  mode: "full" | "regenerate";
  missingSections: string[];
  requestedTemplateId: string;
  appliedTemplateId: string;
  fallbackReason?: string;
  errorCode?: string;
  provenance?: GenerationProvenance;
  /** 附加信息：如重生成板块、失败原因 */
  detail?: string;
};

export type GenerationRecord = Omit<GenerationRecordInput, "detail" | "fallbackReason" | "errorCode"> & {
  id: number;
  detail: string;
  fallbackReason: string;
  errorCode: string;
  provenance?: GenerationProvenance;
  createdAt: string;
};

export type GenerationHealthMetrics = {
  sampleSize: number;
  delivered: number;
  deliveryRate: number;
  partialRate: number;
  templateFallbackRate: number;
  failureRate: number;
  timeoutRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

const usePostgres =
  process.env.SITE_STORE === "postgres" || process.env.NODE_ENV === "production";

export function isGenerationRecordEnabled() {
  return usePostgres;
}

/** 建表（幂等，随 ensureDatabaseSchema 一起） */
export async function ensureGenerationRecordSchema() {
  await ensureDatabaseSchema();
  await getDatabasePool().query(`
    CREATE TABLE IF NOT EXISTS generation_records (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      input_text TEXT NOT NULL,
      intent JSONB NOT NULL,
      operations JSONB NOT NULL,
      template_id TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'complete',
      mode TEXT NOT NULL DEFAULT 'full',
      missing_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      requested_template_id TEXT NOT NULL DEFAULT '',
      applied_template_id TEXT NOT NULL DEFAULT '',
      fallback_reason TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // 兼容已有表：只增列并回填模板语义，不重写历史记录。
  await getDatabasePool().query(`
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'complete';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'full';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS missing_sections JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS requested_template_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS applied_template_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS fallback_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS error_code TEXT NOT NULL DEFAULT '';
    ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;
    UPDATE generation_records SET requested_template_id = template_id WHERE requested_template_id = '';
    UPDATE generation_records SET applied_template_id = template_id WHERE applied_template_id = '';
  `);
}

/** 写入一条生成存证（fail-open：存证失败不影响主流程） */
export async function recordGeneration(input: GenerationRecordInput): Promise<void> {
  if (!usePostgres) return;
  try {
    await ensureGenerationRecordSchema();
    await getDatabasePool().query(
      `INSERT INTO generation_records (
         site_id, input_text, intent, operations, template_id, latency_ms, model, status, detail,
         outcome, mode, missing_sections, requested_template_id, applied_template_id, fallback_reason, error_code, provenance
       ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17::jsonb)`,
      [
        input.siteId,
        "",
        JSON.stringify(input.intent),
        JSON.stringify(input.operations),
        input.templateId,
        input.latencyMs,
        input.model,
        input.status,
        input.detail ?? "",
        input.outcome,
        input.mode,
        JSON.stringify(input.missingSections),
        input.requestedTemplateId,
        input.appliedTemplateId,
        input.fallbackReason ?? "",
        input.errorCode ?? "",
        JSON.stringify(input.provenance ?? {}),
      ],
    );
  } catch (error) {
    // 存证是辅助功能，失败不阻塞生成；生产可加日志
    console.error("recordGeneration failed:", error instanceof Error ? error.message : error);
  }
}

/** 查询最近 N 条存证（供生成页导出） */
export async function listGenerationRecords(limit = 50): Promise<GenerationRecord[]> {
  if (!usePostgres) return [];
  await ensureGenerationRecordSchema();
  const result = await getDatabasePool().query<GenerationRecord>(
    `SELECT id,
       site_id AS "siteId", ''::text AS "inputText", intent, operations,
       template_id AS "templateId", latency_ms AS "latencyMs", model, status, detail,
       outcome, mode, missing_sections AS "missingSections",
       requested_template_id AS "requestedTemplateId", applied_template_id AS "appliedTemplateId",
       fallback_reason AS "fallbackReason", error_code AS "errorCode", provenance, created_at AS "createdAt"
     FROM generation_records ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

function nearestRank(sorted: number[], percentile: number) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

/** 只汇总完整建站终态；局部重生成不污染建站成功率和耗时。 */
export function summarizeGenerationRecords(records: GenerationRecord[]): GenerationHealthMetrics {
  const full = records.filter((record) => record.mode === "full");
  const sampleSize = full.length;
  const deliveredRecords = full.filter((record) => record.outcome === "complete" || record.outcome === "partial");
  const delivered = deliveredRecords.length;
  const failures = full.filter((record) => record.outcome === "error" || record.outcome === "conflict").length;
  const latencies = full.map((record) => Math.max(0, record.latencyMs)).sort((a, b) => a - b);
  const rate = (count: number, denominator: number) => denominator > 0 ? count / denominator : 0;
  return {
    sampleSize,
    delivered,
    deliveryRate: rate(delivered, sampleSize),
    partialRate: rate(deliveredRecords.filter((record) => record.outcome === "partial").length, delivered),
    templateFallbackRate: rate(deliveredRecords.filter((record) => record.requestedTemplateId !== record.appliedTemplateId).length, delivered),
    failureRate: rate(failures, sampleSize),
    timeoutRate: rate(full.filter((record) => record.errorCode === "timeout").length, sampleSize),
    p50LatencyMs: nearestRank(latencies, 0.5),
    p95LatencyMs: nearestRank(latencies, 0.95),
  };
}
