# Railway Operations Runbook

> 本文件是 Railway 生产运维的主参考，覆盖 GitHub 自动部署、Cron 运行观测、Postgres 备份、发布验证和回滚策略。
>
> 部署基础信息见 `docs/deployment.md` 和 `docs/railway-deployment.md`；命令和环境变量见 `docs/L4-operations.md`。

## 1. 部署主路径：GitHub 自动同步到 Railway (#19)

### 1.1 主路径定义

望潮的生产发布方式是 **GitHub push/merge 到 `master` → Railway 自动检测变更 → 触发对应 service 重新构建和部署**。

六个 Railway application service 分别使用独立的 Config as Code 文件：

| Railway service | Config file | 触发条件 |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | `master` 分支有 push/merge |
| Queue Worker | `deploy/railway/queue-worker.railway.json` | `master` 分支有 push/merge |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | `master` 分支有 push/merge |
| Source Discovery Cron | `deploy/railway/source-discovery-cron.railway.json` | `master` 分支有 push/merge |
| Instant Push Cron | `deploy/railway/instant-push-cron.railway.json` | `master` 分支有 push/merge |
| Report Cron | `deploy/railway/report-cron.railway.json` | `master` 分支有 push/merge |

Railway GitHub integration 会监听关联 repo 的默认分支变更，自动为每个配置了 GitHub source 的 service 创建新 deployment。

### 1.2 设置 GitHub 自动部署

1. 在 Railway project 中，为每个 service 的 **Source** 设置为 GitHub repo `jerryisacat/wangchao`，分支 `master`。
2. 在每个 service settings 中设置 **Config file path**：
   - Web: `deploy/railway/web.railway.json`
   - Queue Worker: `deploy/railway/queue-worker.railway.json`
   - Worker Cron: `deploy/railway/worker-cron.railway.json`
   - Source Discovery Cron: `deploy/railway/source-discovery-cron.railway.json`
   - Instant Push Cron: `deploy/railway/instant-push-cron.railway.json`
   - Report Cron: `deploy/railway/report-cron.railway.json`
3. 确认每个 service 都有正确的环境变量（见 §5 环境变量矩阵）。
4. 测试：push 一个小改动到 `master`，确认 Railway 为六个 service 各创建一个 deployment。

### 1.3 哪些 commit 会触发自动部署

**所有 push 到 `master` 分支的 commit 都会触发 Railway 自动部署**（六个 service 同时）。因此：

| 改动类型 | 是否触发部署 | 提交前验证要求 |
|---|---|---|
| 代码功能变更 | 是 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` |
| DB schema / migration | 是 | 上述四件套 + `pnpm db:validate` + migration 前备份检查（见 §4） |
| Railway config / 环境变量 | 是 | 上述四件套 + 确认 predeploy/start command 正确 |
| 仅文档变更（`.md` 文件） | 是* | 建议也跑 typecheck + lint |
| 仅测试变更 | 是* | 建议也跑 typecheck + lint |

\* *Railway 会对每个 push 触发构建，即使改动不影响 runtime。这是 Railway GitHub integration 的默认行为。*

### 1.4 本地 `railway up` 降级为紧急 fallback

本地 `railway up --service ...` 不再是常规发布路径，仅在以下场景使用：

- GitHub integration 故障，需要紧急发布修复
- 需要在本地验证 Railway 构建行为
- 测试尚未 push 的改动在 Railway 上的表现

使用 root `railway.json`（通过 `WANGCHAO_RAILWAY_ROLE` 分发）进行本地上传时，必须设置：

```bash
# Web
WANGCHAO_RAILWAY_ROLE=web railway up --service wangchao-web

# Worker
WANGCHAO_RAILWAY_ROLE=worker railway up --service wangchao-worker

# Queue Worker
WANGCHAO_RAILWAY_ROLE=queue-worker railway up --service wangchao-queue-worker
```

root `railway.json` 缺少 `healthcheckPath` 和 `cronSchedule`，不能替代 service-level config 作为长期生产配置。

### 1.5 构建优化策略 (#24)

当前六个 Railway service 的 build command 均为 `pnpm railway:build`（完整 monorepo 构建）。这是刻意选择的安全路径：

**为什么用完整构建**：Railpack 在 per-service 构建时可能裁掉 `@wangchao/*/dist`，导致 runtime 找不到 workspace 包。这个生产问题已经发生过，完整构建是可靠 workaround。

**可选优化路径（尚未启用）**：

| 脚本 | 命令 | 构建范围 | 预期收益 |
|---|---|---|---|
| `pnpm railway:build` | `pnpm db:generate && pnpm build` | 全部 6 个包 | 当前生产默认，最安全 |
| `pnpm railway:build:web` | `turbo run build --filter=@wangchao/web` | web + 依赖 (core/db/sources/ai) | 减少约 1 个包 |
| `pnpm railway:build:worker` | `turbo run build --filter=@wangchao/worker` | worker + 依赖 (core/db/sources/ai) | 减少约 1 个包 |

**切换到 filtered build 的前提条件**：
1. 在 Railway staging 环境验证 Railpack runtime 中 `@wangchao/*/dist` 完整存在。
2. 确认 filtered build 的产物不缺少 workspace 包。
3. 对比构建时间是否有明确下降。

在以上条件未满足前，保持 `pnpm railway:build` 作为 Railway config 中的 build command。

## 2. Worker Cron 运行与观测 (#20, #3)

### 2.1 Cron 调度配置

| Service | Schedule (UTC) | Start command | 预期行为 |
|---|---|---|---|
| Queue Worker | —（常驻） | `pnpm railway:queue-worker:start` | 持续消费 durable TaskRun；空闲轮询，异常自动重启，部署时优雅退出 |
| Worker Cron | `0 * * * *` (每小时) | `pnpm railway:worker:start` | 执行一轮 fetch→analysis→briefing→governance cycle，完成后退出 |
| Source Discovery Cron | `0 2 * * 1` (每周一 02:00) | `pnpm --filter @wangchao/worker source-discovery` | 执行一轮候选源发现，完成后退出 |
| Instant Push Cron | `*/15 * * * *` | `pnpm worker:instant-push` | 扫描已启用组织、原子 claim 高分事件、发送或记录重试后退出 |
| Report Cron | `*/10 * * * *` | `pnpm worker:report-generation` | 扫描 PENDING 状态的 Report 并逐个生成，完成后退出 |

Railway Cron 的行为：按 schedule 启动容器 → 执行 start command → 进程退出后容器停止 → 下一个 schedule 周期重新启动。

### 2.2 启用 Cron 的步骤 (#3)

1. 确认 `deploy/railway/worker-cron.railway.json` 中有 `"cronSchedule": "0 * * * *"`。
2. 在 Railway dashboard 中确认 Worker Cron service 的 config file path 指向该文件。
3. 确认 service 设置中 **Cron** 已启用（Railway dashboard → Service Settings → Crone Job）。
4. 对 Source Discovery Cron 重复上述步骤，使用 `source-discovery-cron.railway.json`。
5. 验证：等待下一个 cron 周期，在 Railway logs 中确认容器启动并执行。

### 2.3 Worker 结构化日志

Worker 每次执行会输出两行结构化 JSON 日志（到 stdout），格式：

**Cycle 开始**：
```json
{"event":"cycle-start","cycle":"fetch","timestamp":"2026-01-01T00:00:00.000Z"}
```

**Cycle 结束**：
```json
{"event":"cycle-end","cycle":"fetch","timestamp":"2026-01-01T00:05:00.000Z","durationMs":300000,"status":"ok","result":{"fetchedSources":3,"insertedOrUpdatedItems":20,"analyzedItems":15,"createdOrUpdatedEvents":5,"filteredItems":10,"generatedBriefings":1,"generatedWeeklyBriefings":0,"generatedMonthlyBriefings":0,"updatedPreferenceMemories":0,"recordedSourceObservations":3,"failedSources":0}}
```

**Cycle 类型**：
- `fetch` — 默认 worker cycle（fetch → analysis → briefing → governance）
- `queue-worker` — 常驻 durable TaskRun consumer；另输出 `queue-drain` 与 `queue-worker-heartbeat`
- `source-discovery` — 信源发现 cycle
- `instant-push` — 即时推送 cycle
- `report-generation` — 报告生成 cycle
- `health` — 健康检查

**Status 值**：
- `ok` — 正常完成
- `degraded` — 完成但有降级（如 DB 不可达）
- `error` — 异常退出

### 2.4 双层观测

Railway 提供第一层观测：

| 指标 | 查看位置 |
|---|---|
| Deployment status | Railway dashboard → Service → Deployments |
| Container logs | Railway dashboard → Service → Logs（或 `railway logs --service ...`） |
| Cron 执行历史 | Railway dashboard → Service → Deployments（每个 cron 周期 = 一个 deployment） |
| CPU / Memory | Railway dashboard → Service → Metrics |

数据库提供第二层观测：

| 指标 | 查询方式 |
|---|---|
| TaskRun 状态 | `SELECT type, status, startedAt, finishedAt, errorMessage FROM "TaskRun" ORDER BY "startedAt" DESC LIMIT 20;` |
| UsageEvent 用量 | `SELECT type, subjectType, quantity, "createdAt" FROM "UsageEvent" ORDER BY "createdAt" DESC LIMIT 20;` |
| 最近 fetch cycle 结果 | 查看最新 `TaskRun(type='SOURCE_FETCH')` 的 output |
| AI 调用量 | 查看最近 `UsageEvent(type='AI_CALL')` |

### 2.5 Cron 排障 Runbook

| 症状 | 可能原因 | 排查步骤 |
|---|---|---|
| Cron 不触发 | Railway service 未配置为 Cron Job | 检查 Railway dashboard 中 service 是否有 Cron 标签 |
| Cron 触发但立即失败 | start command 错误或 workspace dist 缺失 | 查看 Railway logs 确认 `node dist/index.js` 能否找到 `@wangchao/*/dist` |
| Deployment crashed | DB 不可达 | 查看 logs 是否有 Prisma connection error；确认 `DATABASE_URL` service reference 正确 |
| RSS 超时 | 上游 RSS 服务不可达 | 查看 TaskRun output 中 `failedSources` 计数；RSS 超时是预期行为，重试 3 次后跳过 |
| AI key 缺失 | `AI_API_KEY` 或 Admin 后台 API Key 未配置 | Worker 会 fallback 到 deterministic rules；查看 `UsageEvent(type='AI_CALL')` 是否为 0 |
| Source discovery 静默降级 | `BRAVE_SEARCH_API_KEY` 缺失 | 查看结构化日志中 `skippedKeywordSearch: true`；keyword 渠道被跳过但不阻塞其他渠道 |

## 3. 发布验证与健康检查 (#22)

### 3.1 发布后验证顺序

```
1. Railway deployment status → 确认 build/predeploy/start 成功
2. /api/health → 确认 database ok
3. 关键路由 HTTP smoke → 确认页面可访问
4. Worker health / 最近 TaskRun → 确认 cron 正常
```

### 3.2 Web health check

Railway Web service 使用 `healthcheckPath: /api/health`，失败会阻止错误版本稳定上线。

```bash
# 生产
curl -fsS https://wangchao-web-production.up.railway.app/api/health

# 本地
curl -fsS http://127.0.0.1:3000/api/health
```

返回 JSON：
```json
{
  "service": "wangchao-web",
  "status": "ok",
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "checks": {
    "database": { "status": "ok" }
  }
}
```

DB 不可达时返回 HTTP 503 和 `status: "degraded"`。`DATABASE_URL` 未设置时 database check 为 `skipped`（本地开发模式）。

### 3.3 Worker health check

```bash
pnpm worker:health
# 或在生产环境查看最近一次 cron deployment logs
```

### 3.4 HTTP Smoke Test

#### 使用 Playwright（本地或 CI）

```bash
# 默认：自动启动本地 web server
pnpm smoke:web

# 指定 Railway public URL（生产 smoke）
PLAYWRIGHT_BASE_URL=https://wangchao-web-production.up.railway.app pnpm smoke:web
```

设置 `PLAYWRIGHT_BASE_URL` 后 Playwright 不会启动本地 web server，而是直接面向指定 URL 运行测试。

#### 轻量 HTTP Smoke（无需 Chromium）

在无法启动 Chromium 的环境，可用以下命令快速验证关键路由的 HTTP 状态：

```bash
# 生产 HTTP smoke
BASE_URL=https://wangchao-web-production.up.railway.app \
  node scripts/http-smoke.mjs

# 本地
BASE_URL=http://127.0.0.1:3000 \
  node scripts/http-smoke.mjs
```

HTTP smoke 脚本验证以下路由返回 200：
- `/` — 首页
- `/api/health` — 健康检查
- `/topics` — 主题列表
- `/sources` — 信源列表
- `/briefings` — 简报列表
- `/saved` — 收藏列表
- `/preferences` — 偏好设置

### 3.5 回滚策略

#### App 回滚（首选）

Railway 支持一键回滚到上一个 deployment：

```bash
# CLI 回滚
railway rollback --service wangchao-web

# 或在 Railway dashboard 中
# Service → Deployments → 选择上一个成功的 deployment → Redeploy
```

App 回滚不需要 DB migration 回滚，前提是 **migrations 保持 forward-compatible**（见 §4.3）。

#### DB Migration 回滚（需评审）

- Prisma migrations 进入版本控制，生产只执行 `migrate deploy`（仅 forward）。
- Destructive down migration 需要人工评审和数据备份。
- 如果 migration 引入了 forward-incompatible 变更（如 drop column），需要：
  1. 先从备份恢复数据库到 migration 前状态。
  2. 再回滚 app deployment。

### 3.6 发布失败判断

| 失败阶段 | 表现 | 处理 |
|---|---|---|
| Build failed | Railway deployment 卡在 build 步骤 | 查看 build logs；通常是 TS 编译错误或依赖缺失 |
| Predeploy failed | `pnpm railway:web:predeploy` 失败 | 先检查 commercial mode/secret/HTTPS URL，再确认 Postgres 与 migration |
| Healthcheck failed | `healthcheckPath: /api/health` 超时或返回 503 | 确认 Next.js、DB 与 `checks.authentication` 均正常 |
| Runtime crashed | 进程启动后立即退出 | 查看 Railway logs；确认 `dist/` 输出完整 |
| DB unavailable | Prisma connection error | 确认 Railway Postgres service 运行中；确认 `DATABASE_URL` 正确 |

## 4. Postgres 备份与 Migration 安全 (#21)

### 4.1 备份策略

Railway managed Postgres 提供内置备份能力。当前策略：

| 项目 | 策略 | 责任人 |
|---|---|---|
| 备份方式 | Railway Postgres service 的 Backup 功能（dashboard 或 CLI） | 仓库维护者 |
| 备份频率 | Railway 默认（参考 Railway 文档确认当前频率） | 仓库维护者 |
| 恢复方式 | Railway dashboard → Postgres → Backups → Restore | 仓库维护者 |
| PITR | 如 Railway 支持，优先使用 PITR 恢复到精确时间点 | 仓库维护者 |

**重要**：用户反馈、阅读状态、偏好和简报历史不可随意丢失。RSS 可以重抓，但用户产生的数据不能恢复。

### 4.2 Migration 前检查清单

每次提交涉及 DB schema 变更的 commit 前：

1. **确认备份可用**：在 Railway dashboard 中确认最近一次 Postgres backup 成功。
2. **本地验证**：`pnpm db:validate && pnpm db:migrate`（在干净 Docker Postgres 上）。
3. **幂等性确认**：`pnpm db:deploy` 是幂等的（`migrate deploy` 跳过已应用的 migration），多服务并行 predeploy 不会冲突。
4. **Forward-compatible 检查**：确认 migration 不破坏正在运行的旧版本 app（避免 deploy 期间的服务中断）。
5. **Destructive migration 特殊审批**：任何包含 `DROP TABLE`、`DROP COLUMN` 或数据删除的 migration 需要人工确认，并在 commit message 中标注。

### 4.3 Forward-compatible migration 原则

- **新增列**：安全的，旧 app 忽略新列。
- **删除列**：不安全的，必须先发布不引用该列的 app 版本，确认稳定后再删列。
- **重命名列**：不安全的，应分两步（先加新列 + dual-write，再删旧列）。
- **新增表**：安全的。
- **删除表**：不安全的，需要人工审批。

### 4.4 恢复演练

定期（建议每季度）执行一次恢复演练：

1. 从 Railway Postgres backup 恢复到一个临时 Postgres 实例（或 Railway staging 环境）。
2. 验证 `/api/health` database ok。
3. 验证 `pnpm worker:health` 正常。
4. 验证关键数据可读（首页、主题列表、简报列表）。
5. 记录演练结果到 `DEVELOPE_LOGS.md`。

### 4.5 数据安全规则

- **生产数据库不得手改**。所有 schema 变更通过 Prisma migration。
- **生产数据不得直接导出到公开仓库**。`data/`、生成 JSON、数据库 dump 不提交。
- **日志不得输出密钥、认证 URL、敏感 headers、完整连接串**。
- **`pnpm db:wait` 只输出 host:port**，不输出完整 `DATABASE_URL`。

## 5. 环境变量矩阵与 Secret 管理 (#23)

### 5.1 Railway Service 环境变量矩阵

| Variable | Web | Queue Worker | Worker Cron | Discovery | Instant Push | Report | Source |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | ✅ ref | ✅ ref | ✅ ref | ✅ ref | ✅ ref | ✅ ref | Railway Postgres |
| 默认组织/用户变量 | self-hosted | self-hosted | self-hosted | self-hosted | self-hosted | self-hosted | 商用不作为客户身份 |
| `ENCRYPTION_KEY` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 手动设置 |
| `WANGCHAO_QUEUE_*` | — | 可选 | — | — | — | — | 有安全默认值 |
| AI provider fallback | — | ✅ | ✅ | 可选 | — | ✅ | Admin 后台优先 |
| Search provider fallback | — | — | — | ✅ | — | — | Admin 后台优先 |
| `WANGCHAO_FETCH_*` | — | — | 可选 | — | — | — | 有安全默认值 |
| `WANGCHAO_DISCOVERY_*` | — | — | — | 可选 | — | — | 有安全默认值 |
| Telegram fallback | — | — | ✅ | — | ✅ | — | Admin 后台优先 |
| `WANGCHAO_DB_WAIT_*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 有安全默认值 |
| Seed / topic-create variables | ✅ | — | — | — | — | — | 首次部署 / 可选 |
| `WANGCHAO_DEPLOYMENT_MODE` | ✅ | — | — | — | — | — | 对客设为 `commercial` |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | ✅ | — | — | — | — | — | 商用必需；Railway Secret + HTTPS origin |
| `PORT` | Railway 注入 | — | — | — | — | — | Railway |

`WANGCHAO_RAILWAY_ROLE` 仅用于 root `railway.json` 的本地 `railway up` fallback；GitHub service-level config 不需要设置。

### 5.2 DATABASE_URL Service Reference

`DATABASE_URL` 应通过 Railway Postgres service reference 注入，不手写真实连接串：

1. 在 Railway project 中添加 managed Postgres service。
2. Postgres service 自动暴露 `DATABASE_URL` 等 variables。
3. 在六个 application service 的 **Variables** 中，使用 **Reference Variable** 引用 Postgres service 的 `DATABASE_URL`（格式：`${{Postgres.DATABASE_URL}}`）。
4. 不要在任何 service 的 variables 中手动粘贴真实连接串。

### 5.3 Secret 管理规则

- **真实 secret 只进 Railway Variables**，不进 `.env`、不进代码、不进文档。
- **`.env_example` 只放占位符**。
- **AI/Search secret 按服务最小化暴露**：
  - Web service 不需要 `AI_API_KEY`（AI 调用全部在 worker）。
  - Worker Cron 不需要 `BRAVE_SEARCH_API_KEY`（搜索只在 source discovery）。
  - Source Discovery 不需要 `AI_API_KEY`（source recommendation 使用 `AI_MODEL_L1`，由 Admin 后台或 fallback env 提供）。
- **Admin 后台是 secret 主配置入口**：API Key 通过 `/admin/settings` 配置，AES-256-GCM 加密存储。环境变量仅作为 DB 未配置时的 fallback。
- **变量变更会触发 redeploy**：Railway 中修改变量会自动触发该 service 重新部署。
- **商用切换必须原子配置**：在 Web service 同一次变量变更中设置 mode、secret、URL；predeploy 会在 migration 前校验，失败部署不可切流。商用 smoke 必须确认 health 的 `database/authentication` 均为 `ok`、匿名首页 307 登录跳转及注册后的独立 OWNER 工作区。

### 5.4 生产变量审计 Checklist

定期（建议每月）执行：

- [ ] 确认 `DATABASE_URL` 使用 service reference，非手写值。
- [ ] 确认 AI/Search secret 只在需要的 service 中配置。
- [ ] 搜索 Railway logs 中是否有真实 secret、token 或完整连接串泄露。
- [ ] 搜索仓库文档和代码中是否有真实 secret 值。
- [ ] 确认 `.env_example` 中无真实值。
- [ ] 确认 `ENCRYPTION_KEY` 已设置且与生产一致。

## 6. CI/CD (#15)

### 6.1 GitHub Actions CI

仓库使用 GitHub Actions 在 PR 和 push 时运行基础验证：

```yaml
# .github/workflows/ci.yml 触发条件
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
```

CI 执行内容：

| 步骤 | 命令 | 目的 |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | 确保依赖可解析 |
| Lint | `pnpm lint` | 代码规范 |
| Typecheck | `pnpm typecheck` | 类型安全 |
| Build | `pnpm build` | 编译验证 |
| Test | `pnpm test` | Fixture 验证 |
| DB Validate | `pnpm db:validate` | Prisma schema 一致性 |

CI 不运行 Playwright smoke（需要 Chromium + Postgres，适合本地或专用环境）。

### 6.2 部署触发边界

- **CI 验证** → 在 GitHub Actions 中运行，不影响 Railway。
- **Railway 部署** → 由 GitHub push/merge 自动触发，与 CI 并行。
- CI 失败不阻塞 Railway 部署（Railway GitHub integration 独立工作），但应在 CI 通过后才合并 PR。

### 6.3 集中错误观测

当前错误观测分两层：
1. **Railway logs** — Web/Worker/Cron 的 runtime 日志和 crash 记录。
2. **数据库 TaskRun / UsageEvent** — worker 执行结果的持久化审计。

暂未接入外部错误上报服务（如 Sentry）；如后续需要，优先在 worker 和 web server actions 中添加 error reporter，在 `/api/health` 中暴露 error reporter 状态。
