import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultDraft, type SiteDraft } from "../lib/site-model.ts";
import { ReleaseStore } from "../lib/release-store.ts";

function draftAt(revision: number, title: string): SiteDraft {
  return structuredClone({
    ...defaultDraft,
    revision,
    siteName: "测试企业",
    companyName: "测试企业",
    content: {
      ...defaultDraft.content,
      hero: { ...defaultDraft.content.hero, title: { zh: title, en: title } },
    },
  });
}

test("release stores an immutable draft snapshot", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sitecraft-releases-"));
  try {
    const store = new ReleaseStore({ rootDir, workspaceId: "workspace-a" });
    const source = draftAt(3, "第一版标题");
    await store.createRelease({ siteId: "site-a", draft: source, publishedBy: "tester" });
    source.content.hero.title.zh = "外部修改不应影响发布版";

    const published = await store.getPublishedRelease("site-a");
    assert.equal(published?.draft.content.hero.title.zh, "第一版标题");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("release versions increase and only the newest release is published", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sitecraft-releases-"));
  try {
    const store = new ReleaseStore({ rootDir, workspaceId: "workspace-a" });
    const first = await store.createRelease({ siteId: "site-a", draft: draftAt(1, "第一版"), publishedBy: "tester" });
    const second = await store.createRelease({ siteId: "site-a", draft: draftAt(2, "第二版"), publishedBy: "tester" });

    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.equal((await store.getPublishedRelease("site-a"))?.releaseId, second.releaseId);
    assert.deepEqual((await store.listReleases("site-a")).map((item) => [item.version, item.status]), [[2, "published"], [1, "superseded"]]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("rollback creates a new published version from a historical release", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sitecraft-releases-"));
  try {
    const store = new ReleaseStore({ rootDir, workspaceId: "workspace-a" });
    const first = await store.createRelease({ siteId: "site-a", draft: draftAt(1, "第一版"), publishedBy: "tester" });
    await store.createRelease({ siteId: "site-a", draft: draftAt(2, "第二版"), publishedBy: "tester" });
    const rollback = await store.rollbackRelease({ siteId: "site-a", releaseId: first.releaseId, publishedBy: "tester" });

    assert.equal(rollback.version, 3);
    assert.equal(rollback.draft.content.hero.title.zh, "第一版");
    assert.equal((await store.getPublishedRelease("site-a"))?.releaseId, rollback.releaseId);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("release creation rejects a stale draft revision when an expected revision is provided", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "sitecraft-releases-"));
  try {
    const store = new ReleaseStore({ rootDir, workspaceId: "workspace-a" });
    await assert.rejects(
      store.createRelease({ siteId: "site-a", draft: draftAt(3, "标题"), expectedRevision: 4, publishedBy: "tester" }),
      (error: unknown) => error && typeof error === "object" && "code" in error && error.code === "revision_conflict",
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("postgres rollback locks the site and selects the historical release in one transaction", async () => {
  const source = await readFile(new URL("../lib/release-store.ts", import.meta.url), "utf8");
  assert.match(source, /async function rollbackPostgresRelease[\s\S]*withDatabaseTransaction/);
  assert.match(source, /async function lockPostgresSite[\s\S]*FOR UPDATE/);
  assert.match(source, /rollbackPostgresRelease[\s\S]*lockPostgresSite/);
  assert.doesNotMatch(source, /if \(!usePostgres\) return defaultStore\.rollbackRelease\(args\);[\s\S]*listPostgresReleases\(args\.siteId\)[\s\S]*createPostgresRelease/);
});
