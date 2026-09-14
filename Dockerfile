FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SITE_STORE=postgres
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/vendor ./vendor
# ⚠️ 必须 COPY lib/（2026-09-14 修）：
# `lib/template-adapters/navigation-view.ts:40` 用
#   path.join(process.cwd(), "lib", "template-adapters", "navigation-view.mjs")
# **在运行时读文件**——它不经过打包器，所以不会进 `.next`。
# 不 COPY 的后果（实测）：镜像里 /app/lib 不存在 →
#   读不到导航兼容视图 → **所有模板预览 500**
#   （Error: 读不到导航兼容视图 /app/lib/...：ENOENT）
# 同目录还有 22 个适配器 .mjs/.ts，同样由运行时按路径读取。
COPY --from=build /app/lib ./lib
EXPOSE 3000
CMD ["npm", "run", "start"]
