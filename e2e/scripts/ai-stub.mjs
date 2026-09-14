/**
 * 本地模型 stub —— 让 e2e 打**真实 HTTP 服务**，但模型调用不出网、不烧钱。
 *
 * ## 它解决什么问题
 *
 * 阶段 0.3 要求新增「截图→生成→save→undo」「URL→生成→save→undo」两条完整路径 spec，
 * 且要求**前端→路由→编排入口保持真实**。而 `page.route` 那种浏览器层 mock
 * 一旦拦掉 `/api/templates/from-*`，路由就根本不执行了——**真实层就断在那**。
 *
 * 所以 mock 层往下压到**模型网络**这一层：起一个 OpenAI 兼容的本地 HTTP 服务，
 * 经 `DEEPSEEK_BASE_URL` 注入被测服务（`lib/ai-provider.ts` 的 baseURL/apiKey/model
 * 全由 env 决定，注释里明确"测试可配中转站"）。
 *
 * → 前端 → 路由 → 编排 → coerce/compose → 登记 → 建站 **全部真实**，只有模型是 fake。
 *
 * ## 三条纪律（用户 2026-09-13 指定）
 *
 * 1. **确定性 + 纯离线**：没有任何出网调用；监听 127.0.0.1；随 e2e 生命周期起停
 *    （由 `serve.mjs` spawn，随 webServer 一起被 Playwright 杀掉），不留孤儿进程。
 * 2. **防假门禁**：`/__stub__/vision-dsl` 把本文件声明的 DSL 原样吐出来，
 *    供 spec 用**真实的 `coerceVisionDsl`** 校验——载荷形状一改、stub 一过期，
 *    测试立刻红，而不是继续绿着测旧形状。
 * 3. **只在显式开启时注入**：`serve.mjs` 只在 `E2E_AI_STUB=1` 时设 `DEEPSEEK_BASE_URL`，
 *    所以它**默认不改变任何现有 spec 的行为**。
 *
 * ## 用法
 *
 * ```bash
 * E2E_AI_STUB=1 npx playwright test --grep "完整路径"
 * ```
 * `playwright.config.ts` 的 `webServer.command` 原样继承环境变量
 * （`{ ...process.env, PORT: "3210" }`），所以打开开关无需改 `playwright.config.ts`。
 */
import { createServer } from "node:http";
import { readdirSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_STUB_PORT = 3311;

/**
 * 这两条 spec 的**模板名后缀前缀**。
 *
 * 为什么这么造：登记接口对已存在的模板 id 返 **409**，而"撞名"对客户是没意义的错误，
 * 所以前端用时间戳造后缀避撞（`create-template-dialog.tsx` 的 `u${...}`）。
 * 那个后缀**每跑一次都不一样**——测试进程无法回头去删自己刚造出来的目录。
 *
 * 所以让 stub 给一个**可识别的前缀**：整个跑完由 `serve.mjs` 按前缀清理
 * （见 `cleanupStubTemplates`），而不是让 spec 去猜 id。
 * 这样既不会污染用户的应用数据，也不会让 `templates.spec` 越跑越红。
 */
/**
 * 这两条 spec 会造出**两种**模板目录，命名规则不同，必须分别认：
 *
 * | 轨 | 模板 id 怎么来 | 例子 |
 * |---|---|---|
 * | 截图(B) | 模型给的 `templateId` + 前端后缀 | `e2estub-fengji-u6xweo` |
 * | 网址(A) | **抓到的页面地址** + 前端后缀（`templateIdFromUrl`） | `127-0-0-1-3311-u6y1yh` |
 *
 * 第二种是坑：它由 host+port 派生，**不含我们的前缀**——只按前缀清会漏掉它，
 * 于是每跑一次就在用户的模板库里多留一个 `127-0-0-1-3311-xxx`。
 *
 * 所以 A 轨的正则**从本 stub 实际监听的地址算出来**（单一派生源，不手抄 host），
 * 且只允许匹配"纯数字短后缀"——那是前端的 `u${timestamp}`，用户模板不会长这样。
 */
export const STUB_TEMPLATE_PREFIX = "e2estub-";

/** `http://127.0.0.1:3311` → `127-0-0-1-3311`（与 `templateIdFromUrl` 同一套替换规则）。 */
export function urlTrackTemplateSlug(stubUrl) {
  const { host } = new URL(stubUrl);
  return host.replace(/^www\./, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

/** 判断一个模板目录名是不是本 stub 造出来的。 */
export function isStubTemplateDir(name, stubUrl) {
  if (name.startsWith(STUB_TEMPLATE_PREFIX)) return true;
  if (!stubUrl) return false;
  const slug = urlTrackTemplateSlug(stubUrl);
  // 只认"slug + 数字后缀"——`127-0-0-1-3311-u6y1yh` 这种；用户模板不会撞这个形状
  return new RegExp(`^${slug}-[0-9a-z]{4,6}$`).test(name);
}

/**
 * 模型读图后该吐出的 **DSL**（`coerceVisionDsl` 的输入）。
 *
 * 字段照 `lib/site-vision.ts` 的 `buildVisionPrompt` 说明与
 * `tests/site-vision.test.ts` 的样本；**故意给足板块**，好让入库质量门
 * （要求至少一个集合槽）能过——B 轨产出的槽位由拼装器按内容刻。
 */
export const VISION_DSL = Object.freeze({
  // 可识别前缀——跑完由 serve.mjs 按它清理（见 STUB_TEMPLATE_PREFIX 的说明）
  templateId: "e2estub-fengji",
  name: "风机工业",
  companyName: "鼎力风机设备有限公司",
  siteName: "鼎力风机设备",
  industry: "工业制造",
  goal: "展示产品并获取询盘",
  tokens: {
    primary: "#c8102e",
    secondary: "#1a1a1a",
    accent: "#e63946",
    fontStyle: "sans",
    radius: "sharp",
    density: "compact",
  },
  blocks: [
    { type: "navbar" },
    { type: "hero", variant: "cover" },
    { type: "features" },
    { type: "services" },
    { type: "products" },
    { type: "faq", variant: "accordion" },
    { type: "contact" },
    { type: "footer" },
  ],
  content: {
    hero: { title: "鼎力风机", subtitle: "让您满意，是我们不懈的追求。", cta: "查看更多" },
    about: { title: "关于我们", body: "专注工业风机二十年，稳定交付。" },
    features: {
      title: "核心优势",
      intro: "",
      items: [
        { title: "质量可追溯", body: "每台出厂都有记录。" },
        { title: "交付准时", body: "常规型号两周内发货。" },
      ],
    },
    services: {
      title: "服务",
      intro: "",
      items: [{ title: "选型支持", body: "把风量风压发给我们。" }],
    },
    products: { title: "产品展示", intro: "" },
    faq: {
      title: "常见问题",
      intro: "",
      items: [{ title: "风机怎么选型？", body: "把风量风压发给我们，我们给方案。" }],
    },
    contact: {
      title: "联系我们",
      body: "",
      phone: "400-123-4567",
      email: "sales@dingli-fan.com",
    },
    navigation: { about: "关于我们", products: "产品展示", contact: "联系我们" },
  },
  products: [
    { sku: "TDS-48RD", name: "单吸离心风机", summary: "适配除尘系统", category: "离心风机" },
    { sku: "TDS-48RD-P2", name: "双吸离心风机", summary: "大风量工况", category: "离心风机" },
  ],
  /** 不是 low——否则 `template-from-screenshot.ts` 会走"不裁产品图"的分支 */
  confidence: "high",
});

/**
 * 造一个 OpenAI 兼容的成功响应。
 *
 * ⚠️ 形状必须与 `lib/ai-provider.ts` 的 `requestVisionDsl` 消费端一致：
 * `choices[0].finish_reason !== "length"` 且 `choices[0].message.content` 是
 * **JSON 字符串**（不是对象）——它那边 `JSON.parse` 之后再交给 `coerceVisionDsl`。
 */
export function visionCompletion(dsl = VISION_DSL) {
  return {
    id: "stub-vision-1",
    object: "chat.completion",
    created: 0,
    // ⚠️ 名字必须与注入的 DEEPSEEK_MODEL 一致：编排层把它写进产物 stats.model
    model: process.env.DEEPSEEK_MODEL || "sitecraft-e2e-stub",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(dsl) },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/**
 * URL 轨要抓的那个**目标页**。
 *
 * 抓取（`captureSite`，真开浏览器）必须真实跑，但**不能出网**——
 * 所以让它抓本 stub 自己托管的这个页面：本地、离线、内容确定。
 *
 * 页面结构故意简单：一个 `<h1>`、一个 `mailto:`、一张图。
 * `template-static-export` 的槽位补全认的就是这几样
 * （见 `lib/template-slot-injection.ts` 的 INJECTION_RULES），
 * 所以搬站结果里会出现 `hero.title` 这类真实槽位，而不是空手而归。
 */
export const SAMPLE_SITE_HTML = [
  '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
  "<title>鼎力风机设备有限公司 - 专业离心风机</title>",
  "</head><body>",
  "<header><h1>鼎力风机设备有限公司</h1></header>",
  '<main><p>专注工业风机二十年，稳定交付。</p>',
  '<img src="/sample-site/fan.png" alt="离心风机" width="480" height="320">',
  '<p><a href="mailto:sales@dingli-fan.com">写信给我们</a></p>',
  '<p><a href="tel:400-123-4567">400-123-4567</a></p></main>',
  "</body></html>",
].join("");

/** 1×1 的 PNG（占位图，避免抓取时因 404 产生噪声警告）。 */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

/**
 * 起 stub。返回 `{ port, close }`。
 *
 * 端口已占用时**不静默换端口**——那会让被测服务连到别的东西上而测试照绿。
 * 直接抛错，让调用方看见。
 */
export async function startAiStub({ port = DEFAULT_STUB_PORT, host = "127.0.0.1" } = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    // 防假门禁用：把声明里的 DSL 原样吐出来（spec 拿它喂真实的 coerceVisionDsl）
    if (request.method === "GET" && url.pathname === "/__stub__/vision-dsl") {
      sendJson(response, 200, { dsl: VISION_DSL });
      return;
    }

    // URL 轨的抓取目标（本地页面，零外网）
    if (request.method === "GET" && (url.pathname === "/sample-site" || url.pathname === "/sample-site/")) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(SAMPLE_SITE_HTML);
      return;
    }
    if (request.method === "GET" && url.pathname === "/sample-site/fan.png") {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      response.end(PLACEHOLDER_PNG);
      return;
    }

    // OpenAI 兼容的唯一端点
    if (request.method === "POST" && url.pathname === "/chat/completions") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          // 确认它确实是**多模态**请求：图必须在 content 数组里以 data URL 出现。
          // 若哪天调用端忘了带图，这里如实报错，而不是照样回一份 DSL 让测试假绿。
          const userMessage = Array.isArray(body?.messages)
            ? body.messages.find((message) => message?.role === "user")
            : null;
          const blocks = Array.isArray(userMessage?.content) ? userMessage.content : [];
          const imageBlock = blocks.find((block) => block?.type === "image_url");
          if (!imageBlock?.image_url?.url?.startsWith("data:image/")) {
            sendJson(response, 400, {
              error: { message: "stub 只接受带 data:image/ 的多模态请求", type: "invalid_request_error" },
            });
            return;
          }
        } catch {
          sendJson(response, 400, {
            error: { message: "stub 收到的请求体不是合法 JSON", type: "invalid_request_error" },
          });
          return;
        }
        sendJson(response, 200, visionCompletion());
      });
      return;
    }

    sendJson(response, 404, { error: { message: `stub 没有这个端点：${request.method} ${url.pathname}` } });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return {
    port,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * 删掉本 stub 造出来的运行时模板目录。
 *
 * 由 `serve.mjs` 在**每轮跑完**调用——spec 自己删不了：模板名后缀是前端按时间戳造的
 * （`u${Date.now().toString(36).slice(-5)}`），测试进程当时拿不到，事后再找只能靠前缀猜。
 *
 * 为什么非删不可：`/templates` 页会把 `generated-templates/` 下的目录**扫盘装载**，
 * 留着它们会让 `templates.spec` 的"你做的模板"数量每次跑都变——那不是本测试的意图，
 * 也不该留在用户的应用数据里。
 *
 * @returns 删掉的目录名（供调用方打印）
 */
export async function cleanupStubTemplates(root, { stubUrl } = {}) {
  const dir = path.join(root, ".sitecraft-data", "generated-templates");
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return []; // 目录不存在＝没什么可删的
  }
  const mine = names.filter((name) => isStubTemplateDir(name, stubUrl));
  await Promise.all(mine.map((name) => rm(path.join(dir, name), { recursive: true, force: true })));
  return mine;
}

/**
 * 同步版清理——**给 `process.on("exit")` 用**。
 *
 * 为什么必须有个同步版：进程被 `SIGKILL`（Playwright 关服务时常这么干）或
 * 正常冒泡到 exit 时，**异步回调根本没机会跑**。`process.on("exit")` 里只允许
 * 同步操作——所以真正保证"跑完不留痕"的是这一条，不是优雅的 close 钩子。
 */
export function cleanupStubTemplatesSync(root, { stubUrl } = {}) {
  const dir = path.join(root, ".sitecraft-data", "generated-templates");
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const mine = names.filter((name) => isStubTemplateDir(name, stubUrl));
  for (const name of mine) {
    try {
      rmSync(path.join(dir, name), { recursive: true, force: true });
    } catch {
      // 删不掉也不能让退出流程卡住——下次跑前还有一道兜底
    }
  }
  return mine;
}

/**
 * 端口上是否已有服务在听。
 *
 * 为什么需要：`serve.mjs` 起不上 stub 时会 `process.exit(1)`——但**必须先知道
 * 端口是被谁占着**。若占用者恰好是我们自己上次留下的 stub，直接退出很烦人；
 * 更要紧的是：如果不是我们起的，就**不该由我们去 cleanup**（那会删掉别人的东西）。
 */
export function portInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
}

/** 直接跑本文件即起服务（供 `serve.mjs` spawn / 手工调试）。 */
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  const port = Number(process.env.E2E_AI_STUB_PORT || DEFAULT_STUB_PORT);
  const stub = await startAiStub({ port });
  console.log(`[ai-stub] 就绪 ${stub.url}（OpenAI 兼容；模型=${process.env.DEEPSEEK_MODEL || "sitecraft-e2e-stub"}）`);
  const stop = () => stub.close().then(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  // 父进程（serve.mjs）意外消失时也退出，避免留下孤儿
  process.once("disconnect", stop);
}
