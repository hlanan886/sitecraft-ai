import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { ensureDatabaseSchema, getDatabasePool, withDatabaseTransaction } from "./postgres.ts";
import { defaultDraft, normalizeDraft, templates, type SiteDraft } from "./site-model.ts";
import { applySiteOperations, type SiteOperation } from "./site-operations.ts";
import { throwIfAborted } from "./abort-utils.ts";
import type { GenerationProvenance } from "./generation-record.ts";

export type ChangeSource = "ai" | "import" | "manual" | "migration" | "template";
/** AI 变更的可追溯元数据；不包含原始输入正文，只保留哈希和结构化范围。 */
export type ChangeProvenance = GenerationProvenance & {
  baseRevision: number;
  resultRevision?: number;
  selectedTarget?: string | null;
  appliedTargets?: string[];
};
export type ChangeSet = {
  id: string;
  baseRevision: number;
  revision: number;
  summary: string;
  source: ChangeSource;
  operations: SiteOperation[];
  inverseOperations: SiteOperation[];
  appliedTargets: string[];
  model?: string;
  latencyMs?: number;
  provenance?: ChangeProvenance;
  createdAt: string;
};
export type SiteRecord = {
  siteId: string;
  draft: SiteDraft;
  history: ChangeSet[];
  future: ChangeSet[];
  updatedAt: string;
};
export type SiteSnapshot = {
  draft: SiteDraft;
  history: Array<Pick<ChangeSet, "id" | "revision" | "summary" | "source" | "appliedTargets" | "model" | "latencyMs" | "provenance" | "createdAt">>;
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: string;
  isNew?: boolean;
};
export type SiteSeed = {
  name: string;
  templateId: string;
  locales: SiteDraft["locale"][];
  initialDraft: SiteDraft;
};

const storageRoot = path.join(process.cwd(), ".sitecraft-data", "sites");
const templateIds = new Set(templates.map((item) => item.id));
const workspaceId = process.env.DEFAULT_WORKSPACE_ID || "demo";
const usePostgres = process.env.SITE_STORE === "postgres" || process.env.NODE_ENV === "production";
const globalStore = globalThis as typeof globalThis & { __sitecraftLocks?: Map<string, Promise<void>> };
const locks = globalStore.__sitecraftLocks ?? new Map<string, Promise<void>>();
globalStore.__sitecraftLocks = locks;

function safeSiteId(siteId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(siteId)) throw new Error("Invalid site id");
  return siteId;
}
function recordPath(siteId: string) {
  return path.join(storageRoot, `${safeSiteId(siteId)}.json`);
}
async function readRecord(siteId: string): Promise<SiteRecord | null> {
  try {
    const raw = JSON.parse(await readFile(recordPath(siteId), "utf8")) as Partial<SiteRecord>;
    return {
      siteId,
      draft: normalizeDraft(raw.draft),
      history: Array.isArray(raw.history) ? raw.history as ChangeSet[] : [],
      future: Array.isArray(raw.future) ? raw.future as ChangeSet[] : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}
async function writeRecord(record: SiteRecord, signal?: AbortSignal) {
  await mkdir(storageRoot, { recursive: true });
  const target = recordPath(record.siteId);
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(record, null, 2), "utf8");
  try {
    throwIfAborted(signal);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}
async function withSiteLock<T>(siteId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(siteId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queue = previous.then(() => current);
  locks.set(siteId, queue);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(siteId) === queue) locks.delete(siteId);
  }
}
function createRecord(siteId: string, draft: SiteDraft = defaultDraft): SiteRecord {
  return { siteId, draft: normalizeDraft(draft), history: [], future: [], updatedAt: new Date().toISOString() };
}
function draftFromSeed(seed: SiteSeed) {
  const normalized = normalizeDraft(seed.initialDraft);
  return normalizeDraft({
    ...normalized,
    siteName: seed.name,
    companyName: seed.name,
    templateId: seed.templateId,
    locale: seed.locales[0] ?? normalized.locale,
  });
}
export function snapshot(record: SiteRecord, isNew?: boolean): SiteSnapshot {
  return {
    draft: structuredClone(record.draft),
    history: record.history.slice(-30).reverse().map(({ id, revision, summary, source, appliedTargets, model, latencyMs, provenance, createdAt }) => ({
      id, revision, summary, source, appliedTargets, model, latencyMs, provenance, createdAt,
    })),
    canUndo: record.history.length > 0,
    canRedo: record.future.length > 0,
    updatedAt: record.updatedAt,
    ...(isNew === undefined ? {} : { isNew }),
  };
}
async function getLocalSite(siteId: string) {
  return withSiteLock(siteId, async () => {
    const existing = await readRecord(siteId);
    if (existing) return snapshot(existing, false);
    const record = createRecord(siteId);
    await writeRecord(record);
    return snapshot(record, true);
  });
}
async function createLocalSite(seed: SiteSeed) {
  const id = crypto.randomUUID();
  return withSiteLock(id, async () => {
    const record = createRecord(id, draftFromSeed(seed));
    await writeRecord(record);
    return { id, ...snapshot(record, true) };
  });
}
export type CommitResult =
  | { status: "applied"; record: SiteRecord; changeSet: ChangeSet }
  | { status: "no_change"; record: SiteRecord }
  | { status: "conflict"; record: SiteRecord };

type UndoTargetChange = Pick<ChangeSet, "id" | "revision" | "summary" | "source" | "appliedTargets" | "createdAt">;
export type ConversationalUndoResult =
  | { status: "applied"; record: SiteRecord; changeSet: ChangeSet; undoneChange: UndoTargetChange }
  | { status: "unsafe"; record: SiteRecord; targetChange: UndoTargetChange; laterChanges: UndoTargetChange[] }
  | { status: "empty"; record: SiteRecord }
  | { status: "no_change"; record: SiteRecord; targetChange: UndoTargetChange }
  | { status: "conflict"; record: SiteRecord };

type CommitArgs = {
  siteId: string;
  baseRevision: number;
  operations: SiteOperation[];
  summary: string;
  source: ChangeSource;
  model?: string;
  latencyMs?: number;
  provenance?: ChangeProvenance;
  signal?: AbortSignal;
};

async function commitLocalOperations(args: CommitArgs): Promise<CommitResult> {
  return withSiteLock(args.siteId, async () => {
    throwIfAborted(args.signal);
    const record = (await readRecord(args.siteId)) ?? createRecord(args.siteId);
    if (record.draft.revision !== args.baseRevision) return { status: "conflict", record };
    const result = applySiteOperations(record.draft, args.operations, {
      templateIds,
      lastChange: args.source === "ai" ? "刚刚通过 AI 保存" : "草稿已保存",
    });
    if (!result.changed) return { status: "no_change", record };
    const changeSet: ChangeSet = {
      id: crypto.randomUUID(), baseRevision: record.draft.revision, revision: result.draft.revision,
      summary: args.summary, source: args.source, operations: structuredClone(args.operations),
      inverseOperations: result.inverseOperations, appliedTargets: result.appliedTargets,
      ...(args.model ? { model: args.model } : {}),
      ...(args.latencyMs === undefined ? {} : { latencyMs: args.latencyMs }),
      ...(args.provenance ? {
        provenance: {
          ...args.provenance,
          baseRevision: record.draft.revision,
          resultRevision: result.draft.revision,
          appliedTargets: structuredClone(result.appliedTargets),
        },
      } : {}),
      createdAt: new Date().toISOString(),
    };
    record.draft = result.draft;
    record.history = [...record.history, changeSet].slice(-50);
    record.future = [];
    record.updatedAt = new Date().toISOString();
    await writeRecord(record, args.signal);
    return { status: "applied", record, changeSet };
  });
}
async function moveLocalHistory(siteId: string, action: "undo" | "redo") {
  return withSiteLock(siteId, async () => {
    const record = (await readRecord(siteId)) ?? createRecord(siteId);
    const changeSet = action === "undo" ? record.history.at(-1) : record.future[0];
    if (!changeSet) return { status: "empty" as const, record };
    const result = applySiteOperations(record.draft, action === "undo" ? changeSet.inverseOperations : changeSet.operations, {
      templateIds,
      lastChange: action === "undo" ? "刚刚撤销一次修改" : "刚刚重做一次修改",
    });
    if (!result.changed) return { status: "empty" as const, record };
    record.draft = result.draft;
    if (action === "undo") {
      record.history = record.history.slice(0, -1);
      record.future = [changeSet, ...record.future].slice(0, 50);
    } else {
      record.future = record.future.slice(1);
      record.history = [...record.history, changeSet].slice(-50);
    }
    record.updatedAt = new Date().toISOString();
    await writeRecord(record);
    return { status: "applied" as const, record, changeSet, appliedTargets: result.appliedTargets };
  });
}

type SiteRow = {
  site_id: string;
  draft: unknown;
  history: unknown;
  future: unknown;
  updated_at: Date | string;
};

function rowToRecord(row: SiteRow): SiteRecord {
  return {
    siteId: row.site_id,
    draft: normalizeDraft(row.draft),
    history: Array.isArray(row.history) ? row.history as ChangeSet[] : [],
    future: Array.isArray(row.future) ? row.future as ChangeSet[] : [],
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function lockPostgresRecord(client: PoolClient, siteId: string) {
  safeSiteId(siteId);
  const initial = createRecord(siteId);
  await client.query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4)
     ON CONFLICT (workspace_id, site_id) DO NOTHING`,
    [workspaceId, siteId, JSON.stringify(initial.draft), initial.updatedAt],
  );
  const result = await client.query<SiteRow>(
    `SELECT site_id, draft, history, future, updated_at
     FROM sitecraft_sites WHERE workspace_id = $1 AND site_id = $2 FOR UPDATE`,
    [workspaceId, siteId],
  );
  if (!result.rows[0]) throw new Error("Site record could not be created");
  return rowToRecord(result.rows[0]);
}

async function savePostgresRecord(client: PoolClient, record: SiteRecord) {
  await client.query(
    `UPDATE sitecraft_sites
     SET draft = $3::jsonb, history = $4::jsonb, future = $5::jsonb, updated_at = $6
     WHERE workspace_id = $1 AND site_id = $2`,
    [workspaceId, record.siteId, JSON.stringify(record.draft), JSON.stringify(record.history), JSON.stringify(record.future), record.updatedAt],
  );
}

async function getPostgresSite(siteId: string) {
  safeSiteId(siteId);
  await ensureDatabaseSchema();
  const initial = createRecord(siteId);
  const inserted = await getDatabasePool().query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4)
     ON CONFLICT (workspace_id, site_id) DO NOTHING
     RETURNING site_id`,
    [workspaceId, siteId, JSON.stringify(initial.draft), initial.updatedAt],
  );
  const result = await getDatabasePool().query<SiteRow>(
    `SELECT site_id, draft, history, future, updated_at
     FROM sitecraft_sites WHERE workspace_id = $1 AND site_id = $2`,
    [workspaceId, siteId],
  );
  if (!result.rows[0]) throw new Error("Site record could not be read");
  return snapshot(rowToRecord(result.rows[0]), inserted.rowCount === 1);
}

async function createPostgresSite(seed: SiteSeed) {
  await ensureDatabaseSchema();
  const id = crypto.randomUUID();
  const record = createRecord(id, draftFromSeed(seed));
  const inserted = await getDatabasePool().query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4)
     RETURNING site_id`,
    [workspaceId, id, JSON.stringify(record.draft), record.updatedAt],
  );
  if (inserted.rowCount !== 1) throw new Error("Site record could not be created");
  return { id, ...snapshot(record, true) };
}

async function commitPostgresOperations(args: CommitArgs): Promise<CommitResult> {
  return withDatabaseTransaction(async (client) => {
    throwIfAborted(args.signal);
    const record = await lockPostgresRecord(client, args.siteId);
    if (record.draft.revision !== args.baseRevision) return { status: "conflict", record };
    const result = applySiteOperations(record.draft, args.operations, {
      templateIds,
      lastChange: args.source === "ai" ? "刚刚通过 DeepSeek 保存" : "草稿已保存",
    });
    if (!result.changed) return { status: "no_change", record };
    const changeSet: ChangeSet = {
      id: crypto.randomUUID(),
      baseRevision: record.draft.revision,
      revision: result.draft.revision,
      summary: args.summary,
      source: args.source,
      operations: structuredClone(args.operations),
      inverseOperations: result.inverseOperations,
      appliedTargets: result.appliedTargets,
      ...(args.model ? { model: args.model } : {}),
      ...(args.latencyMs === undefined ? {} : { latencyMs: args.latencyMs }),
      ...(args.provenance ? {
        provenance: {
          ...args.provenance,
          baseRevision: record.draft.revision,
          resultRevision: result.draft.revision,
          appliedTargets: structuredClone(result.appliedTargets),
        },
      } : {}),
      createdAt: new Date().toISOString(),
    };
    record.draft = result.draft;
    record.history = [...record.history, changeSet].slice(-50);
    record.future = [];
    record.updatedAt = new Date().toISOString();
    await savePostgresRecord(client, record);
    return { status: "applied", record, changeSet };
  }, args.signal);
}

async function movePostgresHistory(siteId: string, action: "undo" | "redo") {
  return withDatabaseTransaction(async (client) => {
    const record = await lockPostgresRecord(client, siteId);
    const changeSet = action === "undo" ? record.history.at(-1) : record.future[0];
    if (!changeSet) return { status: "empty" as const, record };
    const result = applySiteOperations(record.draft, action === "undo" ? changeSet.inverseOperations : changeSet.operations, {
      templateIds,
      lastChange: action === "undo" ? "刚刚撤销一次修改" : "刚刚重做一次修改",
    });
    if (!result.changed) return { status: "empty" as const, record };
    record.draft = result.draft;
    if (action === "undo") {
      record.history = record.history.slice(0, -1);
      record.future = [changeSet, ...record.future].slice(0, 50);
    } else {
      record.future = record.future.slice(1);
      record.history = [...record.history, changeSet].slice(-50);
    }
    record.updatedAt = new Date().toISOString();
    await savePostgresRecord(client, record);
    return { status: "applied" as const, record, changeSet, appliedTargets: result.appliedTargets };
  });
}

export function getSite(siteId: string) {
  return usePostgres ? getPostgresSite(siteId) : getLocalSite(siteId);
}

export function createSite(seed: SiteSeed) {
  return usePostgres ? createPostgresSite(seed) : createLocalSite(seed);
}

export function commitOperations(args: CommitArgs): Promise<CommitResult> {
  return usePostgres ? commitPostgresOperations(args) : commitLocalOperations(args);
}

export function moveHistory(siteId: string, action: "undo" | "redo") {
  return usePostgres ? movePostgresHistory(siteId, action) : moveLocalHistory(siteId, action);
}

function undoTarget(changeSet: ChangeSet): UndoTargetChange {
  const { id, revision, summary, source, appliedTargets, createdAt } = changeSet;
  return { id, revision, summary, source, appliedTargets: structuredClone(appliedTargets), createdAt };
}

async function readFullRecord(siteId: string) {
  if (!usePostgres) return (await readRecord(siteId)) ?? createRecord(siteId);
  await getPostgresSite(siteId);
  const result = await getDatabasePool().query<SiteRow>(
    `SELECT site_id, draft, history, future, updated_at
     FROM sitecraft_sites WHERE workspace_id = $1 AND site_id = $2`,
    [workspaceId, siteId],
  );
  if (!result.rows[0]) throw new Error("Site record could not be read");
  return rowToRecord(result.rows[0]);
}

export function isConversationalUndoMessage(message: string) {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, "").replace(/[。！？!?，,]/g, "");
  return /^(?:请帮我|帮我|请)?(?:改回上一条|撤销(?:刚才|上一条|上一次)(?:的)?(?:ai)?(?:修改|改动)|恢复到(?:上一次|上一条)(?:ai)?(?:修改|改动)前)$/.test(normalized);
}

export async function undoLatestAiChange(args: {
  siteId: string;
  baseRevision: number;
  signal?: AbortSignal;
}): Promise<ConversationalUndoResult> {
  const record = await readFullRecord(args.siteId);
  if (record.draft.revision !== args.baseRevision) return { status: "conflict", record };
  const targetIndex = record.history.findLastIndex((changeSet) => changeSet.source === "ai");
  if (targetIndex < 0) return { status: "empty", record };
  const targetChange = record.history[targetIndex];
  const laterChanges = record.history.slice(targetIndex + 1);
  if (laterChanges.length) {
    return {
      status: "unsafe",
      record,
      targetChange: undoTarget(targetChange),
      laterChanges: laterChanges.map(undoTarget),
    };
  }
  const committed = await commitOperations({
    siteId: args.siteId,
    baseRevision: args.baseRevision,
    operations: targetChange.inverseOperations,
    summary: `撤销 AI 修改：${targetChange.summary}`,
    source: "manual",
    signal: args.signal,
  });
  if (committed.status === "conflict") return { status: "conflict", record: committed.record };
  if (committed.status === "no_change") return { status: "no_change", record: committed.record, targetChange: undoTarget(targetChange) };
  return { status: "applied", record: committed.record, changeSet: committed.changeSet, undoneChange: undoTarget(targetChange) };
}

export function getSiteStoreStatus() {
  return { driver: usePostgres ? "postgres" as const : "development-file" as const, shared: usePostgres };
}
