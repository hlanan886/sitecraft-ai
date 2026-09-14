import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDatabaseSchema, getDatabasePool, withDatabaseTransaction } from "./postgres.ts";
import { normalizeDraft, type SiteDraft } from "./site-model.ts";

export type Release = {
  releaseId: string;
  siteId: string;
  workspaceId: string;
  version: number;
  draft: SiteDraft;
  contentHash: string;
  status: "published" | "superseded";
  createdAt: string;
  publishedBy: string;
  rollbackOf?: string;
};

export type CreateReleaseArgs = {
  siteId: string;
  draft: SiteDraft;
  expectedRevision?: number;
  publishedBy?: string;
  rollbackOf?: string;
};

export class ReleaseConflictError extends Error {
  readonly code = "revision_conflict";
  constructor(message = "草稿版本已变化，请刷新后重试。") {
    super(message);
    this.name = "ReleaseConflictError";
  }
}

function safeSegment(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function contentHash(draft: SiteDraft) {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex");
}

type ReleaseStoreOptions = {
  rootDir?: string;
  workspaceId?: string;
  now?: () => Date;
};

const globalLocks = globalThis as typeof globalThis & { __sitecraftReleaseLocks?: Map<string, Promise<void>> };
const locks = globalLocks.__sitecraftReleaseLocks ?? new Map<string, Promise<void>>();
globalLocks.__sitecraftReleaseLocks = locks;

async function withReleaseLock<T>(key: string, task: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queue = previous.then(() => current);
  locks.set(key, queue);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queue) locks.delete(key);
  }
}

export class ReleaseStore {
  private readonly rootDir: string;
  private readonly workspaceId: string;
  private readonly now: () => Date;

  constructor(options: ReleaseStoreOptions = {}) {
    this.rootDir = options.rootDir ?? path.join(process.cwd(), ".sitecraft-data", "releases");
    this.workspaceId = options.workspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? "demo";
    this.now = options.now ?? (() => new Date());
  }

  private filePath(siteId: string) {
    return path.join(this.rootDir, `${safeSegment(this.workspaceId, "workspace id")}-${safeSegment(siteId, "site id")}.json`);
  }

  private async read(siteId: string): Promise<Release[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath(siteId), "utf8")) as unknown;
      return Array.isArray(raw) ? raw as Release[] : [];
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(siteId: string, releases: Release[]) {
    await mkdir(this.rootDir, { recursive: true });
    const target = this.filePath(siteId);
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(releases, null, 2), "utf8");
    try {
      await rename(temp, target);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private async createUnlocked(args: CreateReleaseArgs): Promise<Release> {
    const draft = normalizeDraft(args.draft);
    if (args.expectedRevision !== undefined && draft.revision !== args.expectedRevision) {
      throw new ReleaseConflictError();
    }
    const releases = await this.read(args.siteId);
    const version = releases.reduce((max, release) => Math.max(max, release.version), 0) + 1;
    const release: Release = {
      releaseId: crypto.randomUUID(),
      siteId: args.siteId,
      workspaceId: this.workspaceId,
      version,
      draft: structuredClone(draft),
      contentHash: contentHash(draft),
      status: "published",
      createdAt: this.now().toISOString(),
      publishedBy: args.publishedBy?.trim() || "internal-owner",
      ...(args.rollbackOf ? { rollbackOf: args.rollbackOf } : {}),
    };
    const next = releases.map((item) => item.status === "published" ? { ...item, status: "superseded" as const } : item);
    await this.write(args.siteId, [release, ...next]);
    return structuredClone(release);
  }

  async createRelease(args: CreateReleaseArgs) {
    return withReleaseLock(`${this.workspaceId}:${args.siteId}`, () => this.createUnlocked(args));
  }

  async getPublishedRelease(siteKey: string) {
    const releases = await this.read(siteKey);
    const published = releases.find((release) => release.status === "published");
    return published ? structuredClone(published) : null;
  }

  async listReleases(siteId: string) {
    return (await this.read(siteId)).sort((a, b) => b.version - a.version).map((release) => structuredClone(release));
  }

  async rollbackRelease(args: { siteId: string; releaseId: string; publishedBy?: string }) {
    return withReleaseLock(`${this.workspaceId}:${args.siteId}`, async () => {
      const releases = await this.read(args.siteId);
      const target = releases.find((release) => release.releaseId === args.releaseId);
      if (!target) throw new Error("release_not_found");
      return this.createUnlocked({
        siteId: args.siteId,
        draft: target.draft,
        publishedBy: args.publishedBy,
        rollbackOf: target.releaseId,
      });
    });
  }
}

const defaultStore = new ReleaseStore();
const usePostgres = process.env.SITE_STORE === "postgres" || process.env.NODE_ENV === "production";
const workspaceId = process.env.DEFAULT_WORKSPACE_ID || "demo";

type ReleaseRow = {
  release_id: string;
  site_id: string;
  workspace_id: string;
  version: number;
  draft: unknown;
  content_hash: string;
  status: "published" | "superseded";
  created_at: Date | string;
  published_by: string;
  rollback_of: string | null;
};

function rowToRelease(row: ReleaseRow): Release {
  return {
    releaseId: row.release_id,
    siteId: row.site_id,
    workspaceId: row.workspace_id,
    version: row.version,
    draft: normalizeDraft(row.draft),
    contentHash: row.content_hash,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    publishedBy: row.published_by,
    ...(row.rollback_of ? { rollbackOf: row.rollback_of } : {}),
  };
}

type LockedSite = { draft: SiteDraft };

async function lockPostgresSite(client: import("pg").PoolClient, siteId: string, expectedRevision?: number): Promise<LockedSite> {
  const result = await client.query<{ draft: unknown }>(
    "SELECT draft FROM sitecraft_sites WHERE workspace_id = $1 AND site_id = $2 FOR UPDATE",
    [workspaceId, siteId],
  );
  if (!result.rows[0]) throw new Error("site_not_found");
  const liveDraft = normalizeDraft(result.rows[0].draft);
  if (expectedRevision !== undefined && liveDraft.revision !== expectedRevision) throw new ReleaseConflictError();
  return { draft: liveDraft };
}

async function createPostgresReleaseInTransaction(
  client: import("pg").PoolClient,
  args: CreateReleaseArgs,
  draft: SiteDraft,
  siteLocked = false,
) {
    if (!siteLocked) await lockPostgresSite(client, args.siteId, args.expectedRevision);
    const latest = await client.query<{ version: number }>("SELECT COALESCE(MAX(version), 0)::int AS version FROM sitecraft_releases WHERE workspace_id = $1 AND site_id = $2", [workspaceId, args.siteId]);
    const version = Number(latest.rows[0]?.version ?? 0) + 1;
    await client.query("UPDATE sitecraft_releases SET status = 'superseded' WHERE workspace_id = $1 AND site_id = $2 AND status = 'published'", [workspaceId, args.siteId]);
    const release: Release = {
      releaseId: crypto.randomUUID(), siteId: args.siteId, workspaceId, version,
      draft: structuredClone(draft), contentHash: contentHash(draft), status: "published",
      createdAt: new Date().toISOString(), publishedBy: args.publishedBy?.trim() || "internal-owner",
      ...(args.rollbackOf ? { rollbackOf: args.rollbackOf } : {}),
    };
    await client.query(
      `INSERT INTO sitecraft_releases
        (workspace_id, site_id, release_id, version, draft, content_hash, status, created_at, published_by, rollback_of)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [workspaceId, args.siteId, release.releaseId, release.version, JSON.stringify(release.draft), release.contentHash, release.status, release.createdAt, release.publishedBy, release.rollbackOf ?? null],
    );
    return release;
}

async function createPostgresRelease(args: CreateReleaseArgs) {
  const draft = normalizeDraft(args.draft);
  if (args.expectedRevision !== undefined && draft.revision !== args.expectedRevision) throw new ReleaseConflictError();
  await ensureDatabaseSchema();
  return withDatabaseTransaction(async (client) => {
    await lockPostgresSite(client, args.siteId, args.expectedRevision);
    return createPostgresReleaseInTransaction(client, args, draft, true);
  });
}

async function getPostgresPublishedRelease(siteKey: string) {
  await ensureDatabaseSchema();
  const result = await getDatabasePool().query<ReleaseRow>(
    `SELECT release_id, site_id, workspace_id, version, draft, content_hash, status, created_at, published_by, rollback_of
     FROM sitecraft_releases WHERE workspace_id = $1 AND site_id = $2 AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [workspaceId, siteKey],
  );
  return result.rows[0] ? rowToRelease(result.rows[0]) : null;
}

async function listPostgresReleases(siteId: string) {
  await ensureDatabaseSchema();
  const result = await getDatabasePool().query<ReleaseRow>(
    `SELECT release_id, site_id, workspace_id, version, draft, content_hash, status, created_at, published_by, rollback_of
     FROM sitecraft_releases WHERE workspace_id = $1 AND site_id = $2 ORDER BY version DESC`,
    [workspaceId, siteId],
  );
  return result.rows.map(rowToRelease);
}

export function createRelease(args: CreateReleaseArgs) {
  return usePostgres ? createPostgresRelease(args) : defaultStore.createRelease(args);
}

export function getPublishedRelease(siteKey: string) {
  return usePostgres ? getPostgresPublishedRelease(siteKey) : defaultStore.getPublishedRelease(siteKey);
}

export function listReleases(siteId: string) {
  return usePostgres ? listPostgresReleases(siteId) : defaultStore.listReleases(siteId);
}

export function rollbackRelease(args: { siteId: string; releaseId: string; publishedBy?: string }) {
  if (!usePostgres) return defaultStore.rollbackRelease(args);
  return rollbackPostgresRelease(args);
}

async function rollbackPostgresRelease(args: { siteId: string; releaseId: string; publishedBy?: string }) {
  await ensureDatabaseSchema();
  return withDatabaseTransaction(async (client) => {
    await lockPostgresSite(client, args.siteId);
    const result = await client.query<ReleaseRow>(
      `SELECT release_id, site_id, workspace_id, version, draft, content_hash, status, created_at, published_by, rollback_of
       FROM sitecraft_releases
       WHERE workspace_id = $1 AND site_id = $2 AND release_id = $3
       FOR SHARE`,
      [workspaceId, args.siteId, args.releaseId],
    );
    const target = result.rows[0];
    if (!target) throw new Error("release_not_found");
    const targetRelease = rowToRelease(target);
    return createPostgresReleaseInTransaction(
      client,
      { siteId: args.siteId, draft: targetRelease.draft, publishedBy: args.publishedBy, rollbackOf: targetRelease.releaseId },
      targetRelease.draft,
      true,
    );
  });
}
