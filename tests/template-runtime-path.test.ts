import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { isRuntimeTemplatePath, RUNTIME_TEMPLATE_DIR } from "../lib/template-runtime.ts";

test("isRuntimeTemplatePath: 正斜杠路径（POSIX / 登记单里的写法）", () => {
  assert.equal(isRuntimeTemplatePath(".sitecraft-data/generated-templates/jinggong"), true);
  assert.equal(isRuntimeTemplatePath(RUNTIME_TEMPLATE_DIR), true);
});

test("isRuntimeTemplatePath: Windows 反斜杠路径也必须认得", () => {
  // 真实踩到的 bug：注册单用正斜杠拼接，而 path.join 在 Windows 上返回反斜杠，
  // 前缀比对恒为 false → 「模板注册成功，但任何按目录筛选的地方都列不出它」。
  // 不报错、只是空，属最难排查的那类静默失效。
  const windowsStyle = path.join(RUNTIME_TEMPLATE_DIR, "jinggong");
  assert.equal(isRuntimeTemplatePath(windowsStyle), true, "Windows 路径应被认出：" + windowsStyle);
});

test("isRuntimeTemplatePath: 尾随分隔符不影响判定", () => {
  assert.equal(isRuntimeTemplatePath(RUNTIME_TEMPLATE_DIR + "/jinggong/"), true);
  assert.equal(isRuntimeTemplatePath(RUNTIME_TEMPLATE_DIR + "\\jinggong\\"), true);
});

test("isRuntimeTemplatePath: 基线模板（vendor 目录）不算运行时模板", () => {
  assert.equal(isRuntimeTemplatePath("vendor/open-source-templates/forge"), false);
  assert.equal(isRuntimeTemplatePath("vendor\\open-source-templates\\forge"), false);
});

test("isRuntimeTemplatePath: 前缀相同但不是子路径（防误判）", () => {
  assert.equal(isRuntimeTemplatePath(RUNTIME_TEMPLATE_DIR + "-other/x"), false);
  assert.equal(isRuntimeTemplatePath(undefined), false);
  assert.equal(isRuntimeTemplatePath(""), false);
});
