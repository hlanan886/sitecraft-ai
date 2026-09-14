/**
 * 发布前门禁的**可单测**判定函数（从 route 里抽出，2026-09-09）。
 *
 * 背景：`evaluateFidelity` / `detectAssetIssues` / `isHeroAssetDemo` 此前只被 scripts 与
 * 测试消费，**发布链路一次都没接**（计划 P2.1 看板标"完成"，但其子项「接入门禁」从未执行）。
 * 抽到 lib 层是为了能离线单测——route 里的局部函数测不到，等于没接线。
 */

import { getHeroAsset, isHeroAssetDemo, isHeroAssetReplaceable } from "./template-asset-registry.ts";

export type PublishWarning = {
  patternKey: string;
  severity: "high" | "medium" | "low";
  description: string;
  evidence: string;
};

/**
 * 资产层（L2b）：首屏主视觉仍是模板 demo 素材 → 警告。
 *
 * 判定基于**草稿事实**（`draft.assets["hero.image"]` 是否已替换），而不是去读模板静态 HTML——
 * 模板原图永远在 HTML 里，读它必然命中，无法区分「用户已替换」。
 *
 * - 模板首屏是 demo 素材且草稿未替换 → 警告
 * - 模板首屏不是 demo 素材（无 img / CSS 背景 / SVG / 仅 logo）→ 无警告（无处可换，非缺陷）
 * - 用户已替换 → 无警告
 *
 * **为什么是警告而不是阻断**：22 模板中 12 个首屏是 demo 素材，且 `defaultDraft.assets = {}`。
 * 若阻断，新建站点一律无法发布，直到上传实拍图——这是产品决策，不由代码单方面决定。
 * 需要改成阻断时：把返回结果按 `severity === "high"` 判为 blocker 即可（调用方一处）。
 */
export function collectAssetGateWarnings(draft: {
  templateId: string;
  assets?: { "hero.image"?: unknown };
}): PublishWarning[] {
  if (!isHeroAssetReplaceable(draft.templateId) || !isHeroAssetDemo(draft.templateId)) return [];
  if (draft.assets?.["hero.image"]) return [];
  const asset = getHeroAsset(draft.templateId);
  return [{
    patternKey: "hero_asset_registry_demo",
    severity: "high",
    description: "首屏主视觉仍是模板示例图，建议替换为企业实拍图",
    evidence: asset?.selector ?? asset?.note ?? draft.templateId,
  }];
}
