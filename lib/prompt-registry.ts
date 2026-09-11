import { createHash } from "node:crypto";

export type PromptKey =
  | "site_intent"
  | "draft_operations"
  | "chat_operations"
  | "self_eval";

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
    version: "v1",
    contract: "按模板 manifest 生成受约束的 SiteOperation JSON，不编造企业事实",
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
