import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRequest, resolveAccessContext, type AccessContext } from "../lib/request-context.ts";

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sites/site-a", { headers });
}

test("relaxed internal mode resolves the configured workspace and editor actor", () => {
  const access = resolveAccessContext(request(), { mode: "relaxed", defaultWorkspaceId: "team-a" });
  assert.equal("code" in access, false);
  assert.deepEqual(access, { workspaceId: "team-a", actorId: "internal-dev", role: "editor" });
});

test("strict mode rejects requests without a controlled access context", () => {
  const access = resolveAccessContext(request(), { mode: "strict", defaultWorkspaceId: "team-a" });
  assert.ok("code" in access);
  assert.equal(access.code, "access_context_required");
  assert.equal(access.status, 401);
});

test("strict mode accepts a valid workspace, actor and role header", () => {
  const access = resolveAccessContext(request({
    "x-sitecraft-workspace-id": "team-a",
    "x-sitecraft-actor-id": "reviewer-1",
    "x-sitecraft-role": "reviewer",
  }), { mode: "strict", defaultWorkspaceId: "team-a" });
  assert.deepEqual(access, { workspaceId: "team-a", actorId: "reviewer-1", role: "reviewer" });
});

test("viewer cannot execute write permissions", () => {
  const access: AccessContext = { workspaceId: "team-a", actorId: "viewer-1", role: "viewer" };
  const result = authorizeRequest(request(), "generate", { access, configuredWorkspaceId: "team-a" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "forbidden");
    assert.equal(result.error.status, 403);
  }
});
