import type { APIRequestContext } from "@playwright/test";

export async function createSite(request: APIRequestContext, templateId = "forge") {
  const response = await request.post("/api/sites", {
    data: { name: `e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`, templateId, locales: ["zh", "en"] },
  });
  if (!response.ok()) throw new Error(`createSite failed: ${response.status()} ${await response.text()}`);
  return await response.json() as { id: string };
}

export async function getDraft(request: APIRequestContext, siteId: string) {
  const response = await request.get(`/api/sites/${siteId}/draft`);
  if (!response.ok()) throw new Error(`getDraft failed: ${response.status()}`);
  return await response.json() as { draft: { revision: number; templateId: string; [key: string]: unknown }; history: unknown[]; canUndo: boolean; canRedo: boolean };
}

export async function putManualOps(
  request: APIRequestContext,
  siteId: string,
  baseRevision: number,
  operations: Array<Record<string, unknown>>,
) {
  const response = await request.put(`/api/sites/${siteId}/draft`, {
    data: { baseRevision, operations, summary: "E2E manual history", source: "manual" },
  });
  if (!response.ok()) throw new Error(`putManualOps failed: ${response.status()} ${await response.text()}`);
  return await response.json() as Record<string, unknown>;
}

export async function healthWait(request: APIRequestContext) {
  const response = await request.get("/");
  if (!response.ok()) throw new Error(`health check failed: ${response.status()}`);
}
