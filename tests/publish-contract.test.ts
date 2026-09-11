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
  const [page, publicRoute] = await Promise.all([
    readFile(new URL("../app/published/[siteKey]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/[siteKey]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/public\//);
  assert.doesNotMatch(page, /\/api\/sites\/\$\{encodeURIComponent\(siteKey\)\}\/draft/);
  assert.match(publicRoute, /getPublishedRelease/);
});

test("workspace publish action confirms the draft before opening the public release", async () => {
  const workspace = await readFile(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");

  assert.match(workspace, /\/api\/sites\/\$\{siteId\}\/publish/);
  assert.match(workspace, /idempotencyKey/);
  assert.match(workspace, /publish_blocked/);
  assert.doesNotMatch(workspace, /<Link className="primary-button" href=\{`\/published/);
});
