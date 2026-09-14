import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const privateRoutes = [
  "../app/api/sites/route.ts",
  "../app/api/sites/[siteId]/draft/route.ts",
  "../app/api/sites/[siteId]/chat/route.ts",
  "../app/api/sites/[siteId]/generate/route.ts",
  "../app/api/sites/[siteId]/history/[action]/route.ts",
  "../app/api/sites/[siteId]/publish/route.ts",
  "../app/api/sites/[siteId]/releases/route.ts",
  "../app/api/sites/[siteId]/releases/[releaseId]/rollback/route.ts",
  "../app/api/leads/route.ts",
  "../app/api/leads/[leadId]/route.ts",
  "../app/api/generation-records/route.ts",
];

test("private API routes all perform access authorization before store calls", async () => {
  const sources = await Promise.all(privateRoutes.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  sources.forEach((source, index) => {
    assert.match(source, /authorizeRequest\(/, privateRoutes[index]);
    assert.match(source, /accessErrorResponse\(/, privateRoutes[index]);
  });
});

test("public site and lead routes do not inherit private workspace headers", async () => {
  const [siteRoute, leadRoute] = await Promise.all([
    readFile(new URL("../app/api/public/[siteKey]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/[siteKey]/leads/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(siteRoute, /authorizeRequest\(/);
  assert.doesNotMatch(leadRoute, /authorizeRequest\(/);
});

