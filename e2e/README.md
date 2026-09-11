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
- `E2E_SKIP_DOCKER=1`：不尝试启动 Docker；5432 不可用时直接失败。

## 定位失败

- 终端：list reporter 输出。
- 程序化结果：`test-results/results.json`。
- HTML：`npm run test:e2e:report`。
- 失败 trace：`test-results/` 下对应测试目录。
- 步骤截图：`test-results/steps/`，并附加到 HTML report。

每个测试创建独立站点且串行执行，避免共享数据库竞争。mock SSE 必须保持 `data: {...}\n\n` 格式。
