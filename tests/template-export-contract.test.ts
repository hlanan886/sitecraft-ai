import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TEMPLATE_EXPORT_BYTES,
  buildTemplateResourceResolverScript,
  validateTemplateExportArtifact,
  validateTemplateExportRequest,
  validateTemplateExportResult,
} from "../lib/template-export-contract.ts";

const expected = { templateId: "forge", siteId: "site-17", revision: 9 };

function createResourceResolver(templateRootUrl: string | null) {
  const source = buildTemplateResourceResolverScript(templateRootUrl);
  return new Function(
    "location",
    `${source}; return resolveTemplateResourceUrl;`,
  )({ href: "http://127.0.0.1:3210/api/templates/forge/preview" }) as (
    rawUrl: string,
    baseUrl: string,
  ) => string;
}

test("local template root-relative resources resolve inside the template asset root", () => {
  const resolveResource = createResourceResolver("/api/templates/forge/assets/");
  const stylesheetUrl = "http://127.0.0.1:3210/api/templates/forge/assets/_astro/app.css";

  assert.equal(
    resolveResource("/heroimg.webp", stylesheetUrl),
    "http://127.0.0.1:3210/api/templates/forge/assets/heroimg.webp",
  );
  assert.equal(
    resolveResource("../fonts/brand.woff2", stylesheetUrl),
    "http://127.0.0.1:3210/api/templates/forge/assets/fonts/brand.woff2",
  );
  assert.equal(resolveResource("/api/media/hero", stylesheetUrl), "http://127.0.0.1:3210/api/media/hero");
  assert.equal(resolveResource("//cdn.example.com/hero.webp", stylesheetUrl), "http://cdn.example.com/hero.webp");
  assert.equal(resolveResource("https://cdn.example.com/hero.webp", stylesheetUrl), "https://cdn.example.com/hero.webp");
  assert.equal(resolveResource("data:image/webp;base64,AA==", stylesheetUrl), "data:image/webp;base64,AA==");
  assert.equal(resolveResource("blob:http://127.0.0.1:3210/asset", stylesheetUrl), "blob:http://127.0.0.1:3210/asset");
  assert.equal(resolveResource("#hero", stylesheetUrl), "#hero");
});

test("remote templates preserve normal URL root semantics", () => {
  const resolveResource = createResourceResolver(null);

  assert.equal(
    resolveResource("/hero.webp", "https://demo.example.com/styles/app.css"),
    "https://demo.example.com/hero.webp",
  );
});

test("export request must match the currently applied template, site and revision", () => {
  const valid = {
    type: "sitecraft:export-request",
    requestId: "request-17",
    templateId: "forge",
    siteId: "site-17",
    revision: 9,
  };
  assert.equal(validateTemplateExportRequest(valid, expected).ok, true);
  assert.match(validateTemplateExportRequest({ ...valid, templateId: "screwfast" }, expected).error ?? "", /template/i);
  assert.match(validateTemplateExportRequest({ ...valid, siteId: "site-18" }, expected).error ?? "", /site/i);
  assert.match(validateTemplateExportRequest({ ...valid, revision: 8 }, expected).error ?? "", /revision/i);
});

test("artifact validation allows navigation but rejects remaining resource links", () => {
  const html = "<!doctype html><html><body><a href='https://example.com'>Visit</a></body></html>";
  const report = {
    inlinedResources: 3,
    deduplicatedResources: 1,
    compressedImages: 1,
    externalResourceUrls: [],
    navigationUrls: ["https://example.com"],
    warnings: [],
  };
  const result = validateTemplateExportArtifact(html, report);
  assert.equal(result.ok, true);

  const rejected = validateTemplateExportArtifact(html, {
    ...report,
    externalResourceUrls: ["https://cdn.example.com/app.css"],
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error ?? "", /external_resources_remaining/);
});

test("artifact validation fails above ten megabytes instead of returning a fake success", () => {
  const oversized = "x".repeat(MAX_TEMPLATE_EXPORT_BYTES + 1);
  const result = validateTemplateExportArtifact(oversized, {
    inlinedResources: 0,
    deduplicatedResources: 0,
    compressedImages: 0,
    externalResourceUrls: [],
    navigationUrls: [],
    warnings: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /export_too_large/);
});

test("result validation rejects stale identity and dishonest byte counts", () => {
  const html = "<!doctype html><title>真实模板</title>";
  const bytes = new TextEncoder().encode(html).byteLength;
  const result = {
    type: "sitecraft:export-result",
    requestId: "request-17",
    ok: true,
    templateId: "forge",
    siteId: "site-17",
    revision: 9,
    fileName: "site-17-forge.html",
    html,
    bytes,
    report: {
      inlinedResources: 0,
      deduplicatedResources: 0,
      compressedImages: 0,
      externalResourceUrls: [],
      navigationUrls: [],
      warnings: [],
    },
  };
  assert.equal(validateTemplateExportResult(result, { ...expected, requestId: "request-17" }).ok, true);
  assert.match(validateTemplateExportResult({ ...result, revision: 8 }, { ...expected, requestId: "request-17" }).error ?? "", /revision/i);
  assert.match(validateTemplateExportResult({ ...result, bytes: bytes - 1 }, { ...expected, requestId: "request-17" }).error ?? "", /byte_count_mismatch/);
});
