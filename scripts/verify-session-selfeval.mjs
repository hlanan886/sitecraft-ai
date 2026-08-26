// 阶段验收真机复验：D1/D2/③/①
const BASE = "http://localhost:3000";
const SESSION_ID = "verify-session-" + Date.now();

async function getDraft() {
  return (await (await fetch(`${BASE}/api/sites/demo/draft`, { cache: "no-store" })).json());
}

async function chat(message, baseRevision, opts = {}) {
  const res = await fetch(`${BASE}/api/sites/demo/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, message, sessionId: SESSION_ID, ...opts }),
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
  out.push(`基线 revision: ${rev}`);

  // ---- ③ session 摘要：多轮记忆 4+ 轮 ----
  out.push("\n## ③ session 多轮记忆（同 sessionId 4 轮）");
  const s1 = await chat("只把第二个服务标题改为智能产线集成，其他内容不变", rev);
  out.push(`第1轮: ${s1.done?.status}`);
  if (s1.done?.status === "applied") rev = s1.done.draft.revision;
  const s2 = await chat("刚才改的标题再改短一点", rev);
  out.push(`第2轮(刚才): ${s2.done?.status} | summary: ${s2.done?.summary}`);
  if (s2.done?.status === "applied") rev = s2.done.draft.revision;
  const s3 = await chat("再短一点，只要两个字", rev);
  out.push(`第3轮(再短): ${s3.done?.status} | summary: ${s3.done?.summary}`);
  if (s3.done?.status === "applied") rev = s3.done.draft.revision;
  const s4 = await chat("还是改回'智能产线集成'吧", rev);
  out.push(`第4轮(改回): ${s4.done?.status} | summary: ${s4.done?.summary}`);
  if (s4.done?.status === "applied") rev = s4.done.draft.revision;
  out.push(`4 轮后 revision: ${rev}`);

  // ---- D1 破坏性确认文案（无空格） ----
  out.push("\n## D1 破坏性确认文案");
  const d1 = await chat("删除第三个服务卡片", rev);
  out.push(`status: ${d1.done?.status} | destructive: ${JSON.stringify(d1.done?.destructive)}`);
  if (d1.done?.status === "need_confirmation") {
    const d1b = await chat("删除第三个服务卡片", rev, { confirmedDestructive: true });
    out.push(`确认后: ${d1b.done?.status}`);
    if (d1b.done?.status === "applied") rev = d1b.done.draft.revision;
  }

  // ---- ① 自评：多目标指令应触发自评且正常提交 ----
  out.push("\n## ① 自评（多目标触发）");
  const e1 = await chat("把公司名改成华辰精工，首屏标题改成'精密制造'，导航关于改成'关于华辰'，邮箱改 info@huachen.com", rev);
  out.push(`多目标(≥3op): ${e1.done?.status} | summary: ${e1.done?.summary}`);
  if (e1.done?.status === "applied") rev = e1.done.draft.revision;

  // ---- 单操作不应触发自评（无自评状态事件，正常快速返回） ----
  out.push("\n## ① 单操作不触发自评");
  const e2 = await chat("把首屏标题改成'可靠制造'", rev);
  out.push(`单操作: ${e2.done?.status} | 耗时正常: ${e2.done?.latencyMs !== undefined}`);
  if (e2.done?.status === "applied") rev = e2.done.draft.revision;

  console.log(out.join("\n"));
  console.log(`\n最终 revision: ${rev}`);
}

main().catch((e) => { console.error("失败:", e); process.exit(1); });
