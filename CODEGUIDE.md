# 望潮（Wangchao）— Codebase Structure Map

> **文档创建于 2026-07-06** | 当前主路径以 TypeScript monorepo 为准；旧 Python 原型已归档到 `legacy/python-prototype/`

> 技术路线以 `REFACTOR_PLAN.md` 为准：仓库已绿地重构为 Node.js / TypeScript / Next.js / Postgres / Prisma 架构。`README.md` / `README-en.md` 是当前用户入口说明，`legacy/python-prototype/` 仅作历史参考。

## 1. 全局架构总览

**望潮（Wangchao）** 当前主路径是一个 TypeScript monorepo 情报系统。核心链路是：**Next.js 产品界面 → Postgres/Prisma 数据边界 → Node worker 抓取 RSS → 确定性情报管线/AI adapter 边界 → Dashboard、偏好记忆、简报、导出、信源治理、用量审计和健康检查**。

| 维度 | 描述 |
|------|------|
| 运行时 | Node.js / TypeScript |
| 依赖管理 | `pnpm` workspace |
| 数据库 | Postgres + Prisma |
| 信息源 | RSS/Atom feed，经 `packages/sources` 解析 |
| AI 接口 | OpenAI-compatible adapter，当前主情报管线以可解释规则为主 |
| 输出 | Next.js Dashboard、Markdown event/briefing export |
| 前端 | `apps/web` Next.js App Router |
| 后台任务 | `apps/worker` Node.js worker |

### TypeScript 工作区现状

TypeScript monorepo 是当前主开发路径：

| 维度 | 描述 |
|------|------|
| 包管理 | `pnpm` workspace |
| 构建编排 | Turborepo |
| Web app | `apps/web`，Next.js App Router，提供顶部导航产品壳、首页未读情报流、创建主题、信源管理、简报、已收藏、偏好记忆、`/api/health`、loading/error 状态和本地 UI primitives。按 `FRONTEND.md` 重构为 Kinetic Intelligence 风格：酸黄强调、顶部导航、中间限宽单列阅读区、密集情报卡片、可解释详情、信源质量数字和偏好置信度条。 |
| Worker | `apps/worker`，Node.js TypeScript worker，支持 fetch cycle 与 `--health` 健康检查 |
| 共享包 | `packages/core`, `packages/ai`, `packages/db`, `packages/sources`, `packages/ui` |
| DB 基础 | `packages/db`，Prisma/Postgres schema、migration、seed、lazy client、tenant/member role guard、usage event 与查询 helper |
| 情报管线 | `packages/core` + `apps/worker`，提供可解释 relevance/noise、event draft、dedupe hash、gravity ranking、feedback delta 和 preference ranking |
| 验证命令 | `CI=true pnpm typecheck`, `CI=true pnpm build`, `CI=true pnpm lint`, `CI=true pnpm test` |

### 文档优先级

| 优先级 | 文件 | 说明 |
|--------|------|------|
| 1 | `SPEC.md` | 产品目标、边界、数据模型和功能方向的 source of truth。 |
| 2 | `REFACTOR_PLAN.md` | 技术选型、目标架构和绿地重构阶段的核心依据。 |
| 3 | `AGENTS.md` | AI Agent 协作规则。 |
| 4 | `FRONTEND.md` | 前端视觉语言、交互规则、组件风格和页面组合方式。 |
| 5 | `CODEGUIDE.md` | 当前代码结构、模块职责、数据流和命令说明。 |
| 6 | `AGENTS_CHANGELOGS.md` | AI Agent 每轮修改审计日志。 |
| 7 | `DEVELOPE_LOGS.md` | 分阶段开发审计和延期功能追踪。 |
| 入口说明 | `README.md` / `README-en.md` | 当前 TypeScript 主路径的用户入口说明；架构决策仍以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。 |
| 废弃 | `CHANGELOG.md` | 不再维护，由 `AGENTS_CHANGELOGS.md` 替代。 |

## 2. 目录结构树

```text
wangchao/
├── README.md                         # 中文 README
├── README-en.md                      # 英文 README
├── SPEC.md                           # 当前产品/技术规格入口，描述已实现设计
├── REFACTOR_PLAN.md                  # Node.js / TypeScript 绿地重构计划
├── FRONTEND.md                       # 前端视觉语言、交互规则和页面组合规范
├── AGENTS.md                         # AI Agent 协作规范
├── AGENTS_CHANGELOGS.md              # AI Agent 工作审计日志
├── DEVELOPE_LOGS.md                  # 分阶段开发审计与延期功能追踪
├── CODEGUIDE.md                      # [本文件] 代码库结构手册
├── CHANGELOG.md                      # 已废弃的历史变更日志，勿继续维护
├── docs/
│   ├── deployment.md                 # 通用部署运维、健康检查、环境变量和回滚说明
│   └── railway-deployment.md          # Railway 部署完整指南
├── deploy/
│   └── railway/                      # Railway Web 与 Worker Cron Config as Code 示例
│       ├── README.md                 # Railway service 拆分、config path 和变量说明
│       ├── web.railway.json          # Web service build/predeploy/start/health 配置
│       └── worker-cron.railway.json  # Worker Cron build/start/schedule 配置
├── railway.json                      # 当前 CLI 本地上传部署使用的 Railway root config
├── package.json                      # pnpm workspace 根 package 与统一 scripts
├── pnpm-workspace.yaml               # pnpm workspace 范围与 approved builds
├── pnpm-lock.yaml                    # pnpm 锁定文件
├── turbo.json                        # Turborepo task pipeline
├── tsconfig.base.json                # TypeScript workspace 基础配置
├── apps/
│   ├── web/                          # Next.js App Router 产品界面、产品壳和本地 UI primitives
│   └── worker/                       # Node.js 后台 worker 入口
├── packages/
│   ├── core/                         # 共享领域逻辑
│   ├── ai/                           # OpenAI-compatible AI adapter
│   ├── db/                           # Postgres/Prisma schema、migration、client、repositories
│   ├── sources/                      # RSS/Web source adapter
│   └── ui/                           # 共享 UI 包
├── .env_example                      # 环境变量模板
└── legacy/
    └── python-prototype/             # 已归档的 Python 原型、旧静态前端、旧 prompt 和旧测试
```

## 3. 核心数据流

```text
Next.js Dashboard / Server Actions
  ↓ packages/db repositories
Postgres / Prisma
  ↓ apps/worker runFetchCycle()
RSS feeds -> Item -> IntelligenceEvent
  ↓ apps/web getTopicSourceWorkspace()
Dashboard / Markdown export / source governance / usage audit
```

### Legacy Python Prototype

旧 Python 原型已移动到 `legacy/python-prototype/`。其中保留 SQLite `news` 状态、旧 L1/L2 prompt、旧静态 HTML Dashboard 和 Python 测试，仅作为行为参考。新增功能不得继续写入该目录。

### Postgres / Prisma 数据流

Next.js 和 worker 应通过 `packages/db` 访问 Postgres，不直接散落 Prisma 查询。

```text
Next.js server actions / route handlers
  ↓ packages/db getPrismaClient()
Prisma Client
  ↓
Postgres

Node worker
  ↓ apps/worker runFetchCycle()
packages/db listActiveRssSourcesForFetch()
  ↓
packages/sources fetchRssFeed()
  ↓
packages/db upsertFetchedItems()
  ↓
TaskRun / Source / Item / IntelligenceEvent / Briefing
  ↓
Postgres

AI pipeline stages
  ↓ packages/ai OpenAiCompatibleAdapter
OpenAI-compatible /chat/completions
  ↓ packages/ai parser
sanitized JSON object + schema validation

Fetched items
  ↓ packages/db listFetchedItemsForAnalysis()
Item(status='FETCHED')
  ↓ apps/worker runAnalysisCycle()
packages/core evaluateRelevance()
  ↓
packages/core createIntelligenceEventDraft()
  ↓ packages/core calculateGravityScore()
packages/db upsertIntelligenceEventFromItem()
  ↓
IntelligenceEvent(status='UNREAD') + Item(status='ANALYZED')

Noise items
  ↓ packages/db markItemFiltered()
Item(status='FILTERED')

Dashboard reading workflow
  ↓ apps/web getTopicSourceWorkspace()
packages/db listDashboardEvents()
  ↓
apps/web applies PreferenceMemory weights
  ↓
apps/web page renders unread/saved IntelligenceEvent list + detail
  ↓ Server Action updateDashboardEventStateAction()
packages/db updateDashboardEventState()
  ↓
IntelligenceEvent(status='READ' | 'SAVED' | 'DISMISSED')
UserItemState(status/saved/readAt/dismissedAt)
FeedbackEvent(kind='READ' | 'SAVE' | 'DISMISS')
  ↓ apps/web action 或 apps/worker runPreferenceLearningCycle()
packages/core generatePreferenceDeltas()
  ↓ packages/db upsertPreferenceMemory()
PreferenceMemory(key/value/confidence/explanation)

Briefing and Markdown export
  ↓ apps/worker runDailyBriefingCycle()
packages/db listEventsForDailyBriefing()
  ↓ packages/core renderDailyBriefingMarkdown()
packages/db createDailyBriefing()
  ↓
Briefing(markdown, events)
  ↓ apps/web /exports/briefings/[briefingId]
Markdown download + ExportEvent

Single-event Markdown export
  ↓ apps/web /exports/events/[eventId]
packages/db getEventMarkdownExportRecord()
  ↓ packages/core renderEventMarkdown()
Markdown download + ExportEvent + FeedbackEvent(kind='EXPORT')

Source governance
  ↓ apps/web createCandidateSourceAction()
packages/db createCandidateRssSource(status='CANDIDATE')
  ↓ apps/web updateSourceGovernanceAction()
packages/db updateSourceGovernanceStatus()
  ↓
Source(status='ACTIVE' | 'CANDIDATE' | 'MUTED' | 'REJECTED')
SourceObservation(evidence)
FeedbackEvent(kind='SOURCE_APPROVE' | 'SOURCE_REJECT')
  ↓ apps/worker runSourceGovernanceObservationCycle()
SourceObservation(hitRate/noiseRate/duplicateRate)

Commercial readiness boundary
  ↓ packages/db ensureDefaultWorkspace()
Organization + User + Membership(role)
  ↓ apps/web Server Actions / export routes
packages/db assertMembershipRole()
  ↓
OWNER/ADMIN: topic/source governance mutations
OWNER/ADMIN/MEMBER: read/save/dismiss/export
  ↓ packages/db recordUsageEvent()
UsageEvent(type, quantity, unit, subject)
  ↓ apps/web getTopicSourceWorkspace()
Organization card + membership list + 30-day usage summary
  ↓ apps/worker runFetchCycle()
FETCH / BRIEFING / SOURCE_GOVERNANCE usage events

Deployment and health
  ↓ apps/web /api/health
DATABASE_URL optional check + Prisma SELECT 1
  ↓ apps/worker --health
DATABASE_URL optional check + Prisma SELECT 1
  ↓ docs/deployment.md
env template + service start + logging + rollback guidance
```

核心模型：

| 模型 | 职责 |
|------|------|
| `User`, `Organization`, `Membership` | 为未来商业化、多租户和团队权限保留所有权边界；当前个人版使用默认工作区和默认用户。 |
| `Topic` | 用户关注主题，包含 topic profile、状态和 owner。 |
| `Source`, `SourceObservation` | RSS/Web 信源注册、候选/启用/静音/拒绝状态和质量观测。 |
| `Item` | worker 抓取和规范化后的原始条目。 |
| `IntelligenceEvent` | AI 抽取、去重、评分后的情报单元。 |
| `UserItemState`, `FeedbackEvent`, `PreferenceMemory` | 阅读状态、反馈行为和可解释偏好记忆。 |
| `Briefing`, `ExportEvent` | 简报和 Markdown/PDF/JSON 导出记录。 |
| `TaskRun` | worker 任务状态、重试、错误和输入输出审计。 |

### 目标 Next.js 产品壳

`apps/web` 是当前产品界面入口。按 `FRONTEND.md` 重构后，首页改为顶部导航 + 中间限宽单列未读情报流，组织权限、用量审计、处理管线、KPI 指标卡等从首页移除。新建主题、信源管理、简报、已收藏、偏好记忆拆分为独立路由。数据层通过 `getTopicSourceWorkspace()` 统一获取工作区数据，Server Actions 处理 mutations。`DATABASE_URL` 未配置时首页抛出错误，不再静默降级为预览模式。

```text
apps/web/src/app/layout.tsx
  ↓
apps/web/src/app/page.tsx
  ↓ form actions
apps/web/src/app/actions.ts
  ↓ dynamic import @wangchao/db
packages/db/src/repositories.ts
  ↓
Prisma/Postgres

apps/web/src/lib/topic-source-data.ts
  ↓
apps/web/src/components/ui/*
  ↓
apps/web/src/app/globals.css
```

关键文件：

| 文件 | 目的 |
|------|------|
| `apps/web/components.json` | shadcn/ui 风格配置入口；当前为离线配置，未通过 CLI 拉取完整 Radix 组件。 |
| `apps/web/src/lib/utils.ts` | 本地 `cn()` className 合并 helper。 |
| `apps/web/src/components/ui/button.tsx` | 本地 Button primitive，支持 `primary`、`secondary`、`ghost`、`danger` 变体。 |
| `apps/web/src/components/ui/card.tsx` | 本地 Card primitive，支持 `work`、`kinetic` variant。 |
| `apps/web/src/components/ui/badge.tsx` | 本地 Badge primitive，支持 `default`、`muted`、`success`、`warning`、`danger`、`accent` tone。 |
| `apps/web/src/components/ui/tabs.tsx` | 本地 Tabs 外观 primitive。 |
| `apps/web/src/components/layout/app-shell.tsx` | AppShell 容器，包裹 TopNav + main。 |
| `apps/web/src/components/layout/top-nav.tsx` | 顶部导航：品牌、未读情报/简报/已保存、新增主题/信源管理。 |
| `apps/web/src/components/intelligence/intelligence-card.tsx` | 情报卡片 client 组件：主题标签、来源时间、标题、摘要、为什么重要、已读/收藏/减少/原文动作。 |
| `apps/web/src/components/intelligence/intelligence-feed.tsx` | 情报流 client 组件，空状态时显示 EmptyState。 |
| `apps/web/src/components/intelligence/topic-filter.tsx` | 主题筛选标签条。 |
| `apps/web/src/components/common/empty-state.tsx` | 通用空状态组件。 |
| `apps/web/src/components/common/status-banner.tsx` | 状态横幅组件，支持 info/notice/error/warning tone。 |
| `apps/web/src/components/common/page-header.tsx` | 页面标题 + eyebrow + meta + 操作区。 |
| `apps/web/src/app/page.tsx` | 首页：未读情报流，顶部搜索、主题筛选、情报卡片列表、已读/收藏/减少动作。 |
| `apps/web/src/app/topics/new/page.tsx` | 新建主题页：Kinetic 风格大表单。 |
| `apps/web/src/app/sources/page.tsx` | 信源治理页：候选源表单、质量报告、批准/观察/静音/拒绝动作。 |
| `apps/web/src/app/briefings/page.tsx` | 简报列表页 + Markdown 导出。 |
| `apps/web/src/app/saved/page.tsx` | 已收藏情报页。 |
| `apps/web/src/app/preferences/page.tsx` | 偏好记忆页：权重、置信度、解释。 |
| `apps/web/src/app/actions.ts` | Server Action 入口；创建主题、更新事件状态、创建候选源、信源治理。失败通过 stderr 记录，成功/失败通过 redirect URL 参数反馈。 |
| `apps/web/src/lib/topic-source-data.ts` | 读取工作台数据；`DATABASE_URL` 未配置时抛出错误，不再静默降级为预览模式。 |
| `apps/web/src/app/exports/briefings/[briefingId]/route.ts` | 简报 Markdown 下载 route。 |
| `apps/web/src/app/exports/events/[eventId]/route.ts` | 单条情报 Markdown 下载 route。 |
| `apps/web/src/app/loading.tsx` | Next.js route loading 骨架屏。 |
| `apps/web/src/app/error.tsx` | Next.js route error boundary，提供重试入口。 |
| `apps/web/src/app/globals.css` | 全局 token、布局、组件样式、motion/reduced-motion、焦点状态和响应式规则；按 `FRONTEND.md` 语义 token 定义。 |
| `FRONTEND.md` | `apps/web` 前端设计规范，定义 Kinetic Intelligence 风格、token、组件变体、页面组合、动效、响应式和可访问性边界。 |
| `packages/db/src/repositories.ts` | Topic/Source/Worker/Dashboard/Preference/Briefing/Governance repository。 |
| `apps/worker/src/index.ts` | Worker 入口：抓取 RSS、分析、简报生成、source quality observation、health check。 |
| `packages/core/src/index.ts` | 领域逻辑：relevance/noise 判定、event draft、gravity ranking、feedback delta、preference ranking、Markdown 渲染。 |
| `packages/sources/src/index.ts` | RSS source adapter：抓取 RSS/Atom，解析 item/entry，规范化输出。已移除 `fixture:` 协议和离线 fixture 数据。 |
| `packages/ai/src/openai-compatible.ts` | OpenAI-compatible Chat Completions adapter。 |
| `packages/ai/src/parser.ts` | LLM response parser：清理、抽取 JSON、schema 校验。 |
| `packages/ai/src/types.ts` | AI adapter 共享类型。 |
| `packages/db/prisma.config.ts` | Prisma 7 CLI 配置入口。移除硬编码 localhost 默认 DATABASE_URL，依赖运行时环境变量。 |

维护规则：

- UI 颜色优先使用 `globals.css` 中的 token，不在组件里散落 hex。
- 前端视觉和交互以 `FRONTEND.md` 为准；工作流页面使用密集、稳定、低干扰布局，品牌/空状态/新建主题模块才使用更强 kinetic typography。
- 情报正文、摘要、解释和来源名称不得全大写；来源和原文链接必须使用真实 `<a>`，外链补 `target="_blank"` 和 `rel="noreferrer"`。
- 页面和 Markdown 导出只允许把 HTTP/HTTPS URL 渲染为外链。
- 所有按钮和表单控件应保留明显 `focus-visible`，点击目标最小 44px；图标按钮必须保留 `aria-label`。
- 动效必须作为状态信号而不是装饰；新增动画时必须同步 `prefers-reduced-motion`。
- 不使用 `next/font/google`，避免构建期外部网络依赖。
- 首页搜索使用 `q` URL 参数，情报视图使用 `view=all|high|saved` URL 参数；新增筛选入口必须可点击、可刷新、可分享，不得只放静态按钮。
- 真实数据接入时，页面应通过 Server Components/Server Actions/Route Handlers 调用 `packages/db`，长任务仍交给 worker。
- Dashboard 主列表只展示 `UNREAD` 和 `SAVED` 事件；`READ` 与 `DISMISSED` 默认从主信息流隐藏。
- Dashboard 状态动作必须同时写 `IntelligenceEvent`、`UserItemState` 和 `FeedbackEvent`，为偏好学习保留信号。
- Preference learning 当前使用可解释规则：`SAVE/EXPORT` 提升 category/source 权重，`READ` 轻微提升，`DISMISS` 降低；后续可替换为 LLM 归纳，但必须保留 `PreferenceMemory.explanation` 可解释性。
- Dashboard 排序使用 `gravityScore` 作为基础分，再应用 `PreferenceMemory` 权重；不得只记录反馈而不影响排序。
- Daily briefing 生成必须由 worker 执行；Web 下载 route 只读取已持久化的 `Briefing.markdown` 并记录导出。
- Markdown 导出必须包含生成时间、来源、摘要、解释和原文链接；单条情报导出应作为 `FeedbackEvent(kind='EXPORT')` 正反馈记录。
- Candidate sources 必须保持隔离：worker fetch 和 daily briefing 默认只使用 `ACTIVE` sources；candidate/muted/rejected 不得进入正式抓取和简报。
- Source governance 状态动作必须写 `SourceObservation`；approve/reject/mute/observe 还应记录可追溯 evidence，approve/reject/mute 通过 `FeedbackEvent` 给偏好和质量报告留下信号。
- Source quality report 当前基于 Item/IntelligenceEvent 状态计算 hit/noise/duplicate 指标，worker 每轮把指标快照写入 `SourceObservation`。
- Topic/Source 写入必须保留 tenant scope：先通过默认 organization/user 获取 `organizationId`/`userId`，再写入 `Topic` 与 `Source`。
- RSS URL 进入唯一性约束前必须 canonicalize；当前实现会去掉 hash、统一 hostname 小写并规整尾部 `/`。
- Worker fetch pipeline 必须有 attempt 上限；当前 `MAX_FETCH_ATTEMPTS=3`，每次尝试都会写入独立 `TaskRun`。
- Worker 负责抓取、item normalize、可解释分析、反馈归纳、简报生成和 source quality observation；后续真正 LLM relevance/event extraction/preference summarization/briefing rewrite/source discovery 应接入 `packages/ai`，但仍保持在 worker 中执行。
- 当前分析管线用 topic profile keywords 做 relevance/noise，用标题和 URL 生成 `eventHash`，用 `topicId + eventHash` 幂等 upsert 事件；如果接入更深语义抽取，仍需保留可解释性和幂等写入。
- `markItemFiltered()` 必须保留原有 `rawMetadata`，只追加过滤原因，避免丢失 RSS 原始追溯信息。
- AI adapter 保持 OpenAI-compatible，不绑定具体 vendor SDK；provider response 视为不可信，必须先 sanitize，再 parse，再 validate。
- JSON mode 不可用时允许 fallback，但需要按 model 记忆失败，避免每次都重复使用不兼容参数。
- 完整 shadcn/Radix/Tailwind CLI 初始化被网络环境延后，后续恢复依赖后应评估是否替换本地 primitives。

## 4. 模块职责

### `legacy/python-prototype/`

归档的旧实现：

- `main.py`, `config.py`, `database.py`, `ai_service.py`, `ranking.py`, `response_utils.py`
- `processors/`, `sources/`, `prompts/`
- `index.html`
- `tests_*.py`
- `.python-version`, `pyproject.toml`, `uv.lock`

维护规则：只读参考；如从原型复制行为，必须在新的 TypeScript 模块中实现，并同步本文件的新 owner。

## 5. 环境变量与运行命令

### 本地运行

```bash
cp .env_example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Node.js workspace 验证

```bash
CI=true pnpm typecheck
CI=true pnpm build
CI=true pnpm lint
CI=true pnpm test
pnpm worker:health
```

### Railway 部署脚本

```bash
pnpm railway:web:build
pnpm railway:web:start
pnpm railway:build
pnpm railway:predeploy
pnpm railway:start
pnpm railway:worker:build
pnpm railway:worker:start
pnpm db:deploy
```

说明：

- `deploy/railway/web.railway.json` 使用 `pnpm railway:web:build` 构建 Web，在 pre-deploy 阶段运行 `pnpm db:deploy && pnpm db:seed`，启动命令为 `pnpm railway:web:start`，健康检查路径为 `/api/health`。
- `deploy/railway/worker-cron.railway.json` 使用 `pnpm railway:worker:build` 构建 worker，按 `0 * * * *` UTC 每小时执行一次 `pnpm railway:worker:start`。
- `railway.json` 是当前 CLI 本地上传部署入口。由于当前仓库有大量未提交绿地重构改动，生产部署使用 `railway up --service ...` 上传本地目录；两个服务通过 `WANGCHAO_RAILWAY_ROLE` 分发启动行为：`web` 跑 migration/seed 并启动 Next.js，`worker` 跳过 predeploy 并执行一轮 Node worker。
- Railway Web 与 Worker Cron 应连接同一个 Railway Postgres，并共享 `DATABASE_URL` 与默认 workspace 环境变量。
- 2026-07-06 已创建 Railway project `wangchao`，添加 `Postgres`、`wangchao-web` 和 `wangchao-worker` 服务；Web、Worker、Postgres 已迁移到 `southeast-asia`，实际 region ID 为 `asia-southeast1-eqsg3a`。Worker 当前是部署后执行一轮并停止，尚未通过 CLI 配置成定时 Cron。

### Prisma / Postgres 命令

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
pnpm db:seed
pnpm db:format
```

### 本地 Docker Postgres 验证

当前本机已有其他项目占用 `5432`，望潮本地测试使用 `55433` 映射到容器内 `5432`：

```bash
docker run -d \
  --name wangchao-postgres-local \
  -e POSTGRES_USER=wangchao \
  -e POSTGRES_PASSWORD=wangchao \
  -e POSTGRES_DB=wangchao \
  -p 127.0.0.1:55433:5432 \
  -v wangchao_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine

DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:validate
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:generate
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm db:seed
DATABASE_URL="postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public" pnpm worker:health
```

说明：

- `DATABASE_URL` 由 `.env_example` 提供占位模板，真实值不得提交。
- `WANGCHAO_DEFAULT_ORGANIZATION_SLUG`、`WANGCHAO_DEFAULT_ORGANIZATION_NAME`、`WANGCHAO_DEFAULT_USER_EMAIL`、`WANGCHAO_DEFAULT_USER_NAME` 是当前个人版默认工作区/用户配置；真实商业化前必须替换为正式 auth/session provider。
- `WANGCHAO_SEED_SOURCE_NAME`、`WANGCHAO_SEED_SOURCE_URL` 控制 seed 创建的默认 RSS source。留空时 seed 不创建默认 RSS 源。
- `packages/db/prisma/schema.prisma` 是目标数据模型入口。
- `packages/db/prisma.config.ts` 是 Prisma 7 CLI 配置入口，提供 schema、migration path、seed command 和 datasource URL。datasource URL 从 `DATABASE_URL` 环境变量读取，无硬编码默认值。
- `packages/db/prisma/migrations/0001_init/migration.sql` 是首版 Postgres migration。
- `packages/db/prisma/seed.ts` 创建默认工作区、默认用户、初始主题和 RSS source；默认 workspace/user 读取 `WANGCHAO_DEFAULT_*` 环境变量，默认 seed source 读取 `WANGCHAO_SEED_SOURCE_*` 环境变量。
- `packages/sources/src/index.ts` 支持 RSS/Atom 抓取，仅接受 HTTP/HTTPS URL。
- `packages/db/src/client.ts` 懒加载 Prisma Client，并用 `@prisma/adapter-pg` 注入 Postgres adapter，避免 build-time 读取运行时数据库。
- `packages/db/src/repositories.ts` 提供 tenant/topic scoped 查询 helper，后续新增查询应优先放在这里或同包内的清晰模块中。
- `apps/web/src/app/api/health/route.ts` 是 Web health endpoint，返回 web service 状态和数据库检查结果。
- `apps/worker/src/index.ts --health` 是 worker health check 入口，可通过根脚本 `pnpm worker:health` 调用。
- `docs/deployment.md` 记录当前 Railway 部署顺序、环境变量、服务配置、日志、备份和回滚策略。
- `railway.json` 是当前从本地目录上传部署时实际生效的 Railway root config。
- `deploy/railway/*.railway.json` 是 Railway Config as Code 示例；Web 和 Worker Cron 需要分别作为 Railway service 设置对应 config file path。

注意：

- `pnpm approve-builds --all` 已用于批准当前依赖链中的 `esbuild`、`sharp`、`prisma` 和 `@prisma/engines` 构建脚本，结果写入 `pnpm-workspace.yaml`。
- Next.js web app 不使用 `next/font/google`，避免构建期访问外部字体网络。
- 外部客户端、数据库、Redis 或 SDK 后续必须 lazy init，避免 `next build` 在缺少 runtime env 时失败。
- 2026-07-06 已修复首版 migration 与 Prisma schema 的 `_BriefingEvents` 漂移；干净库已通过根命令 `pnpm db:migrate`，并生成 `_prisma_migrations` 记录。
- 2026-07-06 本地 Docker Postgres 已通过 `db:validate`、`db:generate`、`db:migrate`、`db:seed`、数据库写入 smoke test、Web `/api/health` 和 `worker:health`；浏览器创建主题 + RSS Server Action 已验证写入 Postgres。
- 当前环境曾出现公网 RSS 抓取 `https://hnrss.org/newest?points=100` 失败并记录 `TaskRun(FAILED)`；后续个人使用前需要用真实可访问 RSS 复测，或手动使用离线 fixture source 验证 worker 闭环。
- 2026-07-06 生产发现 `apps/web/src/app/page.tsx` 被 Next.js 静态预渲染，导致 Railway 上 `/api/health` database `ok` 但首页仍显示预览 fallback；已通过 `export const dynamic = "force-dynamic"` 修复，后续首页会读取运行时工作区数据。
- 下载 route、真实事件状态按钮和真实 RSS worker fetch cycle 仍需在可用源/事件数据下继续补 smoke test。

## 6. 维护规则

- `SPEC.md` 是后续产品开发与重构的主要依据，描述目标产品形态；当它与当前实现不一致时，应把当前代码视为可重构的引擎原型，而不是限制产品方向。
- `REFACTOR_PLAN.md` 是下一阶段技术选型和绿地重构路线的核心依据；涉及架构方向时优先参考它，`README.md` / `README-en.md` 负责说明当前可用入口。
- `AGENTS.md` 是 AI Agent 协作规范；修改协作流程、审计规则、提交规则或任务结束检查项时需要同步更新。
- `AGENTS_CHANGELOGS.md` 替代 `CHANGELOG.md`，记录每轮 AI Agent 修改审计；`CHANGELOG.md` 已废弃，不再继续维护。
- `DEVELOPE_LOGS.md` 记录每个开发阶段完成后的审计、缺失功能、已知风险和后续追踪事项。
- 修改项目目标、核心工作流、状态机、输出 schema、配置语义、安全边界或明确限制时必须同步更新 `SPEC.md`。
- 修改代码后必须运行相关测试；涉及运行时/数据库/前端安全时至少运行三份根目录测试脚本。
- 新增环境变量时同步更新 `.env_example` 和本文件。
- 修改数据流、状态机、输出 JSON schema、目录结构或新增测试脚本时同步更新 `CODEGUIDE.md`。
- 每次 AI Agent 对代码、文档、配置或仓库结构做出修改，都必须按 `AGENTS.md` 规则更新 `AGENTS_CHANGELOGS.md`。
- 不要提交 `.env`、`data/*`、生成的 `dashboard.json/top5.json` 或 `.venv`。
- LLM 输出必须按不可信输入处理；前端渲染前 escape，后端解析前 sanitize。
