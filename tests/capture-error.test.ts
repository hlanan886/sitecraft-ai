import assert from "node:assert/strict";
import test from "node:test";
import { humanizeCaptureError } from "../lib/site-capture.ts";

/**
 * 抓取失败的人话翻译。
 *
 * 样本全部取自 **Playwright 的真实报错形态**（2026-09-11 实测：
 * 访问一个不存在的域名，用户看到的是 `page.goto: net::ERR_NAME_NOT_RESOLVED`
 * 加一段 `Call log:` 和 `[2m` 转义码）。
 */

test("域名不存在：说清是什么问题 + 让用户检查网址", () => {
  const raw = `page.goto: net::ERR_NAME_NOT_RESOLVED at https://this-domain-does-not-exist-12345.com/
Call log:
[2m  - navigating to "https://this-domain-does-not-exist-12345.com/", waiting until "load"[22m`;
  const text = humanizeCaptureError(raw);
  assert.ok(text.includes("域名不存在或拼错了"), text);
  assert.ok(text.includes("检查一下网址"), text);
  // 技术噪音一个都不许露
  assert.ok(!/page\.goto|Call log|ERR_NAME|\[\d+m/.test(text), `还露着技术细节：${text}`);
});

test(`连不上：区分「拒绝连接」与「连接被中断」`, () => {
  const refused = humanizeCaptureError("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:9999/");
  assert.ok(refused.includes("拒绝连接"), refused);
  assert.ok(refused.includes("没在运行"), refused);

  const reset = humanizeCaptureError("page.goto: net::ERR_CONNECTION_RESET at https://example.com/");
  assert.ok(reset.includes("连接被中断"), reset);
});

test(`超时：给出「稍后重试」这个下一步`, () => {
  const text = humanizeCaptureError("page.goto: Timeout 45000ms exceeded.");
  assert.ok(text.includes("超时"), text);
  assert.ok(text.includes("稍后重试"), text);
});

test("证书问题：给一条能走通的路（改传截图）", () => {
  const text = humanizeCaptureError("page.goto: net::ERR_CERT_DATE_INVALID at https://expired.example.com/");
  assert.ok(text.includes("证书"), text);
  assert.ok(text.includes("截图"), text);
});

test(`认不出来的错误：剥掉噪音、给通用下一步，但不瞎猜原因`, () => {
  const text = humanizeCaptureError("page.goto: net::ERR_SOMETHING_NEW at https://x.com/\nCall log:\n  - whatever");
  // 不猜——没说成"域名不存在"，因为那会让用户去改一个本来没问题的网址
  assert.ok(!text.includes("域名不存在"), text);
  // 但要给确定有用的下一步
  assert.ok(text.includes("截图"), text);
  // 且不露 Call log
  assert.ok(!/Call log|\[\d+m/.test(text), text);
});

test("空消息也能给出可用的话，不返回空串", () => {
  const text = humanizeCaptureError("");
  assert.ok(text.length > 0);
  assert.ok(text.includes("截图"), text);
});

test("ANSI 转义码在**所有**分支里都不出现", () => {
  const samples = [
    "[2m  - navigating[22m",
    "page.goto: net::ERR_NAME_NOT_RESOLVED[2m at x[22m",
    "Timeout exceeded [2m[22m",
  ];
  for (const sample of samples) {
    const text = humanizeCaptureError(sample);
    assert.ok(!/\[\d+m/.test(text), `样本「${sample}」的产出里还有转义码：${text}`);
  }
});
