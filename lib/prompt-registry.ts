import { createHash } from "node:crypto";

export type PromptKey =
  | "site_intent"
  | "draft_operations"
  | "chat_operations"
  | "self_eval"
  | "vision_dsl";

export type PromptDefinition = {
  key: PromptKey;
  id: string;
  version: `v${number}`;
  contract: string;
  fingerprint: string;
};

const promptContracts: Record<PromptKey, Omit<PromptDefinition, "fingerprint">> = {
  site_intent: {
    key: "site_intent",
    id: "site_intent",
    version: "v1",
    contract: "中文企业资料归一化为行业、受众、站点类型、语言、用户事实和模板推荐",
  },
  draft_operations: {
    key: "draft_operations",
    id: "draft_operations",
    // v3（2026-09-09）：规则段改由 lib/content-policy.ts 策略树派生，与质检器/发布门同源。
    version: "v3",
    contract: "按模板 manifest 为每个业务板块声明其原生排版认知（templateAwareness）后生成受约束的 SiteOperation JSON；不编造企业事实、不以通用排版或仅换背景兜底；内容规则由策略树派生，与质检器/发布门同源",
  },
  chat_operations: {
    key: "chat_operations",
    id: "chat_operations",
    version: "v1",
    contract: "根据工作台目标范围生成受授权的增量 SiteOperation JSON",
  },
  self_eval: {
    key: "self_eval",
    id: "self_eval",
    version: "v1",
    contract: "检查操作结果的事实安全、模板槽位和语言一致性",
  },
  vision_dsl: {
    key: "vision_dsl",
    id: "vision_dsl",
    version: "v1",
    contract: "把网站截图读成拼装说明书（组件序列 + 设计 token + 受模板槽位约束的内容 JSON）；只写图里看得到的，缺失事实写缺口标记而不编造",
  },
};

function fingerprint(contract: Omit<PromptDefinition, "fingerprint">) {
  return createHash("sha256")
    .update(`${contract.id}:${contract.version}:${contract.contract}`)
    .digest("hex");
}

export const promptRegistry = Object.freeze(
  Object.fromEntries(
    Object.entries(promptContracts).map(([key, contract]) => [
      key,
      Object.freeze({ ...contract, fingerprint: fingerprint(contract) }),
    ]),
  ) as Record<PromptKey, PromptDefinition>,
);

export function getPromptDefinition(key: PromptKey): PromptDefinition {
  const definition = promptRegistry[key];
  if (!definition) throw new Error(`Unknown prompt key: ${String(key)}`);
  return definition;
}
