# 生产部署 · 访问上下文与鉴权（T-13 处置 · 方案 A）

> **本文件是生产部署的必读项。** 漏读它的后果是**整站不可用**：
> 除了少数公开路由，其余全部返回 **401**。
>
> 背景取证见 [`2026-09-13-production-auth-inventory.md`](2026-09-13-production-auth-inventory.md)
> （23 个路由 × 权限、逐调用点判定、真实运行服务的实测证据）。

---

## 一、⚠️ 最重要的一条规则（从代码注释升格到此）

> ### **不设 `SITECRAFT_ACCESS_MODE` 时，非 `development` 一律 `strict`。**

这条规则此前**只活在 `lib/request-context.ts:77-81` 的代码注释里**——部署者看不到，
忘了设也不会被提醒，**表现是整站 401**。现在它在这里。

判定逻辑（`lib/request-context.ts`）：

| 情形 | 结果 |
|---|---|
| 显式设 `strict` 或 `relaxed` | **用你设的那个**（两种情况都尊重） |
| 未设，且 `NODE_ENV === "development"` | `relaxed`（本地开发零配置） |
| 未设，且**非 development**（`next start` / 容器） | **`strict`** ← **生产的真实默认** |

**为什么这样设计**：此前是"strict 之外一律 relaxed"——**默认不安全**。
生产只要忘了设环境变量，`curl /api/sites` **不带任何头**就能列出全部站点，
身份还会回落成 `demo / internal-dev / editor`（**可写**）。

> ⚠️ **`SITECRAFT_ACCESS_MODE` 请写进 `.env.local` / 容器 env，
> 不要依赖运行时 export。** 实测：走环境变量会被 `next.config.ts` 的
> `loadEnvConfig` 覆盖（见盘点文档第八节）。

---

## 二、strict 下要求什么

三个请求头，**缺任意一个即 401**：

| 头 | 含义 | 示例 |
|---|---|---|
| `x-sitecraft-workspace-id` | 工作区标识 | `demo` |
| `x-sitecraft-actor-id` | 操作者标识 | `gateway` |
| `x-sitecraft-role` | 角色（`editor` / `reviewer` / `viewer`） | `editor` |

失败响应：

```json
{ "ok": false, "error": "access_context_required",
  "message": "需要内部访问上下文才能访问该资源。" }
```

**`editor` 是可写角色。** 给它就等于给写权限。

---

## 三、方案 A：网关统一注入（本项目当前采用的方案）

**应用代码零改动**，由反向代理注入三个头。

### nginx

```nginx
location / {
    proxy_pass http://sitecraft:3000;
    proxy_set_header Host $host;

    # ── 访问上下文（T-13）─────────────────────────────
    proxy_set_header x-sitecraft-workspace-id "demo";
    proxy_set_header x-sitecraft-actor-id     "gateway";
    proxy_set_header x-sitecraft-role         "editor";
}
```

### Cloudflare Worker（或同类边缘）

```js
export default {
  async fetch(request, env) {
    const headers = new Headers(request.headers);
    headers.set("x-sitecraft-workspace-id", "demo");
    headers.set("x-sitecraft-actor-id", "gateway");
    headers.set("x-sitecraft-role", "editor");
    return fetch(request, { headers });
  },
};
```

### Kubernetes Ingress（nginx-ingress）

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/configuration-snippet: |
      proxy_set_header x-sitecraft-workspace-id "demo";
      proxy_set_header x-sitecraft-actor-id     "gateway";
      proxy_set_header x-sitecraft-role         "editor";
```

### 同时设好环境变量

```dotenv
# .env.local 或容器 env
SITECRAFT_ACCESS_MODE=strict
DEFAULT_WORKSPACE_ID=demo
```

---

## 四、⚠️ 方案 A 的已知代价（**部署前必须知道**）

### 1. 单租户假设被固化

网关只能注入**一组固定值**——**所有请求都是同一个工作区、同一个可写身份**。
本仓库的"多工作区"能力从此**只在代码里、不在部署里**。

**将来要做多租户时，这次注入的常量就是必须拆掉的债。**

### 2. 安全边界移到了应用之外

任何**绕过网关**的路径都能拿到 `demo` 工作区的**可写**身份：

- 内网直连容器端口；
- `kubectl port-forward`；
- 任何能访问 `http://sitecraft:3000` 的旁路服务。

应用的 `strict` 判定**只防了"漏设环境变量"，没防"绕过网关"**。

**部署要求**：容器端口**不得**对宿主/公网暴露，只允许网关可达。

### 3. 这不是"把安全的做不安全"

**当前形态下这不构成新增风险**：本仓库现在**没有登录体系**，
本来就无法区分"用户 A / 用户 B"。方案 A 不是降低安全性，
是**承认现状并把它写清楚**。

> **B 方案（前端登录态 / 凭据签发）挂"多租户需求出现时"立项。**
> 当前不建议做 B1（前端带头）：`NEXT_PUBLIC_*` 会进客户端包，
> **安全性比 A 更弱**（A 至少挡在代理后）。

---

## 五、防漂移：一条会红的冒烟（**别只靠文档**）

网关配置会被误删、被别的变更覆盖。**文档防不住，门禁能。**

```bash
npm run test:e2e:strict
```

它做两件事：

1. 以 strict 起服务，三个核心入口（站点库 / 模板库 / 生成记录）各断言
   **「缺头 → 401」+「带对三头 → 2xx」**，外加**「三个头缺任意一个都算缺」**；
2. 跑 T-14 间歇率探针（10 次冷加载，`EMPTY ≥ 1` 即失败）。

**实测原文**：

```
ok 2 … 站点库（首页打开就有） · /api/sites：缺头 → 401
ok 3 … 站点库（首页打开就有） · /api/sites：带对三头 → 2xx（且是 JSON）
ok 4 … 模板库（建站入口） · /api/templates/runtime：缺头 → 401
ok 5 … 模板库（建站入口） · /api/templates/runtime：带对三头 → 2xx（且是 JSON）
ok 6 … 生成记录（诊断面板） · /api/generation-records：缺头 → 401
ok 7 … 生成记录（诊断面板） · /api/generation-records：带对三头 → 2xx（且是 JSON）
ok 8 … 三个头缺任意一个都算缺（不只测全缺）
8 passed
```

⚠️ **这条冒烟测的是"应用收到头之后的判定"，不是"网关有没有注入"。**
网关侧的注入需要**部署后另跑一次**（带真实域名）：

```bash
# 期望 2xx —— 若 401，说明网关没注入或注入了不全
curl -s -o /dev/null -w "%{http_code}\n" https://<你的域名>/api/sites
```

**把这条 curl 加进部署 checklist**：它是唯一能证明"网关真的在工作"的检查。

---

## 六、公开路由不受影响

以下**无需**三个头（strict 下也照常可用）：

- 静态资源、模板预览页；
- 公开站点页（`/api/published/*`）、留资提交；
- 图片上传（`/api/product-images`）；
- 健康检查、AI 状态（`/api/ai/status`）。

完整清单见盘点文档第二节「23 个路由 × 权限」。
