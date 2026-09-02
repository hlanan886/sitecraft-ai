import type { Page, Route } from "@playwright/test";

type IntentStatus = "ready" | "need_info" | "rejected";
type IntentOverrides = Partial<ReturnType<typeof readyIntent>>;

export function sseBody(events: Array<Record<string, unknown>>) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

export function readyIntent(overrides: Record<string, unknown> = {}) {
  return {
    businessType: "manufacturing",
    companyName: "澄明工业",
    industry: "工业自动化",
    targetAudience: "overseasB2b",
    tone: "professional",
    colorTone: "green",
    coreSections: ["about", "features", "services", "products", "contact"],
    recommendedTemplateId: "forge",
    summary: "面向海外企业客户的工业自动化官网",
    status: "ready" as IntentStatus,
    notices: [],
    needsInfo: [],
    conflicts: [],
    limits: [],
    ...overrides,
  };
}

async function fulfillSse(route: Route, events: Array<Record<string, unknown>>) {
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
    body: sseBody(events),
  });
}

export async function mockAnalyze(
  page: Page,
  options: {
    onMessage?: (message: string, body: Record<string, unknown>) => ReturnType<typeof readyIntent> | void;
  } = {},
) {
  await page.route("**/api/sites/demo/generate", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.step !== "analyze") return route.fallback();
    const message = String(body.message ?? "");
    const intent = options.onMessage?.(message, body) ?? readyIntent();
    await fulfillSse(route, [
      { type: "status", value: "正在理解你的需求…" },
      {
        type: "done",
        status: "ready",
        intent,
        siteLanguage: "zh",
        template: { id: "forge", name: "Forge", category: "制造业", reason: "适合强调工业实力" },
        hiddenSections: [],
      },
    ]);
  });
}

export async function mockExecute(page: Page, onRequest?: (body: Record<string, unknown>) => void) {
  await page.route("**/api/sites/*/generate", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.step === "analyze") return route.fallback();
    onRequest?.(body);
    await fulfillSse(route, [
      { type: "status", value: "正在生成内容…", phase: "content", completedSections: ["hero"], activeSections: ["about"] },
      { type: "done", status: "applied" },
    ]);
  });
}

export async function mockChat(
  page: Page,
  siteId: string,
  options: {
    onDone?: (body: Record<string, unknown>) => void;
    operations?: (body: Record<string, unknown>) => Array<Record<string, unknown>>;
  } = {},
) {
  await page.route(`**/api/sites/${siteId}/chat`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    options.onDone?.(body);
    const operations = options.operations?.(body) ?? [];
    const destructive = String(body.message ?? "").includes("换模板") && body.confirmedDestructive !== true;
    if (destructive) {
      await fulfillSse(route, [{
        type: "done",
        status: "need_confirmation",
        confirmation: "将切换模板并调整页面结构",
        operations,
        summary: "切换模板",
      }]);
      return;
    }
    const response = await page.request.put(`/api/sites/${siteId}/draft`, {
      data: {
        baseRevision: body.baseRevision,
        operations,
        summary: "E2E mock chat",
        source: "manual",
      },
    });
    if (!response.ok()) throw new Error(`mockChat commit failed: ${response.status()} ${await response.text()}`);
    const snapshot = await response.json() as Record<string, unknown>;
    await fulfillSse(route, [
      { type: "status", value: "正在保存…" },
      { type: "done", ...snapshot, summary: "内容已更新" },
    ]);
  });
}
