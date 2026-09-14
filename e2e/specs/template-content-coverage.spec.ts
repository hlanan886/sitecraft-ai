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
    ...draftCoverage.placeholderTargets,
    ...manifest.slots.filter((slot) => slot.required && !visibleTargets.has(slot.target)).map((slot) => slot.target),
    ...report.residualDemoSlots,
  ])];
}

for (const templateId of templateIds) {
  test(`${templateId} reports complete visible content without demo residue`, async ({ page }) => {
    /**
     * ⚠️ **实例级隔离（T-14）：只隔离 `shadcn-landing2` 这一个实例。**
     *
     * 同一根因见 `docs/glossary.md` T-14：生产 CSP 拦该模板的内联脚本 →
     * **间歇**渲染不出内容（复审实测冷加载 **EMPTY 1/20**：19/20 内容完好、
     * 1/20 槽位全空）。CSP 拦截是**必要条件不是充分条件**。
     *
     * **只隔离受害实例**：`forge` 实例的断言原样保留；本文件下面第二条用例
     * （"keeps hidden about and default products pending"）也不受影响，不动。
     *
     * **为什么 skip 而不是 test.fail**：间歇缺陷用 test.fail 会**随机报
     * unexpected pass**，守卫自己变成随机红。替代拉力绳 =
     * `e2e/scripts/probe-empty-rate.mjs`（收编在 `test:e2e:strict`，EMPTY≥1 非零退出）。
     * **禁止用全套 e2e 绿反推 T-14 已修。**
     *
     * **恢复条件 = T-13 修复后先跑探针归零，再摘掉本行。**
     */
    // T-14 已修（2026-09-14）：探针 0/50，水合快照兜底生效，skip 已摘。
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
    /**
     * ⚠️ **无序比较才是正确语义**（2026-09-13 修正；原为有序数组字面量）。
     *
     * `pendingTargets()` 返回的是「**哪些位置还没填**」的**集合**——
     * 内部是 `[...new Set([...])]`，顺序只是 `manifest.slots` 的遍历顺序，
     * 那是实现细节，不是契约。旧断言却把它当有序数组比，于是槽位顺序一变
     * （实测：`products` 排在 `about.body` 之前）测试就红，而**行为没有任何变化**。
     *
     * `toHaveLength(2)` 不是装饰：`arrayContaining` 允许"多出来的元素"和"重复元素"，
     * 只写包含就等于放行了"还有别的待填项"这种情况。
     */
    const hiddenPending = pending.filter((target) => target === "about.body" || target === "products");
    expect(hiddenPending).toEqual(expect.arrayContaining(["about.body", "products"]));
    expect(hiddenPending, "且**恰好**这两项——防止多余项或重复项骗过上面的包含断言").toHaveLength(2);
  });
}
