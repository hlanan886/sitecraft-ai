import { expect, test } from "@playwright/test";
import { cloneDraft, defaultDraft, type SiteDraft } from "../../lib/site-document";

function publishableDraft(name: string, heroTitle: string, revision = 1): SiteDraft {
  const draft = cloneDraft(defaultDraft);
  draft.siteName = name;
  draft.companyName = name;
  draft.templateId = "forge";
  draft.locale = "zh";
  draft.revision = revision;
  draft.industry = "工业自动化";
  draft.goal = "面向制造企业展示自动化解决方案并收集询盘。";
  draft.content.hero.title = { zh: heroTitle, en: "Industrial automation for production teams" };
  draft.content.hero.subtitle = { zh: "为制造团队提供稳定、可追溯的自动化组件。", en: "Reliable, traceable automation components for manufacturing teams." };
  draft.content.about.body = { zh: "我们专注于工业自动化组件的方案与交付。", en: "We focus on industrial automation components and delivery." };
  draft.content.features.items = draft.content.features.items.map((item, index) => ({
    ...item,
    title: { zh: `制造优势${index + 1}`, en: `Manufacturing advantage ${index + 1}` },
    body: { zh: `围绕质量和交付提供第${index + 1}项能力。`, en: `Capability ${index + 1} supports quality and delivery.` },
  }));
  draft.content.services.items = draft.content.services.items.map((item, index) => ({
    ...item,
    title: { zh: `服务流程${index + 1}`, en: `Service step ${index + 1}` },
    body: { zh: `从评估到交付的第${index + 1}项服务。`, en: `Service step ${index + 1} from assessment to delivery.` },
  }));
  draft.products = draft.products.map((product, index) => ({
    ...product,
    name: { zh: `自动化组件${index + 1}`, en: `Automation component ${index + 1}` },
    summary: { zh: `适用于生产线的自动化组件${index + 1}。`, en: `Automation component ${index + 1} for production lines.` },
    category: "工业自动化",
  }));
  draft.content.contact.title = { zh: "联系工程团队", en: "Talk to our engineering team" };
  draft.content.contact.body = { zh: "留下项目需求，我们将在一个工作日内回复。", en: "Share your requirements and we will reply within one business day." };
  draft.content.contact.email = "hello@northstar.example";
  draft.content.contact.phone = "+86 400 123 4567";
  draft.content.contact.address = { zh: "上海市浦东新区示例路 88 号", en: "88 Example Road, Pudong, Shanghai" };
  return draft;
}

test("发布快照独立于草稿，版本递增且回滚恢复历史版本", async ({ page, request }) => {
  const initialDraft = publishableDraft("Northstar Automation", "稳定自动化，从关键组件开始");
  const create = await request.post("/api/sites", {
    data: { name: initialDraft.siteName, templateId: initialDraft.templateId, locales: ["zh", "en"], initialDraft },
  });
  expect(create.status()).toBe(201);
  const { id: siteId } = await create.json() as { id: string };

  const firstPublish = await request.post(`/api/sites/${siteId}/publish`, {
    data: { baseRevision: 1, publishedBy: "e2e", idempotencyKey: `publish-v1-${siteId}` },
  });
  expect(firstPublish.status()).toBe(201);
  const firstPayload = await firstPublish.json() as { release: { releaseId: string; version: number } };
  expect(firstPayload.release.version).toBe(1);

  const update = await request.put(`/api/sites/${siteId}/draft`, {
    data: {
      baseRevision: 1,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "第二版自动化方案" }],
      summary: "e2e second draft",
      source: "manual",
    },
  });
  expect(update.status()).toBe(200);

  const publicAfterDraftEdit = await request.get(`/api/public/${siteId}`);
  expect(publicAfterDraftEdit.status()).toBe(200);
  const publicV1 = await publicAfterDraftEdit.json() as { release: { version: number; draft: SiteDraft } };
  expect(publicV1.release.version).toBe(1);
  expect(publicV1.release.draft.content.hero.title.zh).toBe("稳定自动化，从关键组件开始");

  const secondPublish = await request.post(`/api/sites/${siteId}/publish`, {
    data: { baseRevision: 2, publishedBy: "e2e", idempotencyKey: `publish-v2-${siteId}` },
  });
  expect(secondPublish.status()).toBe(201);
  const secondPayload = await secondPublish.json() as { release: { releaseId: string; version: number } };
  expect(secondPayload.release.version).toBe(2);

  const releases = await request.get(`/api/sites/${siteId}/releases`);
  expect(releases.status()).toBe(200);
  const releaseList = await releases.json() as { releases: Array<{ releaseId: string; version: number; status: string }> };
  expect(releaseList.releases.map((release) => [release.version, release.status])).toEqual([[2, "published"], [1, "superseded"]]);

  const rollback = await request.post(`/api/sites/${siteId}/releases/${firstPayload.release.releaseId}/rollback`, {
    data: { baseRevision: 2, publishedBy: "e2e", idempotencyKey: `rollback-v1-${siteId}` },
  });
  expect(rollback.status()).toBe(201);
  const rollbackPayload = await rollback.json() as { release: { version: number; rollbackOf?: string } };
  expect(rollbackPayload.release.version).toBe(3);
  expect(rollbackPayload.release.rollbackOf).toBe(firstPayload.release.releaseId);

  const rollbackReplay = await request.post(`/api/sites/${siteId}/releases/${firstPayload.release.releaseId}/rollback`, {
    data: { baseRevision: 2, publishedBy: "e2e", idempotencyKey: `rollback-v1-${siteId}` },
  });
  expect(rollbackReplay.status()).toBe(200);
  expect(rollbackReplay.headers()["x-idempotent-replay"]).toBe("true");
  const rollbackReplayPayload = await rollbackReplay.json() as { release: { releaseId: string; version: number } };
  expect(rollbackReplayPayload.release.releaseId).toBe(rollbackPayload.release.releaseId);

  const finalReleases = await request.get(`/api/sites/${siteId}/releases`);
  expect((await finalReleases.json() as { releases: unknown[] }).releases).toHaveLength(3);

  await page.goto(`/published/${siteId}`);
  await expect(page.locator("iframe.open-source-template-frame-published")).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "稳定自动化，从关键组件开始" }).first()).toBeVisible();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "第二版自动化方案" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/steps/chromium-publish-rollback-desktop.png", fullPage: false });
});

test("质量门拒绝未完成草稿且不创建发布版本", async ({ request }) => {
  const create = await request.post("/api/sites", {
    data: { name: `blocked-${Date.now()}`, templateId: "forge", locales: ["zh", "en"] },
  });
  expect(create.status()).toBe(201);
  const { id: siteId } = await create.json() as { id: string };

  const publish = await request.post(`/api/sites/${siteId}/publish`, {
    data: { baseRevision: 1, publishedBy: "e2e", idempotencyKey: `blocked-${siteId}` },
  });
  expect(publish.status()).toBe(422);
  const payload = await publish.json() as { error: string; quality?: { publishable?: boolean; placeholderHits?: string[] } };
  expect(payload.error).toBe("publish_blocked");
  expect(payload.quality?.publishable).toBe(false);
  expect(payload.quality?.placeholderHits?.length).toBeGreaterThan(0);

  const releases = await request.get(`/api/sites/${siteId}/releases`);
  expect(releases.status()).toBe(200);
  expect((await releases.json() as { releases: unknown[] }).releases).toEqual([]);
  expect((await request.get(`/api/public/${siteId}`)).status()).toBe(404);
});

test("发布 revision 冲突时不写入 release", async ({ request }) => {
  const initialDraft = publishableDraft("Revision Conflict", "初始发布标题");
  const create = await request.post("/api/sites", {
    data: { name: initialDraft.siteName, templateId: initialDraft.templateId, locales: ["zh", "en"], initialDraft },
  });
  expect(create.status()).toBe(201);
  const { id: siteId } = await create.json() as { id: string };
  const update = await request.put(`/api/sites/${siteId}/draft`, {
    data: {
      baseRevision: 1,
      operations: [{ op: "set_text", target: "hero.title", locale: "zh", value: "并发更新标题" }],
      summary: "e2e stale publish",
      source: "manual",
    },
  });
  expect(update.status()).toBe(200);

  const publish = await request.post(`/api/sites/${siteId}/publish`, {
    data: { baseRevision: 1, publishedBy: "e2e", idempotencyKey: `stale-${siteId}` },
  });
  expect(publish.status()).toBe(409);
  expect((await publish.json() as { error: string }).error).toBe("revision_conflict");
  expect((await request.get(`/api/sites/${siteId}/releases`)).status()).toBe(200);
  expect((await (await request.get(`/api/sites/${siteId}/releases`)).json() as { releases: unknown[] }).releases).toEqual([]);
});
