export const MAX_TEMPLATE_EXPORT_BYTES = 10_000_000;

export function buildTemplateResourceResolverScript(templateRootUrl: string | null) {
  return `
  const templateResourceRootUrl = ${JSON.stringify(templateRootUrl)}
    ? new URL(${JSON.stringify(templateRootUrl)}, location.href).href
    : null;
  const resolveTemplateResourceUrl = (rawUrl, baseUrl) => {
    const value = String(rawUrl || '').trim();
    if (!value || value.startsWith('#') || value.toLowerCase().startsWith('data:')) return value;
    const isTemplateRootResource = templateResourceRootUrl
      && value.startsWith('/')
      && !value.startsWith('//')
      && value !== '/api'
      && !value.startsWith('/api/');
    if (isTemplateRootResource) return new URL(value.slice(1), templateResourceRootUrl).href;
    return new URL(value, baseUrl).href;
  };`;
}

export type TemplateExportIdentity = {
  templateId: string;
  siteId: string;
  revision: number;
};

export type TemplateExportRequest = TemplateExportIdentity & {
  type: "sitecraft:export-request";
  requestId: string;
};

export type TemplateExportReport = {
  inlinedResources: number;
  deduplicatedResources: number;
  compressedImages: number;
  externalResourceUrls: string[];
  navigationUrls: string[];
  warnings: string[];
};

export type TemplateExportSuccess = TemplateExportIdentity & {
  type: "sitecraft:export-result";
  requestId: string;
  ok: true;
  fileName: string;
  html: string;
  bytes: number;
  report: TemplateExportReport;
};

export type TemplateExportFailure = TemplateExportIdentity & {
  type: "sitecraft:export-result";
  requestId: string;
  ok: false;
  error: string;
  report?: TemplateExportReport;
};

export type TemplateExportResult = TemplateExportSuccess | TemplateExportFailure;

export type ValidationResult<T> = {
  ok: boolean;
  value?: T;
  error?: string;
  bytes?: number;
  report?: TemplateExportReport;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function identityError(value: Record<string, unknown>, expected: TemplateExportIdentity) {
  if (value.templateId !== expected.templateId) return "template_mismatch";
  if (value.siteId !== expected.siteId) return "site_mismatch";
  if (value.revision !== expected.revision) return "revision_mismatch";
  return null;
}

export function validateTemplateExportRequest(
  value: unknown,
  expected: TemplateExportIdentity,
): ValidationResult<TemplateExportRequest> {
  if (!isRecord(value) || value.type !== "sitecraft:export-request") return { ok: false, error: "invalid_export_request" };
  if (typeof value.requestId !== "string" || !value.requestId.trim()) return { ok: false, error: "request_id_required" };
  const error = identityError(value, expected);
  if (error) return { ok: false, error };
  return { ok: true, value: value as TemplateExportRequest };
}

export type ExportReferenceKind = "inline" | "navigation" | "resource";

export function classifyExportReference(
  rawUrl: string,
  tagName: string,
  attributeName: string,
): ExportReferenceKind {
  const url = rawUrl.trim().toLowerCase();
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("#")) return "inline";
  if (tagName.toLowerCase() === "a" && attributeName.toLowerCase() === "href") return "navigation";
  return "resource";
}

export function validateTemplateExportArtifact(
  html: string,
  report: TemplateExportReport,
): ValidationResult<string> {
  const bytes = new TextEncoder().encode(html).byteLength;
  const normalizedReport: TemplateExportReport = {
    ...report,
    externalResourceUrls: [...new Set(report.externalResourceUrls)],
    navigationUrls: [...new Set(report.navigationUrls)],
    warnings: [...new Set(report.warnings)],
  };
  if (normalizedReport.externalResourceUrls.length) {
    return { ok: false, error: "external_resources_remaining", bytes, report: normalizedReport };
  }
  if (bytes > MAX_TEMPLATE_EXPORT_BYTES) {
    return { ok: false, error: "export_too_large", bytes, report: normalizedReport };
  }
  return { ok: true, value: html, bytes, report: normalizedReport };
}

export function validateTemplateExportResult(
  value: unknown,
  expected: TemplateExportIdentity & { requestId: string },
): ValidationResult<TemplateExportSuccess> {
  if (!isRecord(value) || value.type !== "sitecraft:export-result") return { ok: false, error: "invalid_export_result" };
  if (value.requestId !== expected.requestId) return { ok: false, error: "request_id_mismatch" };
  const error = identityError(value, expected);
  if (error) return { ok: false, error };
  if (value.ok !== true) return { ok: false, error: typeof value.error === "string" ? value.error : "export_failed" };
  if (
    typeof value.html !== "string" ||
    typeof value.fileName !== "string" ||
    typeof value.bytes !== "number" ||
    !isRecord(value.report)
  ) {
    return { ok: false, error: "invalid_export_success" };
  }
  const report = value.report as TemplateExportReport;
  const artifact = validateTemplateExportArtifact(value.html, report);
  if (!artifact.ok) return { ok: false, error: artifact.error, bytes: artifact.bytes, report: artifact.report };
  if (artifact.bytes !== value.bytes) return { ok: false, error: "byte_count_mismatch", bytes: artifact.bytes, report: artifact.report };
  return { ok: true, value: value as unknown as TemplateExportSuccess, bytes: artifact.bytes, report: artifact.report };
}
