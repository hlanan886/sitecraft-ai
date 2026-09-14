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
    /**
     * PUT /draft 被确定性校验拒绝时的桩行为（2026-09-11）。
     *
     * 默认 `throw`（旧行为），适合"提交必须成功"的用例。
     * 传 `"replay"` 则模拟**真实服务端**：照常下发 done 事件并带 `rejected`，
     * 供「被拒操作要显性化」这类用例走完整 UI 链路。
     */
    onCommitRejected?: "throw" | "replay";
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
    if (!response.ok()) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (options.onCommitRejected !== "replay") {
        throw new Error(`mockChat commit failed: ${response.status()} ${JSON.stringify(payload)}`);
      }
      // 真实服务端在这种情况下返回 `no_change` + rejected（不 bump revision）。
      // 注意：不要再发一次 GET 取快照——前端 no_change 分支只消费 summary/rejected，
      // 而在 route handler 里嵌套请求会拖住 SSE 回放（实测会导致界面卡在"正在连接模型…"）。
      await fulfillSse(route, [
        { type: "status", value: "正在保存…" },
        { type: "done", status: "no_change", summary: "内容未变化", rejected: [payload.error ?? "操作被拒绝"] },
      ]);
      return;
    }
    const snapshot = await response.json() as Record<string, unknown>;
    await fulfillSse(route, [
      { type: "status", value: "正在保存…" },
      { type: "done", ...snapshot, summary: "内容已更新" },
    ]);
  });
}
