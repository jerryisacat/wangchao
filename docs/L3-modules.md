# L3 - 模块与调用链

> 本文件记录每个包/目录职责、关键文件、调用链细节。属于 L3 实现层，随代码演进频繁更新。
>
> 上层抽象见 `CODEGUIDE.md`（L0 系统架构 + L1 设计原则）；领域模型见 `docs/L2-domain.md`。

## 目录结构树

```text
wangchao/
├── README.md                         # 中文 README
├── README-en.md                      # 英文 README
├── SPEC.md                           # 产品/技术规格入口
├── REFACTOR_PLAN.md                  # Node.js 绿地重构计划
├── FRONTEND.md                       # 前端视觉语言、交互规则和页面组合规范
├── AGENTS.md                         # AI Agent 协作规范
├── AGENTS_CHANGELOGS.md              # AI Agent 工作审计日志
├── DEVELOPE_LOGS.md                  # 分阶段开发审计与延期功能追踪
├── CODEGUIDE.md                      # [L0/L1] 代码库结构手册
├── docs/
│   ├── L2-domain.md                  # [L2] 领域模型、状态机、术语表
│   ├── L3-modules.md                 # [本文件] 模块职责、关键文件、调用链
│   ├── L4-operations.md              # [L4] 命令、环境变量、部署、测试
│   ├── deployment.md                 # 通用部署运维说明
│   ├── railway-deployment.md         # Railway 部署完整指南
│   └── business-model.md             # 订阅制商业模型定义
├── deploy/
│   └── railway/                      # Railway Config as Code 示例
│       ├── README.md
│       ├── web.railway.json
│       ├── worker-cron.railway.json
│       └── source-discovery-cron.railway.json
├── scripts/
│   └── wait-for-database.mjs          # Railway predeploy 数据库 TCP readiness 等待脚本
├── railway.json                      # CLI 本地上传部署 Railway root config
├── package.json                      # pnpm workspace 根 package
├── playwright.config.ts              # Web smoke test 配置
├── pnpm-workspace.yaml               # pnpm workspace 范围
├── pnpm-lock.yaml
├── turbo.json                         # Turborepo task pipeline
├── tsconfig.base.json                # TypeScript workspace 基础配置
├── apps/
│   ├── web/                          # Next.js App Router 产品界面
│   └── worker/                       # Node.js 后台 worker
├── packages/
│   ├── core/                         # 共享领域逻辑
│   ├── ai/                           # OpenAI-compatible AI adapter
│   ├── db/                           # Postgres/Prisma schema、migration、client、repositories
│   ├── sources/                      # RSS/Web source adapter
│   └── ui/                           # 共享 UI 包（预留）
├── tests/
│   └── smoke/                         # Playwright Web smoke tests
└── .env_example                      # 环境变量模板
```

旧 Python 原型已在开源清洗中删除（上游 `t0saki/AI-News-Dashboard` 无 LICENSE）。git history 仍保留历史，但当前代码树不再包含。新增功能继续在 TypeScript 模块中实现。

---

## packages/db

Postgres/Prisma schema、migration、client、repositories。是所有数据访问的唯一入口，Next.js 和 worker 都通过 `packages/db` 访问 Postgres，不直接散落 Prisma 查询。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/db/prisma/schema.prisma` | 目标数据模型入口。所有枚举和模型定义。 |
| `packages/db/prisma.config.ts` | Prisma 7 CLI 配置入口。移除硬编码 localhost 默认 DATABASE_URL，依赖运行时环境变量。 |
| `packages/db/prisma/migrations/0001_init/migration.sql` | 首版 Postgres migration。 |
| `packages/db/prisma/migrations/0002_source_discovery/migration.sql` | 新增 `SOURCE_DISCOVERY` task/usage 枚举，以及 `Source.recommendationReason`、`Source.discoveryChannel`。 |
| `packages/db/prisma/seed.ts` | 创建默认工作区、默认用户，然后按 seed 列表创建 topic 和 source。topic 和 source 都是 create-only：已存在的不被重置 status 或覆盖 profile，保证用户在 UI 上的 mute/reject 和 profile 编辑不被 seed 重置。 |
| `packages/db/seed-sources.json` | 仓库内维护的默认信源列表。schema：`{ version:1, topics:[{ name, description?, keywords?, sources:[{name,url}] }] }`。 |
| `packages/db/src/client.ts` | 懒加载 Prisma Client，并用 `@prisma/adapter-pg` 注入 Postgres adapter，避免 build-time 读取运行时数据库。 |
| `packages/db/src/crypto.ts` | AES-256-GCM 凭证加解密工具。`encryptCredential(plaintext, key)` / `decryptCredential(encrypted, key)` / `maskKeyHint(plaintext)`。密钥来自 `ENCRYPTION_KEY` 环境变量，输出格式 `iv:ciphertext:tag`（base64）。 |
| `packages/db/src/index.ts` | 包公共出口。导出 repositories、crypto 函数（`encryptCredential`/`decryptCredential`/`maskKeyHint`）以及凭证类型（`SubscriptionCredentialView`/`DecryptedCredentials`/`DecryptedAiCredential`/`DecryptedSearchCredential`）。 |
| `packages/db/src/repositories.ts` | Topic/Source/Worker/Dashboard/Preference/Briefing/Governance/Credential repository。提供 tenant/topic scoped 查询 helper，后续新增查询应优先放在这里或同包内的清晰模块中。 |

### Repository 关键函数

| 函数 | 职责 |
|------|------|
| `ensureDefaultWorkspace()` | 创建默认 organization/user/membership。 |
| `createTopic()` / `createTopicWithActiveRssSource()` | 创建主题，带 tenant scope。 |
| `listOrganizationMemberships()` / `assertMembershipRole()` | 租户权限查询和角色断言。 |
| `attachActiveRssSource()` / `createCandidateRssSource()` | 信源绑定和候选源创建。 |
| `listActiveTopics()` / `listTopicsForSourceDiscovery()` | 主题列举（含 discovery 专用）。 |
| `listActiveSources()` / `listActiveRssSourcesForFetch()` | 活跃信源列举。 |
| `listTopicSourceOverview()` / `listSourceGovernanceReport()` | 信源治理报告。 |
| `updateSourceGovernanceStatus()` / `recordSourceQualityObservation()` | 信源治理操作。 |
| `createSourceFetchTaskRun()` / `createSourceDiscoveryTaskRun()` / `completeTaskRun()` / `failTaskRun()` | TaskRun 生命周期。 |
| `recordSourceFetchSuccess()` / `upsertFetchedItems()` | 抓取结果写入。 |
| `listFetchedItemsForAnalysis()` / `markItemFiltered()` / `upsertIntelligenceEventFromItem()` | 分析管线数据流。 |
| `listHighScoreEventPagesForDiscovery()` / `listRecentActiveSourcePagesForDiscovery()` | Source discovery 数据源。 |
| `listDashboardEvents()` / `getDashboardEventById()` | Dashboard 读取。 |
| `updateDashboardEventState()` | Dashboard 状态动作（READ/SAVED/DISMISSED）。 |
| `listRecentFeedbackSignals()` / `generatePreferenceDeltas()` / `upsertPreferenceMemory()` / `listPreferenceMemoryForDashboard()` | 偏好学习数据流。 |
| `listEventsForDailyBriefing()` / `createDailyBriefing()` / `listLatestBriefingsForDashboard()` / `getBriefingMarkdownForDownload()` | 简报数据流。 |
| `getEventMarkdownExportRecord()` | 单条情报导出数据。 |
| `getSubscriptionCredentialView(prisma, scope)` | 读取组织级凭证脱敏视图（`SubscriptionCredentialView`），含 AI/search 的 `hasKey`、`keyHint`、provider/baseUrl/model。供 Admin UI 展示，不返回明文。 |
| `upsertAiCredential(prisma, scope, input)` | 加密并存储 AI API Key（`apiKey`/`baseUrl?`/`provider?`/`model?`）。写入 `Subscription.aiEncryptedKey` + `aiKeyHint`，使用 `ENCRYPTION_KEY` 做 AES-256-GCM 加密。 |
| `upsertSearchCredential(prisma, scope, input)` | 加密并存储搜索 API Key（`apiKey`/`provider?`）。写入 `Subscription.searchEncryptedKey` + `searchKeyHint`。 |
| `getDecryptedCredentials(prisma, scope)` | 解密组织级 AI/search 凭证（`DecryptedCredentials`），供 worker 运行时使用。解密失败静默返回 `null`，不抛错。 |

---

## packages/core

共享领域逻辑：topic profile 初稿生成、relevance/noise 判定、event draft、gravity ranking、feedback delta、preference ranking、Markdown 渲染。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/core/src/index.ts` | 全部领域逻辑出口。 |

### 关键函数

| 函数 | 职责 |
|------|------|
| `buildTopicProfile(input)` | 从主题名称和描述生成 topic profile 初稿（keywords/entities/include/exclude）。 |
| `evaluateRelevance(item)` | 基于 topic profile keywords 做 relevance/noise 判定。 |
| `createIntelligenceEventDraft(item, relevance)` | 从相关 item 生成情报事件草稿。 |
| `createIntelligenceEventDraftFromExtraction(item, extraction)` | 从 AI 抽取结果生成事件草稿，携带 entities/followUpSuggestion。 |
| `calculateGravityScore(input)` | 计算 gravity ranking 综合分。 |
| `generatePreferenceDeltas(signals)` | 把 FeedbackEvent 归纳成 PreferenceMemory delta。 |
| `applyPreferenceWeights(events, memory)` | 应用 PreferenceMemory 权重到事件排序。 |
| `renderEventMarkdown(input)` | 渲染单条情报 Markdown 导出，包含 entities 和 followUpSuggestion。 |
| `renderDailyBriefingMarkdown(input)` | 渲染每日简报 Markdown。 |
| `createContentHash(value)` | Item 内容哈希。 |
| `extractKeywords(topicProfile)` | 从 topic profile 提取关键词。 |
| `preferenceKeysForEvent(input)` | 为事件生成相关 preference key。 |

### 规则

- 当前分析管线用 topic profile keywords 做 relevance/noise，用标题和 URL 生成 `eventHash`，用 `topicId + eventHash` 幂等 upsert 事件。
- Preference learning 使用可解释规则：`SAVE/EXPORT` 提升 category/source 权重，`READ` 轻微提升，`DISMISS` 降低；后续可替换为 LLM 归纳，但必须保留 `PreferenceMemory.explanation` 可解释性。
- Dashboard 排序使用 `gravityScore` 作为基础分，再应用 `PreferenceMemory` 权重；不得只记录反馈而不影响排序。

---

## packages/ai

OpenAI-compatible LLM adapter、响应解析、source recommendation。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/ai/src/index.ts` | 包公共出口。 |
| `packages/ai/src/types.ts` | AI adapter 共享类型。 |
| `packages/ai/src/openai-compatible.ts` | OpenAI-compatible Chat Completions adapter。 |
| `packages/ai/src/event-extraction.ts` | 事件抽取 prompt、严格 JSON 解析、entities/followUpSuggestion 抽取和 deterministic fallback。 |
| `packages/ai/src/event-extraction.fixtures.ts` | Event extraction fixture 测试。 |
| `packages/ai/src/parser.fixtures.ts` | Parser fixture 测试。 |
| `packages/ai/src/source-recommendation.ts` | 候选信源推荐 prompt、严格 JSON 解析、推荐理由 sanitize、0-1 相关性评分和 deterministic fallback。 |
| `packages/ai/src/source-recommendation.fixtures.ts` | Source recommendation fixture 测试。 |

### 规则

- AI adapter 保持 OpenAI-compatible，不绑定具体 vendor SDK。
- provider response 视为不可信，必须先 sanitize，再 parse，再 validate。
- Source recommendation 使用 `packages/ai` 生成一句推荐理由和 0-1 相关性评分；AI 调用失败或未配置 `AI_API_KEY`/`AI_BASE_URL` 时使用 deterministic fallback，并在 evidence 中记录推荐模式。
- JSON mode 不可用时允许 fallback，但需要按 model 记忆失败，避免每次都重复使用不兼容参数。

---

## packages/sources

RSS/Web source adapter、search provider、feed validation/probe、外链提取。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/sources/src/index.ts` | 包公共出口：RSS source adapter、search provider、feed validation/probe、外链提取。 |
| `packages/sources/src/discovery.ts` | Source discovery 工具：`SearchProvider`、`BraveSearchProvider`、主题 query 生成、RSS/Atom 探测、外链提取和 URL 安全过滤。 |
| `packages/sources/src/discovery.fixtures.ts` | Source discovery fixture 测试。 |

### 规则

- 仅接受 HTTP/HTTPS URL。
- Source discovery 三条渠道：`keyword-search`（Brave Search API + RSS/Atom 探测）、`backlink-from-highscore`（高分事件原文页反查 RSS/Atom）、`outlink-network`（active source 最近 item 外链网络）。无 `BRAVE_SEARCH_API_KEY` 时跳过关键词搜索，但不阻塞后两条渠道。
- Source discovery 只能写入 candidate pool，不得绕过治理流程直接标记为 `ACTIVE`；如果发现已存在 source，只更新推荐信息和 observation，不改变现有治理状态。

---

## packages/ui

共享 UI 包（预留）。当前为空 scaffold，UI 组件暂存在 `apps/web/src/components/ui/`。后续组件复用需求出现时再填充。

---

## apps/web

Next.js App Router 产品界面。按 `FRONTEND.md` 重构为 Kinetic Intelligence 风格：酸黄强调、顶部导航、中间限宽单列阅读区、密集情报卡片、可解释详情、信源质量数字和偏好置信度条。

### 目录结构

```text
apps/web/src/
├── app/                              # Next.js App Router
│   ├── layout.tsx                    # 根 layout
│   ├── page.tsx                      # 首页：未读情报流
│   ├── loading.tsx                   # route loading 骨架屏
│   ├── error.tsx                     # route error boundary
│   ├── globals.css                   # 全局 token、布局、组件样式
│   ├── actions.ts                    # Server Action 入口
│   ├── admin/settings/page.tsx       # Admin API Key 配置页（OWNER/ADMIN）
│   ├── api/health/route.ts           # Web health endpoint
│   ├── topics/new/page.tsx           # 新建主题页
│   ├── sources/page.tsx              # 信源治理页
│   ├── briefings/page.tsx            # 简报列表页
│   ├── saved/page.tsx                # 已收藏情报页
│   ├── preferences/page.tsx          # 偏好记忆页
│   ├── events/[eventId]/page.tsx     # 单条情报详情页
│   └── exports/
│       ├── events/[eventId]/route.ts    # 单条情报 Markdown 下载
│       └── briefings/[briefingId]/route.ts # 简报 Markdown 下载
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx             # AppShell 容器
│   │   └── top-nav.tsx               # 顶部导航（含设置齿轮入口 `/admin/settings`）
│   ├── intelligence/
│   │   ├── intelligence-card.tsx     # 情报卡片 client 组件
│   │   ├── intelligence-feed.tsx     # 情报流 client 组件
│   │   └── topic-filter.tsx          # 主题筛选标签条
│   ├── common/
│   │   ├── empty-state.tsx           # 通用空状态
│   │   ├── status-banner.tsx         # 状态横幅
│   │   └── page-header.tsx           # 页面标题 + eyebrow + meta
│   └── ui/                           # shadcn/Radix/Tailwind v4 组件
│       ├── button.tsx                # Button (primary/secondary/ghost/danger + asChild)
│       ├── card.tsx                  # Card (work/kinetic variant)
│       ├── badge.tsx                 # Badge (default/muted/success/warning/danger/accent)
│       ├── tabs.tsx                  # Tabs 基于 Radix，完整键盘导航和 ARIA
│       ├── input.tsx                 # Input
│       ├── label.tsx                 # Label 基于 Radix
│       └── textarea.tsx              # Textarea
└── lib/
    ├── event-display.ts              # 前端展示清洗：HTML/RSS 摘要转用户文案、原文链接提取、解释文案本地化
    ├── utils.ts                      # cn() = twMerge(clsx(...)) 标准 shadcn helper
    └── topic-source-data.ts          # 工作台数据读取；DATABASE_URL 未配置时抛错
```

### 关键文件

| 文件 | 目的 |
|------|------|
| `apps/web/components.json` | shadcn/ui v4 配置入口（radix 库、zinc baseColor、cssVariables）。 |
| `apps/web/postcss.config.mjs` | Tailwind v4 PostCSS 插件配置。 |
| `apps/web/src/app/page.tsx` | 首页：未读情报流，顶部搜索、主题筛选、`view=all\|high\|saved` 视图、情报卡片列表、已读/收藏/减少动作。 |
| `apps/web/src/app/events/[eventId]/page.tsx` | 单条情报详情页：稳定 URL、来源/时间/分数/解释、已读/收藏/减少、Markdown 导出和原文链接。 |
| `apps/web/src/app/topics/new/page.tsx` | 新建主题页：只填写主题名称和描述，提交后自动生成 topic profile 并尝试发现候选信源。 |
| `apps/web/src/app/sources/page.tsx` | 信源治理页：候选源表单、手动触发 source discovery、LLM/兜底推荐理由展示、质量报告、批准/观察/静音/拒绝动作。 |
| `apps/web/src/app/briefings/page.tsx` | 简报列表页 + Markdown 导出。 |
| `apps/web/src/app/saved/page.tsx` | 已收藏情报页。 |
| `apps/web/src/app/preferences/page.tsx` | 偏好记忆页：权重、置信度、解释。 |
| `apps/web/src/app/admin/settings/page.tsx` | Admin API Key 配置页（`/admin/settings`）：展示 AI/search 凭证状态（脱敏 hint），提供新增/覆盖 AI Key（`aiApiKey`/`aiBaseUrl`/`aiProvider`/`aiModel`）和搜索 Key（`searchApiKey`/`searchProvider`）的表单。OWNER/ADMIN 可访问，不展示完整 Key。 |
| `apps/web/src/app/actions.ts` | Server Action 入口；创建主题并自动匹配候选源、更新事件状态、创建候选源、手动 source discovery、信源治理、`upsertAiCredentialAction` / `upsertSearchCredentialAction`（OWNER/ADMIN 守卫，加密存储 API Key）。失败通过 stderr 记录，成功/失败通过 redirect URL 参数反馈。 |
| `apps/web/src/lib/event-display.ts` | 前端展示清洗 helper：把 RSS/HTML 摘要转成用户文案，提取 Article URL 作为原文链接，并本地化解释文案。 |
| `apps/web/src/lib/topic-source-data.ts` | 读取工作台数据和单条情报详情；`DATABASE_URL` 未配置时抛出错误，不再静默降级为预览模式；返回前调用 `event-display.ts` 清洗展示字段。 |
| `apps/web/src/app/exports/briefings/[briefingId]/route.ts` | 简报 Markdown 下载 route。 |
| `apps/web/src/app/exports/events/[eventId]/route.ts` | 单条情报 Markdown 下载 route。 |
| `apps/web/src/app/globals.css` | 全局 token、布局、组件样式、motion/reduced-motion、焦点状态、safe-area padding、触摸导航和响应式规则；按 `FRONTEND.md` 语义 token 定义。 |
| `FRONTEND.md` | `apps/web` 前端设计规范，定义 Kinetic Intelligence 风格、token、组件变体、页面组合、动效、响应式和可访问性边界。 |

### 前端维护规则

- UI 颜色优先使用 `globals.css` 中的 token，不在组件里散落 hex。
- 前端视觉和交互以 `FRONTEND.md` 为准；工作流页面使用密集、稳定、低干扰布局，品牌/空状态/新建主题模块才使用更强 kinetic typography。
- 情报正文、摘要、解释和来源名称不得全大写；来源和原文链接必须使用真实 `<a>`，外链补 `target="_blank"` 和 `rel="noreferrer"`。
- 页面和 Markdown 导出只允许把 HTTP/HTTPS URL 渲染为外链。
- 所有按钮和表单控件应保留明显 `focus-visible`，点击目标最小 44px；图标按钮必须保留 `aria-label`，移动端高频动作应显示文字标签或同等可理解提示。
- 移动端是原生支持目标，不是事后兼容：320px/375px/414px 下必须单列、无横向滚动，顶部导航可触摸横向滚动，主要 CTA 和情报动作需要适配 safe area 与拇指触达。
- 动效必须作为状态信号而不是装饰；新增动画时必须同步 `prefers-reduced-motion`。
- 不使用 `next/font/google`，避免构建期外部网络依赖。
- 首页搜索使用 `q` URL 参数，情报视图使用 `view=all|high|saved` URL 参数；新增筛选入口必须可点击、可刷新、可分享，不得只放静态按钮。
- 真实数据接入时，页面应通过 Server Components/Server Actions/Route Handlers 调用 `packages/db`，长任务仍交给 worker。
- `DATABASE_URL` 未配置时首页抛出错误，不再静默降级为预览模式。

### 数据访问模式

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

---

## apps/worker

Node.js TypeScript worker。负责抓取、item normalize、可解释分析、反馈归纳、简报生成、source quality observation、source discovery、health check。

### 关键文件

| 文件 | 目的 |
|------|------|
| `apps/worker/src/index.ts` | Worker 入口。所有 cycle 函数和 health check。 |

### Worker Cycle 函数

| 函数 | 职责 |
|------|------|
| `runWorkerHealthCheck()` | Worker 健康检查（`--health` 入口）。 |
| `runFetchCycle()` | 抓取 RSS：list active sources -> fetch -> normalize items -> upsert。 |
| `runSourceDiscoveryCycle()` | 信源发现：keyword-search + backlink + outlink -> candidate pool。 |
| `runAnalysisCycle()` | 分析：list fetched items -> relevance -> event draft -> gravity score -> upsert event。 |
| `runPreferenceLearningCycle()` | 偏好学习：list feedback -> generate deltas -> upsert preference memory。 |
| `runDailyBriefingCycle()` | 简报生成：list events -> render markdown -> create briefing。 |
| `runSourceGovernanceObservationCycle()` | 信源质量观测：计算 hit/noise/duplicate -> source observation。 |
| `fetchSourceWithRetries()` / `fetchSourceAttempt()` | 抓取重试（`MAX_FETCH_ATTEMPTS=3`）。 |
| `discoverFromKeywordSearch()` / `discoverFromHighScoreBacklinks()` / `discoverFromActiveSourceOutlinks()` | Source discovery 三条渠道实现。 |
| `createSearchProvider(prisma, organizationId)` | 异步工厂：先通过 `getDecryptedCredentials` 读取 DB 凭证创建 `BraveSearchProvider`，未配置时 fallback 到 `BRAVE_SEARCH_API_KEY` 环境变量，都没有返回 `null`。 |
| `createSourceRecommendationRuntime(prisma, organizationId)` | 异步工厂：先读 DB AI 凭证构建 `OpenAI-compatible` adapter + model，未配置时 fallback 到 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_L1` 环境变量，都没有返回 `null`。 |
| `createAnalysisRuntime(prisma, organizationId)` | 异步工厂：与 `createSourceRecommendationRuntime` 同源逻辑，为 analysis cycle 和 semantic dedup cycle 构建 event extraction adapter + model。 |

### Worker 规则

- Worker 负责抓取、item normalize、可解释分析、反馈归纳、简报生成和 source quality observation；后续真正 LLM relevance/event extraction/preference summarization/briefing rewrite/source discovery 应接入 `packages/ai`，但仍保持在 worker 中执行。
- Candidate sources 必须保持隔离：worker fetch 和 daily briefing 默认只使用 `ACTIVE` sources。
- Source discovery 只能写入 candidate pool，不得绕过治理流程直接标记为 `ACTIVE`。
- Topic/Source 写入必须保留 tenant scope：先通过默认 organization/user 获取 `organizationId`/`userId`，再写入。
- RSS URL 进入唯一性约束前必须 canonicalize；当前实现会去掉 hash、统一 hostname 小写并规整尾部 `/`。
- Worker fetch pipeline 必须有 attempt 上限；当前 `MAX_FETCH_ATTEMPTS=3`，每次尝试都会写入独立 `TaskRun`。
- AI/search 凭证优先从 DB 读取：`createSearchProvider` / `createSourceRecommendationRuntime` / `createAnalysisRuntime` 先调用 `getDecryptedCredentials(prisma, { organizationId })`，再 fallback 到 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_L1`/`BRAVE_SEARCH_API_KEY` 环境变量。解密失败静默跳过，不阻塞 worker。凭证明文不写入日志，调用完成后丢弃。

---

## 关键调用链汇总

### Fetch Cycle（抓取链路）

```text
apps/worker runFetchCycle()
  ↓ packages/db listActiveRssSourcesForFetch()
packages/sources fetchRssFeed()
  ↓
packages/db upsertFetchedItems()
  ↓
TaskRun / Source / Item
  ↓
Postgres
```

### Analysis Cycle（分析链路）

```text
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
```

### Dashboard Reading Workflow（阅读链路）

```text
apps/web getTopicSourceWorkspace()
  ↓ packages/db listDashboardEvents()
apps/web applies PreferenceMemory weights
  ↓
apps/web page renders unread/saved IntelligenceEvent list + detail
  ↓ apps/web /events/[eventId]
packages/db getDashboardEventById()
  ↓
Stable event detail URL + Markdown/original/source/actions
  ↓ Server Action updateDashboardEventStateAction()
packages/db updateDashboardEventState()
  ↓
IntelligenceEvent(status='READ'|'SAVED'|'DISMISSED')
UserItemState(status/saved/readAt/dismissedAt)
FeedbackEvent(kind='READ'|'SAVE'|'DISMISS')
```

### Preference Learning Cycle（偏好学习链路）

```text
FeedbackEvent(kind='READ'|'SAVE'|'DISMISS'|'EXPORT')
  ↓ apps/web action 或 apps/worker runPreferenceLearningCycle()
packages/core generatePreferenceDeltas()
  ↓ packages/db upsertPreferenceMemory()
PreferenceMemory(key/value/confidence/explanation)
  ↓
apps/web applies PreferenceMemory weights -> Dashboard 排序变化
```

### Briefing and Markdown Export（简报与导出链路）

```text
apps/worker runDailyBriefingCycle()
  ↓ packages/db listEventsForDailyBriefing()
packages/core renderDailyBriefingMarkdown()
  ↓ packages/db createDailyBriefing()
Briefing(markdown, events)
  ↓ apps/web /exports/briefings/[briefingId]
Markdown download + ExportEvent

Single-event Markdown export
  ↓ apps/web /exports/events/[eventId]
packages/db getEventMarkdownExportRecord()
  ↓ packages/core renderEventMarkdown()
Markdown download + ExportEvent + FeedbackEvent(kind='EXPORT')
```

### Source Governance（信源治理链路）

```text
apps/web createCandidateSourceAction()
  ↓ packages/db createCandidateRssSource(status='CANDIDATE')
apps/web updateSourceGovernanceAction()
  ↓ packages/db updateSourceGovernanceStatus()
Source(status='ACTIVE'|'CANDIDATE'|'MUTED'|'REJECTED')
SourceObservation(evidence)
FeedbackEvent(kind='SOURCE_APPROVE'|'SOURCE_REJECT')
  ↓ apps/worker runSourceGovernanceObservationCycle()
SourceObservation(hitRate/noiseRate/duplicateRate)
```

### Source Discovery（信源发现链路）

```text
apps/web runSourceDiscoveryAction() 或 apps/worker --source-discovery
  ↓ apps/worker runSourceDiscoveryCycle()
packages/sources BraveSearchProvider / feed probe / external links
  ↓ keyword-search + backlink-from-highscore + outlink-network candidates
packages/ai recommendSourceCandidate() 或 deterministic fallback
  ↓ packages/db createCandidateRssSource()
Source(status='CANDIDATE', discoveryChannel, recommendationReason, trustScore)
SourceObservation(evidence)
TaskRun(type='SOURCE_DISCOVERY')
UsageEvent(type='SOURCE_DISCOVERY')
```

### Commercial Readiness Boundary（商业化边界链路）

```text
packages/db ensureDefaultWorkspace()
  ↓
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
  ↓ apps/worker runFetchCycle() / runSourceDiscoveryCycle()
FETCH / BRIEFING / SOURCE_GOVERNANCE / SOURCE_DISCOVERY usage events
```

### Admin Credential Configuration（Admin 凭证配置链路）

```text
apps/web TopNav Settings 齿轮 -> /admin/settings
  ↓ apps/web/src/app/admin/settings/page.tsx (Server Component)
packages/db getSubscriptionCredentialView(prisma, { organizationId })
  ↓ 返回 SubscriptionCredentialView（脱敏 hint，不含明文）
Admin UI 渲染 AI/search 凭证状态 + 表单

Admin 提交 AI Key 表单
  ↓ apps/web upsertAiCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db upsertAiCredential(prisma, scope, input)
packages/db/crypto encryptCredential(apiKey, ENCRYPTION_KEY) + maskKeyHint(apiKey)
  ↓
Subscription.aiEncryptedKey + aiKeyHint + aiBaseUrl + aiModel
UsageEvent(type='WEB_ACTION', subjectType='subscription')

Admin 提交搜索 Key 表单
  ↓ apps/web upsertSearchCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db upsertSearchCredential(prisma, scope, input)
packages/db/crypto encryptCredential + maskKeyHint
  ↓
Subscription.searchEncryptedKey + searchKeyHint + searchProvider

Worker 运行时读取凭证
  ↓ apps/worker createSearchProvider / createSourceRecommendationRuntime / createAnalysisRuntime
packages/db getDecryptedCredentials(prisma, { organizationId })
  ↓ packages/db/crypto decryptCredential(encrypted, ENCRYPTION_KEY)
DecryptedCredentials(ai: {apiKey, baseUrl, model} | null, search: {apiKey, provider} | null)
  ↓ fallback to env vars if DB credential 缺失
AI adapter / BraveSearchProvider
```

### Deployment and Health（部署与健康检查链路）

```text
apps/web /api/health
  ↓ DATABASE_URL optional check + Prisma SELECT 1
apps/worker --health
  ↓ DATABASE_URL optional check + Prisma SELECT 1
docs/deployment.md
  ↓ env template + service start + logging + rollback guidance
```
