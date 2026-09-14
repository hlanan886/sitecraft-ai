import assert from "node:assert/strict";
import test from "node:test";

import { isInlineEditableSlot, slotToDraftOperation } from "../lib/inline-edit-mapping.ts";
import { applySiteOperations } from "../lib/site-operations.ts";
import { cloneDraft, defaultDraft, type SiteDraft } from "../lib/site-document.ts";

/**
 * P3.1 就地编辑反向映射单测（2026-09-09）。
 *
 * 用例来源：`scripts/probe-slot-mapping.mjs` 对 22 模板实测出的 42 种 slot 形态
 * （可映射 31 / 有意拒绝 11 / 不可映射 0），逐一覆盖。
 */

function draftWith(overrides: (draft: SiteDraft) => void): SiteDraft {
  const draft = cloneDraft(defaultDraft);
  draft.companyName = "启衡工业";
  draft.content.hero.title.zh = "让精密制造更可靠";
  draft.content.hero.title.en = "Precision manufacturing";
  draft.content.about.body.zh = "启衡工业为新能源设备提供精密组件。";
  draft.content.contact.email = "engineering@qiheng.example";
  draft.content.contact.phone = "+86 21 5555 0100";
  draft.content.contact.address.zh = "上海市浦东新区启衡路 18 号";
  draft.content.features.items = [
    { id: "traceability", title: { zh: "全程追溯", en: "Traceability" }, body: { zh: "可核验记录。", en: "Verifiable records." } },
  ];
  draft.content.services.items = [
    { id: "engineering", title: { zh: "联合工程", en: "Joint engineering" }, body: { zh: "共同验证。", en: "Validate together." } },
  ];
  draft.products = [
    { sku: "QH-100", name: { zh: "高稳定连接组件", en: "Stable connector" }, summary: { zh: "面向振动工况。", en: "For vibration." }, category: "精密组件", status: "published", imageColor: "#ddd" },
    { sku: "QH.200", name: { zh: "精密传动部件", en: "Precision drive" }, summary: { zh: "高负载场景。", en: "High load." }, category: "精密组件", status: "published", imageColor: "#eee" },
  ];
  overrides(draft);
  return draft;
}

const base = (slot: string, value: string, originalValue = "") =>
  ({ slot, value, originalValue, draft: draftWith(() => {}), uiLocale: "zh" as const });

// ---------- 正向：set_text ----------

test("hero.title.zh maps to set_text with locale from suffix and expectedValue", () => {
  const result = slotToDraftOperation(base("hero.title.zh", "更可靠的制造", "让精密制造更可靠"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.operation, {
    op: "set_text",
    target: "hero.title",
    locale: "zh",
    value: "更可靠的制造",
    expectedValue: "让精密制造更可靠",
  });
  assert.equal(result.label, "首屏标题");
});

test("hero.title.en uses the en suffix", () => {
  const result = slotToDraftOperation(base("hero.title.en", "Reliable manufacturing", "Precision manufacturing"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { locale?: string }).locale, "en");
});

test("slot without locale suffix falls back to uiLocale (generated-section nodes)", () => {
  const result = slotToDraftOperation({ ...base("about.body", "新简介", "启衡工业为新能源设备提供精密组件。"), uiLocale: "en" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { locale?: string }).locale, "en");
});

test("non-localized targets are normalized to zh even when suffix says en", () => {
  // site-operations.ts:242 会静默忽略 en，这里必须主动归一，否则 expectedValue 比对口径错位
  const result = slotToDraftOperation({ ...base("contact.email.en", "sales@qiheng.example", "engineering@qiheng.example") });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.operation, {
    op: "set_text",
    target: "contact.email",
    locale: "zh",
    value: "sales@qiheng.example",
    expectedValue: "engineering@qiheng.example",
  });
});

test("companyName.zh maps to the non-localized companyName field", () => {
  const result = slotToDraftOperation(base("companyName.zh", "启衡工业集团", "启衡工业"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { target: string }).target, "companyName");
  assert.equal((result.operation as { locale?: string }).locale, "zh");
  assert.equal(result.label, "品牌名称");
});

test("navigation slot maps to set_text and labels the nav item", () => {
  const result = slotToDraftOperation(base("navigation.about.zh", "公司介绍", "关于我们"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { target: string }).target, "navigation.about");
  // ⑥ 起：标签用**用户自己填的那个词**，不是 id。
  // 提示语要给人看，`导航「about」` 对用户是个内部名词。
  assert.equal(result.label, "导航「关于」");
});

// ---------- 正向：update_item ----------

test("features item by id maps to update_item with itemId and index", () => {
  const result = slotToDraftOperation(base("features.items.traceability.title.zh", "全流程追溯", "全程追溯"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.operation, {
    op: "update_item",
    section: "features",
    index: 0,
    itemId: "traceability",
    locale: "zh",
    title: "全流程追溯",
    expectedValue: "全程追溯",
  });
  assert.equal(result.label, "核心优势第 1 条标题");
});

test("features item by numeric index maps to update_item without itemId lookup failure", () => {
  const result = slotToDraftOperation(base("features.items.0.body.zh", "新的说明", "可核验记录。"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { index: number }).index, 0);
  assert.equal((result.operation as { body?: string }).body, "新的说明");
});

test("services item maps to update_item with section=services", () => {
  const result = slotToDraftOperation(base("services.items.engineering.title.zh", "联合工程服务", "联合工程"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { section: string }).section, "services");
  assert.equal(result.label, "服务第 1 条标题");
});

// ---------- 正向：update_product ----------

test("product slot maps to update_product", () => {
  const result = slotToDraftOperation(base("products.QH-100.name.zh", "高稳定连接组件二代", "高稳定连接组件"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.operation, {
    op: "update_product",
    sku: "QH-100",
    locale: "zh",
    name: "高稳定连接组件二代",
    expectedValue: "高稳定连接组件",
  });
});

test("sku containing a dot is matched greedily", () => {
  const result = slotToDraftOperation(base("products.QH.200.summary.zh", "适用于重载场景。", "高负载场景。"));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.operation as { sku: string }).sku, "QH.200");
});

// ---------- 反向：拒绝并给可读原因 ----------

test("template UI copy slots are rejected with a readable message", () => {
  for (const slot of ["footer.rights.zh", "form.labels.name.zh", "form.submit.zh", "faq.title.zh"]) {
    const result = slotToDraftOperation(base(slot, "新文案", "旧文案"));
    assert.equal(result.ok, false, slot);
    if (result.ok) return;
    assert.equal(result.code, "unsupported_slot", slot);
    assert.ok(result.message.length > 0, slot);
  }
});

test("hero.image is rejected (asset slot, handled by the asset channel)", () => {
  const result = slotToDraftOperation(base("hero.image", "x", "y"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unsupported_slot");
});

test("empty slot means the node is not editable", () => {
  const result = slotToDraftOperation(base("", "新文案", "旧文案"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "not_editable");
});

test("blank value and unchanged value are both rejected", () => {
  const blank = slotToDraftOperation(base("hero.title.zh", "   ", "让精密制造更可靠"));
  assert.equal(blank.ok, false);
  if (!blank.ok) assert.equal(blank.code, "invalid_value");

  const unchanged = slotToDraftOperation(base("hero.title.zh", "让精密制造更可靠", "让精密制造更可靠"));
  assert.equal(unchanged.ok, false);
  if (!unchanged.ok) assert.equal(unchanged.code, "invalid_value");
});

test("whitespace differences do not count as a change", () => {
  const result = slotToDraftOperation(base("hero.title.zh", "  让精密制造更可靠  ", "让精密制造更可靠"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "invalid_value");
});

test("stale card id is rejected instead of writing to the wrong item", () => {
  const result = slotToDraftOperation(base("features.items.does-not-exist.title.zh", "新标题", "旧标题"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "stale_target");
});

test("out-of-range card index is rejected", () => {
  const result = slotToDraftOperation(base("features.items.7.title.zh", "新标题", "旧标题"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "stale_target");
});

test("unknown product sku is rejected", () => {
  const result = slotToDraftOperation(base("products.NOPE.name.zh", "新名称", "旧名称"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "stale_target");
});

test("duplicate card ids are reported as ambiguous rather than guessed", () => {
  const draft = draftWith((d) => {
    d.content.features.items = [
      { id: "dup", title: { zh: "A", en: "A" }, body: { zh: "a", en: "a" } },
      { id: "dup", title: { zh: "B", en: "B" }, body: { zh: "b", en: "b" } },
    ];
  });
  const result = slotToDraftOperation({ slot: "features.items.dup.title.zh", value: "新", originalValue: "A", draft, uiLocale: "zh" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "ambiguous");
});

test("over-length values are rejected before hitting the server schema", () => {
  const longTitle = "标".repeat(161);
  const card = slotToDraftOperation(base("features.items.traceability.title.zh", longTitle, "全程追溯"));
  assert.equal(card.ok, false);
  if (!card.ok) assert.equal(card.code, "invalid_value");

  const longText = "文".repeat(1001);
  const text = slotToDraftOperation(base("about.body", longText, "旧正文"));
  assert.equal(text.ok, false);
  if (!text.ok) assert.equal(text.code, "invalid_value");
});

// ---------- isInlineEditableSlot ----------

test("isInlineEditableSlot mirrors the mapping accept/reject decision", () => {
  for (const slot of ["hero.title.zh", "about.body", "features.items.traceability.title.zh", "products.QH-100.name.zh", "companyName.zh", "navigation.about.zh"]) {
    assert.equal(isInlineEditableSlot(slot), true, slot);
  }
  // 2026-09-11：`logos.N.name` 曾因**没有写回路径**（`textTargets` 里没有 `logos.*`）
  // 被拒；⑥-4b 给了它 `update_logo`，所以**只有在草稿里真的存在那一项时才算可编辑**
  // （不带 draft 调用的这一组断言仍按"形态合法"判，见下一条不变量测试）。
  for (const slot of [
    "footer.rights.zh", "form.submit.zh",
    "faq.title.zh",              // 节标题仍不在 `textTargets` 里（⑥-4b 明确拒绝）
    "testimonials.title.zh",
    "brand.logo", "hero.image", "",
  ]) {
    assert.equal(isInlineEditableSlot(slot), false, slot);
  }
});

// ---------- ⑥-4：FAQ 的写回路径 ----------

test("FAQ 条目能就地编辑了（⑥-4：update_item 的 section 扩到了 faq）", () => {
  const draft = draftWith((d) => {
    d.content.faq = {
      title: { zh: "常见问题", en: "" },
      intro: { zh: "", en: "" },
      items: [{ id: "faq-1", title: { zh: "交期多久？", en: "" }, body: { zh: "15 天。", en: "" } }],
    };
  });
  const result = slotToDraftOperation({
    slot: "faq.items.faq-1.title.zh",
    value: "交期一般是多久？",
    originalValue: "交期多久？",
    draft,
    uiLocale: "zh",
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  assert.equal((result.operation as { section: string }).section, "faq");
  assert.equal((result.operation as { title?: string }).title, "交期一般是多久？");
});

test("**草稿里没有 faq 时也能写**——图里没有 FAQ 的站不该被迫先空着一节", () => {
  // `content.faq` 在 schema 里是**可选**的。直接 `draft.content[section].items`
  // 对 `undefined` 取 `.items` 会抛 TypeError，而那是**整批操作失败**——
  // 用户改一条 FAQ 却把同一批里的其它改动一起丢了。
  const draft = draftWith(() => {});
  assert.equal(draft.content.faq, undefined, "前提：这份草稿本来没有 faq 节");
  const after = applySiteOperations(
    draft,
    [{ op: "add_item", section: "faq", item: { id: "faq-1", title: { zh: "问题", en: "" }, body: { zh: "回答", en: "" } } } as never],
    { templateIds: new Set(["t"]), lastChange: "test" },
  );
  assert.equal(after.draft.content.faq?.items.length, 1, "faq 节应被补出来并写入条目");
});

test("`isInlineEditableSlot` 与 `slotToDraftOperation` **逐槽位一致**（不变量）", () => {
  /**
   * 这两个函数是同一件事的两面：前者决定 bridge 要不要弹输入框，
   * 后者决定保存能不能成。**不一致就是 bug**，而且两个方向都糟：
   *  - 前者宽 → 用户敲完字才被拒（白改一次）
   *  - 前者窄 → 明明能改的地方点不动（"点了没反应"，最难查）
   *
   * 2026-09-11（⑥-4）**实测到过一次不一致**：`isInlineEditableSlot` 的兜底是
   * 很宽的 `TEXT_SLOT`（任意点分小写路径都过），于是 `faq.title.zh` 被判"可编辑"，
   * 而 `slotToDraftOperation` 拒它。这条不变量把两边焊死。
   */
  const draft = draftWith((d) => {
    d.content.faq = {
      title: { zh: "常见问题", en: "" },
      intro: { zh: "", en: "" },
      items: [{ id: "faq-1", title: { zh: "问", en: "" }, body: { zh: "答", en: "" } }],
    };
  });
  const slots = [
    // 该接受
    "hero.title.zh", "about.body", "features.items.traceability.title.zh", "services.items.0.body.zh",
    "products.QH-100.name.zh", "products.QH-100.summary.en", "companyName.zh", "contact.email.zh",
    "navigation.about.zh", "navigation.contact", "faq.items.faq-1.title.zh", "faq.items.0.body.zh",
    // 该拒绝
    "footer.rights.zh", "form.submit.zh", "form.labels.name.zh", "brand.logo", "hero.image",
    "testimonials.items.0.quote.zh", "faq.title.zh", "faq.intro.zh", "testimonials.title.zh",
    "navigation.home.zh", "sections.order", "", "about.visibility",
    // 形态对但草稿里没有 —— 两边都该拒
    "navigation.nope.zh", "logos.0.name",
  ];
  for (const slot of slots) {
    const predicted = isInlineEditableSlot(slot, draft);
    const actual = slotToDraftOperation({ ...base(slot, "新值", "旧值"), draft }).ok;
    assert.equal(predicted, actual, `${slot}：isInlineEditableSlot=${predicted} 而 slotToDraftOperation=${actual}`);
  }

  /**
   * 再跑一遍**带评价与 Logo 的草稿**——上一条用同一份槽位清单在这里的判定应当翻转。
   *
   * 这半边才是真正有价值的：它证明"同一条不变量在**两种草稿状态下**都成立"。
   * 只测一种状态的话，`logos.0.name` 那种"看草稿才能判"的槽位会溜过去。
   */
  const rich = draftWithExtras();
  for (const slot of ["logos.0.name", "testimonials.items.0.quote.zh", "testimonials.items.0.author.zh"]) {
    const predicted = isInlineEditableSlot(slot, rich);
    const actual = slotToDraftOperation({ ...base(slot, "新值", "旧值"), draft: rich }).ok;
    assert.equal(predicted, actual, `${slot}（有该项的草稿）：isInlineEditableSlot=${predicted} 而 slotToDraftOperation=${actual}`);
    assert.equal(actual, true, `${slot} 在草稿里真的有该项，两边都该放行`);
  }
});

test("不存在的导航 id：一致地拒绝（两边都不该放行）", () => {
  // 导航项 id 由数据决定，模型完全可能输出一个草稿里没有的 id。
  // 放行的话，用户敲完字才在保存那步发现改不了。
  const draft = draftWith(() => {});
  assert.equal(isInlineEditableSlot("navigation.home.zh", draft), false, "草稿里没有 home 这一项");
  const result = slotToDraftOperation({ ...base("navigation.home.zh", "首页", "旧"), draft });
  assert.equal(result.ok, false);
});

// ---------- ⑥-4b：评价与 Logo 的写回路径 ----------

function draftWithExtras(): SiteDraft {
  return draftWith((d) => {
    d.content.testimonials = {
      title: { zh: "客户评价", en: "" },
      intro: { zh: "", en: "" },
      items: [
        { id: "quote-1", quote: { zh: "交付很稳。", en: "" }, author: { zh: "某集团采购部", en: "" }, role: { zh: "", en: "" } },
      ],
    };
    d.logos = [{ id: "logo-1", name: "国家电投" }, { id: "logo-2", name: "华能集团" }];
  });
}

test("评价的正文能就地改（⑥-4b：新增 update_testimonial）", () => {
  const draft = draftWithExtras();
  const result = slotToDraftOperation({ ...base("testimonials.items.0.quote.zh", "并网半年，发电量超预期。", "交付很稳。"), draft });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  assert.equal((result.operation as { op: string }).op, "update_testimonial");
  // 槽位是**下标**，操作要用 **itemId**——下标会指到别人身上
  assert.equal((result.operation as { itemId: string }).itemId, "quote-1");
});

test("评价的署名与身份也能改", () => {
  const draft = draftWithExtras();
  for (const [field, value] of [["author", "某园区能源负责人"], ["role", "采购总监"]] as const) {
    const result = slotToDraftOperation({ ...base(`testimonials.items.0.${field}.zh`, value, ""), draft });
    assert.equal(result.ok, true, `${field} 应该能改：${result.ok ? "" : result.message}`);
  }
});

test("Logo 文案能就地改（⑥-4b：新增 update_logo）", () => {
  const draft = draftWithExtras();
  const result = slotToDraftOperation({ ...base("logos.1.name", "华能集团（中国）", "华能集团"), draft });
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (!result.ok) return;
  assert.equal((result.operation as { op: string }).op, "update_logo");
  assert.equal((result.operation as { itemId: string }).itemId, "logo-2");
});

test("下标越界的评价/Logo：报「已变化」而不是写错地方", () => {
  // 模板换了、条目删了，页面上残留的下标就会指到不存在的项。
  const draft = draftWithExtras();
  for (const slot of ["logos.9.name", "testimonials.items.9.quote.zh"]) {
    const result = slotToDraftOperation({ ...base(slot, "新值", "旧值"), draft });
    assert.equal(result.ok, false, slot);
    if (!result.ok) assert.equal(result.code, "stale_target", slot);
  }
});

test("草稿里没有评价/Logo 时也不崩（可选字段）", () => {
  const draft = draftWith(() => {});
  for (const slot of ["logos.0.name", "testimonials.items.0.quote.zh"]) {
    const result = slotToDraftOperation({ ...base(slot, "新值", "旧值"), draft });
    assert.equal(result.ok, false, slot);
    if (!result.ok) assert.equal(result.code, "stale_target", slot);
  }
});

