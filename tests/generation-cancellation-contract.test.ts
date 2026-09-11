import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("generate page aborts analyze requests and releases both SSE readers", async () => {
  const source = await readFile(new URL("../app/generate/page.tsx", import.meta.url), "utf8");
  assert.match(source, /analyzeControllerRef/);
  const analyzeBlock = source.slice(source.indexOf("const analyze = async"), source.indexOf("const toggleSection"));
  assert.match(analyzeBlock, /signal:\s*controller\.signal/);
  assert.match(analyzeBlock, /reader\?\.releaseLock\(\)/);
  const executeBlock = source.slice(source.indexOf("const execute = async"), source.indexOf("useEffect", source.indexOf("const execute = async")));
  assert.match(executeBlock, /reader\?\.releaseLock\(\)/);
  assert.match(executeBlock, /controller\.abort\(\);\s*void reader\?\.cancel\(\)/);
});

test("route propagates analyze and regenerate deadlines and commit signal", async () => {
  const source = await readFile(new URL("../app/api/sites/[siteId]/generate/route.ts", import.meta.url), "utf8");
  const analyzeCall = source.slice(source.indexOf("requestSiteIntent({"), source.indexOf("if (!intentRes.ok)"));
  assert.match(analyzeCall, /signal:/);
  assert.match(analyzeCall, /deadlineAt:/);
  const regenerateCall = source.slice(source.indexOf("regenerateSectionOperations({"), source.indexOf(": await generateDraftOperations"));
  assert.match(regenerateCall, /signal:\s*generationSignal/);
  assert.match(regenerateCall, /deadlineAt/);
  const commitCall = source.slice(source.indexOf("commitOperations({", source.indexOf("正在校验内容并保存")), source.indexOf("});", source.indexOf("commitOperations({", source.indexOf("正在校验内容并保存"))));
  assert.match(commitCall, /signal:\s*generationSignal/);
});

test("storage checks abort at the local rename and database COMMIT boundaries", async () => {
  const store = await readFile(new URL("../lib/site-store.ts", import.meta.url), "utf8");
  assert.match(store, /signal\?:\s*AbortSignal/);
  assert.match(store, /throwIfAborted\(signal\);[\s\S]*?await rename\(temp, target\)/);
  assert.match(store, /withDatabaseTransaction\([\s\S]*args\.signal\)/);
  const postgres = await readFile(new URL("../lib/postgres.ts", import.meta.url), "utf8");
  assert.match(postgres, /throwIfAborted\(signal\);[\s\S]*?await client\.query\("COMMIT"\)/);
});
