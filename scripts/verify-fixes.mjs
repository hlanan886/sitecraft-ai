// 阶段C 验证脚本：重跑关键场景对比 R1/R2/R3 修复效果
const BASE = "http://localhost:3000";

async function getDraft() {
  return (await (await fetch(`${BASE}/api/sites/demo/draft`, { cache: "no-store" })).json());
}

async function chat(message, baseRevision, context = [], selectedTarget = null) {
  const res = await fetch(`${BASE}/api/sites/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, message, selectedTarget, context }),
  });
  const text = await res.text();
  const events = text.split("\n\n").map((b) => b.split("\n").find((l) => l.startsWith("data: "))?.slice(6)).filter(Boolean).map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
  const done = events.find((e) => e.type === "done");
  return { httpStatus: res.status, done };
}

async function main() {
  const out = [];
  let draft = await getDraft();
  let rev = draft.draft.revision;

  // ---- 验证 R1：模板切换（"模板换成"语序）----
  out.push("## R1 验证：模板切换语序");
  const r1 = await chat("请把模板换成 atlas", rev);
  out.push(`状态: ${r1.done?.status} | rejected: ${JSON.stringify(r1.done?.rejected)} | 模板: ${r1.done?.draft?.templateId}`);
  if (r1.done?.status === "applied") { rev = r1.done.draft.revision; }
  // 切回 forge 以便后续场景基线一致
  const back = await chat("请换回 forge 模板", rev);
  out.push(`切回状态: ${back.done?.status} | 模板: ${back.done?.draft?.templateId}`);
  if (back.done?.status === "applied") { rev = back.done.draft.revision; }

  // ---- 验证 R2：多轮记忆 ----
  out.push("\n## R2 验证：多轮记忆（模拟前端透传 context）");
  // 第一轮：改第二个服务标题
  const r2a = await chat("只把第二个服务标题改为智能产线集成，其他内容不变", rev);
  out.push(`第1轮: ${r2a.done?.status} | ops: ${JSON.stringify(r2a.done?.changeSet?.operations ?? [])}`);
  if (r2a.done?.status === "applied") { rev = r2a.done.draft.revision; }
  // 第二轮：透传 context = [{user:第1轮指令},{assistant:第1轮summary}]，说"刚才改的标题再改短一点"
  const ctx = [
    { role: "user", text: "只把第二个服务标题改为智能产线集成，其他内容不变" },
    { role: "assistant", text: r2a.done?.summary ?? "" },
  ];
  const r2b = await chat("刚才改的标题再改短一点", rev, ctx);
  out.push(`第2轮(带context): ${r2b.done?.status} | summary: ${r2b.done?.summary}`);
  out.push(`  ops: ${JSON.stringify(r2b.done?.changeSet?.operations ?? r2b.done?.operations ?? [])}`);
  out.push(`  HTTP: ${r2b.httpStatus}`);
  if (r2b.done?.status === "applied") { rev = r2b.done.draft.revision; }

  // ---- 验证 R3：文案长度 ----
  out.push("\n## R3 验证：首屏优化文案长度（改前场景7b副标题40+字）");
  const r3 = await chat("把首屏优化一下，别换模板", rev);
  out.push(`状态: ${r3.done?.status} | summary: ${r3.done?.summary}`);
  const ops3 = r3.done?.changeSet?.operations ?? r3.done?.operations ?? [];
  for (const op of ops3) {
    if (op.op === "set_text" && op.target?.startsWith("hero.subtitle")) {
      out.push(`  hero.subtitle.${op.locale} (${op.value.length}字符): ${op.value}`);
    }
    if (op.op === "set_text" && op.target?.startsWith("hero.title")) {
      out.push(`  hero.title.${op.locale} (${op.value.length}字符): ${op.value}`);
    }
  }

  console.log(out.join("\n"));
}

main().catch((e) => { console.error("脚本失败:", e); process.exit(1); });
