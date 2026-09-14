/**
 * 安全基线回归（批次 A，2026-09-11）。
 *
 * 覆盖两项在审计里被标为 P0、长期未修的安全问题：
 *
 * **P-1 默认无鉴权**：此前 `strict` 之外一律 `relaxed`，生产忘记设环境变量时
 * `curl /api/sites` **不带任何头**即可读到全部站点，身份回落成 `demo/internal-dev/editor`。
 * 现在：非 development 一律 strict；显式设置仍优先。
 *
 * **P-2 上传放行 SVG → 同源存储型 XSS**：用户上传带 `<script>` 的 SVG，
 * 由本站域名同源提供 → 脚本在我们的 origin 下执行。
 * 现在：上传白名单移除 `image/svg+xml`。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ALLOWED_IMAGE_MIME } from "../lib/product-image-store.ts";

/** 在被测函数依赖的 env 上跑一段，结束后还原（避免污染其它用例） */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("P-2：上传白名单不再放行 SVG（同源存储型 XSS 的入口）", () => {
  assert.ok(
    !ALLOWED_IMAGE_MIME.includes("image/svg+xml"),
    "image/svg+xml 必须从白名单移除——SVG 可内嵌 <script>，同源提供即存储型 XSS",
  );
  // 常规位图仍须放行，别把口子收得太死
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]) {
    assert.ok(ALLOWED_IMAGE_MIME.includes(mime), `${mime} 应仍被允许`);
  }
});

test("P-1：非 development 环境默认 strict（生产不依赖部署者记得设环境变量）", async () => {
  // 动态 import 以便在 env 切换下重新求值（configuredMode 在模块内是函数，直接调用即可）
  const { resolveAccessContext } = await import("../lib/request-context.ts");

  // 生产 + 未设 SITECRAFT_ACCESS_MODE → 必须要求访问上下文
  withEnv({ SITECRAFT_ACCESS_MODE: undefined, NODE_ENV: "production" }, () => {
    const request = new Request("http://localhost/api/sites");
    const resolved = resolveAccessContext(request);
    assert.ok("code" in resolved, "生产环境不带任何访问头应被拒（此前会回落成 demo/editor）");
    assert.equal((resolved as { code: string }).code, "access_context_required");
  });

  // 本地 development + 未设 → 保持零配置可用
  withEnv({ SITECRAFT_ACCESS_MODE: undefined, NODE_ENV: "development" }, () => {
    const request = new Request("http://localhost/api/sites");
    const resolved = resolveAccessContext(request);
    assert.ok(!("code" in resolved), "本地开发应零配置可用（不影响 next dev）");
  });

  // 显式设置优先于环境推断（两种方向都要尊重）
  withEnv({ SITECRAFT_ACCESS_MODE: "relaxed", NODE_ENV: "production" }, () => {
    const resolved = resolveAccessContext(new Request("http://localhost/api/sites"));
    assert.ok(!("code" in resolved), "显式 relaxed 应被尊重（e2e 依赖它）");
  });
  withEnv({ SITECRAFT_ACCESS_MODE: "strict", NODE_ENV: "development" }, () => {
    const resolved = resolveAccessContext(new Request("http://localhost/api/sites"));
    assert.ok("code" in resolved, "显式 strict 在开发环境也应生效");
  });

  // 带上完整访问头：strict 下也必须放行
  withEnv({ SITECRAFT_ACCESS_MODE: "strict", NODE_ENV: "production" }, () => {
    const request = new Request("http://localhost/api/sites", {
      headers: {
        "x-sitecraft-workspace-id": "demo",
        "x-sitecraft-actor-id": "dev",
        "x-sitecraft-role": "editor",
      },
    });
    const resolved = resolveAccessContext(request);
    assert.ok(!("code" in resolved), "带合法访问头应放行");
  });
});
