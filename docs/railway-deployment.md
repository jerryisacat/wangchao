# Railway 部署指南

本文档记录 `望潮（Wangchao）` 在 Railway 上的完整部署流程，覆盖项目创建、服务配置、环境变量、部署命令、健康检查和定时任务。

> 通用部署运维说明（健康检查、日志、备份、回滚）见 `docs/deployment.md`。
> Railway Config as Code 文件见 `deploy/railway/`。

## 1. 前置条件

| 条件 | 说明 |
|---|---|
| Railway 账号 | https://railway.com 注册 |
| Railway CLI | `npm i -g @railway/cli`，运行 `railway login` 登录 |
| 本地代码 | `git clone` 仓库，`pnpm install`，确保 `pnpm typecheck && pnpm build` 通过 |
| Postgres | Railway 提供 managed Postgres，无需自建 |

## 2. 项目结构

Railway project 包含三个资源：

| 资源 | 用途 | 配置文件 |
|---|---|---|
| Postgres | 望潮数据库 | Railway managed PostgreSQL |
| wangchao-web | Next.js 产品界面、Server Actions、export routes、`/api/health` | `deploy/railway/web.railway.json` |
| wangchao-worker | RSS 抓取、情报分析、简报生成、source observation | `deploy/railway/worker-cron.railway.json` |

Web 和 Worker 共享同一个 Postgres 实例和同一份代码仓库，通过 `WANGCHAO_RAILWAY_ROLE` 环境变量区分启动行为。

## 3. 创建项目和服务

### 3.1 创建 Railway project

```bash
railway create
```

记录生成的 project name 和 project ID。

### 3.2 添加 Postgres

```bash
railway add --database
```

选择 PostgreSQL。创建后进入 Railway dashboard 或 CLI 查看 `DATABASE_URL`。

### 3.3 添加 Web 服务

```bash
railway add --service wangchao-web
```

在 service settings 中设置 config file path 为 `deploy/railway/web.railway.json`。

### 3.4 添加 Worker 服务

```bash
railway add --service wangchao-worker
```

在 service settings 中设置 config file path 为 `deploy/railway/worker-cron.railway.json`。

## 4. 环境变量

在 Railway dashboard 或 CLI 中为两个服务分别设置以下变量。

### 4.1 必需变量

| 变量 | 服务 | 说明 |
|---|---|---|
| `DATABASE_URL` | web, worker | Postgres 连接串。从 Railway Postgres 资源引用 `${Postgres.DATABASE_URL}`。 |
| `WANGCHAO_RAILWAY_ROLE` | web | 设为 `web` |
| `WANGCHAO_RAILWAY_ROLE` | worker | 设为 `worker` |
| `WANGCHAO_DEFAULT_ORGANIZATION_SLUG` | web, worker | 默认工作区 slug，如 `default` |
| `WANGCHAO_DEFAULT_ORGANIZATION_NAME` | web, worker | 默认工作区名称，如 `Wangchao` |
| `WANGCHAO_DEFAULT_USER_EMAIL` | web, worker | 默认用户邮箱 |
| `WANGCHAO_DEFAULT_USER_NAME` | web, worker | 默认用户名称 |

### 4.2 可选变量

| 变量 | 服务 | 说明 |
|---|---|---|
| `WANGCHAO_SEED_SOURCE_NAME` | web (seed) | seed 创建的默认 RSS 源名称 |
| `WANGCHAO_SEED_SOURCE_URL` | web (seed), worker | seed 创建的默认 RSS URL。worker 会用它做首次抓取 |
| `AI_BASE_URL` | worker (未来) | OpenAI-compatible API endpoint |
| `AI_API_KEY` | worker (未来) | AI provider API key |
| `AI_MODEL_L1` / `AI_MODEL_L2` | worker (未来) | AI pipeline 默认模型 |

### 4.3 通过 CLI 设置变量

```bash
railway variables --service wangchao-web set WANGCHAO_RAILWAY_ROLE=web
railway variables --service wangchao-web set WANGCHAO_DEFAULT_ORGANIZATION_SLUG=default
railway variables --service wangchao-web set WANGCHAO_DEFAULT_ORGANIZATION_NAME=Wangchao
railway variables --service wangchao-web set WANGCHAO_DEFAULT_USER_EMAIL=your@email.com
railway variables --service wangchao-web set WANGCHAO_DEFAULT_USER_NAME=YourName
```

对 worker 重复上述命令，并把 `WANGCHAO_RAILWAY_ROLE` 设为 `worker`。

### 4.4 引用 Postgres 连接串

在 Railway dashboard 中，将 `DATABASE_URL` 变量的值设为 `Postgres` 资源的 `DATABASE_URL` 引用（点击变量值栏，选择 Postgres 资源）。或通过 CLI：

```bash
railway variables --service wangchao-web set DATABASE_URL=${{Postgres.DATABASE_URL}}
railway variables --service wangchao-worker set DATABASE_URL=${{Postgres.DATABASE_URL}}
```

## 5. 部署

### 5.1 部署 Web 服务

```bash
railway up --service wangchao-web --detach
```

Web 服务的部署流程（由 `deploy/railway/web.railway.json` 定义）：

1. **Build**: `pnpm railway:web:build`（生成 Prisma client + 构建 Next.js）
2. **Pre-deploy**: `pnpm db:deploy && pnpm db:seed`（运行 migration + seed 默认工作区）
3. **Start**: `pnpm railway:web:start`（启动 Next.js production server）
4. **Health check**: Railway 探测 `/api/health`，超时 300s

### 5.2 部署 Worker 服务

```bash
railway up --service wangchao-worker --detach
```

Worker 服务的部署流程（由 `deploy/railway/worker-cron.railway.json` 定义）：

1. **Build**: `pnpm railway:build`（生成 Prisma client + 完整 monorepo 构建）
2. **Pre-deploy**: `pnpm railway:worker:predeploy`（`pnpm db:wait && pnpm db:deploy`，等待数据库可达并应用 migration）
3. **Start**: `pnpm railway:worker:start`（执行一轮 fetch cycle 并退出）
4. **Cron schedule**: `0 * * * *`（每小时 UTC 整点执行）

Worker 是一次性任务：执行完一轮抓取→分析→简报后退出。Railway Cron 会按 schedule 自动重新启动。

### 5.3 部署顺序

三个服务（Web、Worker Cron、Source Discovery Cron）的 predeploy 都会运行 `db:wait && db:deploy`（Prisma `migrate deploy` 是幂等的，已应用的 migration 不会重复执行），因此并行部署不会冲突。首次部署时先部署 Web 可确保 seed 数据先写入。

## 6. 验证

### 6.1 检查服务状态

```bash
railway status
```

确认：
- `wangchao-web` 状态为 `Online`
- `wangchao-worker` 状态为 `Completed`（正常，worker 是一次性任务）
- `Postgres` 状态为 `Online`

### 6.2 Web 健康检查

```bash
curl -fsS https://<your-web-domain>/api/health
```

预期返回：

```json
{
  "checks": { "database": { "status": "ok" } },
  "generatedAt": "...",
  "service": "wangchao-web",
  "status": "ok"
}
```

### 6.3 前端路由验证

```bash
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/topics/new
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/sources
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/briefings
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/saved
curl -sS -o /dev/null -w "%{http_code}" https://<your-web-domain>/preferences
```

所有路由应返回 `200`。

### 6.4 Worker 日志

```bash
railway logs --service wangchao-worker
```

确认输出包含 `Wangchao worker` 和 JSON 结果（`fetchedSources`、`insertedOrUpdatedItems`、`createdOrUpdatedEvents`、`generatedBriefings` 等）。

### 6.5 Worker 健康检查（本地）

```bash
pnpm worker:health
```

## 7. 定时任务（Cron）

Worker 服务的 `deploy/railway/worker-cron.railway.json` 已配置 `cronSchedule: "0 * * * *"`（每小时 UTC 整点）。

如果 Railway 没有自动识别 cron schedule，需要手动在 service settings 中：

1. 进入 `wangchao-worker` service settings
2. 找到 `Cron Schedule` 选项
3. 设为 `0 * * * *`

Worker 每次执行一轮：抓取所有 ACTIVE RSS 源 → 分析 → 简报 → source quality observation，然后退出。Railway Cron 按配置的 schedule 自动重启。

调整频率：修改 `deploy/railway/worker-cron.railway.json` 中的 `cronSchedule` 字段，重新部署。

## 8. 更新部署

代码变更后，重新部署对应服务：

```bash
railway up --service wangchao-web --detach
railway up --service wangchao-worker --detach
```

Web 部署会自动运行 `pnpm db:deploy && pnpm db:seed`，确保 schema 是最新的。

## 9. 常见问题

### 9.1 Web 首页显示错误而非情报流

检查 `DATABASE_URL` 是否正确设置并引用 Postgres 资源。Web 在 `DATABASE_URL` 缺失时会抛出错误，不再静默降级为预览模式。

### 9.2 Worker 抓取失败

检查：
- `WANGCHAO_SEED_SOURCE_URL` 是否指向可访问的 RSS feed
- Worker 日志中的 `failedSources` 计数
- RSS URL 是否为有效的 HTTP/HTTPS 地址（`fixture:` 协议已移除）

### 9.3 Migration 未生效

Web 的 pre-deploy 会运行 `pnpm db:deploy`。如果 migration 失败，检查：
- `DATABASE_URL` 是否指向正确的 Postgres
- `packages/db/prisma/migrations/` 是否包含最新 migration
- Railway deploy logs 中 pre-deploy 阶段的输出

### 9.4 Worker Cron 不执行

确认：
- Service settings 中 `Cron Schedule` 已设为 `0 * * * *`
- Worker 最近的 deployment 不是 `Crashed` 状态
- Railway Cron 目前不支持秒级精度，最短间隔为 1 分钟

### 9.5 健康检查超时

Web 的 health check 超时设为 300s。如果首次部署较慢（Prisma generate + migration + Next.js build），可能需要等待。如果持续超时，检查 deploy logs 是否有 build 失败。

## 10. 当前部署信息

| 项目 | 值 |
|---|---|
| Railway project | `wangchao` |
| Project ID | `acba6cd9-3392-4fb7-9c30-a58ddd7bf97f` |
| Region | `southeast-asia` (`asia-southeast1-eqsg3a`) |
| Web public URL | `https://wangchao-web-production.up.railway.app` |
| Web service ID | `c5bbc02b-02b6-4de7-8212-34ecdb1033d5` |
| Worker service ID | `898bceca-6d8c-4533-b7a8-3325d23d8ead` |
| Postgres | Railway managed, `postgres-volume` |

## 11. 参考文件

| 文件 | 说明 |
|---|---|
| `railway.json` | Railway root config（CLI 本地上传部署入口） |
| `deploy/railway/web.railway.json` | Web service Config as Code |
| `deploy/railway/worker-cron.railway.json` | Worker Cron service Config as Code |
| `deploy/railway/README.md` | Railway Config as Code 说明 |
| `docs/deployment.md` | 通用部署运维说明（健康检查、日志、备份、回滚） |
| `.env_example` | 环境变量模板（占位符，不含真实凭据） |
