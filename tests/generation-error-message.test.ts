/**
 * 面向用户的操作错误翻译测试。
 *
 * 真机来源：2026-09-10 实测，一句话建站失败时界面直接显示
 * `features item 4 does not exist`（英文 + 技术化），中文用户无法理解。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { translateGenerationError, userFacingGenerationError } from "../lib/generation-error-message.ts";

test("真机复现：item N does not exist 被翻译成可读中文，且条数按人类计数 +1", () => {
  const out = translateGenerationError("features item 4 does not exist");
  assert.ok(out, "应识别该模式");
  assert.match(out, /优势/, "features 应译成「优势」而非英文");
  assert.match(out, /第 5 条/, "index 4 是第 5 条（0 基 → 1 基）");
  assert.ok(!/does not exist/i.test(out), "不该残留英文技术信息");
});

test("各板块名都有中文映射", () => {
  for (const [en, zh] of [["hero", "首屏"], ["about", "关于"], ["services", "服务"], ["products", "产品"], ["contact", "联系"]]) {
    const out = translateGenerationError(`${en} item 0 does not exist`);
    assert.ok(out && out.includes(zh), `${en} 应译成「${zh}」，实际：${out}`);
  }
});

test("未知 section 退化为原名而非崩溃", () => {
  const out = translateGenerationError("unknownsec item 1 does not exist");
  assert.ok(out?.includes("unknownsec"), "未登记的 section 应保留原名");
});

test("Card / Product 不存在的错误被翻译", () => {
  assert.match(translateGenerationError("Card abc-123 does not exist") ?? "", /卡片/);
  assert.match(translateGenerationError("Product SKU-9 does not exist") ?? "", /商品/);
});

test("未知错误返回 null（交给调用方保留原文，不误译）", () => {
  assert.equal(translateGenerationError("some totally unexpected failure"), null);
  assert.equal(translateGenerationError(""), null);
});

test("userFacingGenerationError：认识的翻译，不认识的保留原文", () => {
  assert.match(userFacingGenerationError("features item 4 does not exist"), /优势/);
  // 关键：未知错误必须保留原文——翻译层吞掉未知错误会让排查失去线索
  assert.equal(userFacingGenerationError("ECONNRESET to llm provider"), "ECONNRESET to llm provider");
});

test("userFacingGenerationError：空消息回退到默认文案", () => {
  assert.equal(userFacingGenerationError(""), "生成失败");
  assert.equal(userFacingGenerationError("   ", "自定义兜底"), "自定义兜底");
});
