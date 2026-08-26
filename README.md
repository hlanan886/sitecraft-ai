# SiteCraft AI

企业独立站 AI 制作工作台 MVP。当前包含：

- 16 套带来源与许可证说明的开源模板筛选与整页预览
- 中英文实时预览、桌面/平板/手机画布切换
- DeepSeek 真实自然语言改稿、草稿版本、撤销/重做
- CSV/XLSX 商品导入，SKU 合并，中文/英文列名兼容，AI 补全标记
- 商品目录预留图片匹配规则，发布按钮与站点 API 骨架
- 发布按钮打开公开站点预览 `/published/forge-industrial`，包含双语切换、产品目录和询盘表单
- DeepSeek Chat Completions JSON 模式；未配置或上游失败时明确报错，不执行离线伪修改
- PostgreSQL JSONB 事务草稿和行级修订锁，生产 Web 实例保持无状态
- Docker Compose 本地全栈与双副本 Kubernetes 部署清单

## 本地运行

```bash
git clone --recurse-submodules https://github.com/redmaplewww/sitecraft-ai.git
cd sitecraft-ai
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

DeepSeek 配置写入 `.env.local`：

```env
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=server-only-secret
DEEPSEEK_MODEL=deepseek-v4-flash
```

本地 `next dev` 会读取开发草稿；生产构建强制使用 PostgreSQL，不会退回单机文件。迁移已有开发草稿：

```bash
npm run migrate:drafts
```

容器启动时通过运行环境注入 `DEEPSEEK_API_KEY` 和 `DATABASE_URL`。多实例示例见 `deploy/kubernetes/sitecraft.yaml`；密钥不得写入镜像或清单。

运行检查：

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

使用真实 DeepSeek 生成并复核三个双语企业测试站点：

```bash
npm run test:three-sites
```

模板来源、许可证和演示地址见 [OPEN_SOURCE_TEMPLATES.md](./OPEN_SOURCE_TEMPLATES.md)。16 套上游模板通过 Git submodule 固定版本；本项目自身暂未声明开源许可证，模板继续遵循各自许可证。
