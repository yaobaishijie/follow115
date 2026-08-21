# 115 追剧 Web

本仓库按《115 影视订阅与自动追剧服务 —— 产品需求规格 V1》独立实现，不依赖 CloudSaver 运行时。

## 第一阶段基线

- `packages/contracts`：领域枚举、状态机、API 契约与统一错误模型；
- `apps/api`：Fastify 服务入口、健康检查、数据库迁移与未实现路由的契约占位；
- `apps/web`：React + Vite 响应式前端骨架；
- `infra/postgres/migrations`：PostgreSQL Schema；
- `docker-compose.yml`：Web、API、PostgreSQL（供后续 pg-boss）、每日备份和独立 Mihomo/Clash。

## 本地验证

```bash
cp .env.example .env
npm install
npm run lint
npm run typecheck
npm test
docker compose up --build
```

首次代理默认使用 HTTP `clash:7890`。Compose 通过 `CLASH_CONFIG_DIR` 挂载
Mihomo 配置，默认沿用 `/Volumes/sansung/docker/cloudsaver/clash`；外部请求
是否走代理由设置页控制，代理不可用不会阻塞主服务启动。

Docker 启动后：Web 为 `http://localhost:8080`，API 健康检查为 `http://localhost:3000/health`。

真实 115 转存、移动、重命名、删除，以及未反推完成的分享转存接口，不在第一阶段执行。
