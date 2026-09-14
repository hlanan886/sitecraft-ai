import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("publish APIs expose quality-gated release and rollback contracts", async () => {
  const [publish, releases, rollback] = await Promise.all([
    readFile(new URL("../app/api/sites/[siteId]/publish/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sites/[siteId]/releases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sites/[siteId]/releases/[releaseId]/rollback/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(publish, /evaluateDraftQuality/);
  assert.match(publish, /publish_blocked/);
  assert.match(publish, /idempotencyKey/);
  assert.match(publish, /createRelease/);
  assert.match(releases, /listReleases/);
  assert.match(rollback, /rollbackRelease/);
});

test("published page reads an immutable public release instead of the mutable draft", async () => {
  // A11（2026-09-09）：发布页拆成「服务端外壳 + 客户端渲染」。
  // 服务端外壳直接读发布快照（getPublishedRelease），客户端回退走公开 API。
  const [page, client, publicRoute] = await Promise.all([
    readFile(new URL("../app/published/[siteKey]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/published/[siteKey]/client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/[siteKey]/route.ts", import.meta.url), "utf8"),
  ]);

  // 服务端外壳：只读发布快照，不读可变草稿
  assert.match(page, /getPublishedRelease/);
  assert.doesNotMatch(page, /\/api\/sites\/\$\{encodeURIComponent\(siteKey\)\}\/draft/);
  // 客户端：回退路径仍走公开 API
  assert.match(client, /\/api\/public\//);
  assert.doesNotMatch(client, /\/api\/sites\/\$\{encodeURIComponent\(siteKey\)\}\/draft/);
  assert.match(publicRoute, /getPublishedRelease/);
});

test("workspace publish action confirms the draft before opening the public release", async () => {
  const workspace = await readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

  assert.match(workspace, /\/api\/sites\/\$\{siteId\}\/publish/);
  assert.match(workspace, /idempotencyKey/);
  assert.match(workspace, /publish_blocked/);
  assert.doesNotMatch(workspace, /<Link className="primary-button" href=\{`\/published/);
});

/**
 * 忠实度门禁接线回归（2026-09-10）。
 *
 * 背景：`lib/template-fidelity-guard.ts` 写了 385 行三层检测（L2 残留 / L3 结构），
 * 但**在生产代码中零 import**——只在 scripts/ 与 tests/ 里跑，是装饰性代码。
 * 而 P4 新模板的验收依赖它。本测试锁死「发布链路真的调用了 evaluateFidelity」。
 */
test("publish route wires the template fidelity gate (L2 residual + L3 structure)", async () => {
  const publish = await readFile(new URL("../app/api/sites/[siteId]/publish/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

  // 服务端：必须真的调用 evaluateFidelity 并把结果随响应返回
  assert.match(publish, /import \{[^}]*evaluateFidelity[^}]*\} from "@\/lib\/template-fidelity-guard"/);
  assert.match(publish, /evaluateFidelity\(\{/);
  assert.match(publish, /fidelityWarnings/);
  // 渲染事实来自客户端（服务端无法从 draft JSON 重算）
  assert.match(publish, /renderFacts/);

  // 客户端：必须把桥接报告的渲染事实随发布请求带上，并消费返回的警告
  assert.match(workspace, /renderFacts: \{/);
  assert.match(workspace, /visibleTextsBySlot/);
  assert.match(workspace, /fidelityWarnings/);
});

test("fidelity gate requires render facts and degrades safely without them", async () => {
  const publish = await readFile(new URL("../app/api/sites/[siteId]/publish/route.ts", import.meta.url), "utf8");
  // 缺省 renderFacts 时必须跳过（向后兼容无头/旧客户端），不能因此报错或误判
  assert.match(publish, /if \(parsed\.data\.renderFacts\)/);
  // 默认只警告不阻断——L3 违规率未实测前冒然 422 会让所有站发不出去
  assert.match(publish, /fidelityWarnings\.push/);
  assert.doesNotMatch(publish, /error: "publish_blocked"[^}]*fidelity/);
});
