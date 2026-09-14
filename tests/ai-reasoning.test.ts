import assert from "node:assert/strict";
import test from "node:test";
import { shouldDisableReasoning } from "../lib/ai-provider.ts";

const KEY = "SITECRAFT_DISABLE_REASONING";
const saved = process.env[KEY];
function restore() { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; }

test("默认：大批量生成关推理（实测 16000→2942 tokens，槽位 0→23）", () => {
  delete process.env[KEY];
  try {
    assert.equal(shouldDisableReasoning(true), true, "写整页 HTML/整站内容必须关——推理会吃掉 90% 预算");
    assert.equal(shouldDisableReasoning(false), false, "意图理解/对话改字段保留推理——输出短、要判断力");
  } finally { restore(); }
});

test("环境变量可全局覆盖", () => {
  try {
    process.env[KEY] = "1";
    assert.equal(shouldDisableReasoning(false), true, "强制关：排查问题或换非推理模型时用");
    process.env[KEY] = "true";
    assert.equal(shouldDisableReasoning(false), true);
    process.env[KEY] = "0";
    assert.equal(shouldDisableReasoning(true), false, "强制开：对比效果时用");
    process.env[KEY] = "false";
    assert.equal(shouldDisableReasoning(true), false);
  } finally { restore(); }
});

test("环境变量填了无效值 → 回落按调用点策略（不静默全局生效）", () => {
  try {
    process.env[KEY] = "yes";
    assert.equal(shouldDisableReasoning(true), true);
    assert.equal(shouldDisableReasoning(false), false);
  } finally { restore(); }
});
