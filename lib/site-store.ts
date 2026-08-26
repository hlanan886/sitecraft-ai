import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { ensureDatabaseSchema, getDatabasePool, withDatabaseTransaction } from "@/lib/postgres";
import { defaultDraft, normalizeDraft, templates, type SiteDraft } from "@/lib/site-model";
import { applySiteOperations, type SiteOperation } from "@/lib/site-operations";

export type ChangeSource = "ai" | "import" | "manual" | "migration" | "template";
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
  history: Array<Pick<ChangeSet, "id" | "revision" | "summary" | "source" | "appliedTargets" | "model" | "latencyMs" | "createdAt">>;
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: string;
  isNew?: boolean;
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
async function writeRecord(record: SiteRecord) {
  await mkdir(storageRoot, { recursive: true });
  const target = recordPath(record.siteId);
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(record, null, 2), "utf8");
  await rename(temp, target);
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
function createRecord(siteId: string): SiteRecord {
  return { siteId, draft: structuredClone(defaultDraft), history: [], future: [], updatedAt: new Date().toISOString() };
}
export function snapshot(record: SiteRecord, isNew?: boolean): SiteSnapshot {
  return {
    draft: structuredClone(record.draft),
    history: record.history.slice(-30).reverse().map(({ id, revision, summary, source, appliedTargets, model, latencyMs, createdAt }) => ({
      id, revision, summary, source, appliedTargets, model, latencyMs, createdAt,
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
export type CommitResult =
  | { status: "applied"; record: SiteRecord; changeSet: ChangeSet }
  | { status: "no_change"; record: SiteRecord }
  | { status: "conflict"; record: SiteRecord };

type CommitArgs = {
  siteId: string;
  baseRevision: number;
  operations: SiteOperation[];
  summary: string;
  source: ChangeSource;
  model?: string;
  latencyMs?: number;
};

async function commitLocalOperations(args: CommitArgs): Promise<CommitResult> {
  return withSiteLock(args.siteId, async () => {
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
      createdAt: new Date().toISOString(),
    };
    record.draft = result.draft;
    record.history = [...record.history, changeSet].slice(-50);
    record.future = [];
    record.updatedAt = new Date().toISOString();
    await writeRecord(record);
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

async function commitPostgresOperations(args: CommitArgs): Promise<CommitResult> {
  return withDatabaseTransaction(async (client) => {
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
      createdAt: new Date().toISOString(),
    };
    record.draft = result.draft;
    record.history = [...record.history, changeSet].slice(-50);
    record.future = [];
    record.updatedAt = new Date().toISOString();
    await savePostgresRecord(client, record);
    return { status: "applied", record, changeSet };
  });
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

export function commitOperations(args: CommitArgs): Promise<CommitResult> {
  return usePostgres ? commitPostgresOperations(args) : commitLocalOperations(args);
}

export function moveHistory(siteId: string, action: "undo" | "redo") {
  return usePostgres ? movePostgresHistory(siteId, action) : moveLocalHistory(siteId, action);
}

export function getSiteStoreStatus() {
  return { driver: usePostgres ? "postgres" as const : "development-file" as const, shared: usePostgres };
}
