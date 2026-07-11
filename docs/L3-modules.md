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
| `packages/db/prisma/migrations/0008_briefing_idempotency/migration.sql` | 合并既有重复 Briefing（保留最新、迁移 ExportEvent、合并事件关系），再增加 `topicId + period + rangeStart` 唯一索引。 |
| `packages/db/prisma/migrations/0009_delivery_report_feedback/migration.sql` | 新增 `DeliveryLog`、`Report` 模型，`DeliveryChannel`/`DeliveryStatus`/`ReportStatus` 枚举，`Subscription` 表 Telegram 凭证字段，`TaskRunType` 新增 `REPORT_GENERATION`/`TELEGRAM_DELIVERY`，`FeedbackKind` 新增 6 种增强反馈。 |
| `packages/db/prisma/migrations/0010_subscription_plan_auth/migration.sql` | 新增 `Plan`/`SubscriptionStatus` 枚举，`PaymentInvoice`/`Account`/`Session` 模型（Better Auth 兼容），`Subscription` 表扩展 plan/status/byok/ccpayment/stripe 字段。 |
| `packages/db/prisma/migrations/0011_source_governance_enhancements/migration.sql` | 新增 `Source.observeExpiresAt` 字段，用于候选源观察到期复审机制。 |
| `packages/db/prisma/seed.ts` | 创建默认工作区、默认用户，然后按 seed 列表创建 topic 和 source。topic 和 source 都是 create-only：已存在的不被重置 status 或覆盖 profile，保证用户在 UI 上的 mute/reject 和 profile 编辑不被 seed 重置。 |
| `packages/db/seed-sources.json` | 仓库内维护的默认信源列表。schema：`{ version:1, topics:[{ name, description?, keywords?, sources:[{name,url}] }] }`。 |
| `packages/db/src/client.ts` | 懒加载 Prisma Client，并用 `@prisma/adapter-pg` 注入 Postgres adapter，避免 build-time 读取运行时数据库。 |
| `packages/db/src/crypto.ts` | AES-256-GCM 凭证加解密工具。`encryptCredential(plaintext, key)` / `decryptCredential(encrypted, key)` / `maskKeyHint(plaintext)`。密钥来自 `ENCRYPTION_KEY` 环境变量，输出格式 `iv:ciphertext:tag`（base64）。 |
| `packages/db/src/index.ts` | 包公共出口。导出 repositories、crypto 函数（`encryptCredential`/`decryptCredential`/`maskKeyHint`）以及凭证类型（`SubscriptionCredentialView`/`DecryptedCredentials`/`DecryptedAiCredential`/`DecryptedSearchCredential`）。 |
| `packages/db/src/repositories.ts` | Topic/Source/Worker/Dashboard/Preference/Briefing/Governance/Credential repository。提供 tenant/topic scoped 查询 helper，后续新增查询应优先放在这里或同包内的清晰模块中。信源治理函数包括 `updateSourceGovernanceStatus`、`batchUpdateSourceGovernanceStatus`、`listExpiredCandidateSources`、`listCandidateRssSourcesForObservation`、`setSourceObserveExpiry`、`autoMuteFailingSources`。 |
| `packages/db/src/extended-repositories.ts` | Telegram 凭证管理（`getTelegramCredentialView`/`upsertTelegramCredential`/`deleteTelegramCredential`/`getDecryptedTelegramCredential`/`testTelegramCredential`）、DeliveryLog CRUD（`createDeliveryLog`/`updateDeliveryLog`/`findPendingDeliveryForBriefing`/`findBriefingsForTelegramDelivery`）、Report CRUD（`createReport`/`getReport`/`listReports`/`updateReportStatus`/`completeReport`/`failReport`）、证据检索（`searchReportEvidenceEvents`）、偏好编辑（`deletePreferenceMemory`/`updatePreferenceMemoryWeight`/`recordEnhancedFeedback`）、订阅计划管理（`getSubscriptionPlanView`/`updateSubscriptionPlan`/`setSelfHostedMode`）、用量统计（`getTodayAiCallCount`/`getMonthAiCallCount`/`getMonthExportCount`/`getTopicCount`/`getActiveSourceCount`）和 per-user BYOK 凭证管理（`upsertByokCredential`/`deleteByokCredential`/`getByokCredentialView`/`testByokCredential`）。 |
| `packages/db/src/repositories.fixtures.ts` | Repository fixture：验证收藏集合 scope/分页/状态转换，以及 daily briefing 时间窗口、幂等 upsert 和历史分页。 |
| `packages/db/src/ccpayment.ts` | CCPayment 支付适配器。`createCcpaymentInvoice()`（创建支付订单）、`getCcpaymentOrderInfo()`（查询订单状态）、`verifyCcpaymentWebhookSignature()`（webhook 签名校验）。依赖 `CCPAYMENT_APP_ID`/`CCPAYMENT_APP_SECRET` 环境变量。 |

### Repository 关键函数

| 函数 | 职责 |
|------|------|
| `ensureDefaultWorkspace()` | 创建默认 organization/user/membership。 |
| `createTopic()` / `createTopicWithActiveRssSource()` | 创建主题，带 tenant scope。 |
| `listOrganizationMemberships()` / `assertMembershipRole()` | 租户权限查询和角色断言；工作区审计页仅允许 OWNER/ADMIN。 |
| `attachActiveRssSource()` / `createCandidateRssSource()` | 信源绑定和候选源创建。 |
| `listActiveTopics()` / `listTopicsForSourceDiscovery()` | 主题列举（含 discovery 专用）。 |
| `getTopicById()` / `listAllTopics()` | 主题详情和全量列表（含 PAUSED/ARCHIVED）。 |
| `updateTopic()` / `updateTopicStatus()` / `deleteTopic()` | 主题编辑、状态转换（pause/resume/archive/restore）、硬删除。 |
| `listActiveSources()` / `listActiveRssSourcesForFetch()` | 活跃信源列举。 |
| `listTopicSourceOverview()` / `listSourceGovernanceReport()` | 信源治理报告；后者按 active primary/secondary EventItem 关系计算 hit/noise/duplicate 与唯一活跃事件数。 |
| `updateSourceGovernanceStatus()` / `recordSourceQualityObservation()` | 信源治理操作。 |
| `batchUpdateSourceGovernanceStatus()` | 批量信源治理：支持批量 approve/mute/reject/observe，统一写 `FeedbackEvent` 审计。 |
| `listExpiredCandidateSources()` | 查询 `observeExpiresAt` 已过期的候选源，供过期候选源复审 cycle 使用。 |
| `listCandidateRssSourcesForObservation()` | 查询 CANDIDATE 状态的 RSS source，供低频候选源观察 fetch 使用。 |
| `setSourceObserveExpiry()` | 设置候选源观察到期时间。 |
| `autoMuteFailingSources()` | 自动静音连续失败次数超过阈值的 ACTIVE source。 |
| `createTaskRun()` / `createSourceFetchTaskRun()` / `createSourceDiscoveryTaskRun()` / `completeTaskRun()` / `failTaskRun()` | 通用 TaskRun 创建与生命周期；专用 fetch/discovery helper 复用相同 RUNNING/attempt/timing 契约。 |
| `recordSourceFetchSuccess()` / `upsertFetchedItems()` | 抓取结果写入。 |
| `listFetchedItemsForAnalysis()` / `markItemFiltered()` / `upsertIntelligenceEventFromItem()` | 分析管线数据流；标题模糊命中按已有 event id 更新，维护唯一 PRIMARY EventItem，并把旧 primary 标记为 SECONDARY/DUPLICATE。 |
| `listHighScoreEventPagesForDiscovery()` / `listRecentActiveSourcePagesForDiscovery()` | Source discovery 数据源。 |
| `listDashboardEvents()` / `getDashboardEventById()` | Dashboard 首页与详情读取。 |
| `listSavedDashboardEvents()` | 按 `organizationId + userId + UserItemState.saved=true` 查询完整收藏集合，返回总数与稳定分页；不复用首页 Top 30 截断结果。 |
| `updateDashboardEventState()` | Dashboard 状态动作（READ/SAVED/DISMISSED/unsave）；已收藏事件执行 READ 时保留 saved 状态，只有显式 unsave 才移出收藏集合。 |
| `recordCategoryPreferenceFeedback()` | 详情页 category up/down：tenant-scoped 校验事件，写 `CATEGORY_UP/DOWN`，不改变事件状态。 |
| `listRecentFeedbackSignals()` / `generatePreferenceDeltas()` / `upsertPreferenceMemory()` / `listPreferenceMemoryForDashboard()` | 偏好学习数据流；读取状态/导出/category 信号，并按 `topicId + preference key` 隔离归纳。 |
| `listEventsForDailyBriefing()` / `createDailyBriefing()` | UTC daily window 事件读取与 `topicId + DAILY + rangeStart` 幂等 upsert；更新时替换事件关系集合。 |
| `createPeriodBriefing()` / `listTimelineEvents()` | 周报/月报幂等 upsert（`topicId + period + rangeStart`）和主题时间线查询（按 `occurredAt` 倒序分页，含 merged sources）。 |
| `listBriefingsPage()` / `getBriefingMarkdownForDownload()` | organization-scoped 完整简报历史分页（支持 period 筛选）与下载读取。 |
| `getEventMarkdownExportRecord()` | 单条情报导出数据。 |
| `getSubscriptionCredentialView(prisma, scope)` | 读取组织级凭证脱敏视图（`SubscriptionCredentialView`），含 AI/search 的 `hasKey`、`keyHint`、provider/baseUrl/model。供 Admin UI 展示，不返回明文。 |
| `upsertAiCredential(prisma, scope, input)` | 加密并存储 AI API Key（`apiKey`/`baseUrl?`/`provider?`/`model?`）。写入 `Subscription.aiEncryptedKey` + `aiKeyHint`，使用 `ENCRYPTION_KEY` 做 AES-256-GCM 加密。 |
| `upsertSearchCredential(prisma, scope, input)` | 加密并存储搜索 API Key（`apiKey`/`provider?`）。写入 `Subscription.searchEncryptedKey` + `searchKeyHint`。 |
| `deleteAiCredential(prisma, scope)` | 清除 AI 凭证（upsert null 到 `aiEncryptedKey`/`aiKeyHint`/`aiBaseUrl`/`aiProvider`/`aiModel`）。 |
| `deleteSearchCredential(prisma, scope)` | 清除搜索凭证（upsert null 到 `searchEncryptedKey`/`searchKeyHint`/`searchProvider`）。 |
| `testAiCredential(prisma, scope)` | 测试 AI 凭证连接：`GET {baseUrl}/models` + Bearer auth，10s 超时；若端点返回 404/405/415/501 或超时则回退到 `POST /chat/completions`（最小 payload）兜底验证。返回 `CredentialTestResult`（`{ok, message}`）。 |
| `listAiModels(credential)` | 嗅探 OpenAI-compatible 端点的可用模型列表：`GET {baseUrl}/models` + Bearer auth，解析 `{ data: [{ id, owned_by }] }`，按 id 字典序排序返回 `AiModelListResult`（`{ok, message, models}`）。10s 超时，不依赖 Prisma。 |
| `testSearchCredential(prisma, scope)` | 测试搜索凭证连接：按 `provider`（brave/serpapi/tavily）调用对应搜索 API 验证 Key；`custom` 或不支持的 provider 返回"暂不支持自动测试"提示；10s 超时，返回 `CredentialTestResult`。 |
| `getDecryptedCredentials(prisma, scope)` | 解密组织级 AI/search 凭证（`DecryptedCredentials`），供 worker 运行时使用。解密失败静默返回 `null`，不抛错。 |
| `getSubscriptionPlanView(prisma, scope)` | 读取组织订阅计划视图：`plan`、`status`、`isSelfHosted`、`currentPeriodStart/End` 和 BYOK 凭证脱敏 hint。 |
| `updateSubscriptionPlan(prisma, scope, input)` | 更新订阅计划（`plan`/`status`/`currentPeriodStart`/`currentPeriodEnd`/`canceledAt`）。支付确认后触发。 |
| `setSelfHostedMode(prisma, scope, enabled)` | 开关自用模式。`true` 时 `isSelfHosted=true`，跳过所有配额检查。 |
| `getTodayAiCallCount(prisma, scope)` / `getMonthAiCallCount(prisma, scope)` | 读取当日/当月 AI 调用次数（`UsageEvent(type='AI_CALL')` 聚合），供配额引擎和用量仪表盘使用。 |
| `getMonthExportCount(prisma, scope)` | 读取当月导出次数（`UsageEvent(type='EXPORT')` 聚合）。 |
| `getTopicCount(prisma, scope)` / `getActiveSourceCount(prisma, scope)` | 读取当前主题数和活跃信源数，供配额检查使用。 |
| `upsertByokCredential(prisma, scope, input)` | 加密并存储 per-user BYOK 凭证（`byokApiKey`/`byokBaseUrl?`/`byokProvider?`/`byokModel?`）。写入 `Subscription.byokEncryptedKey` + `byokKeyHint`，使用 `ENCRYPTION_KEY` 做 AES-256-GCM 加密。 |
| `deleteByokCredential(prisma, scope)` | 清除 per-user BYOK 凭证（upsert null 到 `byok*` 字段）。 |
| `getByokCredentialView(prisma, scope)` | 读取 BYOK 凭证脱敏视图（`byokKeyHint` + provider/baseUrl/model），供 Admin UI 展示。 |
| `testByokCredential(prisma, scope)` | 测试 BYOK 凭证连接（复用 `testAiCredential` 逻辑），返回 `CredentialTestResult`。 |
| `createCcpaymentInvoice(prisma, scope, input)` | 创建 CCPayment 支付订单，返回支付 URL。依赖 `CCPAYMENT_APP_ID`/`CCPAYMENT_APP_SECRET`。 |
| `getCcpaymentOrderInfo(orderId)` | 查询 CCPayment 订单状态。 |
| `verifyCcpaymentWebhookSignature(payload, signature)` | 验证 CCPayment webhook 签名，防止伪造回调。 |

---

## packages/core

共享领域逻辑：topic profile 初稿生成、relevance/noise 判定、event draft、gravity ranking、feedback delta、preference ranking、Markdown 渲染。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/core/src/index.ts` | 全部领域逻辑出口。 |
| `packages/core/src/quota.ts` | 配额引擎。`PLAN_LIMITS` 定义 FREE/PLUS/PRO 三层配额（主题数、信源数、AI 调用次数、导出次数）。`checkTopicQuota()`/`checkSourceQuota()`/`checkAiCallQuota()`/`checkExportQuota()` 检查当前用量是否超限。`shouldUseByok()` 根据 Plan 和 BYOK 配置决定是否使用 per-user BYOK 凭证。 |

### 关键函数

| 函数 | 职责 |
|------|------|
| `buildTopicProfile(input)` | 从主题名称和描述生成 topic profile 初稿（keywords/entities/include/exclude）。 |
| `buildTopicProfileContext(profile, topic)` | 清洗 profile 字符串数组，并与 Topic 行的当前 name/description 组装为 Worker AI 输入，避免读取过期 profile identity。 |
| `evaluateRelevance(item)` | 基于 title/summary 匹配 profile：excludeScope 优先否决；keywords/entities/includeScope 提供可解释正信号与分数。 |
| `createIntelligenceEventDraft(item, relevance)` | 从相关 item 生成情报事件草稿。 |
| `createIntelligenceEventDraftFromExtraction(item, extraction)` | 从 AI 抽取结果生成事件草稿，携带 entities/followUpSuggestion。 |
| `calculateGravityScore(input)` | 计算 gravity ranking 综合分。 |
| `generatePreferenceDeltas(signals)` | 把 FeedbackEvent 归纳成 PreferenceMemory delta。偏好信号带 30 天半衰期时间衰减（`applyTimeDecay`），旧信号自动衰减权重。 |
| `applyPreferenceWeights(events, memory)` | 应用 PreferenceMemory 权重到事件排序。 |
| `renderEventMarkdown(input)` | 渲染单条情报 Markdown 导出，包含 entities 和 followUpSuggestion。 |
| `renderDailyBriefingMarkdown(input)` | 渲染每日简报 Markdown。 |
| `createContentHash(value)` | Item 内容哈希。 |
| `createUtcDayRange(value)` | 生成稳定 UTC 自然日 `[rangeStart, rangeEnd)`，供 daily briefing 查询和幂等键复用。 |
| `extractKeywords(topicProfile)` | 从 topic profile 提取关键词。 |
| `preferenceKeysForEvent(input)` | 为事件生成相关 preference key。 |

### 规则

- 当前规则分析管线以 excludeScope > keywords/entities/includeScope 的优先级做 relevance/noise；importanceRules 保持 AI-only。规则 draft 把命中实体写入事件，并把所有命中信号写入 explanation。标题和 URL 生成 `eventHash`，用 `topicId + eventHash` 幂等 upsert 事件。
- Preference learning 使用可解释规则：`SAVE/EXPORT` 提升 category/source 权重，`READ` 轻微提升，`DISMISS` 降低，`CATEGORY_UP/DOWN` 只改变 category 权重；增强反馈（`SOURCE_QUALITY_UP/DOWN`、`SCORE_UP/DOWN`、`MORE/LESS_LIKE_THIS`）提供更细粒度的 source/score/entity 信号。偏好信号带 30 天半衰期时间衰减（`PREFERENCE_DECAY_HALF_LIFE_DAYS=30`），归纳 Map 使用 `topicId + key` 复合键避免跨主题污染。后续可替换为 LLM 归纳，但必须保留 `PreferenceMemory.explanation` 可解释性。
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
| `packages/ai/src/event-extraction.ts` | 事件抽取 prompt、严格 JSON 解析、entities/followUpSuggestion 抽取和 deterministic fallback。支持 `rawContent`（原文全文）和 `languagePreferences`（输出语言 + 术语规则）输入。 |
| `packages/ai/src/event-extraction.fixtures.ts` | Event extraction fixture 测试。 |
| `packages/ai/src/parser.fixtures.ts` | Parser fixture 测试，覆盖 sanitize/extract/parse/repair/validate 边界。 |
| `packages/ai/src/adapter.fixtures.ts` | OpenAI-compatible adapter fixture 测试，覆盖 retry、timeout、JSON mode fallback 和非 JSON 错误体处理。 |
| `packages/ai/src/source-recommendation.ts` | 候选信源推荐 prompt、严格 JSON 解析、推荐理由 sanitize、0-1 相关性评分和 deterministic fallback。 |
| `packages/ai/src/source-recommendation.fixtures.ts` | Source recommendation fixture 测试。 |
| `packages/ai/src/semantic-dedup.ts` | 语义去重 prompt 和严格 JSON 解析。 |
| `packages/ai/src/semantic-dedup.fixtures.ts` | Semantic dedup fixture 测试。 |

### 规则

- AI adapter 保持 OpenAI-compatible，不绑定具体 vendor SDK。
- provider response 视为不可信，必须先 sanitize，再 parse，再 validate。
- Source recommendation 使用 `packages/ai` 生成一句推荐理由和 0-1 相关性评分；AI 调用失败或未配置 `AI_API_KEY`/`AI_BASE_URL` 时使用 deterministic fallback，并在 evidence 中记录推荐模式。
- JSON mode 不可用时允许 fallback，但需要按 model 记忆失败，避免每次都重复使用不兼容参数。

---

## packages/sources

RSS/Web source adapter、search provider、feed validation/probe、外链提取、原文全文抓取（readability）。

### 关键文件

| 文件 | 目的 |
|------|------|
| `packages/sources/src/index.ts` | 包公共出口：RSS source adapter、search provider、feed validation/probe、外链提取、`fetchArticleContent()`（基于 `@mozilla/readability` + `linkedom` 提取网页正文）、`fetchArxivPapers()`/`fetchGitHubReleases()` 专用适配器、`createSearchProvider()` 工厂。 |
| `packages/sources/src/discovery.ts` | Source discovery 工具：`SearchProvider`、`BraveSearchProvider`、`TavilySearchProvider`、`SerperSearchProvider`、`SearXngSearchProvider`、`createSearchProvider()` 工厂、主题 query 生成、RSS/Atom 探测、外链提取和 URL 安全过滤。 |
| `packages/sources/src/adapters.ts` | 专用适配器：`fetchArxivPapers(searchQuery, options)`（arXiv Atom API）、`fetchGitHubReleases(repo, options)`（GitHub releases API）。 |
| `packages/sources/src/discovery.fixtures.ts` | Source discovery fixture 测试。 |
| `packages/sources/src/adapters.fixtures.ts` | arXiv 和 GitHub releases 适配器 fixture 测试。 |
| `packages/sources/src/parser.fixtures.ts` | RSS/Atom parser edge-case fixtures: content:encoded priority, Atom rel=alternate, numeric entities, CDATA, empty feed, Atom date fallback |

### 规则

- 仅接受 HTTP/HTTPS URL。
- Source discovery 三条渠道：`keyword-search`（搜索 provider + RSS/Atom 探测）、`backlink-from-highscore`（高分事件原文页反查 RSS/Atom）、`outlink-network`（active source 最近 item 外链网络）。`keyword-search` 支持 Brave/Tavily/Serper/SearXNG 四种 provider，通过 `WANGCHAO_SEARCH_PROVIDER` 选择，`createSearchProvider()` 按类型创建。无配置 API Key 时跳过关键词搜索，但不阻塞后两条渠道。
- Source discovery 只能写入 candidate pool，不得绕过治理流程直接标记为 `ACTIVE`；如果发现已存在 source，只更新推荐信息和 observation，不改变现有治理状态。
- `fetchArticleContent()` 在 Worker fetch cycle 后对无 `rawContent` 的 Item 异步抓取原文全文；失败不阻塞主流程，结果写入 `Item.rawContent`。RSS `content:encoded` 字段也会被提取为 `rawContent`，无需额外 HTTP 请求。

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
│   ├── admin/settings/page.tsx       # Admin API Key 配置页（Tabs 布局，OWNER/ADMIN）
│   ├── admin/usage/page.tsx          # OWNER/ADMIN 成员与近 30 天用量审计
│   ├── admin/settings/credential-form.tsx  # 凭证表单客户端组件（密码显隐/Provider 下拉/loading）
│   ├── admin/settings/telegram-form.tsx  # Telegram 凭证表单客户端组件（Bot Token/Chat ID/测试连接）
│   ├── login/page.tsx                # 登录页（email/password）
│   ├── register/page.tsx             # 注册页（email/password）
│   ├── pricing/page.tsx              # 定价页（FREE/PLUS/PRO 三层对比）
│   ├── usage/page.tsx                # 用量仪表盘（配额进度条、AI 调用/导出统计）
│   ├── api/health/route.ts           # Web health endpoint
│   ├── api/auth/[...all]/route.ts    # Better Auth catch-all route handler
│   ├── api/billing/ccpayment/create-invoice/route.ts  # CCPayment 创建支付订单
│   ├── api/billing/ccpayment/webhook/route.ts          # CCPayment webhook（签名验证 + 幂等）
│   ├── api/billing/stripe/checkout/route.ts            # Stripe checkout session 创建（骨架）
│   ├── api/billing/stripe/webhook/route.ts             # Stripe webhook（骨架，未配置时返回 placeholder）
│   ├── topics/new/page.tsx           # 新建主题页
│   ├── topics/page.tsx              # 主题管理列表页（含 PAUSED/ARCHIVED）
│   ├── topics/[topicId]/page.tsx    # 主题详情页（状态、统计、管理操作、时间线/批量导出入口）
│   ├── topics/[topicId]/edit/page.tsx # 主题编辑页（name/description/profile）
│   ├── topics/[topicId]/timeline/page.tsx # 主题时间线页（按 occurredAt 倒序）
│   ├── sources/page.tsx              # 信源治理页
│   ├── briefings/page.tsx            # 简报列表页（DAILY/WEEKLY/MONTHLY 筛选）
│   ├── saved/page.tsx                # 已收藏情报页
│   ├── preferences/page.tsx          # 偏好记忆页（含权重调整/删除）
│   ├── reports/page.tsx              # 专题报告列表页（提交问题、历史报告）
│   ├── reports/[reportId]/page.tsx   # 专题报告详情页（Markdown 内容、覆盖说明）
│   ├── events/[eventId]/page.tsx     # 单条情报详情页（含增强反馈按钮）
│   └── exports/
│       ├── events/[eventId]/route.ts    # 单条情报 Markdown 下载
│       ├── briefings/[briefingId]/route.ts # 简报 Markdown 下载（Obsidian-friendly 文件名）
│       └── topics/[topicId]/route.ts    # 主题批量导出（Top 100 事件）
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx             # AppShell 容器
│   │   └── top-nav.tsx               # 顶部导航（首页/专题报告/主题/信源/简报/收藏/偏好/设置齿轮入口）
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
│       ├── input.tsx                 # Input（React.forwardRef，支持 ref 转发）
│       ├── label.tsx                 # Label 基于 Radix
│       └── textarea.tsx              # Textarea
└── lib/
    ├── event-display.ts              # 前端展示清洗：HTML/RSS 摘要转用户文案、原文链接提取、解释文案本地化
    ├── report-data.ts                # 专题报告数据读取：`getReportsPage()`（分页列表）、`getReportDetail()`（单条详情）
    ├── auth.ts                       # Better Auth 服务端配置（email/password + session + Prisma adapter）
    ├── auth-client.ts                # Better Auth 客户端（createAuthClient for browser）
    ├── session.ts                    # Session helper：`getSessionWorkspace()`（auth 启用时读 session，否则 fallback 到 ensureDefaultWorkspace）
    ├── utils.ts                      # cn() = twMerge(clsx(...)) 标准 shadcn helper
    └── topic-source-data.ts          # 工作台与 dedicated audit 数据读取；DATABASE_URL 未配置时抛错
```

### 关键文件

| 文件 | 目的 |
|------|------|
| `apps/web/components.json` | shadcn/ui v4 配置入口（radix 库、zinc baseColor、cssVariables）。 |
| `apps/web/postcss.config.mjs` | Tailwind v4 PostCSS 插件配置。 |
| `apps/web/src/app/page.tsx` | 首页：未读情报流，顶部搜索、主题筛选、`view=all\|high\|saved` 视图、情报卡片列表、已读/收藏/减少动作；卡片来源名称链接到 Source URL，“原文”动作只链接到清洗后的 Item/Article URL，无原文时降级显示“来源”。 |
| `apps/web/src/app/events/[eventId]/page.tsx` | 单条情报详情页：稳定 URL、来源/时间/分数/解释、已读/收藏/减少、Markdown 导出和原文链接。 |
| `apps/web/src/app/topics/new/page.tsx` | 新建主题页：只填写主题名称和描述，提交后自动生成 topic profile 并尝试发现候选信源。 |
| `apps/web/src/app/sources/page.tsx` | 信源治理页：候选源表单、手动触发 source discovery、LLM/兜底推荐理由展示、质量报告、批准/观察/静音/拒绝动作、批量治理工具栏、过期候选源复审卡片。 |
| `apps/web/src/app/topics/page.tsx` | 主题管理列表页：展示所有主题（含 PAUSED/ARCHIVED），每行带状态 Badge、编辑/暂停/恢复/归档/删除操作。 |
| `apps/web/src/app/topics/[topicId]/page.tsx` | 主题详情页：展示主题信息、关联统计（信源数/事件数/简报数）、状态管理操作入口。 |
| `apps/web/src/app/topics/[topicId]/edit/page.tsx` | 主题编辑页：编辑 name/description 与 keywords/entities/includeScope/excludeScope/importanceRules；每项有长度/条数边界，保存后重定向回详情页。 |
| `apps/web/src/components/topics/delete-topic-button.tsx` | 删除主题客户端按钮组件，带 `confirm()` 二次确认。 |
| `apps/web/src/app/briefings/page.tsx` | organization-scoped 完整简报历史分页：总数、周期（DAILY/WEEKLY/MONTHLY 筛选 tabs）、UTC 日期窗口、更新时间、上一页/下一页和 Markdown 导出。 |
| `apps/web/src/app/topics/[topicId]/timeline/page.tsx` | 主题时间线页：按 `occurredAt` 倒序分页展示主题全部正式事件（含 merged sources、score、source link），提供上一页/下一页。 |
| `apps/web/src/app/saved/page.tsx` | 已收藏情报页：通过 dedicated user-scoped repository 分页读取完整收藏集合，显示总数和上一页/下一页；标题可进入详情，已读、取消收藏、原文动作保留在当前页面，取消收藏不写负反馈。 |
| `apps/web/src/app/preferences/page.tsx` | 偏好记忆页：权重、置信度、解释；置信度条提供 `progressbar` 语义；支持权重调整（`updatePreferenceWeightAction`）和删除偏好（`deletePreferenceAction`）。 |
| `apps/web/src/app/reports/page.tsx` | 专题报告列表页：用户提交自然语言问题（`createReportAction`），异步触发报告生成；展示历史报告列表（分页），含状态 Badge（排队中/生成中/已完成/失败/信息不足）。 |
| `apps/web/src/app/reports/[reportId]/page.tsx` | 专题报告详情页：展示报告 Markdown 内容、事件/主题/信源统计、覆盖说明和状态；PENDING/GENERATING 显示"生成中"提示。 |
| `apps/web/src/lib/report-data.ts` | 报告数据读取 helper：`getReportsPage()` 分页列表、`getReportDetail()` 单条详情；使用 `getSessionWorkspace()` 获取 workspace scope；`DATABASE_URL` 未配置时抛错。 |
| `apps/web/src/app/admin/settings/telegram-form.tsx` | `"use client"` Telegram 凭证表单组件：Bot Token 密码显隐、Chat ID 输入、测试当前配置（`testTelegramCredentialAction`）、测试通过后可保存（`upsertTelegramCredentialAction`）。 |
| `apps/web/src/app/admin/settings/page.tsx` | Admin API Key 配置页（`/admin/settings`）：Tabs 布局（AI 凭证 / 搜索凭证 / Telegram 投递 / BYOK / CCPayment / 自用模式）；展示 AI/search/Telegram 凭证状态（脱敏 hint + key-value 布局 + 更新时间）；AI tab 提供新增/覆盖 AI Key（`aiApiKey`/`aiBaseUrl`/`aiProvider`/`aiModel`）、测试连接、清除凭证操作；Search tab 提供新增/覆盖搜索 Key（`searchApiKey`/`searchProvider`）、测试连接、清除凭证操作；Telegram tab 提供 Bot Token + Chat ID 配置、测试连接、清除凭证操作；BYOK tab 提供 per-user BYOK 凭证管理（加密存储、脱敏展示、Plus 必填/Pro 可选）；CCPayment tab 配置加密支付；自用模式开关跳过所有配额检查。OWNER/ADMIN 可访问，不展示完整 Key。 |
| `apps/web/src/app/admin/usage/page.tsx` | OWNER/ADMIN 工作区审计页：成员角色、近 30 天 UsageEvent 分类型/单位汇总；数量不跨单位相加。 |
| `apps/web/src/app/admin/settings/credential-form.tsx` | `"use client"` 凭证表单组件：密码显隐切换（Eye/EyeOff）、Provider 下拉选择（AI: OpenAI/Azure/Anthropic/Groq/DeepSeek/自定义；Search: Brave/SerpAPI/Tavily/自定义）+ 已知 Provider 自动填充 Base URL（ref 实现）、帮助链接、必填/可选标记、`useFormStatus` 提交 loading 态；`onSubmit` 客户端前置校验（API Key 非空 + 红色错误提示 + 自动聚焦）；AI 凭证表单支持"刷新模型列表"嗅探 OpenAI-compatible 端点可用模型并填充下拉选择；自定义 provider 支持"手动确认" checkbox 跳过自动测试；计费提示文案。 |
| `apps/web/src/app/admin/settings/providers.ts` | Provider 常量集中定义：`AI_PROVIDERS`（AI provider 选项 + defaultBaseUrl）、`SEARCH_PROVIDERS`（搜索 provider 选项）、`defaultAiBaseUrl(provider)` 函数。替代前端 credential-form 内联常量与后端 actions.ts 独立函数，确保前后端使用同一份 Provider 元数据。 |
| `apps/web/src/lib/auth.ts` | Better Auth 服务端配置。email/password + session 插件 + Prisma adapter。仅当 `BETTER_AUTH_SECRET` 环境变量设置时启用。 |
| `apps/web/src/lib/auth-client.ts` | Better Auth 客户端导出 `createAuthClient`，供 login/register 页面和客户端组件使用。 |
| `apps/web/src/lib/session.ts` | Session helper。`getSessionWorkspace()`：当 `BETTER_AUTH_SECRET` 设置时，从 Better Auth session 读取用户和组织；否则 fallback 到 `ensureDefaultWorkspace()`（兼容默认 workspace 开发模式）。 |
| `apps/web/src/middleware.ts` | Next.js 中间件。仅当 `BETTER_AUTH_SECRET` 设置时激活，保护需要认证的路由，未登录重定向到 `/login`。 |
| `apps/web/src/app/login/page.tsx` | 登录页。email/password 表单，提交到 Better Auth session。 |
| `apps/web/src/app/register/page.tsx` | 注册页。email/password 注册，创建用户后重定向。 |
| `apps/web/src/app/pricing/page.tsx` | 定价页。FREE/PLUS/PRO 三层对比，展示各层配额限制和价格。 |
| `apps/web/src/app/usage/page.tsx` | 用量仪表盘。展示当前周期配额使用进度条（主题/信源/AI 调用/导出），按 `getSubscriptionPlanView()` + `getTodayAiCallCount()`/`getMonthAiCallCount()`/`getMonthExportCount()`/`getTopicCount()`/`getActiveSourceCount()` 读取。 |
| `apps/web/src/app/actions.ts` | Server Action 入口；创建主题并自动匹配候选源、更新事件状态、创建候选源、手动 source discovery、信源治理、主题管理（`updateTopicAction`/`updateTopicStatusAction`/`deleteTopicAction`，OWNER/ADMIN 守卫）、批量信源治理（`batchUpdateSourceGovernanceAction`）、`upsertAiCredentialAction` / `upsertSearchCredentialAction`（OWNER/ADMIN 守卫，加密存储 API Key）、`deleteAiCredentialAction` / `deleteSearchCredentialAction`（清除凭证）、`testAiCredentialAction`（测试 AI 连接，含 chat/completions 兜底）、`listAiModelsAction`（嗅探可用模型列表，不写 DB）、`testSearchCredentialAction`（测试搜索连接）、`upsertTelegramCredentialAction`/`deleteTelegramCredentialAction`/`testTelegramCredentialAction`（Telegram 凭证管理）、`createReportAction`（提交报告问题，异步调用 `runReportGeneration`）、`deletePreferenceAction`/`updatePreferenceWeightAction`（偏好编辑）、`recordEnhancedFeedbackAction`（增强反馈：MORE/LESS_LIKE_THIS、SOURCE_QUALITY_UP/DOWN、SCORE_UP/DOWN）。失败通过 stderr 记录，成功/失败通过 redirect URL 参数反馈。 |
| `apps/web/src/lib/event-display.ts` | 前端展示清洗 helper：把 RSS/HTML 摘要清洗为可读正文（去除 Article URL/Points/# Comments 等元数据标记，用 title 作为 fallback），提取 Article URL 作为原文链接，并本地化解释文案。 |
| `apps/web/src/lib/topic-source-data.ts` | 读取工作台、完整收藏/简报分页、单条情报详情和 dedicated workspace audit。所有数据函数使用 `getSessionWorkspace()` 获取 session-based workspace（`BETTER_AUTH_SECRET` 未配置时内部 fallback 到 `ensureDefaultWorkspace()`）。`DATABASE_URL` 未配置时抛出错误，不再静默降级为预览模式。 |
| `apps/web/src/app/exports/briefings/[briefingId]/route.ts` | 简报 Markdown 下载 route。 |
| `apps/web/src/app/exports/events/[eventId]/route.ts` | 单条情报 Markdown 下载 route。 |
| `apps/web/src/app/globals.css` | 全局 token、布局、组件样式、motion/reduced-motion、焦点状态、safe-area padding、触摸导航和响应式规则；按 `FRONTEND.md` 语义 token 定义。 |
| `tests/smoke/responsive.spec.ts` | 全站响应式回归：逐页验证 320/375/414/768/1024/1440px 无横向滚动/超框，主要控件不少于 44px，主按钮对比度不少于 4.5:1。 |
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

### Auth 与 Middleware 规则

- 当 `BETTER_AUTH_SECRET` 环境变量设置时，Better Auth 激活：`/login` 和 `/register` 页面可用，`/api/auth/[...all]` 处理认证请求，`middleware.ts` 保护需要认证的路由。
- 当 `BETTER_AUTH_SECRET` 未设置时，应用运行在兼容模式：`getSessionWorkspace()` fallback 到 `ensureDefaultWorkspace()`，使用默认 workspace/user，不要求登录。这是当前个人版和本地开发的默认行为。
- `middleware.ts` 仅在 `BETTER_AUTH_SECRET` 设置时执行认证检查，否则直接放行（`next()`）。
- 认证模式下，`/login`、`/register`、`/pricing` 和 `/api/*` 公开路由不需要 session；其余路由需要登录。

### 数据访问模式

```text
apps/web/src/app/layout.tsx
  ↓
apps/web/src/app/page.tsx
  ↓ getSessionWorkspace()
apps/web/src/lib/topic-source-data.ts
  ↓ form actions
apps/web/src/app/actions.ts
  ↓ getSessionWorkspace() → dynamic import @wangchao/db
packages/db/src/repositories.ts
  ↓
Prisma/Postgres

apps/web/src/lib/topic-source-data.ts
  ↓ getSessionWorkspace()
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
| `apps/worker/src/index.fixtures.ts` | Worker runtime fixture：验证 rule/LLM noiseReason 的优先级与持久化前选择逻辑。 |

### Worker Cycle 函数

| 函数 | 职责 |
|------|------|
| `runWorkerHealthCheck()` | Worker 健康检查（`--health` 入口）。 |
| `runFetchCycle()` | 抓取 RSS：list active sources -> fetch -> normalize items -> upsert。 |
| `runSourceDiscoveryCycle()` | 信源发现：keyword-search + backlink + outlink -> candidate pool。 |
| `runAnalysisCycle()` | 分析：检查 Plan 配额和 BYOK 策略（`createAnalysisRuntimeWithPlan`），配额耗尽时 graceful skip；每 Item 写 `AI_RELEVANCE` TaskRun；有 AI runtime 时另写 `AI_EVENT_EXTRACTION`，失败落库后回退规则；AI 调用 source（official/byok/official_fallback）写入 UsageEvent.metadata；最终 filtered/event-upserted 结果写回外层 TaskRun。 |
| `runPreferenceLearningCycle()` | 偏好学习：list feedback -> generate deltas -> upsert preference memory。 |
| `runDailyBriefingCycle()` | 简报生成：每主题写 `BRIEFING_GENERATION` TaskRun -> 计算 UTC daily window -> 无事件记录 skipped / 有事件 render + upsert 当日唯一 briefing。 |
| `runPeriodBriefingCycle(period)` | 周报/月报生成：每主题计算 UTC week/month window -> `listTimelineEvents` 聚合 -> `renderPeriodBriefingMarkdown` -> `createPeriodBriefing` 幂等 upsert。 |
| `runSourceGovernanceObservationCycle()` | 信源质量观测：计算 hit/noise/duplicate -> source observation。 | |
| `runCandidateObservationCycle()` | 候选源低频观察 fetch：探测 CANDIDATE 状态 RSS source，收集质量信号用于治理审核。受 `WANGCHAO_CANDIDATE_OBSERVATION_ENABLED` 开关控制。 |
| `runExpiredCandidateReviewCycle()` | 过期候选源复审：遍历 `observeExpiresAt` 已过期的候选源，有事件产出则提升为 `ACTIVE`，否则标记 `REJECTED`。 |
| `runTelegramDeliveryCycle()` | Telegram 投递：读取已加密 Telegram 凭证 -> 查找近 2h 未投递 Briefing -> 幂等创建 DeliveryLog -> 调用 Telegram Bot API 发送 -> 写 SENT/FAILED/SKIPPED。在 fetch cycle 末尾自动运行。 |
| `runReportGeneration(input)` | 按需专题报告生成（异步）：从 Server Action `createReportAction` 调用 -> 使用 plan-aware runtime（`createAnalysisRuntimeWithPlan`） -> 检索情报库证据（`searchReportEvidenceEvents`） -> 规则+AI 生成结构化 Markdown -> 写 COMPLETED/FAILED/INSUFFICIENT_DATA。不放入 cron cycle。 |
| `fetchSourceWithRetries()` / `fetchSourceAttempt()` | 抓取重试（`MAX_FETCH_ATTEMPTS=3`）。 |
| `discoverFromKeywordSearch()` / `discoverFromHighScoreBacklinks()` / `discoverFromActiveSourceOutlinks()` | Source discovery 三条渠道实现。 |
| `createSearchProvider(prisma, organizationId)` | 异步工厂：先通过 `getDecryptedCredentials` 读取 DB 凭证创建搜索 provider（支持 brave/tavily/serper/searxng），未配置时 fallback 到对应环境变量（`BRAVE_SEARCH_API_KEY`/`TAVILY_API_KEY`/`SERPER_API_KEY`/`SEARXNG_BASE_URL`），都没有返回 `null`。 |
| `createSourceRecommendationRuntime(prisma, organizationId)` | 异步工厂：先读 DB AI 凭证构建 `OpenAI-compatible` adapter + model，未配置时 fallback 到 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_L1` 环境变量，都没有返回 `null`。 |
| `createAnalysisRuntimeWithPlan(prisma, organizationId)` | 异步工厂：按 Plan 配额/BYOK 策略为 analysis cycle 构建 event extraction adapter + model。返回 `AnalysisRuntimeResult`（`source: "official" \| "byok" \| "official_fallback"`）。配额耗尽时返回 `null`，调用方 graceful skip。 |
| `createOfficialAiRuntime(prisma, scope)` | 异步 helper：从 DB 组织级凭证构建 AI adapter + model，DB 凭证缺失时 fallback 到 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_L1` 环境变量。供 `createAnalysisRuntimeWithPlan` 内部按 BYOK 策略复用。 |

### Worker 规则

- Worker 负责抓取、item normalize、可解释分析、反馈归纳、简报生成、source quality observation、Telegram 投递和按需报告生成；后续真正 LLM relevance/event extraction/preference summarization/briefing rewrite/source discovery 应接入 `packages/ai`，但仍保持在 worker 中执行。
- Analysis item query 必须同时读取 Source name、Topic 当前 name/description 与 profile；`buildExtractionInput()` 通过 core 的 `buildTopicProfileContext()` 组装 AI topic context，不能让类型中声明的来源或主题 identity 在真实查询中变成空值，也不能假设 profile JSON 冗余保存 identity。
- Candidate sources 必须保持隔离：worker fetch 和 daily briefing 默认只使用 `ACTIVE` sources。
- Source discovery 只能写入 candidate pool，不得绕过治理流程直接标记为 `ACTIVE`。
- Topic/Source 写入必须保留 tenant scope：先通过默认 organization/user 获取 `organizationId`/`userId`，再写入。
- RSS URL 进入唯一性约束前必须 canonicalize；当前实现会去掉 hash、统一 hostname 小写并规整尾部 `/`。
- Worker fetch pipeline 必须有 attempt 上限；当前 `MAX_FETCH_ATTEMPTS=3`，每次尝试都会写入独立 `TaskRun`。
- Worker 声明的六类 TaskRun 必须有真实写入链路：source fetch/discovery、item relevance/LLM extraction、topic briefing、Markdown export；失败必须落 `errorMessage`，不能只写 stderr。当前还声明 `REPORT_GENERATION`（按需报告生成）和 `TELEGRAM_DELIVERY`（Telegram 简报投递）两类 TaskRun，由 `runReportGeneration` 和 `runTelegramDeliveryCycle` 分别写入。
- 主 fetch cycle 在简报生成和 source governance observation 之后会自动运行 `runTelegramDeliveryCycle`，将最近生成的简报通过 Telegram 投递到已配置的 Chat ID；Telegram 未配置或未启用时静默跳过。
- Fetch cycle 末尾自动运行 `autoMuteFailingSources()`：连续抓取失败次数超过 `WANGCHAO_AUTO_MUTE_THRESHOLD`（默认 10）的 ACTIVE source 自动转为 `MUTED`，避免持续失败源占用抓取资源。
- 候选源低频观察 fetch 由 `WANGCHAO_CANDIDATE_OBSERVATION_ENABLED`（默认 false）开关控制；启用后 `runCandidateObservationCycle()` 探测 CANDIDATE 状态 RSS source，收集质量信号供治理审核。
- 过期候选源复审由 `runExpiredCandidateReviewCycle()` 执行：遍历 `observeExpiresAt` 已过期的候选源，有事件产出提升为 `ACTIVE`，否则标记 `REJECTED`，完成候选源自动治理闭环。
- AI UsageEvent 以逻辑 adapter 调用数计量（内部 HTTP retry 不重复计数），成功数/fallback 数放 metadata；不能只统计成功响应而漏记最终失败调用。
- AI/search 凭证优先从 DB 读取：`createSearchProvider` / `createSourceRecommendationRuntime` / `createAnalysisRuntimeWithPlan` 先调用 `getDecryptedCredentials(prisma, { organizationId })`，再 fallback 到 `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL_L1`/`BRAVE_SEARCH_API_KEY` 环境变量。解密失败静默跳过，不阻塞 worker。凭证明文不写入日志，调用完成后丢弃。
- Worker AI 分析前检查 Plan 配额和 BYOK 策略，配额耗尽时 graceful skip（不 crash），stderr 记录拦截原因。`createAnalysisRuntimeWithPlan` 返回 `AnalysisRuntimeResult`，其 `source` 字段（official/byok/official_fallback）写入 UsageEvent.metadata。`runSemanticDedupCycle` 和 `runReportGeneration` 同样使用 plan-aware runtime；`createSourceRecommendationRuntime` 保持不变（低频调用，不拦截配额）。
- Worker 每次执行输出两行结构化 JSON 日志到 stdout：`cycle-start`（cycle type + timestamp）和 `cycle-end`（cycle type + timestamp + durationMs + status + 全部计数器/结果）。Cycle type 为 `fetch` / `source-discovery` / `health`。Status 为 `ok` / `degraded` / `error`。这些日志可被 Railway logs 直接消费，用于 Cron 观测闭环。

---

## 关键调用链汇总

### Fetch Cycle（抓取链路）

```text
apps/worker runFetchCycle()
  ↓ packages/db listActiveRssSourcesForFetch()
packages/sources fetchRssFeed()
  ↓
packages/db upsertFetchedItems() (含 rawContent from content:encoded)
  ↓
apps/worker runArticleFetchCycle()
  ↓ packages/sources fetchArticleContent() (readability + linkedom)
  ↓ packages/db updateItemRawContent()
  ↓
TaskRun / Source / Item (rawContent)
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
apps/web getSessionWorkspace()
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

Saved page
  ↓ packages/db listSavedDashboardEvents(organizationId, userId, page)
UserItemState(saved=true) paginated collection + total
  ↓
apps/web /saved renders every saved event across pages
  ↓ read keeps saved=true and records readAt/READ feedback
  ↓ unsave Server Action action='unsave'
IntelligenceEvent + UserItemState restore READ/UNREAD and saved=false
  ↓
No DISMISS FeedbackEvent
```

### Preference Learning Cycle（偏好学习链路）

```text
FeedbackEvent(kind='READ'|'SAVE'|'DISMISS'|'EXPORT'|'CATEGORY_UP'|'CATEGORY_DOWN')
  ↓ apps/web action 或 apps/worker runPreferenceLearningCycle()
packages/core generatePreferenceDeltas()（按 topicId + key 隔离）
  ↓ packages/db upsertPreferenceMemory()
PreferenceMemory(key/value/confidence/explanation)
  ↓
apps/web applies PreferenceMemory weights -> Dashboard 排序变化
```

### Briefing and Markdown Export（简报与导出链路）

```text
apps/worker runDailyBriefingCycle()
  ↓ packages/db createTaskRun(type='BRIEFING_GENERATION', topicId)
  ↓ packages/core createUtcDayRange(generatedAt)
UTC [rangeStart, rangeEnd)
  ↓ packages/db listEventsForDailyBriefing(createdAt window, ACTIVE source)
packages/core renderDailyBriefingMarkdown()
  ↓ packages/db createDailyBriefing() upsert(topicId, DAILY, rangeStart)
One Briefing per topic/day, refreshed event set
  ↓ apps/web listBriefingsPage()
Paginated complete briefing history
  ↓ apps/web /exports/briefings/[briefingId]
TaskRun(type='EXPORT_GENERATION') RUNNING
  ↓ Markdown download + ExportEvent + UsageEvent(type='EXPORT')
TaskRun SUCCEEDED (or FAILED with errorMessage)

Single-event Markdown export
  ↓ apps/web /exports/events/[eventId]
packages/db getEventMarkdownExportRecord()
  ↓ TaskRun(type='EXPORT_GENERATION', eventId) RUNNING
packages/core renderEventMarkdown()
Markdown download + ExportEvent + FeedbackEvent(kind='EXPORT') + UsageEvent(type='EXPORT')
  ↓ TaskRun SUCCEEDED (or FAILED with errorMessage)
```

### Source Governance（信源治理链路）

```text
apps/web createCandidateSourceAction()
  ↓ packages/db createCandidateRssSource(status='CANDIDATE', observeExpiresAt=+14d)
apps/web updateSourceGovernanceAction() / batchUpdateSourceGovernanceAction()
  ↓ packages/db updateSourceGovernanceStatus() / batchUpdateSourceGovernanceStatus()
Source(status='ACTIVE'|'CANDIDATE'|'MUTED'|'REJECTED')
SourceObservation(evidence)
FeedbackEvent(kind='SOURCE_APPROVE'|'SOURCE_REJECT')
  ↓ apps/worker runSourceGovernanceObservationCycle()
SourceObservation(hitRate/noiseRate/duplicateRate)
  ↓ apps/worker runExpiredCandidateReviewCycle()
Source(status='ACTIVE' if has events | 'REJECTED' if observeExpiresAt passed)
```

质量指标从未归档 EventItem 关系计算：primary/secondary 都是 hit，只有 secondary 的合并报道是 duplicate；eventCount 按 event id 去重。模糊标题命中必须更新已有 event id，并同步 PRIMARY/SECONDARY 与 ANALYZED/DUPLICATE 状态；semantic merge 归档旧事件时清空其匹配 hash，防止未来输入重新绑定到 archived event。

### Workspace Audit（成员与用量）

```text
apps/web /admin/settings → /admin/usage
  ↓ getSessionWorkspace()
  ↓ getWorkspaceAudit()
packages/db assertMembershipRole(OWNER|ADMIN)
  ↓ listOrganizationMemberships() + listUsageSummary(since=30 days)
Member roles + UsageEvent grouped by type/unit
```

### Source Discovery（信源发现链路）

```text
apps/web runSourceDiscoveryAction() 或 apps/worker --source-discovery
  ↓ apps/worker runSourceDiscoveryCycle()
packages/sources createSearchProvider() -> Brave/Tavily/Serper/SearXNG provider / feed probe / external links
  ↓ keyword-search + backlink-from-highscore + outlink-network candidates
packages/ai recommendSourceCandidate() 或 deterministic fallback
  ↓ packages/db createCandidateRssSource()
Source(status='CANDIDATE', discoveryChannel, recommendationReason, trustScore, observeExpiresAt=+14d)
SourceObservation(evidence)
TaskRun(type='SOURCE_DISCOVERY')
UsageEvent(type='SOURCE_DISCOVERY')
```

### Commercial Readiness Boundary（商业化边界链路）

```text
packages/db ensureDefaultWorkspace() (worker) / getSessionWorkspace() (web)
  ↓
Organization + User + Membership(role)
  ↓ apps/web Server Actions / export routes
packages/db assertMembershipRole()
  ↓
OWNER/ADMIN: topic/source governance mutations
OWNER/ADMIN/MEMBER: read/save/dismiss/export
  ↓ packages/db recordUsageEvent()
UsageEvent(type, quantity, unit, subject)
  ↓ apps/web getSessionWorkspace()
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

Admin 在 AI 表单填入当前配置并测试连接（不写入数据库）
  ↓ 或点击"刷新模型列表"嗅探可用模型
  ↓ apps/web testAiCredentialAction(formData) / listAiModelsAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db testAiCredential({ apiKey, baseUrl }) / listAiModels({ apiKey, baseUrl })
AI: fetch GET {baseUrl}/models (Bearer auth, 10s timeout)
  ↓ 失败时回退 POST {baseUrl}/chat/completions (最小 payload)
  ↓ 嗅探时解析模型列表 { data: [{ id, owned_by }] }
CredentialTestResult { ok, message } 回到表单；通过前禁用保存，任何 Key/Provider/Base URL 修改都会要求重新测试
  ↓ 自定义 provider 可勾选"手动确认"跳过自动测试
AI 模型嗅探结果填充为下拉选择框，支持"自定义..."选项回退手填

Admin 测试通过后提交 AI Key 表单
  ↓ apps/web upsertAiCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db upsertAiCredential(prisma, scope, input)
packages/db/crypto encryptCredential(apiKey, ENCRYPTION_KEY) + maskKeyHint(apiKey)
  ↓
Subscription.aiEncryptedKey + aiKeyHint + aiBaseUrl + aiModel
UsageEvent(type='WEB_ACTION', subjectType='subscription')

Admin 在搜索表单填入当前配置并测试连接（不写入数据库）
  ↓ apps/web testSearchCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db testSearchCredential({ apiKey, provider })
Search: 按 provider 调用对应搜索 API (10s timeout)
CredentialTestResult { ok, message } 回到表单；通过前禁用保存，任何 Key/Provider 修改都会要求重新测试

Admin 测试通过后提交搜索 Key 表单
  ↓ apps/web upsertSearchCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db upsertSearchCredential(prisma, scope, input)
packages/db/crypto encryptCredential + maskKeyHint
  ↓
Subscription.searchEncryptedKey + searchKeyHint + searchProvider
UsageEvent(type='WEB_ACTION', subjectType='subscription')

Admin 点击清除凭证
  ↓ apps/web deleteAiCredentialAction / deleteSearchCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db deleteAiCredential / deleteSearchCredential(prisma, scope)
Subscription.{ai|search}* fields -> null (upsert)
UsageEvent(type='WEB_ACTION', unit='credential-delete')

Worker 运行时读取凭证
  ↓ apps/worker createSearchProvider / createSourceRecommendationRuntime / createAnalysisRuntimeWithPlan
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

### Telegram Delivery（Telegram 投递链路）

```text
apps/worker runFetchCycle()
  ↓ (briefing + governance 之后)
apps/worker runTelegramDeliveryCycle()
packages/db getDecryptedTelegramCredential(prisma, { organizationId })
  ↓ Subscription.telegramEnabled + telegramEncryptedBotToken 解密
packages/db findBriefingsForTelegramDelivery(prisma, scope, since=2h ago)
  ↓ 过滤已有 DeliveryLog 的 Briefing
packages/db createDeliveryLog(prisma, { briefingId, channel='TELEGRAM', status='PENDING' })
  ↓ createTaskRun(type='TELEGRAM_DELIVERY')
POST {TELEGRAM_API_BASE}/bot{token}/sendMessage
  ↓ 成功: updateDeliveryLog(SENT, sentAt) + completeTaskRun(SUCCEEDED)
  ↓ 失败: updateDeliveryLog(FAILED, errorMessage) + failTaskRun(FAILED)
  ↓ 已 SENT/SKIPPED: 跳过
DeliveryLog(briefingId + channel 唯一, 幂等)
```

### Report Generation（专题报告生成链路）

```text
apps/web /reports -> createReportAction(formData)
  ↓ OWNER/ADMIN 守卫
packages/db createReport(prisma, scope, { question })
  ↓ status=PENDING
apps/worker runReportGeneration({ reportId, organizationId, userId })
  ↓ (异步, 不在 cron cycle)
packages/db updateReportStatus(reportId, GENERATING)
packages/db searchReportEvidenceEvents(prisma, scope, { keywords, rangeStart?, rangeEnd? })
  ↓ 从 IntelligenceEvent + Item 检索证据 (不做全网搜索)
  ↓ 规则生成: 从证据组装 Markdown
  ↓ AI 生成 (有凭证时): LLM 组装结构化报告
packages/db completeReport(prisma, reportId, { markdown, summary, eventCount, ... })
  ↓ status=COMPLETED
  ↓ 证据不足: status=INSUFFICIENT_DATA + coverageNote
  ↓ 异常: failReport(prisma, reportId, errorMessage) -> status=FAILED
Report(status=PENDING -> GENERATING -> COMPLETED/FAILED/INSUFFICIENT_DATA)
```

### Subscription and Billing（订阅与支付链路）

```text
用户在 /pricing 选择 Plan
  ↓ apps/web /api/billing/ccpayment/create-invoice
packages/db createCcpaymentInvoice(prisma, scope, { plan, amount, currency })
  ↓ 调用 CCPayment API (CCPAYMENT_APP_ID + CCPAYMENT_APP_SECRET)
PaymentInvoice(status=PENDING, orderId, provider='ccpayment')
  ↓ 返回支付 URL 给用户

CCPayment 支付完成后回调 webhook
  ↓ apps/web /api/billing/ccpayment/webhook
packages/db verifyCcpaymentWebhookSignature(payload, signature)
  ↓ 签名验证通过
PaymentInvoice(status=PAID) 幂等更新
  ↓ packages/db updateSubscriptionPlan(prisma, scope, { plan, status='ACTIVE', periodStart, periodEnd })
Subscription.plan = PLUS/PRO, status = ACTIVE
  ↓ 配额引擎解锁对应 Plan 的限制

Stripe checkout (骨架)
  ↓ apps/web /api/billing/stripe/checkout
未配置 STRIPE_SECRET_KEY 时返回 placeholder
已配置时创建 checkout session

Stripe webhook (骨架)
  ↓ apps/web /api/billing/stripe/webhook
处理 checkout.session.completed 事件 (待完整实现)
```

### BYOK Credential（Per-user BYOK 凭证链路）

```text
用户在 /admin/settings BYOK tab 配置自己的 AI Key
  ↓ apps/web upsertByokCredentialAction(formData)
packages/db assertMembershipRole(['OWNER','ADMIN'])
  ↓ packages/db upsertByokCredential(prisma, scope, input)
packages/db/crypto encryptCredential(byokApiKey, ENCRYPTION_KEY) + maskKeyHint(byokApiKey)
  ↓
Subscription.byokEncryptedKey + byokKeyHint + byokBaseUrl + byokModel
UsageEvent(type='WEB_ACTION', subjectType='subscription')

Worker analysis cycle 运行时
  ↓ packages/core shouldUseByok(plan, byokConfigured)
  ↓ PLUS 且已配置 BYOK: 使用 BYOK 凭证
  ↓ PRO 且已配置 BYOK: 优先使用 BYOK, 否则 fallback 到组织级 AI 凭证
packages/db getByokCredentialView / decrypt
  ↓ 解密 BYOK Key -> 注入 adapter -> 调用完成丢弃明文
```
