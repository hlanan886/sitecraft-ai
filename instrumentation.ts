/**
 * Next.js 进程级启动钩子（2026-09-10，方向 3 阶段 A）。
 *
 * 目的只有一个：**把运行时模板装载器接入服务端进程**。
 *
 * ## 为什么必须有这个文件
 *
 * `allTemplates()`（`lib/site-model.ts`）在客户端 bundle 里，所以它**不能**静态
 * import 任何碰 `node:fs` 的模块——Turbopack 会让构建直接失败
 * （实测 `does not support external modules (request: node:fs)`）。
 * 于是装载器用依赖倒置：由「能读磁盘的一方」显式注入钩子。
 *
 * 本文件是 Next.js 保证**每个服务端进程只执行一次**的入口，正是注入点。
 *
 * ## `NEXT_RUNTIME` 守卫是必须的，不是保险
 *
 * Next.js 会把 `instrumentation.ts` 编译**两份**：Node.js 运行时一份、**Edge 运行时一份**。
 * Edge 没有 `node:fs`／`process.cwd()`，所以不加守卫时构建会报
 * 「A Node.js API is used ... not supported in the Edge Runtime」（实测踩到）。
 *
 * 光把 import 写成动态的**不够**——不判运行时的话它仍会被无条件求值、照样进 Edge 包。
 * 必须先用 `NEXT_RUNTIME === "nodejs"` 把这段代码挡在 Node 分支里。
 *
 * ## 为什么不在每个路由里调 `loadRuntimeTemplatesFromDisk()`
 *
 * 那样确实也能工作，但会出现「某些路由看得见沉淀模板、某些看不见」：
 * 首个请求打到哪个路由，决定了注册表装没装。启动时统一装载没有这个不确定性，
 * 而且装载失败（一个坏登记单）可以在启动日志里一次性暴露。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadRuntimeTemplatesFromDisk } = await import("./lib/template-runtime-loader.ts");
  const { registered, errors } = loadRuntimeTemplatesFromDisk(true);
  if (registered.length) {
    console.log(`[sitecraft] 已装载 ${registered.length} 个运行时模板：${registered.join(", ")}`);
  }
  for (const error of errors) {
    // 坏模板只警告不抛：一个坏目录不能阻止整站启动。
    console.warn(`[sitecraft] 运行时模板 ${error.templateId} 装载失败：${error.reason}`);
  }
}
