import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUserBrief } from "../lib/site-intent.ts";

test("normalizeUserBrief maps Chinese industrial export brief to stable taxonomy", () => {
  const brief = normalizeUserBrief(
    "我们是华东智造，做工业自动化设备和视觉检测系统，面向欧洲采购商，提供中文和英文产品目录。",
  );

  assert.equal(brief.businessType, "manufacturing");
  assert.equal(brief.industryKey, "industrial_automation");
  assert.equal(brief.audience, "overseasB2b");
  assert.equal(brief.siteType, "catalog");
  assert.deepEqual(brief.locales, ["zh", "en"]);
});

test("normalizeUserBrief only marks facts that occur in user input", () => {
  const brief = normalizeUserBrief("我们有 ISO 9001 认证，服务 200 家客户，暂无其他公开数据。");

  assert.deepEqual(
    brief.facts.map((fact) => ({ kind: fact.kind, raw: fact.raw, source: fact.source, confidence: fact.confidence })),
    [
      { kind: "certification", raw: "ISO 9001", source: "user", confidence: "confirmed" },
      { kind: "customers", raw: "服务 200 家客户", source: "user", confidence: "confirmed" },
    ],
  );
});

test("normalizeUserBrief rejects empty text before a provider call", () => {
  assert.throws(() => normalizeUserBrief("   "), /输入不能为空/);
});
