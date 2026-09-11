import { expect, test, type Page } from "@playwright/test";

import { classifyDraftCoverage } from "../../lib/template-content-coverage.ts";
import { cloneDraft, defaultDraft, type SiteDraft } from "../../lib/site-document.ts";
import { getTemplateManifest, type TemplateManifest } from "../../lib/template-manifest.ts";

type BridgeReport = {
  type: "sitecraft:applied";
  revision: number;
  visibleTextsBySlot: Record<string, string[]>;
  residualDemoSlots: string[];
};

const templateIds = ["forge", "shadcn-landing2"] as const;
const contactTargets = [
  "contact.title",
  "contact.body",
  "contact.email",
  "contact.phone",
  "contact.address",
] as const;

function completeDraft(templateId: string) {
  const draft = cloneDraft(defaultDraft);
  draft.templateId = templateId;
  draft.revision = 42;
  draft.companyName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  draft.content.about.body.zh = "启衡工业为新能源设备提供精密组件与联合工程服务。";
  draft.content.features.items = [{
    id: "traceability",
    title: { zh: "全程追溯", en: "Traceability" },
    body: { zh: "从来料到出货保留可核验记录。", en: "Verifiable records from intake to shipment." },
  }];
  draft.content.services.items = [{
    id: "engineering",
    title: { zh: "联合工程", en: "Joint engineering" },
    body: { zh: "围绕应用边界共同完成设计验证。", en: "Validate designs against application constraints." },
  }];
  draft.products = [{
    sku: "QH-100",
    name: { zh: "高稳定连接组件", en: "Stable connector assembly" },
    summary: { zh: "面向高频振动工况。", en: "For high-vibration environments." },
    category: "精密组件",
    status: "published",
    imageColor: "#d7e7d1",
  }];
  draft.content.contact.title.zh = "把需求交给工程团队";
  draft.content.contact.body.zh = "提交图纸与目标交期，工程团队将在一个工作日内回复。";
  draft.content.contact.email = "engineering@qiheng.example";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  return draft;
}

async function applyDraft(page: Page, templateId: string, draft: SiteDraft): Promise<BridgeReport> {
  const response = await page.goto(`/api/templates/${templateId}/preview`);
  expect(response?.status()).toBe(200);
  return page.evaluate(({ currentTemplateId, currentDraft }) => new Promise<BridgeReport>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("bridge_apply_timeout")), 10_000);
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== "sitecraft:applied" || event.data.revision !== currentDraft.revision) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data as BridgeReport);
    };
    window.addEventListener("message", receive);
    window.postMessage({
      type: "sitecraft:content",
      templateId: currentTemplateId,
      siteKey: "coverage-e2e",
      draft: currentDraft,
      locale: currentDraft.locale,
      variant: "preview",
    }, "*");
  }), { currentTemplateId: templateId, currentDraft: draft });
}

function pendingTargets(report: BridgeReport, draft: SiteDraft, manifest: TemplateManifest) {
  const draftCoverage = classifyDraftCoverage({ draft, manifest, appliedTargets: [] });
  const visibleTargets = new Set(Object.keys(report.visibleTextsBySlot));
  return [...new Set([
    ...draftCoverage.pendingTargets,
    ...manifest.slots.filter((slot) => slot.required && !visibleTargets.has(slot.target)).map((slot) => slot.target),
    ...report.residualDemoSlots,
  ])];
}

for (const templateId of templateIds) {
  test(`${templateId} reports complete visible content without demo residue`, async ({ page }) => {
    const manifest = getTemplateManifest(templateId);
    expect(manifest).toBeTruthy();
    const draft = completeDraft(templateId);
    const report = await applyDraft(page, templateId, draft);
    const contentTargets = manifest!.slots.map((slot) => slot.target);

    expect(Object.keys(report.visibleTextsBySlot)).toEqual(expect.arrayContaining(contentTargets));
    expect(report.residualDemoSlots).toEqual([]);
    expect(pendingTargets(report, draft, manifest!)).toEqual([]);
    for (const target of contactTargets) {
      expect(report.visibleTextsBySlot[target]?.join(" ").trim(), target).toBeTruthy();
    }
    expect(Object.keys(report.visibleTextsBySlot).some((target) => /(?:logo|image|formAction)/i.test(target))).toBe(false);
    for (const slot of manifest!.slots) {
      expect(report.visibleTextsBySlot[slot.target].every((text) => text.length <= slot.maxLength), slot.target).toBe(true);
    }
  });

  test(`${templateId} keeps hidden about and default products pending`, async ({ page }) => {
    const manifest = getTemplateManifest(templateId);
    expect(manifest).toBeTruthy();
    const draft = completeDraft(templateId);
    draft.hiddenSections = ["about"];
    draft.content.about = structuredClone(defaultDraft.content.about);
    draft.products = structuredClone(defaultDraft.products);
    draft.revision += 1;

    const report = await applyDraft(page, templateId, draft);
    const pending = pendingTargets(report, draft, manifest!);
    expect(report.visibleTextsBySlot["about.body"]).toBeUndefined();
    expect(pending).toEqual(expect.arrayContaining(["about.body", "products"]));
    expect(pending.filter((target) => target === "about.body" || target === "products")).toEqual([
      "about.body",
      "products",
    ]);
  });
}
