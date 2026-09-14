/**
 * 模板注册表**键集一致性守卫**（阶段 4，2026-09-11）。
 *
 * 同一个模板库散落在**四张各自维护的表**里：
 *  - `templateCatalog`（目录 + 展示元数据）
 *  - `templateManifests`（槽位契约）
 *  - `templateAdapters`（渲染适配器）
 *  - `site-intent.ts` 的 `TEMPLATE_IDS`（意图层白名单）
 *
 * 它们**没有任何交叉校验**——某个模板只加了三处、漏了一处，就是一个静默 bug：
 * 加进目录但没 manifest → 生成时取不到契约；有 adapter 但不在 catalog → 永远不会被推荐。
 *
 * 本文件把"四张表必须相等"变成会失败的断言。**实测四张表当前一致**，
 * 所以这里锁的是"别在将来漂移"，不是"修一个已知的错"。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { templateCatalog } from "../lib/template-catalog.ts";
import { templateManifests } from "../lib/template-manifests/index.ts";
import { templateAdapters } from "../lib/template-adapters/index.ts";
import { TEMPLATE_IDS } from "../lib/site-intent.ts";

function sorted(items: readonly string[]): string[] {
  return [...items].sort();
}

test("四张模板注册表键集一致（catalog / manifests / adapters / intent 白名单）", () => {
  const catalog = sorted(templateCatalog.map((t) => t.id));
  const manifests = sorted(Object.keys(templateManifests));
  const adapters = sorted(Object.keys(templateAdapters));
  const intent = sorted([...TEMPLATE_IDS]);

  assert.deepEqual(
    manifests,
    catalog,
    `manifest 与 catalog 键集不一致：仅 catalog 有 [${catalog.filter((id) => !manifests.includes(id))}]，仅 manifest 有 [${manifests.filter((id) => !catalog.includes(id))}]`,
  );
  assert.deepEqual(
    adapters,
    catalog,
    `adapter 与 catalog 键集不一致：仅 catalog 有 [${catalog.filter((id) => !adapters.includes(id))}]，仅 adapter 有 [${adapters.filter((id) => !catalog.includes(id))}]`,
  );
  assert.deepEqual(
    intent,
    catalog,
    `site-intent 白名单与 catalog 键集不一致：仅 catalog 有 [${catalog.filter((id) => !intent.includes(id))}]，仅白名单有 [${intent.filter((id) => !catalog.includes(id))}]`,
  );
});

test("每个模板的 manifest 都指向自己（防复制粘贴时漏改 templateId）", () => {
  for (const [key, manifest] of Object.entries(templateManifests)) {
    assert.equal(manifest.templateId, key, `manifest ${key} 的 templateId 是 ${manifest.templateId}，与键不符`);
  }
});
