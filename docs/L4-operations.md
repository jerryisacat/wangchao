# L4 - 操作与运维

> 本文件记录命令、环境变量、部署、测试和本地验证入口。属于 L4 操作层，随实现演进频繁更新。
>
> 上层抽象见 `CODEGUIDE.md`（L0 系统架构 + L1 设计原则）。

## 本地运行

```bash
cp .env_example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Node.js workspace 验证

```bash
CI=true pnpm typecheck
CI=true pnpm build
CI=true pnpm lint
CI=true pnpm test
pnpm worker:health
pnpm worker:source-discovery
pnpm smoke:web
```

## Railway 部署脚本

```bash
pnpm railway:web:build
pnpm railway:web:start
pnpm railway:build
pnpm railway:predeploy
pnpm railway:start
pnpm railway:worker:build
pnpm railway:worker:start
pnpm worker:source-discovery
pnpm db:wait
pnpm db:deploy
```

说明：

- `deploy/railway/web.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 Railway/Railpack 在 Web-only 构建时裁掉 `@wangchao/*` workspace 包；在 pre-deploy 阶段运行 `pnpm db:wait && pnpm db:deploy && pnpm db:seed`，先等待 Railway Postgres 私网端口可达，再执行 migration/seed，启动命令为 `pnpm railway:web:start`，健康检查路径为 `/api/health`。
- `deploy/railway/worker-cron.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 worker runtime 缺少 `@wangchao/*/dist`；按 `0 * * * *` UTC 每小时执行一次 `pnpm railway:worker:start`。
- `deploy/railway/source-discovery-cron.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 source discovery runtime 缺少 `@wangchao/*/dist`；按 `0 2 * * 1` UTC 每周执行一次 `pnpm --filter @wangchao/worker source-discovery`。
- `railway.json` 是当前 CLI 本地上传部署入口。由于当前仓库有大量未提交绿地重构改动，生产部署使用 `railway up --service ...` 上传本地目录；两个服务通过 `WANGCHAO_RAILWAY_ROLE` 分发启动行为：`web` 跑 migration/seed 并启动 Next.js，`worker` 跳过 predeploy 并执行一轮 Node worker。
- Railway Web、Worker Cron 与 Source Discovery Cron 应连接同一个 Railway Postgres，并共享 `DATABASE_URL`、默认 workspace、AI 和 discovery 环境变量。
- `pnpm db:wait` 由 `scripts/wait-for-database.mjs` 提供，只从 `DATABASE_URL` 解析 host/port 并做 TCP 探测，不输出完整连接串。默认最多等待 180 秒，每 2 秒重试；可通过 `WANGCHAO_DB_WAIT_TIMEOUT_MS` 和 `WANGCHAO_DB_WAIT_INTERVAL_MS` 覆盖。
- 2026-07-06 已创建 Railway project `wangchao`，添加 `Postgres`、`wangchao-web` 和 `wangchao-worker` 服务；Web、Worker、Postgres 已迁移到 `southeast-asia`，实际 region ID 为 `asia-southeast1-eqsg3a`。Worker 当前是部署后执行一轮并停止，尚未通过 CLI 配置成定时 Cron。

## Prisma / Postgres 命令

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:seed
pnpm db:format
```

## 本地 Docker Postgres 验证

当前本机已有其他项目占用 `5432`，望潮本地测试使用 `55433` 映射到容器内 `5432`：

```bash
docker run -d \
  --name wangchao-postgres-local \
  -e POSTGRES_USER=wangchao \
  -e POSTGRES_PASSWORD=wangchao \
  -e POSTGRES_DB=wangchao \
  -p 127.0.0.1:55433:5432 \
  -v wangchao_postgres_data:/var/postgresql/data \
  postgres:16-alpine

DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:validate
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:generate
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:seed
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm worker:health
```

## 环境变量

`DATABASE_URL` 由 `.env_example` 提供占位模板，真实值不得提交。

### DB wait

- `WANGCHAO_DB_WAIT_TIMEOUT_MS` 可选，控制 `pnpm db:wait` 最长等待时间，默认 `180000`。
- `WANGCHAO_DB_WAIT_INTERVAL_MS` 可选，控制 `pnpm db:wait` 重试间隔，默认 `2000`。

### AI

- `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL_L1`、`AI_MODEL_L2` 用于 OpenAI-compatible AI 调用；source recommendation 当前使用 `AI_MODEL_L1`，未配置时走 deterministic fallback。

### Source Discovery

- `BRAVE_SEARCH_API_KEY` 是 Brave Search API BYOK；为空时 source discovery 跳过 `keyword-search` 渠道。
- `WANGCHAO_SEARCH_PROVIDER` 当前支持 `brave`，默认 `brave`，后续可接 Tavily/Serper/SearXNG。
- `WANGCHAO_DISCOVERY_HIGHSCORE_THRESHOLD` 控制高分事件反查阈值，默认 `0.7`。
- `WANGCHAO_DISCOVERY_LOOKBACK_DAYS` 控制高分事件反查时间窗，默认 `14`。
- `WANGCHAO_DISCOVERY_WEEKLY_LIMIT` 控制每轮每个 topic 最多写入候选源数量，默认 `5`。
- `WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT` 控制每轮最多探测多少条高分原文页，默认 `10`。
- `WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT` 控制每轮最多探测多少条 active source item，默认 `12`。
- `WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE` 控制每个 active item 最多探测多少条外链，默认 `3`。
- `WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS` 控制 discovery 网页/RSS 探测超时，默认 `5000`。

### Topic 创建

- `WANGCHAO_TOPIC_CREATE_SOURCE_LIMIT` 控制新建主题时从内置信源包最多写入多少个候选源，默认 `3`。
- `WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS` 控制新建主题时 RSS/Atom 候选源验证超时，默认 `2000`。

### 默认工作区

- `WANGCHAO_DEFAULT_ORGANIZATION_SLUG`、`WANGCHAO_DEFAULT_ORGANIZATION_NAME`、`WANGCHAO_DEFAULT_USER_EMAIL`、`WANGCHAO_DEFAULT_USER_NAME` 是当前个人版默认工作区/用户配置；真实商业化前必须替换为正式 auth/session provider。

### Seed Sources

- `WANGCHAO_SEED_SOURCES_URL` 指定多主题信源列表 JSON 的 URL（Gist raw 或任意公开 JSON），留空时默认拉本仓库 raw link `https://raw.githubusercontent.com/jerryisacat/wangchao/main/packages/db/seed-sources.json`。拉取失败时 fallback 到随部署 bundle 的本地 `packages/db/seed-sources.json`。
- `WANGCHAO_SEED_SOURCE_NAME`、`WANGCHAO_SEED_SOURCE_URL` 是旧单源模式：两者同时设置时优先生效，会内联成单 topic 单 source 的列表，跳过列表解析。
- `packages/db/seed-sources.json` 是仓库内维护的默认信源列表，schema：`{ version:1, topics:[{ name, description?, keywords?, sources:[{name,url}] }] }`。改这个文件后 push 即可在下次 seed 生效（前提是默认拉 raw link）。

## 测试与验证入口

- `pnpm smoke:web` 运行 Playwright smoke tests；默认单 worker 启动 `@wangchao/web` production server，避免真实 Server Action 与外部 RSS 验证并行互相干扰，因此需要先完成 `pnpm build`，并提供可用 `DATABASE_URL`。如已有服务可用，可设置 `PLAYWRIGHT_BASE_URL` 跳过内置 webServer。
- `apps/web/src/app/api/health/route.ts` 是 Web health endpoint，返回 web service 状态和数据库检查结果。
- `apps/worker/src/index.ts --health` 是 worker health check 入口，可通过根脚本 `pnpm worker:health` 调用。
- `docs/deployment.md` 记录当前 Railway 部署顺序、环境变量、服务配置、日志、备份和回滚策略。
- `railway.json` 是当前从本地目录上传部署时实际生效的 Railway root config。
- `deploy/railway/*.railway.json` 是 Railway Config as Code 示例；Web 和 Worker Cron 需要分别作为 Railway service 设置对应 config file path。

## 验证注意事项

- `pnpm approve-builds --all` 已用于批准当前依赖链中的 `esbuild`、`sharp`、`prisma` 和 `@prisma/engines` 构建脚本，结果写入 `pnpm-workspace.yaml`。
- Next.js web app 不使用 `next/font/google`，避免构建期访问外部字体网络。
- 外部客户端、数据库、Redis 或 SDK 后续必须 lazy init，避免 `next build` 在缺少 runtime env 时失败。
- 2026-07-06 已修复首版 migration 与 Prisma schema 的 `_BriefingEvents` 漂移；干净库已通过根命令 `pnpm db:migrate`，并生成 `_prisma_migrations` 记录。
- 2026-07-06 本地 Docker Postgres 已通过 `db:validate`、`db:generate`、`db:migrate`、`db:seed`、数据库写入 smoke test、Web `/api/health` 和 `worker:health`；浏览器创建主题 + RSS Server Action 已验证写入 Postgres。
- 当前环境曾出现公网 RSS 抓取 `https://hnrss.org/newest?points=100` 失败并记录 `TaskRun(FAILED)`；后续个人使用前需要用真实可访问 RSS 复测，或手动使用离线 fixture source 验证 worker 闭环。
- 2026-07-06 生产发现 `apps/web/src/app/page.tsx` 被 Next.js 静态预渲染，导致 Railway 上 `/api/health` database `ok` 但首页仍显示预览 fallback；已通过 `export const dynamic = "force-dynamic"` 修复，后续首页会读取运行时工作区数据。
- 2026-07-08 已补 Playwright smoke 用例覆盖首页搜索/主题/视图 URL 状态和事件详情入口；当前本机 Chromium 因 macOS sandbox `MachPortRendezvousServer` permission denied 无法启动，已用临时 Docker Postgres + production server + HTTP smoke 验证 `/api/health`、`/?q=OpenAI&view=high`、`/events/[eventId]` 和 `/exports/events/[eventId]`。
