import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { normalizeDraft } from "../lib/site-document.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const source = path.join(process.cwd(), ".sitecraft-data", "sites");
const workspaceId = process.env.DEFAULT_WORKSPACE_ID || "demo";
const pool = new Pool({ connectionString: databaseUrl });

await pool.query(`
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

let migrated = 0;
for (const name of await readdir(source).catch(() => [] as string[])) {
  if (!name.endsWith(".json")) continue;
  const siteId = name.slice(0, -5);
  const raw = JSON.parse(await readFile(path.join(source, name), "utf8")) as Record<string, unknown>;
  const draft = normalizeDraft(raw.draft);
  const history = Array.isArray(raw.history) ? raw.history : [];
  const future = Array.isArray(raw.future) ? raw.future : [];
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString();
  await pool.query(
    `INSERT INTO sitecraft_sites (workspace_id, site_id, draft, history, future, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6)
     ON CONFLICT (workspace_id, site_id) DO UPDATE SET
       draft = EXCLUDED.draft,
       history = EXCLUDED.history,
       future = EXCLUDED.future,
       updated_at = EXCLUDED.updated_at`,
    [workspaceId, siteId, JSON.stringify(draft), JSON.stringify(history), JSON.stringify(future), updatedAt],
  );
  migrated += 1;
}

await pool.end();
console.log(`Migrated ${migrated} site draft(s) into PostgreSQL.`);
