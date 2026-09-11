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
