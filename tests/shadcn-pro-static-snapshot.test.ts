import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readTemplateStaticFile } from "../lib/template-static.ts";

const snapshotRoot = path.join(
  process.cwd(),
  "vendor",
  "open-source-templates",
  "shadcn-landing2",
  "dist",
);
const assetRoutePrefix = "/api/templates/shadcn-landing2/assets/";

test("SHADCN PRO ships a self-contained static preview for clean checkouts", async () => {
  const indexPath = path.join(snapshotRoot, "index.html");
  assert.ok(
    existsSync(indexPath),
    "SHADCN PRO must include dist/index.html instead of relying on an ignored .next cache",
  );

  const html = await readFile(indexPath, "utf8");
  assert.match(html, /<!DOCTYPE html>/i);
  assert.doesNotMatch(html, /(?:src|href)=["']\/_next\//i);

  const localAssetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((assetPath) => assetPath.startsWith(assetRoutePrefix) || assetPath.startsWith("/hero-"));

  assert.ok(localAssetPaths.some((assetPath) => assetPath.endsWith(".css")), "preview must include local CSS");
  assert.ok(localAssetPaths.some((assetPath) => assetPath.endsWith(".js")), "preview must include local JavaScript");

  for (const assetPath of localAssetPaths) {
    const snapshotPath = assetPath.startsWith(assetRoutePrefix)
      ? assetPath.slice(assetRoutePrefix.length)
      : assetPath.replace(/^\/+/, "");
    const filePath = path.resolve(snapshotRoot, snapshotPath);
    assert.ok(filePath.startsWith(`${snapshotRoot}${path.sep}`), `unsafe preview asset path: ${assetPath}`);
    assert.ok(existsSync(filePath), `missing preview asset: ${assetPath}`);
  }
});

test("Next static-export assets are read from dist when .next is absent", async () => {
  const originalCwd = process.cwd();
  const fixtureParent = path.join(originalCwd, "test-results");
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, "template-static-dist-"));
  const distRoot = path.join(
    fixtureRoot,
    "vendor",
    "open-source-templates",
    "shadcn-landing2",
    "dist",
  );
  const cssPath = path.join(distRoot, "_next", "static", "preview.css");

  await mkdir(path.dirname(cssPath), { recursive: true });
  await writeFile(path.join(distRoot, "index.html"), "<!doctype html><html></html>", "utf8");
  await writeFile(cssPath, ".preview { color: green; }", "utf8");

  process.chdir(fixtureRoot);
  try {
    const asset = await readTemplateStaticFile("shadcn-landing2", ["_next", "static", "preview.css"]);
    assert.ok(asset, "dist/_next asset must not depend on sourceRoot/.next");
    assert.equal(asset.contentType, "text/css; charset=utf-8");
    assert.equal(asset.body.toString("utf8"), ".preview { color: green; }");
  } finally {
    process.chdir(originalCwd);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
