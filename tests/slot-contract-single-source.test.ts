/**
 * 槽位契约的**单源与完整性**守卫（阶段 4，2026-09-11）。
 *
 * 这里锁住两件在本次收敛前后**真实成立**的事：
 *
 * 1. **`maxLength` 只有一份定义**。此前 `template-manifests/shared.ts` 与
 *    `template-runtime.ts` 各有一份**逐项相同**的拷贝，无交叉校验（测试只断言
 *    `typeof === "number" && > 0`），改一处必漂。现统一到 `lib/template-slot-contract.ts`。
 *
 * 2. **`hero.cta` 不再被静默丢弃**。它曾经不在运行时的 `KNOWN_TARGETS` 白名单里，
 *    于是客户模板 HTML 里声明的 `data-sitecraft-slot="hero.cta.zh"` 会在
 *    `collectSlotTargetsFromHtmlString` 里被悄悄丢掉——**而 `template-slot-guard.ts`
 *    又把它登记为必需前缀**。三处认知互不相同：一处说必需、一处说没有、一处真实存在。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SLOT_MAX_LENGTH, slotMaxLength, SLOT_MAX_LENGTH_FALLBACK } from "../lib/template-slot-contract.ts";
import { templateCatalog } from "../lib/template-catalog.ts";
import { getTemplateManifest } from "../lib/template-manifest.ts";
import { defaultRuntimeSlots, normalizeSlotTarget } from "../lib/template-runtime.ts";
import { collectSlotTargetsFromHtmlString } from "../lib/template-runtime-loader.ts";

test("manifest 与运行时槽位上限同源：读的是同一个 SLOT_MAX_LENGTH", () => {
  for (const [target, expected] of Object.entries(SLOT_MAX_LENGTH)) {
    assert.equal(slotMaxLength(target), expected, `${target} 的 slotMaxLength 应与单源一致`);
  }
  // 未登记槽位走兜底，而不是 undefined
  assert.equal(slotMaxLength("unknown.slot"), SLOT_MAX_LENGTH_FALLBACK);
});

test("运行时槽位的 maxLength 直接取自单源（不是另一份拷贝）", () => {
  const runtime = defaultRuntimeSlots(["hero.title", "about.body", "contact.email"]);
  for (const slot of runtime) {
    assert.equal(
      slot.maxLength,
      SLOT_MAX_LENGTH[slot.target as keyof typeof SLOT_MAX_LENGTH] ?? SLOT_MAX_LENGTH_FALLBACK,
      `${slot.target} 的运行时 maxLength 必须来自单源`,
    );
  }
});

test("基线模板 manifest 的 maxLength 也来自单源", () => {
  // 覆盖全部 22 个模板，防某个模板自己写死一份
  for (const template of templateCatalog) {
    const manifest = getTemplateManifest(template.id);
    if (!manifest) continue;
    for (const slot of manifest.slots) {
      const expected = (SLOT_MAX_LENGTH as Record<string, number>)[slot.target];
      if (expected === undefined) continue; // 集合槽等不在单源表内的跳过
      assert.equal(slot.maxLength, expected, `${template.id}:${slot.target} 应取自单源`);
    }
  }
});

test("hero.cta 不再被静默丢弃（回归：三处认知不一致的老问题）", () => {
  // 客户上传模板里声明的 hero.cta，必须能穿过白名单
  assert.equal(normalizeSlotTarget("hero.cta.zh"), "hero.cta");
  assert.equal(normalizeSlotTarget("hero.cta"), "hero.cta");

  const html = [
    `<h1 data-sitecraft-slot="hero.title.zh">主标题</h1>`,
    `<a data-sitecraft-slot="hero.cta.zh">立即咨询</a>`,
  ].join("");
  const targets = collectSlotTargetsFromHtmlString(html);
  assert.ok(targets.includes("hero.cta"), `hero.cta 不得被丢弃，实际扫到：${JSON.stringify(targets)}`);
});

test("未登记槽位仍然被过滤（白名单没被放宽过头）", () => {
  assert.equal(normalizeSlotTarget("nonsense.slot"), null);
  assert.equal(normalizeSlotTarget("footer.copyright"), null);
});
