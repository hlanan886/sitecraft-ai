/**
 * 运行时功能开关。
 *
 * 规则保持简单且可审计：全局逗号列表提供默认启用项，逐项环境变量可以
 * 明确关闭或开启；canary 只对列出的 workspace 额外开启开关，明确关闭
 * 的逐项变量仍然优先，方便紧急熔断。
 */

export const FEATURE_FLAG_KEYS = [
  "template_matching_v2",
  "quality_gate_v1",
  "chat_cas_v1",
  "release_v1",
  "access_scope_v1",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;
export type FeatureFlagEnv = Readonly<Record<string, string | undefined>>;

export type FeatureFlagSnapshot = {
  workspaceId: string;
  flags: FeatureFlags;
  canary: boolean;
};

const truthyValues = new Set(["1", "true", "yes", "on"]);
const falsyValues = new Set(["0", "false", "no", "off"]);

function listValues(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function envFlagName(key: FeatureFlagKey): string {
  return `SITECRAFT_FLAG_${key.toUpperCase()}`;
}

function explicitValue(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (truthyValues.has(normalized)) return true;
  if (falsyValues.has(normalized)) return false;
  return undefined;
}

function parseBaseFlags(env: FeatureFlagEnv): FeatureFlags {
  const enabled = listValues(env.SITECRAFT_FEATURE_FLAGS);
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => {
      const override = explicitValue(env[envFlagName(key)]);
      return [key, override ?? enabled.has(key)];
    }),
  ) as FeatureFlags;
}

function resolveWorkspaceId(env: FeatureFlagEnv, workspaceId?: string): string {
  return workspaceId?.trim() || env.DEFAULT_WORKSPACE_ID?.trim() || "demo";
}

export function parseFeatureFlags(env: FeatureFlagEnv = process.env): FeatureFlags {
  return parseBaseFlags(env);
}

export function isFeatureEnabled(
  key: FeatureFlagKey,
  workspaceId?: string,
  env: FeatureFlagEnv = process.env,
): boolean {
  const base = parseBaseFlags(env);
  const explicit = explicitValue(env[envFlagName(key)]);
  const workspace = resolveWorkspaceId(env, workspaceId);
  const canaryWorkspace = listValues(env.SITECRAFT_CANARY_WORKSPACES).has(workspace);
  const canaryFlag = listValues(env.SITECRAFT_CANARY_FLAGS).has(key);

  // 明确关闭是熔断开关，不能被 canary 再次打开。
  if (explicit === false) return false;
  return base[key] || (canaryWorkspace && canaryFlag);
}

export function getFeatureFlagSnapshot(
  env: FeatureFlagEnv = process.env,
  workspaceId?: string,
): FeatureFlagSnapshot {
  const resolvedWorkspace = resolveWorkspaceId(env, workspaceId);
  const canary = listValues(env.SITECRAFT_CANARY_WORKSPACES).has(resolvedWorkspace);
  const flags = Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, isFeatureEnabled(key, resolvedWorkspace, env)]),
  ) as FeatureFlags;
  return { workspaceId: resolvedWorkspace, flags, canary };
}
