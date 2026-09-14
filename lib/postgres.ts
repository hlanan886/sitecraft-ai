import { Pool, type PoolClient } from "pg";
import { throwIfAborted } from "./abort-utils.ts";

const globalDatabase = globalThis as typeof globalThis & {
  __sitecraftPool?: Pool;
  __sitecraftSchemaReady?: Promise<void>;
};

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL 未配置，生产环境不会退回本地文件存储。");
  return value;
}

export function getDatabasePool() {
  if (!globalDatabase.__sitecraftPool) {
    globalDatabase.__sitecraftPool = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      ...(process.env.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } }
        : {}),
    });
  }
  return globalDatabase.__sitecraftPool;
}

export async function ensureDatabaseSchema() {
  if (!globalDatabase.__sitecraftSchemaReady) {
    globalDatabase.__sitecraftSchemaReady = (async () => {
      await getDatabasePool().query(`
        CREATE TABLE IF NOT EXISTS sitecraft_sites (
          workspace_id TEXT NOT NULL,
          site_id TEXT NOT NULL,
          draft JSONB NOT NULL,
          history JSONB NOT NULL DEFAULT '[]'::jsonb,
          future JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (workspace_id, site_id)
        )
      `);
      // 存量库补列（2026-09-10）：用户粘贴的企业素材，与站点绑定。
      // CREATE TABLE IF NOT EXISTS 对已存在的表不会加列，必须显式 ALTER。
      await getDatabasePool().query(`ALTER TABLE sitecraft_sites ADD COLUMN IF NOT EXISTS source_material TEXT`);
      await getDatabasePool().query(`
        CREATE TABLE IF NOT EXISTS sitecraft_leads (
          id UUID PRIMARY KEY,
          site_key TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          company TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'archived')),
          source TEXT NOT NULL DEFAULT 'published',
          idempotency_key TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (site_key, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS sitecraft_leads_site_created_idx
          ON sitecraft_leads (site_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS sitecraft_leads_site_status_idx
          ON sitecraft_leads (site_key, status, created_at DESC);
      `);
      await getDatabasePool().query(`
        CREATE TABLE IF NOT EXISTS sitecraft_releases (
          workspace_id TEXT NOT NULL,
          site_id TEXT NOT NULL,
          release_id UUID NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0),
          draft JSONB NOT NULL,
          content_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('published', 'superseded')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          published_by TEXT NOT NULL,
          rollback_of UUID,
          PRIMARY KEY (workspace_id, release_id),
          UNIQUE (workspace_id, site_id, version)
        );
        CREATE INDEX IF NOT EXISTS sitecraft_releases_site_version_idx
          ON sitecraft_releases (workspace_id, site_id, version DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS sitecraft_releases_published_idx
          ON sitecraft_releases (workspace_id, site_id) WHERE status = 'published';
      `);
    })().catch((error) => {
        globalDatabase.__sitecraftSchemaReady = undefined;
        throw error;
      });
  }
  return globalDatabase.__sitecraftSchemaReady;
}

export async function withDatabaseTransaction<T>(task: (client: PoolClient) => Promise<T>, signal?: AbortSignal) {
  await ensureDatabaseSchema();
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    const result = await task(client);
    throwIfAborted(signal);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection() {
  await ensureDatabaseSchema();
  await getDatabasePool().query("SELECT 1");
}
