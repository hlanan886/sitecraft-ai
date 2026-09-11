import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { rewriteTemplateRootRelativeReferences } from "../lib/template-static.ts";

const assetBase = "/api/templates/forge/assets/";

test("rewrites root-relative template resources in HTML island metadata", () => {
  const html = [
    '<script type="module" src="/_astro/ClientRouter.js"></script>',
    '<astro-island component-url="/_astro/nav.js" renderer-url="/_astro/client.js"></astro-island>',
    '<link rel="stylesheet" href="/_astro/About.css">',
    '<img src="/hero.webp">',
    '<a href="/Contact">Contact</a>',
  ].join(" ");

  const rewritten = rewriteTemplateRootRelativeReferences(html, "text/html; charset=utf-8", assetBase);

  assert.match(rewritten, /src="\/api\/templates\/forge\/assets\/_astro\/ClientRouter\.js"/);
  assert.match(rewritten, /component-url="\/api\/templates\/forge\/assets\/_astro\/nav\.js"/);
  assert.match(rewritten, /renderer-url="\/api\/templates\/forge\/assets\/_astro\/client\.js"/);
  assert.match(rewritten, /href="\/api\/templates\/forge\/assets\/_astro\/About\.css"/);
  assert.match(rewritten, /src="\/api\/templates\/forge\/assets\/hero\.webp"/);
  assert.match(rewritten, /<a href="\/Contact">Contact<\/a>/);
});

test("rewrites root-relative resources inside CSS and JavaScript assets", () => {
  const css = ".hero{background:url('/hero.webp')}@font-face{src:url(/_astro/font.woff2)}";
  const js = 'const next = import("/_astro/client.js"); fetch("/_astro/data.json");';

  assert.equal(
    rewriteTemplateRootRelativeReferences(css, "text/css; charset=utf-8", assetBase),
    ".hero{background:url('/api/templates/forge/assets/hero.webp')}@font-face{src:url(/api/templates/forge/assets/_astro/font.woff2)}",
  );
  assert.equal(
    rewriteTemplateRootRelativeReferences(js, "text/javascript; charset=utf-8", assetBase),
    'const next = import("/api/templates/forge/assets/_astro/client.js"); fetch("/api/templates/forge/assets/_astro/data.json");',
  );
});

test("does not rewrite external, data, hash, or application API URLs", () => {
  const source = [
    "url(https://cdn.example.com/image.webp)",
    "url(data:image/svg+xml;base64,abc)",
    "url(#mask)",
    "url(/api/templates/forge/assets/icon.svg)",
    "url(/api/sites/current)",
    "url(//cdn.example.com/image.webp)",
  ].join(" ");

  assert.equal(
    rewriteTemplateRootRelativeReferences(source, "text/css; charset=utf-8", assetBase),
    source,
  );
});

test("template bridge reapplies the active draft before exporting offline HTML", async () => {
  const source = await readFile(new URL("../app/api/templates/[templateId]/preview/route.ts", import.meta.url), "utf8");
  assert.match(source, /let activeDraft = null/);
  assert.match(source, /activeDraft = event\.data\.draft/);
  assert.match(source, /await applyContent\(activeDraft, activeLocale, activeExpectedTargets, activeVariant\)/);
});
