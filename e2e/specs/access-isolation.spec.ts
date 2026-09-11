import { expect, test } from "@playwright/test";

const editorHeaders = {
  "x-sitecraft-workspace-id": "demo",
  "x-sitecraft-actor-id": "editor-1",
  "x-sitecraft-role": "editor",
};

test("strict access context protects private APIs and preserves public site-key reads", async ({ request }) => {
  const missing = await request.get("/api/sites");
  expect(missing.status()).toBe(401);
  expect((await missing.json() as { error: string }).error).toBe("access_context_required");

  const editor = await request.get("/api/sites", { headers: editorHeaders });
  expect(editor.status()).toBe(200);

  const otherWorkspace = await request.get("/api/sites", {
    headers: { ...editorHeaders, "x-sitecraft-workspace-id": "other-team" },
  });
  expect(otherWorkspace.status()).toBe(403);
  expect((await otherWorkspace.json() as { error: string }).error).toBe("workspace_mismatch");

  const viewerWrite = await request.post("/api/sites", {
    headers: { ...editorHeaders, "x-sitecraft-role": "viewer" },
    data: { name: "not-allowed", templateId: "forge", locales: ["zh"] },
  });
  expect(viewerWrite.status()).toBe(403);
  expect((await viewerWrite.json() as { error: string }).error).toBe("forbidden");

  const publicRead = await request.get("/api/public/not-published-yet");
  expect(publicRead.status()).toBe(404);
  expect((await publicRead.json() as { error: string }).error).toBe("published_not_found");
});

