# Railway Deployment Configs

本目录放置 Railway Config as Code。当前个人版推荐在同一个 Railway project 中创建 Postgres 与六个应用服务：

| Railway resource | Purpose | Config file |
|---|---|---|
| Postgres | Wangchao 数据库 | Railway managed PostgreSQL |
| Web service | Next.js Dashboard、Server Actions、export routes、`/api/health` | `deploy/railway/web.railway.json` |
| Queue worker service | 常驻消费 durable TaskRun，及时处理手动摘要等命令 | `deploy/railway/queue-worker.railway.json` |
| Worker cron service | RSS fetch、analysis、briefing、source observation | `deploy/railway/worker-cron.railway.json` |
| Source discovery cron service | 每周自动信源发现，写入 candidate pool | `deploy/railway/source-discovery-cron.railway.json` |
| Instant push cron service | 每 15 分钟投递高分情报 | `deploy/railway/instant-push-cron.railway.json` |
| Report cron service | 每 10 分钟生成待处理专题报告 | `deploy/railway/report-cron.railway.json` |

Railway 每个 service 只能有一份 active config。为同一个 GitHub repo 创建 Web 和 Worker 两个 service 后，在 service settings 中分别设置对应的 config file path：

```text
deploy/railway/web.railway.json
deploy/railway/queue-worker.railway.json
deploy/railway/worker-cron.railway.json
deploy/railway/source-discovery-cron.railway.json
deploy/railway/instant-push-cron.railway.json
deploy/railway/report-cron.railway.json
```

Web service 在部署前运行：

```bash
pnpm db:deploy && pnpm db:seed
```

Web service 的 build 阶段使用完整 monorepo 构建：

```bash
pnpm railway:build
```

这样可以确保 `apps/web` 构建时 `@wangchao/core`、`@wangchao/db`、`@wangchao/sources`、`@wangchao/worker` 等 workspace 包都在 Railpack 构建上下文中可解析。

全部 worker service 也使用完整 monorepo 构建，确保运行时可以加载 worker 依赖的 `@wangchao/*/dist` 输出。Queue Worker 不设置 cron，使用 `pnpm railway:queue-worker:start` 常驻运行。

Worker cron service 默认每小时运行一次。Source discovery cron service 默认每周一 02:00 UTC 运行一次。Railway cron 使用 UTC crontab；如需调整频率，修改 `cronSchedule`。
