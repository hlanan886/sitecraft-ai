/**
 * T-21 结构回归网：forge 的两条**独立**缺陷（2026-09-14 由会话 A 接手实施）。
 *
 * ## 为什么要一个独立 spec（而不是留在探针里）
 *
 * 探针（`scripts/probe-forge-structure.mjs`）是**一次性取证工具**：
 * 它打印读数、不设退出码、不进 e2e。修复完成后探针退役，
 * **缺陷就回到"没锁"状态**——修过的 bug 会再犯，这正是 S-1 的教训。
 * 用户裁决：**把探针断言并进 e2e，成为常设回归网。**
 *
 * ## 两条机制**分开立**（用户裁决 4：不许合并成「hero 消失」一句话）
 *
 * | 机制 | 位置 | 签名 | 坏样本 |
 * |---|---|---|---|
 * | **a** 产品图 | `bridge.renderAdditionalProducts` | 有图 → `<img>`；**无图 → 色块** | 删掉色块分支（即修复前） |
 * | **b** CTAbg | `forge.ts` CTA 改建 | computed `background-image` **含 CTAbg** | 改回 `removeAttribute('class')`（即修复前） |
 *
 * 两条的坏样本**互不干扰**：删色块不会让 b 变红，抹 CTAbg 不会让 a 变红
 * ——这是"分开立"的判别力依据（附则 A4）。
 *
 * ## 反证（证明它们是两条独立路径，不是"整个 hero 塌了"）
 *
 * `heroimg` 两轮都渲染正常（`img[src*="heroimg"]` 存在）。
 * 本 spec 也锁住它：**它不该被这两条修复波及**。
 */
import { test, expect } from "@playwright/test";
import { cloneDraft, defaultDraft } from "../../lib/site-document";

const TEMPLATE_ID = "forge";
const PREVIEW_PATH = `/api/templates/${TEMPLATE_ID}/preview`;

/** 空草稿：新站初始态（探针里的 revision=101 同款）。 */
function emptyDraft() {
  const draft = cloneDraft(defaultDraft);
  draft.templateId = TEMPLATE_ID;
  draft.revision = 101;
  draft.companyName = "启衡工业";
  draft.siteName = "启衡工业";
  return draft;
}

/**
 * 有产品草稿：**2 个产品，只有第 1 个带图** —— 这个"1 图 2 卡"正是机制 a 的签名
 * （探针实测：卡片=2 图=1，无图那张卡里什么 media 都没有）。
 */
function draftWithProducts() {
  const draft = emptyDraft();
  draft.revision = 102;
  draft.products = [
    {
      sku: "QH-100",
      name: { zh: "高稳定连接组件", en: "Stable connector assembly" },
      summary: { zh: "面向高频振动工况。", en: "For high-vibration environments." },
      category: "精密组件",
      status: "published",
      imageColor: "#d7e7d1",
      image: "/api/product-images/probe-1.jpg",
    },
    {
      sku: "QH-200",
      name: { zh: "精密传动部件", en: "Precision drive part" },
      summary: { zh: "适用于高负载场景。", en: "For high-load scenarios." },
      category: "精密组件",
      status: "published",
      imageColor: "#cfe0ee",
      // ⚠️ 故意不给 image —— 这就是"无图"那条分支
    },
  ];
  return draft;
}

/** 把草稿推进预览页并等 bridge 回报 applied。 */
async function applyDraft(page, draft) {
  await page.evaluate(
    ({ tid, d }) =>
      new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("bridge_apply_timeout")), 15_000);
        const receive = (event) => {
          if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
          window.clearTimeout(timer);
          window.removeEventListener("message", receive);
          resolve(null);
        };
        window.addEventListener("message", receive);
        window.postMessage(
          { type: "sitecraft:content", templateId: tid, siteKey: "t21-spec", draft: d, locale: d.locale, variant: "preview" },
          "*",
        );
      }),
    { tid: TEMPLATE_ID, d: draft },
  );
}

test.describe("T-21 · forge 结构回归网", () => {
  test("机制a：产品卡有图插 img、无图回落色块", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${PREVIEW_PATH}`);
    await applyDraft(page, draftWithProducts());

    const read = await page.evaluate(() => {
      const section = document.querySelector("[data-sitecraft-generated-products]");
      if (!section) return null;
      const cards = Array.from(section.querySelectorAll("article"));
      return {
        sectionPresent: true,
        cardCount: cards.length,
        imgCount: section.querySelectorAll("img").length,
        placeholderSkus: Array.from(section.querySelectorAll("[data-sitecraft-product-placeholder]")).map(
          (n) => n.getAttribute("data-sitecraft-product-placeholder"),
        ),
        // 色块的背景色必须真的被应用（不是只建了个空壳节点）
        placeholderBg: Array.from(section.querySelectorAll("[data-sitecraft-product-placeholder]")).map(
          (n) => window.getComputedStyle(n).backgroundColor,
        ),
      };
    });

    expect(read, "产品区必须存在（有 products 就该生成）").not.toBeNull();
    expect(read.cardCount, "卡片数必须等于 products 数").toBe(2);
    expect(read.imgCount, "只有第 1 个产品带图 → 只该有 1 个 img").toBe(1);
    expect(
      read.placeholderSkus,
      "无图的产品必须有**色块回退节点**（机制 a 的签名）——修复前这里一张卡什么 media 都没有",
    ).toEqual(["QH-200"]);
    expect(
      read.placeholderBg[0],
      "色块必须真的带上草稿里的 imageColor（#cfe0ee → rgb(207, 224, 238)）",
    ).toBe("rgb(207, 224, 238)");
  });

  test("机制a：空 products → 产品区整区不生成", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${PREVIEW_PATH}`);
    await applyDraft(page, emptyDraft());

    const count = await page.evaluate(
      () => document.querySelectorAll("[data-sitecraft-generated-products]").length,
    );
    expect(count, "空 products 不该生成产品区（二值信号，不做结构计数）").toBe(0);
  });

  test("机制b：CTA 段保留 CTAbg 背景大图", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${PREVIEW_PATH}`);
    await applyDraft(page, draftWithProducts());

    const cta = await page.evaluate(() => {
      const node = document.querySelector("body > section#contact") ?? document.querySelector("body > section");
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        id: node.id,
        hasCtabgInBackground: (style.backgroundImage || "").includes("CTAbg"),
        backgroundImage: (style.backgroundImage || "").slice(0, 160),
      };
    });

    expect(cta, "CTA 段必须存在").not.toBeNull();
    expect(cta.id, "CTA 段仍该被改建为 #contact").toBe("contact");
    expect(
      cta.hasCtabgInBackground,
      "CTA 的 computed background-image 必须含 CTAbg —— 修复前 class 被 removeAttribute 抹掉，" +
        "背景大图整段消失（用户看到的就是「只剩渐变底」）",
    ).toBe(true);
  });

  test("反证：heroimg 不受这两条修复波及", async ({ page, baseURL }) => {
    await page.goto(`${baseURL}${PREVIEW_PATH}`);
    await applyDraft(page, draftWithProducts());

    const hero = await page.evaluate(() => {
      const img = document.querySelector('img[src*="heroimg"]');
      return { present: Boolean(img), src: img ? img.getAttribute("src") : null };
    });
    expect(hero.present, "hero 图必须仍在（证明 a/b 是两条独立路径，不是整个 hero 塌了）").toBe(true);
  });
});

/**
 * T-22 · 头部**可见文案不得重复**（2026-09-14 登记）。
 *
 * ## 为什么加这条（现状已不复现，但需要常设回归网）
 *
 * 用户截图里曾出现「联系我们」在头部出现两次（nav 兜底词与 contact 标题同词）。
 * 2026-09-14 实测三适配器（forge / kindred / nextjs-landing）**均已不复现**：
 * nav 渲染的是 `draft.navigation` 的真实值（关于/优势/产品/服务/联系），
 * 与 contact 标题「联系我们」不同词 —— 该缺陷被其他改动顺带修掉了。
 *
 * **但仍立此断言**：这类"同词重复"是**很容易复发**的（兜底词一改回去就复发），
 * 而它只影响观感、不报错，没有门禁就再也回不来（S-1 的教训）。
 *
 * 判据：**只看可见元素**（`getClientRects().length`）——
 * 桌面/移动两套 logo 是设计需要，不算重复。
 */
test.describe("T-22 · 头部可见文案不得重复", () => {
  for (const templateId of ["forge", "kindred", "nextjs-landing"]) {
    test(`${templateId} 头部无可见重复文案`, async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/api/templates/${templateId}/preview`);
      const draft = emptyDraft();
      draft.templateId = templateId;
      draft.revision = 902;
      await page.evaluate(
        ({ tid, d }) =>
          new Promise((resolve) => {
            const timer = window.setTimeout(resolve, 8_000);
            const receive = (event) => {
              if (event.data?.type !== "sitecraft:applied" || event.data.revision !== d.revision) return;
              window.clearTimeout(timer);
              window.removeEventListener("message", receive);
              resolve(null);
            };
            window.addEventListener("message", receive);
            window.postMessage(
              { type: "sitecraft:content", templateId: tid, siteKey: "t22-spec", draft: d, locale: d.locale, variant: "preview" },
              "*",
            );
          }),
        { tid: templateId, d: draft },
      );

      const dupes = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("header a, header button")).filter(
          (n) => n.getClientRects().length > 0, // 只算可见的
        );
        const counts: Record<string, number> = {};
        for (const node of nodes) {
          const text = (node.textContent || "").trim();
          if (!text) continue;
          counts[text] = (counts[text] || 0) + 1;
        }
        return Object.entries(counts)
          .filter(([, count]) => count > 1)
          .map(([text, count]) => `${text} x${count}`);
      });

      expect(
        dupes,
        `${templateId} 头部出现**可见的重复文案**（含移动端隐藏元素不算）——` +
          `历史上曾因 nav 兜底词与 contact 标题同词触发：${dupes.join("、")}`,
      ).toEqual([]);
    });
  }
});
