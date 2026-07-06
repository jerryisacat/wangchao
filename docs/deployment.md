# Wangchao Deployment and Operations

本文档记录当前个人版部署方式，覆盖 Web、worker、Postgres、健康检查、日志和回滚边界。

当前个人版首选部署平台是 **Railway**。仓库已提供 Railway Config as Code 示例：

| Service | Config file | Role |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | Next.js Dashboard、Server Actions、export routes、health endpoint |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | 定时执行 RSS fetch、analysis、briefing、source observation |

Railway service 需要分别指向对应 config file path；两个服务可以连接同一个 Railway Postgres。

2026-07-06 实际部署说明：

- Railway project: `wangchao`
- Services: `Postgres`, `wangchao-web`, `wangchao-worker`
- Region: `southeast-asia` (`asia-southeast1-eqsg3a`)
- Public URL: `https://wangchao-web-production.up.railway.app`
- 当前部署方式：`railway up --service ...` 从本地目录上传部署。后续代码稳定并提交到远端后，可切换到 GitHub 自动部署。
- 实际生效的 root config: `railway.json`
- `wangchao-web` 已成功执行 `pnpm db:deploy && pnpm db:seed`，Next.js 已启动。
- `wangchao-worker` 已部署并执行一轮 worker，生成 item/event/briefing；当前尚未通过 CLI 配置成 Railway Cron。
- 生产 smoke test 已通过 `/api/health` database `ok`，Railway edge 显示 `hkg1`；首页使用动态渲染读取运行时数据。

## Services

| Service | Path | Role | Start command |
|---|---|---|---|
| Web | `apps/web` | Next.js App Router UI、Server Actions、export routes、health endpoint | `pnpm railway:web:start` |
| Worker | `apps/worker` | RSS fetch、analysis、preference learning、briefing、source governance observation | `pnpm railway:worker:start` |
| Database | `packages/db` | Prisma/Postgres schema、migration、seed、repository boundary | `pnpm db:migrate`、`pnpm db:seed` |

## Required Environment

| Variable | Used by | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | web, worker, db scripts | Yes | Postgres connection string. Do not commit real values. |
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

1. Create a Railway project from the GitHub repository.
2. Add a managed Railway Postgres database.
3. Create a Web service from the same repo and set its config file path to `deploy/railway/web.railway.json`.
4. Create a Worker service from the same repo and set its config file path to `deploy/railway/worker-cron.railway.json`.
5. Attach the Postgres database variables to both services, especially `DATABASE_URL`.
6. Set the default workspace variables on both services:

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

8. Deploy Web first. Its Railway pre-deploy command runs:

```bash
pnpm db:deploy && pnpm db:seed
```

9. Deploy Worker Cron after Web succeeds.
10. Open the Web service health endpoint and confirm database status is `ok`:

```bash
curl -fsS https://<railway-web-domain>/api/health
```

### Railway Service Commands

Web config:

```text
Build:      pnpm railway:build
Predeploy:  pnpm railway:predeploy
Start:      pnpm railway:start
Role:       WANGCHAO_RAILWAY_ROLE=web
```

Worker Cron config:

```text
Build:      pnpm railway:build
Predeploy:  pnpm railway:predeploy
Start:      pnpm railway:start
Role:       WANGCHAO_RAILWAY_ROLE=worker
Target Cron Schedule: 0 * * * * UTC
```

The worker process is expected to run one cycle and exit. Railway Cron will start it on the configured schedule.

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

## Logging

- Web route handlers and Server Actions should not log secrets, cookies, auth headers, provider URLs with tokens, or raw LLM output.
- Worker logs should be structured around cycle result counts: fetched sources, failed sources, inserted items, generated briefings, source observations, and usage events.
- Long-running failures should be persisted through `TaskRun.errorMessage` where possible.
- Usage/cost related activity should be persisted through `UsageEvent`, not inferred only from logs.

## Backup and Rollback

- Postgres backups must be handled by the hosting provider or an explicit scheduled backup job before production use.
- Prisma migrations are version-controlled in `packages/db/prisma/migrations`.
- Rollback should prefer deploying the previous application version while keeping forward-compatible migrations; destructive down migrations require explicit review.
- `AGENTS_CHANGELOGS.md` and `DEVELOPE_LOGS.md` must record deployment-related repository changes.

## Current Gaps

- No production auth/session provider.
- Railway Web and Worker services have been deployed from this environment.
- Worker service currently runs one cycle on deploy and stops; Railway Cron still needs to be enabled through service config/dashboard/API.
- No centralized error reporting.
- No automated backup job.
- Postgres backup policy and rollback drill still need live Railway verification.
