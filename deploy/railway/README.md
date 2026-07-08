# Railway Deployment Configs

本目录放置 Railway Config as Code 示例。当前个人版推荐在同一个 Railway project 中创建四个资源：

| Railway resource | Purpose | Config file |
|---|---|---|
| Postgres | Wangchao 数据库 | Railway managed PostgreSQL |
| Web service | Next.js Dashboard、Server Actions、export routes、`/api/health` | `deploy/railway/web.railway.json` |
| Worker cron service | RSS fetch、analysis、briefing、source observation | `deploy/railway/worker-cron.railway.json` |
| Source discovery cron service | 每周自动信源发现，写入 candidate pool | `deploy/railway/source-discovery-cron.railway.json` |

Railway 每个 service 只能有一份 active config。为同一个 GitHub repo 创建 Web 和 Worker 两个 service 后，在 service settings 中分别设置对应的 config file path：

```text
deploy/railway/web.railway.json
deploy/railway/worker-cron.railway.json
deploy/railway/source-discovery-cron.railway.json
```

Web service 在部署前运行：

```bash
pnpm db:deploy && pnpm db:seed
```

Worker cron service 默认每小时运行一次。Source discovery cron service 默认每周一 02:00 UTC 运行一次。Railway cron 使用 UTC crontab；如需调整频率，修改 `cronSchedule`。
