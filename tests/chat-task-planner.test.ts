import assert from "node:assert/strict";
import test from "node:test";
import { planChatTasks, splitChatTask } from "../lib/chat-task-planner.ts";

test("planChatTasks deterministically separates section and SKU instructions within hard limits", () => {
  const tasks = planChatTasks("首屏标题改得更专业；关于我们强调工厂能力；把 SKU-0024 的简介改成英文；联系板块加入询盘说明");

  assert.ok(tasks.length >= 4);
  assert.ok(tasks.length <= 12);
  assert.ok(tasks.every((task) => task.instruction.length <= 600));
  assert.ok(tasks.some((task) => task.scopes.includes("hero")));
  assert.ok(tasks.some((task) => task.scopes.includes("about")));
  assert.ok(tasks.some((task) => task.scopes.includes("products") && task.productSkus.includes("SKU-0024")));
  assert.ok(tasks.some((task) => task.scopes.includes("contact")));
});

test("planChatTasks gives an explicitly selected target one exact task", () => {
  const tasks = planChatTasks("把这张卡片的标题改得更具体，其他内容不变", "features.items.1.title.zh");

  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].scopes, ["features"]);
  assert.equal(tasks[0].selectedTarget, "features.items.1.title.zh");
});

test("planChatTasks chunks a long instruction without exceeding twelve tasks or 600 characters", () => {
  const tasks = planChatTasks("修改首屏文案。".repeat(320));

  assert.ok(tasks.length <= 12);
  assert.ok(tasks.every((task) => task.instruction.length > 0 && task.instruction.length <= 600));
  assert.equal(tasks.map((task) => task.instruction).join("；").replaceAll("；。", "。" ).length > 0, true);
});

test("splitChatTask changes scope or instruction so a truncated request is never replayed unchanged", () => {
  const byScope = splitChatTask({
    id: "task-1",
    instruction: "同时修改首屏和关于我们",
    scopes: ["hero", "about"],
    productSkus: [],
    selectedTarget: null,
    depth: 0,
  });
  assert.deepEqual(byScope.map((task) => task.scopes), [["hero"], ["about"]]);
  assert.ok(byScope.every((task) => task.scopes.join(",") !== "hero,about"));

  const byInstruction = splitChatTask({
    id: "task-2",
    instruction: "修改首屏标题并且修改首屏副标题",
    scopes: ["hero"],
    productSkus: [],
    selectedTarget: null,
    depth: 0,
  });
  assert.equal(byInstruction.length, 2);
  assert.ok(byInstruction.every((task) => task.instruction !== "修改首屏标题并且修改首屏副标题"));
});
