import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ensureDatabaseSchema, getDatabasePool, withDatabaseTransaction } from "./postgres.ts";

export const leadStatusSchema = z.enum(["new", "contacted", "archived"]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

const leadPayloadSchema = z.object({
  name: z.string().trim().min(1, "姓名不能为空").max(80),
  email: z.string().trim().email("请输入有效邮箱").max(160),
  company: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1, "留言不能为空").max(4000),
  website: z.string().max(200).optional(),
  honeypot: z.string().max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
}).transform((value) => ({
  name: value.name,
  email: value.email,
  company: value.company ?? "",
  message: value.message,
  honeypot: value.honeypot || value.website || "",
  idempotencyKey: value.idempotencyKey || undefined,
}));

export type NormalizedLeadPayload = z.output<typeof leadPayloadSchema>;

export function normalizeLeadPayload(payload: unknown) {
  return leadPayloadSchema.safeParse(payload);
}

export type LeadInput = NormalizedLeadPayload & {
  siteKey: string;
  source: string;
};

export type LeadRecord = {
  id: string;
  siteKey: string;
  name: string;
  email: string;
  company: string;
  message: string;
  status: LeadStatus;
  source: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadListOptions = {
  siteKey: string;
  status?: LeadStatus;
  limit?: number;
};

export type LeadStore = {
  create(input: LeadInput): Promise<{ lead: LeadRecord; created: boolean }>;
  list(options: LeadListOptions): Promise<LeadRecord[]>;
  updateStatus(input: { siteKey: string; leadId: string; status: LeadStatus }): Promise<LeadRecord | null>;
};

function cloneLead(lead: LeadRecord): LeadRecord {
  return { ...lead };
}

export function createMemoryLeadStore(seed: LeadRecord[] = []): LeadStore {
  const records = new Map(seed.map((lead) => [lead.id, cloneLead(lead)]));

  return {
    async create(input) {
      const duplicate = input.idempotencyKey
        ? [...records.values()].find(
            (lead) => lead.siteKey === input.siteKey && lead.idempotencyKey === input.idempotencyKey,
          )
        : undefined;
      if (duplicate) return { lead: cloneLead(duplicate), created: false };
      const now = new Date().toISOString();
      const lead: LeadRecord = {
        id: crypto.randomUUID(),
        siteKey: input.siteKey,
        name: input.name,
        email: input.email,
        company: input.company,
        message: input.message,
        status: "new",
        source: input.source,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        createdAt: now,
        updatedAt: now,
      };
      records.set(lead.id, lead);
      return { lead: cloneLead(lead), created: true };
    },
    async list({ siteKey, status, limit = 50 }) {
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      return [...records.values()]
        .filter((lead) => lead.siteKey === siteKey && (!status || lead.status === status))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, safeLimit)
        .map(cloneLead);
    },
    async updateStatus({ siteKey, leadId, status }) {
      const lead = records.get(leadId);
      if (!lead || lead.siteKey !== siteKey) return null;
      const updated = { ...lead, status, updatedAt: new Date().toISOString() };
      records.set(leadId, updated);
      return cloneLead(updated);
    },
  };
}

type LeadRow = {
  id: string;
  site_key: string;
  name: string;
  email: string;
  company: string;
  message: string;
  status: LeadStatus;
  source: string;
  idempotency_key: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function rowToLead(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    siteKey: row.site_key,
    name: row.name,
    email: row.email,
    company: row.company,
    message: row.message,
    status: row.status,
    source: row.source,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const usePostgres = process.env.SITE_STORE === "postgres" || process.env.NODE_ENV === "production";

export function isLeadStoreEnabled() {
  return usePostgres;
}

/**
 * 文件存储的询盘库（非 Postgres 时使用）。
 *
 * **2026-09-10 修复「询盘闭环在 file 模式下闭锁」**：
 * 此前 `isLeadStoreEnabled()` 只认 Postgres，三个路由（`/api/public/[siteKey]/leads`、
 * `/api/leads`、`/api/leads/[leadId]`）**只走 `postgresLeadStore`**——本机
 * `SITE_STORE=file` 时公开页表单提交必然 **503**，客户看到「提交失败」，
 * `/leads` 页也提示检查数据库连接。而 `createMemoryLeadStore` 写好了却**零调用点**（纯死代码）。
 *
 * 对代建服务这是致命的：当着客户演示询盘闭环会失败。故补文件持久化实现——
 * 沿用 `site-store.ts` / `release-store.ts` 的既有约定（`.sitecraft-data/` + 原子写）。
 *
 * **取长补短**：`createMemoryLeadStore` 有完整的幂等/排序/状态流转逻辑但重启即丢；
 * 本实现直接复用它作为**内存索引**，在其上叠加落盘，避免重复实现业务规则。
 */
class FileLeadStore implements LeadStore {
  private readonly rootDir: string;
  private memory: LeadStore;
  private loaded = false;
  private readonly seed: LeadRecord[] = [];
  /** 串行化落盘，避免并发 create 互相覆盖（与 site-store 的锁语义一致）。 */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir = options.rootDir ?? path.join(process.cwd(), ".sitecraft-data", "leads");
    this.memory = createMemoryLeadStore();
  }

  private filePath(siteKey: string) {
    const safe = siteKey.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "unknown";
    return path.join(this.rootDir, `${safe}.json`);
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    let entries: string[] = [];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return; // 目录不存在 = 还没有任何询盘
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const records = JSON.parse(await readFile(path.join(this.rootDir, entry), "utf8")) as LeadRecord[];
        if (!Array.isArray(records)) continue;
        // 用**完整记录**重建内存索引（seed），不能用 `create`——
        // `create` 固定把 status 置为 "new"，会让已联系/已归档的询盘重启后退回未处理。
        for (const record of records) {
          if (record && typeof record.siteKey === "string" && typeof record.id === "string") {
            this.seed.push(record);
          }
        }
      } catch {
        // 单个文件损坏不影响其他站点
      }
    }
    // 索引就绪后用种子重建内存库（保留 status / createdAt / idempotencyKey）
    if (this.seed.length) {
      this.memory = createMemoryLeadStore(this.seed);
    }
  }

  private async persist(siteKey: string) {
    const records = await this.memory.list({ siteKey, limit: 100 });
    await mkdir(this.rootDir, { recursive: true });
    const target = this.filePath(siteKey);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(records, null, 2), "utf8");
    await rename(temp, target);
  }

  private enqueue(task: () => Promise<void>) {
    this.writeChain = this.writeChain.then(task, task);
    return this.writeChain;
  }

  async create(input: LeadInput) {
    await this.load();
    const result = await this.memory.create(input);
    if (result.created) await this.enqueue(() => this.persist(input.siteKey));
    return result;
  }

  async list(options: LeadListOptions) {
    await this.load();
    return this.memory.list(options);
  }

  async updateStatus(input: { siteKey: string; leadId: string; status: LeadStatus }) {
    await this.load();
    const updated = await this.memory.updateStatus(input);
    if (updated) await this.enqueue(() => this.persist(input.siteKey));
    return updated;
  }
}

export function createFileLeadStore(options: { rootDir?: string } = {}): LeadStore {
  return new FileLeadStore(options);
}

/**
 * 询盘存储的**统一入口**（路由层只应 import 这一个）。
 *
 * 此前三个路由各自 import `postgresLeadStore`，导致「存储模式」这个决策被复制了三份、
 * 且都只实现了 Postgres 分支。集中到工厂函数后，新增存储模式只改这一处。
 */
let activeLeadStore: LeadStore | null = null;

export function getLeadStore(): LeadStore {
  if (!activeLeadStore) {
    activeLeadStore = usePostgres ? createPostgresLeadStore() : createFileLeadStore();
  }
  return activeLeadStore;
}

export function createPostgresLeadStore(): LeadStore {
  return {
    async create(input) {
      return withDatabaseTransaction(async (client) => {
        const values = [
          crypto.randomUUID(),
          input.siteKey,
          input.name,
          input.email,
          input.company,
          input.message,
          input.source,
          input.idempotencyKey ?? null,
        ];
        const inserted = await client.query<LeadRow>(
          `INSERT INTO sitecraft_leads
             (id, site_key, name, email, company, message, status, source, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $8)
           ON CONFLICT (site_key, idempotency_key) DO NOTHING
           RETURNING id, site_key, name, email, company, message, status, source, idempotency_key, created_at, updated_at`,
          values,
        );
        if (inserted.rows[0]) return { lead: rowToLead(inserted.rows[0]), created: true };
        if (!input.idempotencyKey) throw new Error("Lead could not be created");
        const existing = await client.query<LeadRow>(
          `SELECT id, site_key, name, email, company, message, status, source, idempotency_key, created_at, updated_at
           FROM sitecraft_leads WHERE site_key = $1 AND idempotency_key = $2`,
          [input.siteKey, input.idempotencyKey],
        );
        if (!existing.rows[0]) throw new Error("Lead idempotency record could not be read");
        return { lead: rowToLead(existing.rows[0]), created: false };
      });
    },
    async list({ siteKey, status, limit = 50 }) {
      await ensureDatabaseSchema();
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const values: Array<string | number> = [siteKey];
      const statusClause = status ? " AND status = $2" : "";
      if (status) values.push(status);
      values.push(safeLimit);
      const limitPlaceholder = `$${values.length}`;
      const result = await getDatabasePool().query<LeadRow>(
        `SELECT id, site_key, name, email, company, message, status, source, idempotency_key, created_at, updated_at
         FROM sitecraft_leads WHERE site_key = $1${statusClause}
         ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
        values,
      );
      return result.rows.map(rowToLead);
    },
    async updateStatus({ siteKey, leadId, status }) {
      await ensureDatabaseSchema();
      const result = await getDatabasePool().query<LeadRow>(
        `UPDATE sitecraft_leads SET status = $1, updated_at = NOW()
         WHERE id = $2 AND site_key = $3
         RETURNING id, site_key, name, email, company, message, status, source, idempotency_key, created_at, updated_at`,
        [status, leadId, siteKey],
      );
      return result.rows[0] ? rowToLead(result.rows[0]) : null;
    },
  };
}

export const postgresLeadStore = createPostgresLeadStore();
