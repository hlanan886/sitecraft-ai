# Sitecraft Playwright 探测

## 首次安装

```text
npm install
npm run e2e:install
```

测试默认使用 Docker Postgres、自动判断是否需要生产构建，并在 `127.0.0.1:3210` 启动 Next.js。端口 3000 不会被占用。

## 运行

```text
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:real
```

默认用例拦截 AI SSE，不消耗 token。`test:e2e:real` 设置 `E2E_REAL_AI=1`，仅运行标记为 `@real` 的真实 DeepSeek 冒烟。

可用环境变量：

- `E2E_FORCE_BUILD=1`：忽略缓存并重新构建。
- `E2E_SKIP_DOCKER=1`：不尝试启动 Docker；Postgres 不可用时直接失败。
- `E2E_AI_STUB=1`：启用**本地模型 stub**（`scripts/ai-stub.mjs`），把被测服务的
  `DEEPSEEK_BASE_URL` 指到它。用于"截图/网址 → 模板"这类**要真调模型**的完整路径
  （`specs/template-full-path.spec.ts`）——mock 只落在模型那一步，
  **前端→路由→编排→拼装→登记→建站全部真跑**，且不出网、不烧钱。
  不开这个开关时那些用例会整段跳过（见 spec 头部的说明）。
  同一轮跑完由 spec 自己清理它生成的模板目录，不留痕迹。
- `E2E_AI_STUB_PORT`：stub 的端口，默认 3311。被占用时**直接失败**而不是换端口——
  换端口会让被测服务连到别的东西上而测试照绿。

## 定位失败

- 终端：list reporter 输出。
- 程序化结果：`test-results/results.json`。
- HTML：`npm run test:e2e:report`。
- 失败 trace：`test-results/` 下对应测试目录。
- 步骤截图：`test-results/steps/`，并附加到 HTML report。

每个测试创建独立站点且串行执行，避免共享数据库竞争。mock SSE 必须保持 `data: {...}\n\n` 格式。
