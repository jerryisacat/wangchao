# Wangchao Deployment and Operations

本文件记录当前个人版部署方式，覆盖 Web、worker、Postgres、健康检查、日志和回滚边界。

当前个人版首选部署平台是 **Railway**。部署主路径是 **GitHub push/merge 到 `master` → Railway 自动构建和部署**。详细的 Railway 运维操作（Cron 观测、备份、回滚 runbook、环境变量矩阵）见 `docs/railway-runbook.md`。

仓库提供 Railway Config as Code 文件，每个 Railway service 使用独立 config：

| Service | Config file | Role |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | Next.js Dashboard、Server Actions、export routes、health endpoint |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | 定时执行 RSS fetch、analysis、briefing、source observation |
| Source Discovery Cron | `deploy/railway/source-discovery-cron.railway.json` | 每周自动信源发现，写入 candidate pool |
| Instant Push Cron | `deploy/railway/instant-push-cron.railway.json` | 每 15 分钟投递新入库的高分情报 |

Railway service 需要分别指向对应 config file path；三个服务连接同一个 Railway Postgres。

2026-07-06 实际部署说明：

- Railway project: `wangchao`
- Services: `Postgres`, `wangchao-web`, `wangchao-worker`
- Region: `southeast-asia` (`asia-southeast1-eqsg3a`)
- Public URL: `https://wangchao-web-production.up.railway.app`
- **部署主路径**：GitHub push/merge 到 `master` → Railway 自动构建和部署。
- **紧急 fallback**：`railway up --service ...` 从本地目录上传（使用 root `railway.json` + `WANGCHAO_RAILWAY_ROLE` 分发），仅在 GitHub integration 故障时使用。
- `wangchao-web` 已成功执行 `pnpm db:deploy && pnpm db:seed`，Next.js 已启动。
- `wangchao-worker` 已部署并执行一轮 worker，生成 item/event/briefing。
- 生产 smoke test 已通过 `/api/health` database `ok`，Railway edge 显示 `hkg1`；首页使用动态渲染读取运行时数据。

2026-07-07 部署更新：

- 使用最新代码（前端 Kinetic Intelligence 重构 + 生产环境清理）重新部署了两个服务。
- `wangchao-web` deploy ID: `b57f4326-e6c6-4634-983a-9ece088ba4bd`，已通过 health check (`/api/health` → database `ok`)。
- `wangchao-worker` deploy ID: `24f6945e-6549-40f7-876f-4a98fdda57c7`，成功执行一轮：抓取 1 个 RSS 源，写入 20 条 item，生成 1 个事件 + 1 份简报。
- 前端路由验证全部通过（200）：`/`、`/topics/new`、`/sources`、`/briefings`、`/saved`、`/preferences`。
- 首页正确渲染情报卡片：主题标签、来源链接、标题、摘要、为什么重要解释、已读/收藏/减少/原文动作按钮。

## Services

| Service | Path | Role | Start command |
|---|---|---|---|
| Web | `apps/web` | Next.js App Router UI、Server Actions、export routes、health endpoint | `pnpm railway:web:start` |
| Worker Cron | `apps/worker` | RSS fetch、analysis、preference learning、briefing、source governance observation（Railway Cron 每小时触发） | `pnpm railway:worker:start` |
| Source Discovery Cron | `apps/worker --source-discovery` | 候选信源发现（Railway Cron 每周一 02:00 UTC 触发） | `pnpm --filter @wangchao/worker source-discovery` |
| Instant Push Cron | `apps/worker --instant-push` | 高分情报可靠 Telegram 投递（每 15 分钟） | `pnpm worker:instant-push` |
| Database | `packages/db` | Prisma/Postgres schema、migration、seed、repository boundary | `pnpm db:migrate`、`pnpm db:seed` |

## Required Environment

| Variable | Used by | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | web, worker, db scripts | Yes | Postgres connection string. Do not commit real values. |
| `WANGCHAO_DB_WAIT_TIMEOUT_MS` | web predeploy | Optional | Max wait for Postgres TCP readiness before migration; defaults to `180000`. |
| `WANGCHAO_DB_WAIT_INTERVAL_MS` | web predeploy | Optional | Retry interval for Postgres readiness checks; defaults to `2000`. |
| `WANGCHAO_DEFAULT_ORGANIZATION_SLUG` | web, worker, seed | Yes | Default workspace slug until real auth/session exists. |
| `WANGCHAO_DEFAULT_ORGANIZATION_NAME` | web, worker, seed | Yes | Default workspace display name. |
| `WANGCHAO_DEFAULT_USER_EMAIL` | web, worker, seed | Yes | Default user email. |
| `WANGCHAO_DEFAULT_USER_NAME` | web, worker, seed | Yes | Default user display name. |
| `WANGCHAO_SEED_SOURCE_NAME` | seed | Personal deployment | Default source display name. |
| `WANGCHAO_SEED_SOURCE_URL` | seed, worker | Personal deployment | Default first RSS URL. |
| `PORT` | web | Railway injected | Do not set manually unless the platform requires it. |
| `AI_BASE_URL` | future AI runtime | Later | OpenAI-compatible endpoint. |
| `AI_API_KEY` | future AI runtime | Later | Secret; never log or commit. |

## Railway Setup

1. Create a Railway project and connect the GitHub repository (`jerryisacat/wangchao`).
2. Add a managed Railway Postgres database.
3. Create a Web service from the GitHub repo and set its config file path to `deploy/railway/web.railway.json`.
4. Create a Worker Cron service from the GitHub repo and set its config file path to `deploy/railway/worker-cron.railway.json`.
5. Create a Source Discovery Cron service from the GitHub repo and set its config file path to `deploy/railway/source-discovery-cron.railway.json`.
6. Create an Instant Push Cron service and set its config file path to `deploy/railway/instant-push-cron.railway.json`.
6. Attach the Postgres database variables to all three services via Railway service reference (`${{Postgres.DATABASE_URL}}`), not hardcoded values.
7. Set the default workspace variables on all three services:

```text
WANGCHAO_DEFAULT_ORGANIZATION_SLUG
WANGCHAO_DEFAULT_ORGANIZATION_NAME
WANGCHAO_DEFAULT_USER_EMAIL
WANGCHAO_DEFAULT_USER_NAME
```

7. For real personal use, set seed source variables before first Web deploy:

```text
WANGCHAO_SEED_SOURCE_NAME
WANGCHAO_SEED_SOURCE_URL
```

8. Deploy Web first. Its Railway pre-deploy command waits for Railway Postgres to accept private-network TCP connections, then runs migrations and seed:

```bash
pnpm db:wait && pnpm db:deploy && pnpm db:seed
```

9. Deploy Worker Cron and Source Discovery Cron after Web succeeds.
10. Open the Web service health endpoint and confirm database status is `ok`:

```bash
curl -fsS https://<railway-web-domain>/api/health
```

11. Confirm Worker Cron and Source Discovery Cron schedules are active in Railway dashboard.

### Railway Service Commands

三个 service-level config 使用各自的专用脚本（推荐路径）：

| Service | Build | Predeploy | Start | Cron |
|---|---|---|---|---|
| Web | `pnpm railway:build` | `pnpm db:wait && pnpm db:deploy && pnpm db:seed` | `pnpm railway:web:start` | — |
| Worker Cron | `pnpm railway:build` | `pnpm railway:worker:predeploy` | `pnpm railway:worker:start` | `0 * * * *` UTC |
| Source Discovery | `pnpm railway:build` | `pnpm railway:worker:predeploy` | `pnpm --filter @wangchao/worker source-discovery` | `0 2 * * 1` UTC |
| Instant Push | `pnpm railway:build` | `pnpm railway:worker:predeploy` | `pnpm worker:instant-push` | `*/15 * * * *` UTC |

root `railway.json`（`WANGCHAO_RAILWAY_ROLE` 分发）仅用于 `railway up` 本地紧急 fallback：

```text
Build:      pnpm railway:build
Predeploy:  pnpm railway:predeploy
Start:      pnpm railway:start
Role:       WANGCHAO_RAILWAY_ROLE=web|worker
```

Worker Cron 和 Source Discovery Cron 的进程设计为运行一轮后退出。Railway Cron 按 schedule 启动容器，执行 start command，进程退出后容器停止。

## Health Checks

Web:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

The endpoint returns JSON with `service`, `status`, `generatedAt`, and dependency `checks`. If `DATABASE_URL` is unset, database check is `skipped` for local preview mode. If DB ping fails, HTTP status is `503`.

Worker:

```bash
pnpm --filter @wangchao/worker build
pnpm worker:health
```

The worker health command runs the built worker entrypoint, prints runtime dependency checks, and exits non-zero when a required configured dependency is down.

## Deployment Sequence

1. Provision Postgres.
2. Set environment variables from `.env_example`.
3. Install dependencies.
4. Run `pnpm db:generate`.
5. Run `pnpm db:migrate` locally or `pnpm db:deploy` in deployment.
6. Run `pnpm db:seed` for default workspace bootstrap.
7. Build Web with `pnpm --filter @wangchao/web build`.
8. Start Web on the target platform.
9. Start worker as a separate long-running process or scheduled job.
10. Check `/api/health` and `pnpm worker:health`.

## Backup and Rollback

详细的 Postgres 备份/PITR 策略、migration 前检查、恢复演练、回滚 runbook 和环境变量矩阵见 `docs/railway-runbook.md`。

- Postgres backups 使用 Railway managed Postgres 的内置 Backup/PITR 能力。
- Prisma migrations are version-controlled in `packages/db/prisma/migrations`.
- Rollback 优先使用 Railway previous deployment rollback；DB migration 回滚需保持 forward-compatible。
- Destructive migration 有单独风险说明和人工确认要求。
- `AGENTS_CHANGELOGS.md` 和 `DEVELOPE_LOGS.md` 记录部署相关仓库变更。

## Logging

- Web route handlers 和 Server Actions 不输出 secrets、cookies、auth headers、provider URLs with tokens 或 raw LLM output。
- Worker 每次执行输出结构化 JSON 日志：`cycle-start`（cycle type + timestamp）和 `cycle-end`（cycle type + duration + status + counters）。详细字段见 `docs/railway-runbook.md` §2.3。
- Fetch、discovery、relevance、AI extraction、briefing 和 Markdown export 都必须把成功/失败持久化到对应 `TaskRun`；provider 失败后走规则 fallback 时仍保留失败的 extraction `errorMessage`。
- Usage/cost related activity 应通过 `UsageEvent` 持久化，而不是仅从日志推断。AI_CALL quantity 使用逻辑 adapter calls（内部 HTTP retries 不重复计数），包括最终失败的调用，而 success/fallback 计数保留在 metadata。

## CI

GitHub Actions CI 在 push/PR 到 `master` 时运行 lint、typecheck、build、test 和 Prisma schema validate。CI 与 Railway 部署并行工作，Railway 由 GitHub integration 独立触发。详细说明见 `docs/railway-runbook.md` §6 和 `.github/workflows/ci.yml`。

## Current Gaps

- No production auth/session provider.
- No centralized error reporting service（如 Sentry）。
- Worker Cron 和 Source Discovery Cron 的 schedule 已在 config 中定义，需在 Railway dashboard 确认 service-level cron 已启用。
- Postgres backup policy 需在 Railway dashboard 确认频率和保留期。
- 回滚演练需定期执行（建议每季度），记录到 `DEVELOPE_LOGS.md`。
