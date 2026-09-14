import assert from "node:assert/strict";
import test from "node:test";
import { requestDraftOperations, requestSiteIntent } from "../lib/ai-provider.ts";
import { defaultDraft } from "../lib/site-document.ts";
import { normalizeUserBrief, type SiteIntent } from "../lib/site-intent.ts";

function configuredEnvironment() {
  const previous = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "test-model";
  return () => { process.env = previous; };
}

test("requestSiteIntent: parent signal aborts the active provider request", async () => {
  const restoreEnvironment = configuredEnvironment();
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("", { status: 500 })), 30);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }) as typeof fetch;
  const args = { text: "工业官网", signal: controller.signal, deadlineAt: Date.now() + 100 };

  try {
    const pending = requestSiteIntent(args);
    setTimeout(() => controller.abort(new Error("客户端取消")), 2);
    const result = await Promise.race([
      pending,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 20)),
    ]);
    assert.notEqual(result, "hung");
    if (result !== "hung") {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "aborted");
    }
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("requestSiteIntent: retry consumes the original remaining deadline", async () => {
  const restoreEnvironment = configuredEnvironment();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("", { status: 500 })), 30);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }) as typeof fetch;
  const args = { text: "工业官网", deadlineAt: Date.now() + 12 };

  try {
    const result = await requestSiteIntent(args);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "timeout");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("requestSiteIntent: sends normalized brief constraints to the provider", async () => {
  const restoreEnvironment = configuredEnvironment();
  const originalFetch = globalThis.fetch;
  let systemPrompt = "";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    systemPrompt = body.messages?.find((message) => message.role === "system")?.content ?? "";
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        status: "ready",
        businessType: "manufacturing",
        companyName: "华东智造",
        industry: "工业自动化",
        targetAudience: "overseasB2b",
        tone: "professional",
        coreSections: ["about", "features", "products", "contact"],
        recommendedTemplateId: "forge",
        summary: "工业自动化官网",
        siteLanguage: "zh",
        notices: [],
        needsInfo: [],
        conflicts: [],
        limits: [],
      }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const brief = normalizeUserBrief("华东智造做工业自动化设备，面向欧洲采购商，拥有 ISO 9001 认证。");
    const result = await requestSiteIntent({ text: "生成工业自动化官网", brief });
    assert.equal(result.ok, true);
    assert.match(systemPrompt, /industrial_automation/);
    assert.match(systemPrompt, /overseasB2b/);
    assert.match(systemPrompt, /ISO 9001/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("requestDraftOperations: provider request consumes the caller deadline instead of a fixed 90 seconds", async () => {
  const restoreEnvironment = configuredEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const intent: SiteIntent = {
    businessType: "manufacturing",
    companyName: "测试制造",
    industry: "工业制造",
    targetAudience: "overseasB2b",
    tone: "professional",
    coreSections: ["about", "features", "services", "products", "contact"],
    recommendedTemplateId: "forge",
    summary: "工业制造官网",
  };

  try {
    const result = await Promise.race([
      requestDraftOperations({
        intent,
        templateId: "forge",
        baseDraft: defaultDraft,
        scope: { sections: ["about"], bilingual: false },
        maxAttempts: 1,
        deadlineAt: Date.now() + 15,
      }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 60)),
    ]);
    assert.notEqual(result, "hung");
    if (result !== "hung") {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "timeout");
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});

test("requestDraftOperations: sends template capability constraints to the provider", async () => {
  const restoreEnvironment = configuredEnvironment();
  const originalFetch = globalThis.fetch;
  let systemPrompt = "";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    systemPrompt = body.messages?.find((message) => message.role === "system")?.content ?? "";
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "完成", operations: [] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const intent: SiteIntent = {
    businessType: "manufacturing",
    companyName: "测试制造",
    industry: "工业制造",
    targetAudience: "domesticB2b",
    tone: "professional",
    coreSections: ["about", "features", "services", "products", "contact"],
    recommendedTemplateId: "forge",
    summary: "工业制造官网",
  };

  try {
    const result = await requestDraftOperations({
      intent,
      templateId: "forge",
      baseDraft: defaultDraft,
      scope: { sections: ["hero"], bilingual: true, siteLanguage: "zh" },
      maxAttempts: 1,
    });
    assert.equal(result.ok, true);
    assert.match(systemPrompt, /模板能力约束/);
    assert.match(systemPrompt, /manifestVersion=1/);
    assert.match(systemPrompt, /hero\.title/);
    assert.match(systemPrompt, /输出语言：zh/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment();
  }
});
