/**
 * 每模板 manifest 对外 API 层。
 *
 * 槽位声明数据在 lib/template-manifests/<id>.ts（每模板一文件）；本文件聚合并提供查询 API，
 * 模块路径与历史一致，既有 import 方无需改动。新增模板只需在 lib/template-manifests/ 加文件。
 */
import type { Locale } from "./site-model.ts";
import type { TemplateManifest } from "./template-manifests/types.ts";
import { templateManifests, lookupTemplateManifest } from "./template-manifests/index.ts";
import { defaultPresentation } from "./template-manifests/shared.ts";

export type { TemplateManifest, TemplateContentTarget, TemplateSlotBinding, TemplateNonContentSlot, TemplateRuntime, TemplateUiSurface, TemplatePresentationBlock, PresentationRole, PresentationItemShape } from "./template-manifests/types.ts";

export { templateManifests } from "./template-manifests/index.ts";
export { registerTemplateManifest, getRuntimeTemplateManifests, resetRuntimeTemplateManifestsForTest } from "./template-manifests/index.ts";

export function getTemplateManifest(templateId: string): TemplateManifest | undefined {
  return lookupTemplateManifest(templateId);
}

/** 某模板的原生排版角色表：手写 presentation 优先，未手写则用 defaultPresentation 兜底（card_grid 旧行为）。 */
export function getTemplatePresentation(templateId: string) {
  return getTemplateManifest(templateId)?.presentation ?? defaultPresentation();
}

export function supportsTemplateLocale(templateId: string, locale: Locale) {
  const manifest = getTemplateManifest(templateId);
  return manifest ? manifest.outputLocales.includes(locale) : true;
}

export function isTemplateRecommendationEligible(templateId: string) {
  return getTemplateManifest(templateId)?.recommendation !== "isolated";
}

export function getRequiredVisibleTargets(templateId: string): readonly string[] {
  return getTemplateManifest(templateId)?.requiredVisibleTargets ?? [];
}
