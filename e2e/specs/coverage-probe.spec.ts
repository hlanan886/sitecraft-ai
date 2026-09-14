/**
 * 诊断探针：对缺槽模板注入标准草稿后，读回 hero / contact 区的真实 DOM 结构与 slot 状态。
 * 用于判定缺口是"模板结构真缺（报不支持）"还是"引擎启发式漏匹配（需适配器）"。
 * 非断言测试，只打印证据供适配判定。
 */
import { test } from "@playwright/test";
import { applyDraft, coverageDraft, openPreview } from "../helpers/coverage-scan";

const probeIds = (process.env.PROBE_TEMPLATES || "signal,powerai,moon,devportfolio,awesome,astrofy,shadcn-landing,yukina").split(",").map(s => s.trim()).filter(Boolean);

for (const templateId of probeIds) {
  test(`probe ${templateId} DOM after draft apply`, async ({ page }) => {
    await openPreview(page, templateId);
    const draft = coverageDraft(templateId);
    const report = await applyDraft(page, templateId, draft);
    const dom = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      // hero: what visible h1/h2 exist and which have hero.title slot
      const heroSlot = document.querySelector('[data-sitecraft-slot^="hero.title."]');
      out.heroSlotText = heroSlot?.textContent?.slice(0, 60) || null;
      out.heroSlotTag = heroSlot?.tagName || null;
      out.visibleHeadings = Array.from(document.querySelectorAll("h1,h2"))
        .filter((n) => n.getClientRects().length)
        .slice(0, 8)
        .map((n) => `${n.tagName}:${(n.textContent || "").trim().slice(0, 40)}`);
      // contact: scoped section presence + contact detail slots
      const contactScope = document.querySelector('[data-sitecraft-scope="contact"]');
      out.contactScopeFound = Boolean(contactScope);
      out.contactScopeHeadings = contactScope ? Array.from(contactScope.querySelectorAll("h1,h2,h3"))
        .filter((n) => n.getClientRects().length).map((n) => `${n.tagName}:${(n.textContent || "").trim().slice(0, 40)}`) : null;
      out.contactSlots = Array.from(document.querySelectorAll("[data-sitecraft-slot^='contact.']"))
        .map((n) => n.dataset.sitecraftSlot + "=" + (n.textContent || n.getAttribute("href") || "").trim().slice(0, 30));
      // mailto/tel anchors anywhere
      out.mailtoAnchors = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) => a.getAttribute("href")).slice(0, 3);
      out.telAnchors = Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) => a.getAttribute("href")).slice(0, 3);
      return out;
    });
    console.log(`[probe] ${templateId}`);
    console.log(`[probe]   missingSlots=${report.missingSlots.join(",")} residue=${report.residualDemoSlots.join(",")}`);
    console.log(`[probe]   ${JSON.stringify(dom)}`);
  });
}
