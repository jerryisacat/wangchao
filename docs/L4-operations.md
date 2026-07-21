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
pnpm worker:task-runs
pnpm worker:source-discovery
pnpm worker:report-generation
pnpm smoke:web
```

`pnpm test` 会实际执行 `packages/core`、`packages/ai`、`packages/sources`、`packages/db`、`apps/worker` 和 Web 纯函数 fixture；除既有覆盖外，正文采集变更需验证 RSS embedded HTML→Markdown、Readability→Markdown、主动内容清理、X 不触发通用网络抓取、READY LLM 门禁、摘要标题复读/语言质量拒绝、正式简报只选 READY summary，以及 UI 状态文案。

Topic profile 或 analysis 输入变更后，应使用临时 Postgres 验证：更新后的 keywords/entities/include/exclude/importance、当前 Source name 与 Topic 当前 name/description 能从 `listFetchedItemsForAnalysis()` 进入 extraction input / `buildTopicProfileContext()`；使用错误 organizationId 调用 `updateTopic()` 必须失败。不要在真实工作区制造验证数据。

`@wangchao/db` 的普通 `pnpm test` 链式运行 repositories/workspace-auth/user-lifecycle、TaskRun schema 与 TaskRun repository fixtures；普通测试即使环境中存在 `DATABASE_URL` 也不会误触发专用 PostgreSQL suites。Better Auth migration replay 使用 `DATABASE_URL=... pnpm --filter @wangchao/db test:migration-replay`。TaskRun 并发验证必须额外显式设置 `RUN_TASK_RUN_PG_TESTS=1 WANGCHAO_DISPOSABLE_DATABASE=1`，且 DATABASE_URL 只允许 localhost/127.0.0.1、数据库名必须包含 `task_run_pg`，再执行 `pnpm --filter @wangchao/db test:task-run-pg`；该 suite 验证 active-idempotency、SKIP LOCKED claim、stale fencing、yield 与 exact-expiry reaper。

多组织 Worker 真实数据库验证使用 `RUN_ORGANIZATION_CYCLE_PG_TESTS=1 WANGCHAO_DISPOSABLE_DATABASE=1 pnpm --filter @wangchao/worker test:organization-pg`。`DATABASE_URL` 必须指向 localhost/127.0.0.1，数据库名必须包含 `organization_cycle_pg`，并由调用方预先执行 migrations。该 suite 验证 ACTIVE actor 枚举、tenant repository 与 destructive mutation fencing、A 失败/B 继续、真实 workspace pipeline，以及 TaskRun/UsageEvent/DeliveryLog 组织隔离；fixture 不连接外部 RSS/AI，MUTED source 与无凭证配置只验证本地 pipeline 的 graceful isolation。

Relevance 变更必须用 core fixture 覆盖：exclude 与正信号同时命中时 exclude 胜出且不生成 draft；仅 entity 或 includeScope 命中也能生成 event；entity match 保留到 event entities；无任何正信号仍被过滤。Worker filtered 分支必须把具体 rule 或 LLM `noiseReason` 写入 Item rawMetadata 和对应 extraction/relevance TaskRun output，而不是覆盖成泛化文案。

多来源或治理指标变更后，应在临时 Postgres 验证：同标题不同 URL 最终只有一个未归档 IntelligenceEvent；最新 Item 为 PRIMARY/ANALYZED，旧 Item 为 SECONDARY/DUPLICATE；source report 的 hit/noise/duplicate 与唯一 active event 数和 fixture 数据一致。

Worker/导出链路变更后，应在临时 Postgres 中至少验证 `TaskRun.type/status/attempt/maxAttempts/startedAt/finishedAt/output/errorMessage`。Durable `SOURCE_FETCH/SOURCE_DISCOVERY/CONTENT_FETCH` 还必须验证 `idempotencyKey/leaseOwner/leaseToken/leaseExpiresAt/heartbeatAt`：两个 claimant 不得获得同一行，旧 token complete/fail 必须影响 0 行，过期 lease 必须按预算恢复或终止。摘要 `CONTENT_FETCH` 另需核对 task 的 `topicId/itemId/eventId` 绑定、event-scoped active key、重复点击不重置 RUNNING 状态，以及 handler 只处理指定 Item。renew 返回 false 表示明确失去 ownership；renew 请求异常不直接判定丢失，后续 complete/fail 的 fencing 结果才是权威。TaskRun 与 fetch 子 cycle 日志不得保存/输出 raw message、URL 或 stack，只使用固定低基数 class。`pnpm worker:task-runs` 只 drain durable queue；默认 `pnpm railway:worker:start` 会先 drain queue，再继续既有 fetch cron。AI provider 失败但规则 fallback 成功时，应同时看到失败的 `AI_EVENT_EXTRACTION`、成功且 `llmFallback=true` 的 `AI_RELEVANCE`，并确认 `UsageEvent(type='AI_CALL').quantity` 包含最终失败的逻辑 adapter 调用（内部 HTTP retry 不重复计数）。

正文采集链路必须额外验证 `CONTENT_FETCH` TaskRun 与 `Item.contentStatus/contentSource/contentFetchedAt/contentErrorCode`；`CONTENT_FETCH_FAILED/CONTENT_INSUFFICIENT/CONTENT_UNSUPPORTED/AI_FAILED` 占位事件应在首页和详情可见、保留原文链接，但不得被 briefing、instant push、report evidence 或 semantic dedup 查询选中。详情页重新采集会原子写入 durable `CONTENT_FETCH` 与等待状态；下一轮 Worker 优先 drain queue，并对指定 Item 执行实际网络/AI 工作。

Briefing schema 变更后必须运行 `pnpm db:generate`、`pnpm db:validate` 和 migration 验证。

`0015_content_capture_status` 为 Item/IntelligenceEvent 增加非破坏性状态字段并回填既有非空 `rawContent` 为 `READY/LEGACY_TEXT`；部署后新条目会把该列作为安全 Markdown 使用。上线前应在 staging 执行 migration，并抽查既有纯文本快照仍能作为合法 Markdown 读取。

`0013_credentials_split` 执行前需确认目标库无并发写入：它将 Subscription 表上的 22 个凭证列迁移到新建的 OrganizationCredential 表（按 credentialType 分区），再 DROP 原列。迁移期间短暂持有 ACCESS EXCLUSIVE 锁。合理做法是在业务低峰窗前执行 `prisma migrate deploy`，并在 staging 先验证。该 migration 还删除了 `IntelligenceEvent.secondaryItemIds`、`DeliveryLog.idempotencyKey`、`UserItemState.dismissedAt` 三个冗余列——如已有数据依赖这些列，需先确认再部署。`0008_briefing_idempotency` 会在增加唯一索引前合并同一 `topicId + period + rangeStart` 的历史重复记录，保留最新简报，将既有 `ExportEvent` 指向保留记录，并合并 `_BriefingEvents` 关系；生产发布前不得跳过 migration/predeploy。

## Railway 部署脚本

```bash
pnpm railway:web:build
pnpm railway:web:start
pnpm railway:build
pnpm railway:build:web
pnpm railway:build:worker
pnpm railway:predeploy
pnpm railway:start
pnpm railway:worker:build
pnpm railway:worker:predeploy
pnpm railway:worker:start
pnpm worker:source-discovery
pnpm db:wait
pnpm db:deploy
```

说明：

- 部署主路径是 **GitHub push/merge → Railway 自动构建和部署**，不需要手动运行上述脚本（除非使用 `railway up` 本地 fallback）。详细运维操作见 `docs/railway-runbook.md`。
- `deploy/railway/web.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 Railway/Railpack 在 Web-only 构建时裁掉 `@wangchao/*` workspace 包；在 pre-deploy 阶段运行 `pnpm db:wait && pnpm db:deploy && pnpm db:seed`，先等待 Railway Postgres 私网端口可达，再执行 migration/seed，启动命令为 `pnpm railway:web:start`，健康检查路径为 `/api/health`。
- `deploy/railway/worker-cron.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 worker runtime 缺少 `@wangchao/*/dist`；在 pre-deploy 阶段运行 `pnpm railway:worker:predeploy`（即 `pnpm db:wait && pnpm db:deploy`），确保数据库可达且 migration 已应用后再启动；按 `0 * * * *` UTC 每小时执行一次 `pnpm railway:worker:start`。
- `deploy/railway/source-discovery-cron.railway.json` 使用 `pnpm railway:build` 执行完整 monorepo 构建，避免 source discovery runtime 缺少 `@wangchao/*/dist`；在 pre-deploy 阶段同样运行 `pnpm railway:worker:predeploy`；按 `0 2 * * 1` UTC 每周执行一次 `pnpm --filter @wangchao/worker source-discovery`。
- `pnpm railway:build:web` 和 `pnpm railway:build:worker` 是可选的 Turborepo filtered build 脚本，用于未来优化构建速度。当前 Railway config 仍使用 `pnpm railway:build`（完整构建），因为 Railpack per-service 构建可能裁掉 workspace `dist/` 输出（这是已发生的生产问题）。切换到 filtered build 的前提是在 Railway staging 环境验证 runtime 中 `@wangchao/*/dist` 完整存在。
- `railway.json` 是当前 CLI 本地上传部署入口（紧急 fallback）。两个服务通过 `WANGCHAO_RAILWAY_ROLE` 分发启动行为：`web` 跑 migration/seed 并启动 Next.js，`worker` 跳过 predeploy 并执行一轮 Node worker。root config 缺少 `healthcheckPath` 和 `cronSchedule`，不能替代 service-level config 作为长期生产配置。
- Railway Web、Worker Cron 与 Source Discovery Cron 应连接同一个 Railway Postgres，并共享 `DATABASE_URL`（通过 Railway service reference 注入）、默认 workspace、AI 和 discovery 环境变量。三个服务的 predeploy 都会运行 `db:wait && db:deploy`，Prisma `migrate deploy` 是幂等的，已应用的 migration 不会重复执行，因此多服务并行 predeploy 不会冲突。详细环境变量矩阵见 `docs/railway-runbook.md` §5。
- `pnpm db:wait` 由 `scripts/wait-for-database.mjs` 提供，只从 `DATABASE_URL` 解析 host/port 并做 TCP 探测，不输出完整连接串。默认最多等待 180 秒，每 2 秒重试；可通过 `WANGCHAO_DB_WAIT_TIMEOUT_MS` 和 `WANGCHAO_DB_WAIT_INTERVAL_MS` 覆盖。
- 2026-07-06 已创建 Railway project `wangchao`，添加 `Postgres`、`wangchao-web` 和 `wangchao-worker` 服务；Web、Worker、Postgres 已迁移到 `southeast-asia`，实际 region ID 为 `asia-southeast1-eqsg3a`。

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

### 凭证加密

- `ENCRYPTION_KEY` Required when API keys are configured via Admin backend. Must be 32 bytes as UTF-8 string or 64 hex characters. Generate with `openssl rand -hex 32`。
- `ENCRYPTION_KEY` 用于 Admin 后台配置的 API Key 加密存储，算法为 AES-256-GCM；Worker 运行时从 DB 读取并解密 Key -> 注入 adapter -> 调用完成后丢弃明文，不写入日志。
- `ENCRYPTION_KEY` 未设置时 Admin 后台无法保存 API Key，系统只能使用环境变量 fallback。

### Admin 后台 API Key 配置

- API Key（AI provider、搜索 provider）通过 Admin 后台 `/admin/settings` 配置（需要 OWNER/ADMIN 权限），不直接通过环境变量管理。
- 环境变量（`AI_API_KEY`、`BRAVE_SEARCH_API_KEY` 等）仅作为 DB 未配置时的 fallback，不应作为主配置方式。
- API Key 在数据库中使用 AES-256-GCM 加密存储，加密密钥来自 `ENCRYPTION_KEY` 环境变量。
- Admin 后台不显示完整 API Key，仅展示脱敏 hint（如 `sk-...xyz`）；可新增或覆盖 Key，但不可查看。
- Worker 运行时优先从 DB 读取并解密 Key，DB 未配置时 fallback 到环境变量。
- AI 凭证表单支持"刷新模型列表"按钮，嗅探 OpenAI-compatible 端点（`GET /models`）的可用模型列表，填充为下拉选择框；支持"自定义..."选项回退到手填模型名。
- 自定义 provider 的凭证可通过"我已确认此 Key 有效" checkbox 手动确认后保存，无需通过自动测试验证。
- AI 凭证连接测试优先使用 `GET /models` 端点；若返回 404/405/415/501 或超时，自动回退到 `POST /chat/completions`（最小 payload，`max_tokens: 1`）兜底验证。测试时会产生极少量 API 费用，UI 已添加提示。

### AI

- `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL_L1`、`AI_MODEL_L2` 用于 OpenAI-compatible AI 调用；当前作为 Admin 后台 `/admin/settings` 未配置时的 fallback。source recommendation 当前使用 `AI_MODEL_L1`，未配置时走 deterministic fallback。

### Telegram 投递

- `TELEGRAM_API_BASE` 可选，控制 Telegram Bot API base URL，默认 `https://api.telegram.org`。自建 Telegram Bot API server 或需走代理时可覆盖。
- Telegram 凭证（Bot Token + Chat ID）通过 Admin 后台 `/admin/settings` Telegram tab 配置（需要 OWNER/ADMIN 权限），Bot Token 使用 AES-256-GCM 加密存储，不通过环境变量管理。
- Worker `runTelegramDeliveryCycle` 在 fetch cycle 末尾自动运行：读取已配置凭证，查找近 2 小时未投递的 Briefing，通过 Telegram Bot API 发送，每条 Briefing 每渠道最多一条 DeliveryLog（幂等）。
- `pnpm worker:instant-push` 独立运行即时推送；Railway 使用 `/deploy/railway/instant-push-cron.railway.json` 每 15 分钟调度。
- `WANGCHAO_INSTANT_PUSH_SCORE_THRESHOLD` 默认 `90`（0-100），`WANGCHAO_INSTANT_PUSH_MAX_PER_CYCLE` 默认 `10`，`WANGCHAO_INSTANT_PUSH_MAX_ATTEMPTS` 默认 `3`。
- Railway 必须创建独立 service、绑定上述 Config as Code 路径并引用 `DATABASE_URL`/`ENCRYPTION_KEY`；提交 JSON 不会自动创建 service。

### Source Discovery

- `BRAVE_SEARCH_API_KEY` 是 Brave Search API BYOK；当前作为 Admin 后台 `/admin/settings` 未配置时的 fallback。为空时 source discovery 跳过 `keyword-search` 渠道。
- `WANGCHAO_SEARCH_PROVIDER` 搜索 provider 类型，默认 `brave`，支持 `brave`/`tavily`/`serper`/`searxng`。
- `TAVILY_API_KEY` Tavily 搜索 API Key（当 `WANGCHAO_SEARCH_PROVIDER=tavily` 时需要）。当前作为 Admin 后台 `/admin/settings` 未配置时的 fallback。
- `SERPER_API_KEY` Serper 搜索 API Key（当 `WANGCHAO_SEARCH_PROVIDER=serper` 时需要）。当前作为 Admin 后台 `/admin/settings` 未配置时的 fallback。
- `SEARXNG_BASE_URL` SearXNG 自建实例 base URL（当 `WANGCHAO_SEARCH_PROVIDER=searxng` 时需要），默认 `http://localhost:8080`，不需要 API Key。
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

### Auth（Better Auth）

- `BETTER_AUTH_SECRET` Required for auth。设置后激活 Better Auth（email/password + session）：`apps/web/src/proxy.ts` 在进入受保护页面/API/Server Action 前调用 Better Auth `getSession()` 验证数据库 Session，不能只凭 cookie 存在放行；页面无 Session/Session 过期时跳转 `/login?next=<原站内路径+query>`，API/Action 返回 `401 UNAUTHENTICATED`，认证依赖不可用返回 `503 AUTH_UNAVAILABLE`。未设置时 proxy 跳过认证门，`getSessionWorkspace()` fallback 到 `ensureDefaultWorkspace()`，使用默认 workspace/user，不要求登录。
- `BETTER_AUTH_URL` Required for auth。Better Auth 的 base URL（如 `https://wangchao.jerryiscat.one`），用于 session callback URL 和邮件链接生成。
- 当 `BETTER_AUTH_SECRET` 未设置时，`/login` 和 `/register` 页面不作为访问前置条件，应用直接使用默认 workspace，适合个人版和本地开发。发布前必须同时 smoke `/` 与 `/sources` 为 200，防止误把 self-hosted 模式锁在登录页外。
- 公开路由为 `/login`、`/register`、`/pricing`、`/api/auth/*`、`/api/health` 和 CCPayment/Stripe 签名 webhook；checkout、管理页、导出和产品工作台均受保护。新增公开入口时必须显式评审 `auth-access.ts` allowlist，禁止宽泛放行 `/api/*`。
- 登录 `next` 只接受站内绝对 path；绝对 URL、`//`、反斜杠和控制字符统一回退 `/`。不要在页面或 Action 中直接 `router.push(searchParams.get("next"))`。
- production 请求由 `apps/web/src/proxy.ts` 生成随机 CSP nonce，并通过 request header 交给 Next.js 为 framework/React Flight 内联脚本加 nonce；redirect/401/503 同样保留 CSP 与全部安全响应头。根 layout 使用 request-time rendering，因为静态预渲染页面无法获得每请求 nonce。不要把 `script-src` 简化回只有 `'self'`，也不要以 `'unsafe-inline'` 作为长期修复。

### 支付（CCPayment + Stripe）

- `CCPAYMENT_APP_ID` Optional。CCPayment 加密支付 provider 的 App ID。配置后启用 CCPayment 支付（创建订单、查询状态、webhook 签名验证）。未配置时支付功能不可用。
- `CCPAYMENT_APP_SECRET` Optional。CCPayment App Secret，用于 webhook 签名验证。需在 `/admin/settings` CCPayment tab 中配置，webhook URL 为 `/api/billing/ccpayment/webhook`。
- `STRIPE_SECRET_KEY` Optional（注释/预留）。Stripe 支付的 Secret Key。当前 `/api/billing/stripe/checkout` 和 `/api/billing/stripe/webhook` 为骨架实现，未配置时返回 placeholder。完整 Stripe 集成待后续阶段实现。
- `STRIPE_WEBHOOK_SECRET` Optional（注释/预留）。Stripe webhook 签名验证 secret。
- `STRIPE_PUBLISHABLE_KEY` Optional（注释/预留）。Stripe 前端 publishable key。

### Worker 抓取

- `WANGCHAO_FETCH_CONCURRENCY` 控制每轮 worker 并发抓取 RSS source 数量，默认 `5`。
- `WANGCHAO_FETCH_BACKOFF_BASE_MS` 控制重试指数退避的基准延迟毫秒数，默认 `1000`。实际延迟为 `BASE * 2^(attempt-1) * jitter(0.5-1.0)`。
- 正文采集不需要新增环境变量：RSS embedded content 优先；普通网页使用 Readability + 安全 Markdown 转换；X/Twitter 暂不接入 API，状态为 `UNSUPPORTED`，用户仍可打开原文。

### 信源治理

- `WANGCHAO_AUTO_MUTE_THRESHOLD` 控制连续失败自动静音阈值，默认 `10`。ACTIVE source 连续抓取失败次数超过该阈值时自动转为 `MUTED`。
- `WANGCHAO_CANDIDATE_OBSERVATION_ENABLED` 控制候选源低频观察 fetch 是否启用，默认 `false`。启用后 worker 会按低频周期探测候选源，用于在治理审核前收集质量信号。
- `WANGCHAO_CANDIDATE_OBSERVATION_CONCURRENCY` 控制候选源观察的并发上限，默认 `3`。实际并发取 `min(WANGCHAO_FETCH_CONCURRENCY, 此值)`，不会超过主抓取并发。

### Seed Sources

- `WANGCHAO_SEED_SOURCES_URL` 指定多主题信源列表 JSON 的 URL（Gist raw 或任意公开 JSON），留空时默认拉本仓库 raw link `https://raw.githubusercontent.com/jerryisacat/wangchao/main/packages/db/seed-sources.json`。拉取失败时 fallback 到随部署 bundle 的本地 `packages/db/seed-sources.json`。
- `WANGCHAO_SEED_SOURCE_NAME`、`WANGCHAO_SEED_SOURCE_URL` 是旧单源模式：两者同时设置时优先生效，会内联成单 topic 单 source 的列表，跳过列表解析。
- `packages/db/seed-sources.json` 是仓库内维护的默认信源列表，schema：`{ version:1, topics:[{ name, description?, keywords?, sources:[{name,url}] }] }`。改这个文件后 push 即可在下次 seed 生效（前提是默认拉 raw link）。

## 测试与验证入口

- `pnpm smoke:web` 运行 Playwright smoke tests；默认单 worker 启动 `@wangchao/web` production server，避免真实 Server Action 与外部 RSS 验证并行互相干扰，因此需要先完成 `pnpm build`，并提供可用 `DATABASE_URL`。如已有服务可用，可设置 `PLAYWRIGHT_BASE_URL` 跳过内置 webServer（也支持指向 Railway public URL 做生产 smoke）。用例覆盖搜索/筛选、情报详情（含忽略与 category up/down 入口）、收藏取消、主题创建/管理、Admin Tabs/客户端校验；`tests/smoke/responsive.spec.ts` 额外覆盖应用页面在 320/375/414/768/1024/1440px 下的超框、44px 触达目标和主按钮对比度。
- `node scripts/http-smoke.mjs` 运行轻量 HTTP smoke（无需 Chromium），验证关键路由返回 200。通过 `BASE_URL` 指向目标环境（生产或本地）。
- `apps/web/src/app/api/health/route.ts` 是 Web health endpoint，返回 web service 状态和数据库检查结果。
- `apps/worker/src/index.ts --health` 是 worker health check 入口，可通过根脚本 `pnpm worker:health` 调用。Worker 每次 cycle 执行会输出结构化 JSON 日志（`cycle-start` + `cycle-end`），包含 cycle type、timestamp、duration、status 和所有计数器。
- `docs/deployment.md` 记录当前 Railway 部署顺序、环境变量、服务配置、日志、备份和回滚策略。
- `docs/railway-runbook.md` 是 Railway 生产运维主参考：GitHub→Railway 主路径、Cron 运行观测、Postgres 备份/PITR、发布验证 smoke/回滚 runbook、环境变量矩阵、CI/CD。
- `railway.json` 是 `railway up` 本地紧急 fallback 使用的 Railway root config（通过 `WANGCHAO_RAILWAY_ROLE` 分发）。
- `deploy/railway/*.railway.json` 是 Railway Config as Code；Web、Worker Cron、Source Discovery Cron、Instant Push Cron 和 Report Cron 分别作为独立 Railway service 设置对应 config file path。
- `.github/workflows/ci.yml` 是 GitHub Actions CI workflow，在 push/PR 到 `master` 时运行 lint、typecheck、build、test 和 Prisma schema validate。

## 验证注意事项

- `pnpm approve-builds --all` 已用于批准当前依赖链中的 `esbuild`、`sharp`、`prisma` 和 `@prisma/engines` 构建脚本，结果写入 `pnpm-workspace.yaml`。
- Next.js web app 不使用 `next/font/google`，避免构建期访问外部字体网络。
- 外部客户端、数据库、Redis 或 SDK 后续必须 lazy init，避免 `next build` 在缺少 runtime env 时失败。
- 2026-07-06 已修复首版 migration 与 Prisma schema 的 `_BriefingEvents` 漂移；干净库已通过根命令 `pnpm db:migrate`，并生成 `_prisma_migrations` 记录。当前共 10 个 migration，最新为 `0010_subscription_plan_auth`（新增 Plan/SubscriptionStatus 枚举、PaymentInvoice/Account/Session 模型、Subscription 表扩展 BYOK/CCPayment/Stripe 字段）。
- 2026-07-06 本地 Docker Postgres 已通过 `db:validate`、`db:generate`、`db:migrate`、`db:seed`、数据库写入 smoke test、Web `/api/health` 和 `worker:health`；浏览器创建主题 + RSS Server Action 已验证写入 Postgres。
- 当前环境曾出现公网 RSS 抓取 `https://hnrss.org/newest?points=100` 失败并记录 `TaskRun(FAILED)`；后续个人使用前需要用真实可访问 RSS 复测，或手动使用离线 fixture source 验证 worker 闭环。
- 2026-07-06 生产发现 `apps/web/src/app/page.tsx` 被 Next.js 静态预渲染，导致 Railway 上 `/api/health` database `ok` 但首页仍显示预览 fallback；已通过 `export const dynamic = "force-dynamic"` 修复，后续首页会读取运行时工作区数据。
- 2026-07-10 已安装与 Playwright 匹配的 Chromium，并在沙箱外通过本地 Prisma Postgres + 干净 `next build` / `next start` 完成桌面/移动交互 smoke；同时通过 11 个页面 × 6 档宽度的响应式矩阵。不要让 `next dev` 与 `next build` / `next start` 同时使用同一个 `apps/web/.next`，并发写入会制造无效或不一致的客户端产物。

### Auth E2E 测试

Auth 端到端测试覆盖 Better Auth 注册、自动登录、session reload 恢复、登出/重登录、OWNER Membership、多用户 Organization 隔离、未登录访问 `/`/`/sources`/`/admin/settings` 的安全 `next` 跳转、受保护 API `401`、站外 `next` 拒绝，以及 cookie 仍在但数据库 Session 已删除时拒绝访问。redirect/401 还断言安全响应头未丢失；结束时自动清理 fixture。desktop/mobile project 使用 RFC 5737 TEST-NET 地址隔离 Better Auth 内存限流 bucket，不修改产品限流配置。

启用条件：
- 服务端设置 `BETTER_AUTH_SECRET`，或测试进程设置 `PLAYWRIGHT_AUTH_ENABLED=1`
- 设置 `DATABASE_URL`（指向已有 migration 的 Postgres）
- 可选：设置 `PLAYWRIGHT_AUTH_RUN_ID` 避免测试用户冲突

运行命令：
```bash
# 启动 Docker Postgres（如尚未启动）
docker run -d --name wangchao-smoke-pg -e POSTGRES_USER=wangchao -e POSTGRES_PASSWORD=wangchao -e POSTGRES_DB=wangchao -p 5433:5432 postgres:16-alpine

# 执行 migration
DATABASE_URL=postgresql://wangchao:wangchao@localhost:5433/wangchao?schema=public pnpm --filter @wangchao/db exec prisma migrate deploy

# 运行 auth e2e 测试
BETTER_AUTH_SECRET=test-secret BETTER_AUTH_URL=http://localhost:3000 DATABASE_URL=postgresql://wangchao:***@localhost:5433/wangchao?schema=public PLAYWRIGHT_AUTH_ENABLED=1 pnpm exec playwright test tests/smoke/auth.spec.ts
```

未配置 `BETTER_AUTH_SECRET` 且未设置 `PLAYWRIGHT_AUTH_ENABLED=1`，或缺少 `DATABASE_URL` 时，auth 测试自动 skip。浏览器 client 始终使用同源 `/api/auth`；`BETTER_AUTH_URL` 仅用于服务端 Better Auth base URL，必须与测试 Origin 一致。
