export type AccessRole = "editor" | "reviewer" | "viewer";
export type AccessPermission = "public" | "read" | "edit" | "chat" | "generate" | "publish" | "rollback" | "leads:read" | "leads:write";
export type AccessContext = {
  workspaceId: string;
  actorId: string;
  role: AccessRole;
};

export type AccessError = {
  code: "access_context_required" | "invalid_access_context" | "workspace_mismatch" | "forbidden";
  status: 400 | 401 | 403;
  message: string;
};

export type AccessResolution = AccessContext | AccessError;
export type AccessDecision =
  | { ok: true; context: AccessContext }
  | { ok: false; error: AccessError };

type ResolveOptions = {
  mode?: "relaxed" | "strict";
  defaultWorkspaceId?: string;
};

type AuthorizeOptions = ResolveOptions & {
  access?: AccessContext;
  configuredWorkspaceId?: string;
};

const workspaceHeader = "x-sitecraft-workspace-id";
const actorHeader = "x-sitecraft-actor-id";
const roleHeader = "x-sitecraft-role";
const segmentPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const roleValues = new Set<AccessRole>(["editor", "reviewer", "viewer"]);

const permissionRoles: Record<AccessPermission, readonly AccessRole[]> = {
  public: ["editor", "reviewer", "viewer"],
  read: ["editor", "reviewer", "viewer"],
  edit: ["editor"],
  chat: ["editor"],
  generate: ["editor"],
  publish: ["editor", "reviewer"],
  rollback: ["editor", "reviewer"],
  "leads:read": ["editor", "reviewer", "viewer"],
  "leads:write": ["editor", "reviewer"],
};

function error(
  code: AccessError["code"],
  status: AccessError["status"],
  message: string,
): AccessError {
  return { code, status, message };
}

function isAccessError(value: AccessResolution): value is AccessError {
  return "code" in value;
}

function configuredMode(): "relaxed" | "strict" {
  return process.env.SITECRAFT_ACCESS_MODE === "strict" ? "strict" : "relaxed";
}

function configuredWorkspaceId() {
  return process.env.DEFAULT_WORKSPACE_ID?.trim() || "demo";
}

export function resolveAccessContext(
  request: Request,
  options: ResolveOptions = {},
): AccessResolution {
  const mode = options.mode ?? configuredMode();
  const fallbackWorkspace = options.defaultWorkspaceId?.trim() || configuredWorkspaceId();
  const workspaceId = request.headers.get(workspaceHeader)?.trim() || "";
  const actorId = request.headers.get(actorHeader)?.trim() || "";
  const roleValue = request.headers.get(roleHeader)?.trim() || "";

  if (mode === "strict" && (!workspaceId || !actorId || !roleValue)) {
    return error("access_context_required", 401, "需要内部访问上下文才能访问该资源。");
  }

  const resolvedWorkspace = workspaceId || fallbackWorkspace;
  const resolvedActor = actorId || "internal-dev";
  const resolvedRole = roleValue || "editor";
  if (!segmentPattern.test(resolvedWorkspace) || !segmentPattern.test(resolvedActor)) {
    return error("invalid_access_context", 400, "访问上下文格式无效。");
  }
  if (!roleValues.has(resolvedRole as AccessRole)) {
    return error("invalid_access_context", 400, "访问角色无效。");
  }
  return { workspaceId: resolvedWorkspace, actorId: resolvedActor, role: resolvedRole as AccessRole };
}

export function authorizeRequest(
  request: Request,
  permission: AccessPermission,
  options: AuthorizeOptions = {},
): AccessDecision {
  if (permission === "public") {
    return {
      ok: true,
      context: {
        workspaceId: options.configuredWorkspaceId?.trim() || configuredWorkspaceId(),
        actorId: "public",
        role: "viewer",
      },
    };
  }

  const resolved = options.access ?? resolveAccessContext(request, options);
  if (isAccessError(resolved)) return { ok: false, error: resolved };
  const configured = options.configuredWorkspaceId?.trim() || configuredWorkspaceId();
  if (resolved.workspaceId !== configured) {
    return { ok: false, error: error("workspace_mismatch", 403, "当前访问上下文不能访问该工作区。") };
  }
  if (!permissionRoles[permission].includes(resolved.role)) {
    return { ok: false, error: error("forbidden", 403, "当前角色没有执行该操作的权限。") };
  }
  return { ok: true, context: resolved };
}

export function accessErrorResponse(decision: AccessDecision) {
  if (decision.ok) return null;
  return Response.json(
    { ok: false, error: decision.error.code, message: decision.error.message },
    { status: decision.error.status, headers: { "Cache-Control": "no-store" } },
  );
}

