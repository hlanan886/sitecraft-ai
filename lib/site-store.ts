import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { ensureDatabaseSchema, getDatabasePool, withDatabaseTransaction } from "./postgres.ts";
import { allTemplates, defaultDraft, normalizeDraft, type SiteDraft } from "./site-model.ts";
import { applySiteOperations, normalizePersistedOperations, type SiteOperation } from "./site-operations.ts";
import { siteDraftSchema } from "./site-document.ts";
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
  /**
   * 用户粘贴的企业素材原文（2026-09-10）。
   *
   * 与**站点**绑定而非随请求传递——这样生成、补全、对话三条路径都能引用同一份素材，
   * 且用户刷新/换设备后仍在，可回看与纠正。见 `docs` 中方向 2 的方案。
   */
  sourceMaterial?: string;
};
export type SiteSnapshot = {
  draft: SiteDraft;
  history: Array<Pick<ChangeSet, "id" | "revision" | "summary" | "source" | "appliedTargets" | "model" | "latencyMs" | "provenance" | "createdAt">>;
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: string;
  isNew?: boolean;
  /** 用户粘贴的企业素材（与站点绑定，生成/补全/对话共用）。 */
  sourceMaterial?: string;
};
export type SiteSeed = {
  name: string;
  templateId: string;
  locales: SiteDraft["locale"][];
  initialDraft: SiteDraft;
};

/**
 * 文件后端的存储根**解析规则**——提成纯函数，好在测试里逐字断言默认值。
 *
 * `SITECRAFT_DATA_ROOT` 是**测试专用**的覆盖点（2026-09-12 加，为了给
 * "旧名读入 → undo 重放 → 新名落盘 → 再读"这条**真实链路**写测试）。
 * 不设它时返回的分支与从前的写法**逐字节相同**：
 * `path.join(cwd, ".sitecraft-data", "sites")`。
 *
 * ⚠️ 用环境变量而不是构造函数参数，是因为 `site-store` 是**函数式模块**
 * （不像 `ReleaseStore` 那样有实例可注入 `rootDir`），改成类会牵动 20+ 个调用点。
 *
 * ⚠️ 之所以提成纯函数而不是写成模块级三元表达式：模块级表达式**在加载时固化**，
 * 测试无法在加载后再改它——只能靠"在 import 之前设环境变量"这种时序约定，
 * 而那个约定会被**同一个进程里别的测试先 import 一次**打破（本测试第一版就栽在这里）。
 * 纯函数没有这个耦合。
 */
export function resolveStorageRoot(
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  return env.SITECRAFT_DATA_ROOT
    ? path.join(env.SITECRAFT_DATA_ROOT, "sites")
    : path.join(cwd, ".sitecraft-data", "sites");
}

const storageRoot = resolveStorageRoot(process.env, process.cwd());
const templateIds = new Set(allTemplates().map((item) => item.id));
const workspaceId = process.env.DEFAULT_WORKSPACE_ID || "demo";
const usePostgres = process.env.SITE_STORE === "postgres" || process.env.NODE_ENV === "production";
const globalStore = globalThis as typeof globalThis & { __sitecraftLocks?: Map<string, Promise<void>> };
const locks = globalStore.__sitecraftLocks ?? new Map<string, Promise<void>>();
globalStore.__sitecraftLocks = locks;

function safeSiteId(siteId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(siteId)) throw new Error("Invalid site id");
  return siteId;
}

/**
 * **落盘 ChangeSet 的读取归一化**——两个后端的**共同**入口。
 *
 * 文件后端的 `readRecord()` 与 PG 后端的 `rowToRecord()` 都经过这里，
 * 所以"同一份历史，换后端读出来必须一样"是**结构上保证**的，
 * 而不是靠两处各写一遍、再指望它们不漂。
 *
 * ⚠️ 这**不是**校验：读不认识的形态时原样放行（存量比今天的 schema 更宽）。
 * 详见 `normalizePersistedOperations` 的说明。
 */
function normalizePersistedChangeSets(raw: unknown[]): ChangeSet[] {
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") return entry as ChangeSet;
    const changeSet = entry as ChangeSet;
    return {
      ...changeSet,
      operations: normalizePersistedOperations(changeSet.operations),
      inverseOperations: normalizePersistedOperations(changeSet.inverseOperations),
    };
  });
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
      history: Array.isArray(raw.history) ? normalizePersistedChangeSets(raw.history) : [],
      future: Array.isArray(raw.future) ? normalizePersistedChangeSets(raw.future) : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      ...(typeof raw.sourceMaterial === "string" && raw.sourceMaterial.trim()
        ? { sourceMaterial: raw.sourceMaterial }
        : {}),
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
/**
 * 写入前校验：草稿必须能通过 `siteDraftSchema`（P-0，2026-09-11）。
 *
 * ## 为什么必须有
 *
 * 修复前是**写入宽松 / 读取严格**：
 *  - 写入走 `applySiteOperations`，**从不跑 `siteDraftSchema`**；
 *  - 读取走 `normalizeDraft`，`safeParse` 一旦失败就 `cloneDraft(defaultDraft)`
 *    并只回填 7 个字段 —— `about`/`features`/`services`/`contact`/`navigation`
 *    **全部重置成 Forge 演示文案**，且**无任何报错**。
 *
 * 实测：把 `industry` 写到 130 字 → 写入成功 → 下次读取整站内容消失。
 *
 * 这道校验是**兜底**：`checkCopyLength` 已在操作层拦下常见超限（含可读长度与字段硬上限），
 * 但条目数（`items.max(12)`）等结构性溢出不在它管辖内，只能靠 schema 兜住。
 * 宁可**写入当场失败并给出可读原因**，也不能让损坏的草稿落盘、在读取时静默毁掉用户内容。
 */
function assertDraftWritable(draft: SiteDraft): void {
  const parsed = siteDraftSchema.safeParse(draft);
  if (parsed.success) return;
  const first = parsed.error.issues[0];
  const where = first?.path.join(".") || "草稿";
  throw new Error(`草稿写入被拒绝（${where}）：${first?.message ?? "不符合草稿结构"}。内容未被保存，请调整后重试。`);
}

function createRecord(siteId: string, draft: SiteDraft = defaultDraft, sourceMaterial?: string): SiteRecord {
  return {
    siteId,
    draft: normalizeDraft(draft),
    history: [],
    future: [],
    updatedAt: new Date().toISOString(),
    ...(sourceMaterial?.trim() ? { sourceMaterial } : {}),
  };
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
    ...(record.sourceMaterial?.trim() ? { sourceMaterial: record.sourceMaterial } : {}),
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

/** 列出本工作区站点（首页「我的站点」用）。 */
export type SiteListItem = {
  id: string;
  name: string;
  templateId: string;
  locale: SiteDraft["locale"];
  revision: number;
  updatedAt: string;
};

async function listLocalSites(): Promise<SiteListItem[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(storageRoot);
  } catch {
    return []; // 目录不存在 = 还没有任何站点
  }
  const items: SiteListItem[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const siteId = entry.slice(0, -".json".length);
    try {
      const record = await readRecord(siteId);
      if (!record) continue;
      items.push({
        id: record.siteId,
        name: record.draft.siteName || record.draft.companyName || record.siteId,
        templateId: record.draft.templateId,
        locale: record.draft.locale,
        revision: record.draft.revision,
        updatedAt: record.updatedAt,
      });
    } catch {
      // 单个文件损坏不影响其他站点
    }
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function listPostgresSites(): Promise<SiteListItem[]> {
  await ensureDatabaseSchema();
  const result = await getDatabasePool().query<{ site_id: string; draft: unknown; updated_at: Date | string }>(
    `SELECT site_id, draft, updated_at FROM sitecraft_sites WHERE workspace_id = $1 ORDER BY updated_at DESC`,
    [workspaceId],
  );
  return result.rows.map((row) => {
    const draft = normalizeDraft(row.draft);
    return {
      id: row.site_id,
      name: draft.siteName || draft.companyName || row.site_id,
      templateId: draft.templateId,
      locale: draft.locale,
      revision: draft.revision,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
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
    assertDraftWritable(result.draft);
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
    assertDraftWritable(result.draft);
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
  source_material?: string | null;
};

function rowToRecord(row: SiteRow): SiteRecord {
  return {
    siteId: row.site_id,
    draft: normalizeDraft(row.draft),
    history: Array.isArray(row.history) ? normalizePersistedChangeSets(row.history) : [],
    future: Array.isArray(row.future) ? normalizePersistedChangeSets(row.future) : [],
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(typeof row.source_material === "string" && row.source_material.trim()
      ? { sourceMaterial: row.source_material }
      : {}),
  };
}

async function lockPostgresRecord(client: PoolClient, siteId: string) {
  safeSiteId(siteId);
  const initial = createRecord(siteId);
  await client.query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at, source_material)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4, $5)
     ON CONFLICT (workspace_id, site_id) DO NOTHING`,
    [workspaceId, siteId, JSON.stringify(initial.draft), initial.updatedAt, initial.sourceMaterial ?? null],
  );
  const result = await client.query<SiteRow>(
    `SELECT site_id, draft, history, future, updated_at, source_material
     FROM sitecraft_sites WHERE workspace_id = $1 AND site_id = $2 FOR UPDATE`,
    [workspaceId, siteId],
  );
  if (!result.rows[0]) throw new Error("Site record could not be created");
  return rowToRecord(result.rows[0]);
}

async function savePostgresRecord(client: PoolClient, record: SiteRecord) {
  await client.query(
    `UPDATE sitecraft_sites
     SET draft = $3::jsonb, history = $4::jsonb, future = $5::jsonb, updated_at = $6, source_material = $7
     WHERE workspace_id = $1 AND site_id = $2`,
    [workspaceId, record.siteId, JSON.stringify(record.draft), JSON.stringify(record.history), JSON.stringify(record.future), record.updatedAt, record.sourceMaterial ?? null],
  );
}

async function getPostgresSite(siteId: string) {
  safeSiteId(siteId);
  await ensureDatabaseSchema();
  const initial = createRecord(siteId);
  const inserted = await getDatabasePool().query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at, source_material)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4, $5)
     ON CONFLICT (workspace_id, site_id) DO NOTHING
     RETURNING site_id`,
    [workspaceId, siteId, JSON.stringify(initial.draft), initial.updatedAt, initial.sourceMaterial ?? null],
  );
  const result = await getDatabasePool().query<SiteRow>(
    `SELECT site_id, draft, history, future, updated_at, source_material
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
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at, source_material)
     VALUES ($1, $2, $3::jsonb, '[]'::jsonb, '[]'::jsonb, $4, $5)
     RETURNING site_id`,
    [workspaceId, id, JSON.stringify(record.draft), record.updatedAt, record.sourceMaterial ?? null],
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
    assertDraftWritable(result.draft);
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
    assertDraftWritable(result.draft);
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

/**
 * 列出本工作区的全部站点（2026-09-10）。
 *
 * 此前 `GET /api/sites` **恒返 `[{id:"demo"}]`**，首页又硬编码 3 个假站点——
 * 用户建完站回首页**看不到自己的站**，属信任级缺陷（用户会怀疑"我刚才做的站去哪了"）。
 */
export function listSites(): Promise<SiteListItem[]> {
  return usePostgres ? listPostgresSites() : listLocalSites();
}

/**
 * 保存用户粘贴的企业素材（2026-09-10，方向 2）。
 *
 * 与**站点**绑定而非随请求传递：生成 / 补全 / 对话三条路径都能引用同一份素材，
 * 且用户刷新或换设备后仍在，可回看与纠正。
 * 传空串则清除。**不 bump draft.revision**——素材不是草稿内容，改它不该让草稿冲突。
 */
export async function setSiteSourceMaterial(siteId: string, material: string): Promise<{ sourceMaterial?: string }> {
  const trimmed = material.trim();
  if (usePostgres) {
    await ensureDatabaseSchema();
    await getDatabasePool().query(
      `UPDATE sitecraft_sites SET source_material = $3 WHERE workspace_id = $1 AND site_id = $2`,
      [workspaceId, safeSiteId(siteId), trimmed || null],
    );
    return trimmed ? { sourceMaterial: trimmed } : {};
  }
  return withSiteLock(siteId, async () => {
    const existing = await readRecord(siteId);
    const record = existing ?? createRecord(siteId);
    if (trimmed) record.sourceMaterial = trimmed;
    else delete record.sourceMaterial;
    await writeRecord(record);
    return trimmed ? { sourceMaterial: trimmed } : {};
  });
}

/** 读取站点素材（生成/补全/对话共用）。无则返回 undefined。 */
export async function getSiteSourceMaterial(siteId: string): Promise<string | undefined> {
  const site = await getSite(siteId);
  return site.sourceMaterial;
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
    `SELECT site_id, draft, history, future, updated_at, source_material
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
