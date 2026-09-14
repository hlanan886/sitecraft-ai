import assert from "node:assert/strict";
import test from "node:test";
import { authorizeRequest } from "../lib/request-context.ts";

test("a request from another workspace is rejected before store access", () => {
  const request = new Request("http://localhost/api/sites/site-a", {
    headers: {
      "x-sitecraft-workspace-id": "team-b",
      "x-sitecraft-actor-id": "editor-b",
      "x-sitecraft-role": "editor",
    },
  });
  const result = authorizeRequest(request, "read", { mode: "strict", configuredWorkspaceId: "team-a" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "workspace_mismatch");
    assert.equal(result.error.status, 403);
  }
});

test("public access is represented by the published site key, never an arbitrary site id", () => {
  const request = new Request("http://localhost/api/public/site-a");
  const result = authorizeRequest(request, "public", { mode: "strict", configuredWorkspaceId: "team-a" });
  assert.equal(result.ok, true);
});
