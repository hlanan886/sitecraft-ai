import { createHash } from "node:crypto";

export type IdempotencyBeginResult =
  | { status: "new" }
  | { status: "inflight" }
  | { status: "completed"; result: Record<string, unknown> }
  | { status: "key_conflict" };

type Entry = {
  expiresAt: number;
  requestHash?: string;
  result?: Record<string, unknown>;
};

export class RequestIdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = Math.max(1, options.ttlMs ?? 10 * 60 * 1000);
    this.now = options.now ?? Date.now;
  }

  private key(scope: string, idempotencyKey: string) {
    return `${scope}:${idempotencyKey}`;
  }

  begin(scope: string, idempotencyKey: string, requestHash?: string): IdempotencyBeginResult {
    const key = this.key(scope, idempotencyKey);
    const current = this.entries.get(key);
    const now = this.now();
    if (current && current.expiresAt > now) {
      if (current.requestHash && requestHash && current.requestHash !== requestHash) return { status: "key_conflict" };
      return current.result ? { status: "completed", result: current.result } : { status: "inflight" };
    }
    this.entries.set(key, { expiresAt: now + this.ttlMs, ...(requestHash ? { requestHash } : {}) });
    return { status: "new" };
  }

  complete(scope: string, idempotencyKey: string, result: Record<string, unknown>) {
    const key = this.key(scope, idempotencyKey);
    const requestHash = this.entries.get(key)?.requestHash;
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, ...(requestHash ? { requestHash } : {}), result: structuredClone(result) });
  }

  release(scope: string, idempotencyKey: string) {
    this.entries.delete(this.key(scope, idempotencyKey));
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload)), "utf8").digest("hex");
}

const globalStore = globalThis as typeof globalThis & { __sitecraftRequestIdempotency?: RequestIdempotencyStore };
export const requestIdempotency = globalStore.__sitecraftRequestIdempotency
  ?? (globalStore.__sitecraftRequestIdempotency = new RequestIdempotencyStore());
