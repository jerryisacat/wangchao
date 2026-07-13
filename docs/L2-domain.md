# L2 - 领域模型与概念

> 本文件记录望潮的核心实体职责、状态机和领域术语。属于 L2 领域层，随数据模型演进而更新。
>
> 上层抽象见 `CODEGUIDE.md`（L0 系统架构 + L1 设计原则）；模块实现细节见 `docs/L3-modules.md`。
>
> 数据模型 source of truth 是 `packages/db/prisma/schema.prisma`。本文件是可读概览，schema 冲突时以 Prisma 为准。

## 核心实体职责

| 模型 | 职责 |
|------|------|
| `User` | 人类账户。当前个人版使用默认用户，不要求真实注册登录。 |
| `Organization` | 租户和计费边界。当前个人版使用默认组织。 |
| `Membership` | User-to-Organization 角色映射（OWNER/ADMIN/MEMBER）。 |
| `Subscription` | Organization 的 1:1 订阅与计费配置。仅承载 plan/status/isSelfHosted/instantPush/Stripe/周期字段，不再存储凭证。凭证已拆分到 OrganizationCredential。 |
| `OrganizationCredential` | Organization 的凭证分区表。每行一类凭证（AI/SEARCH/BYOK/TELEGRAM/CCPAYMENT），通过 `credentialType` 分区。存储 AES-256-GCM 密文 + 脱敏 hint + provider/model/baseUrl/chatId/appId 等配置字段。`organizationId + credentialType` 唯一。 |
| `PaymentInvoice` | 支付订单记录。跟踪 CCPayment 和 Stripe 支付，关联 organization，含订单号（`provider + providerOrderId` 唯一）、金额（Decimal）、币种、支付状态和 provider 元数据。 |
| `Account` | Better Auth 兼容的 OAuth/account 记录。当前用于 email/password 认证，预留第三方 OAuth 扩展。 |
| `Session` | Better Auth 兼容的会话记录。跟踪用户登录状态和过期时间。 |
| `Topic` | 用户创建的情报主题，包含 topic profile、状态和 owner。 |
| `Source` | RSS/Web 信源注册条目，带 candidate/active/muted/rejected 状态和质量分。`observeExpiresAt` 是观察到期时间，用于候选源复审机制。设置为 CANDIDATE 状态时自动设置 14 天观察期；到期后 worker 自动复审（有事件产出则提升为 ACTIVE，否则 REJECTED）。 |
| `Item` | worker 抓取并规范化后的原始条目。 |
| `IntelligenceEvent` | AI 抽取、去重、评分后的情报单元。通过 EventItem 关联表支持多来源合并（primary + secondary），携带实体和后续跟踪建议。 |
| `UserItemState` | 用户对某条情报的阅读/收藏/忽略状态。`dismissedAt` 已移除，由 `status=DISMISSED` 隐含。 |
| `FeedbackEvent` | 原始行为和显式反馈记录，为偏好学习保留信号。 |
| `PreferenceMemory` | 可解释的、按主题学到的用户偏好记忆。 |
| `Briefing` | 每日/每周/每月生成的主题简报。 |
| `ExportEvent` | Markdown/PDF/JSON 导出记录和正价值反馈信号。 |
| `SourceObservation` | 候选/活跃信源的质量观测指标和审核证据。 |
| `TaskRun` | worker 任务状态、重试、错误和输入输出审计。 |
| `UsageEvent` | AI 调用、抓取、导出、简报生成等用量记录。 |
| `DeliveryLog` | 简报投递记录。每条 Briefing 每个投递渠道（当前仅 Telegram）最多一条 DeliveryLog，通过 `briefingId + channel` 唯一约束保证幂等。`idempotencyKey` 字段已移除。 |
| `Report` | 按需专题报告。用户提交自然语言问题，系统从情报库已有事件检索证据，生成结构化 Markdown 报告。 |

## 关键状态机

### Topic 状态机

```text
ACTIVE ──pause───-> PAUSED
PAUSED ──resume──-> ACTIVE
ACTIVE ──archive──> ARCHIVED
PAUSED ──archive──> ARCHIVED
ARCHIVED ──restore> ACTIVE
*       ──delete──> (硬删除，级联删除关联数据)
```

规则：
- worker fetch、analysis、daily briefing 和 source discovery 只处理 `ACTIVE` 主题；`PAUSED` 和 `ARCHIVED` 主题被 repository 查询层自动过滤。
- `PAUSED` 表达"临时暂停、可恢复"，`ARCHIVED` 表达"不再关注但保留历史"。
- 删除为硬删除，级联删除 Source/Item/IntelligenceEvent/Briefing/FeedbackEvent/PreferenceMemory 等关联数据，需二次确认。

### Source 状态机

```text
CANDIDATE ──approve──> ACTIVE
CANDIDATE ──reject───> REJECTED
CANDIDATE ──mute─────> MUTED
ACTIVE ──mute────────> MUTED
ACTIVE ──reject───────> REJECTED
MUTED ──approve──────> ACTIVE
MUTED ──reject────────> REJECTED
REJECTED ──approve────> ACTIVE (重新审核)
```

规则：
- worker fetch 和 daily briefing 默认只使用 `ACTIVE` sources。
- `CANDIDATE`/`MUTED`/`REJECTED` 不得进入正式抓取和简报。
- approve/reject/mute 通过 `FeedbackEvent`（`SOURCE_APPROVE`/`SOURCE_REJECT`）留下管理员治理审计；它们不直接进入个人 `PreferenceMemory`，不能冒充 SPEC 的 `source_good/source_bad` 用户反馈。
- 状态动作必须写 `SourceObservation` 保留可追溯 evidence。

### Item 状态机

```text
FETCHED ──relevance pass──> ANALYZED (生成 IntelligenceEvent)
FETCHED ──relevance fail──> FILTERED (噪音)
FETCHED ──error──────────> ERROR
ANALYZED ──duplicate──────> DUPLICATE
```

规则：
- `markItemFiltered()` 必须保留原有 `rawMetadata`，只追加过滤原因，避免丢失 RSS 原始追溯信息。
- 当前规则 relevance 对 title/summary 做大小写不敏感的精确短语包含匹配：excludeScope 命中直接 FILTERED 且 score=0；keywords/entities/includeScope 是独立正信号。命中实体会进入 fallback IntelligenceEvent.entities，命中信号/noiseReason 会进入 decision/TaskRun/Item metadata。LLM 返回 isRelevant=false 时，其 noiseReason 同样写入 extraction/relevance TaskRun 和 Item metadata，不得被泛化文案覆盖。importanceRules 只由 AI extraction 消费；AI 另外读取当前 Source name 与 Topic 行的当前 name/description。标题和 URL 生成 `eventHash`，用 `topicId + eventHash` 幂等 upsert 事件。
- 多来源合并：精确 event hash 或标题 hash + ±24h 命中已有事件时，直接按已有 event id 更新，不能按新 hash 再创建一条事件；旧 primary 的 `EventItem.role` 改为 `SECONDARY` 且 Item 进入 `DUPLICATE`，新 Item 成为 `PRIMARY/ANALYZED`。语义聚类同样把被合并事件的 Item 关联到保留事件并标记为 `DUPLICATE`；归档的被合并事件清空 eventHash/titleHash，避免未来新报道再次命中已归档行或被唯一键阻塞。

### IntelligenceEvent 状态机

```text
UNREAD ──read──────> READ
UNREAD ──save───────> SAVED
UNREAD ──dismiss────> DISMISSED
READ ────save───────> SAVED
SAVED ───dismiss────> DISMISSED
SAVED ───unsave─────> READ（已有 readAt）或 UNREAD
* ───────archive────> ARCHIVED
```

规则：
- Dashboard 主列表只展示 `UNREAD` 和 `SAVED` 事件；`READ` 与 `DISMISSED` 默认从主信息流隐藏。
- `read` / `save` / `dismiss` 必须同时写 `IntelligenceEvent`、`UserItemState` 和 `FeedbackEvent`，为偏好学习保留信号。
- `unsave` 只取消收藏并恢复为已有阅读状态或未读状态，不写 `DISMISS`，避免把“取消收藏”误记为负反馈。
- 对已收藏事件执行 `read` 时写入 `readAt` 和 `READ` feedback，但保留 `saved=true` / `SAVED`；只有显式 `unsave` 才移出收藏集合。
- 收藏集合以 `(userId, eventId)` 对应的 `UserItemState.saved=true` 为查询依据，并按用户分页读取；不得通过截取首页事件后再过滤来推断完整收藏集合。

### Briefing 周期与幂等规则

- `DAILY` 使用 UTC 自然日半开区间 `[rangeStart, rangeEnd)`；`WEEKLY` 使用 UTC 自然周（周一开始）半开区间；`MONTHLY` 使用 UTC 自然月半开区间。当前尚未实现 organization/user 可配置业务时区。
- 同一 `topicId + period + rangeStart` 只能存在一条 Briefing。Worker 同窗口重跑通过 upsert 刷新内容、`generatedAt` 和事件关系，不新增重复记录。
- Daily briefing 按 `IntelligenceEvent.createdAt` 选择当日新进入情报库的事件；`UNREAD`、`READ`、`SAVED` 可进入，`DISMISSED`、`ARCHIVED` 不进入。Weekly/Monthly briefing 按 `occurredAt` 倒序聚合窗口内全部事件。
- 正式简报只允许 primary item 属于 `ACTIVE` source；candidate/muted/rejected 继续隔离。
- Web 简报历史按 organization 分页读取（支持 period 筛选），不能通过固定 Top-N 结果冒充完整历史。

### TaskRun 状态机

```text
                     ┌──success──> SUCCEEDED
create/start ──> RUNNING
                     └──failure──> FAILED
```

规则：
- Worker fetch pipeline 必须有 attempt 上限；当前 `MAX_FETCH_ATTEMPTS=3`，每次尝试都会新建独立 `TaskRun`，失败记录不会被下一次 attempt 覆盖。
- 当前运行路径创建后直接进入 `RUNNING`，最终收敛为 `SUCCEEDED` 或 `FAILED`；`PENDING` / `CANCELED` 为后续 DB queue/cancel 能力预留，当前代码不把它们描述为已实现状态转换。
- 六类 TaskRun 均有真实写入者：`SOURCE_FETCH`、`SOURCE_DISCOVERY`、`AI_RELEVANCE`、`AI_EVENT_EXTRACTION`、`BRIEFING_GENERATION`、`EXPORT_GENERATION`。
- LLM extraction 失败但规则 fallback 成功时，`AI_EVENT_EXTRACTION=FAILED`，外层 `AI_RELEVANCE=SUCCEEDED` 且 output 标记 `llmFallback=true`；这不是整轮失败，也不会丢失 provider 错误证据。
- AI UsageEvent 的 quantity 统计逻辑 adapter 调用数（内部 HTTP retry 不重复计数），包括最终失败的调用；成功数和 fallback 数保留在 metadata。

### Report 状态机

```text
PENDING ──generate──> GENERATING ──success─────────> COMPLETED
GENERATING ──insufficient──> INSUFFICIENT_DATA
GENERATING ──error──────────> FAILED
```

规则：
- 用户提交问题后创建 `PENDING` 记录，Worker `runReportGeneration()` 接管后转为 `GENERATING`。
- 证据检索从 `IntelligenceEvent` 和 `Item` 获取，不发起全网搜索。
- 证据不足时标记 `INSUFFICIENT_DATA` 并写入 `coverageNote`；生成失败标记 `FAILED` 并写入 `errorMessage`。
- `COMPLETED` 报告携带 `markdown`、`summary`、`eventCount`、`itemCount`、`topicIds`、`sourceIds` 和 `coverageNote`。

### DeliveryLog 状态机

```text
PENDING ──sent────> SENT
PENDING ──failed──> FAILED
PENDING ──skip────> SKIPPED
```

规则：
- 每条 Briefing 每个投递渠道（当前仅 `TELEGRAM`）最多一条 DeliveryLog，由 `briefingId + channel` 唯一约束保证幂等。
- Worker `runTelegramDeliveryCycle` 在 fetch cycle 末尾运行：读取已加密 Telegram 凭证，查找近 2 小时内未投递的 Briefing，按幂等键创建 DeliveryLog。
- 投递成功写 `SENT` 和 `sentAt`；失败写 `FAILED` 和 `errorMessage`/`errorCode`；已投递或已跳过的记录不再重发。
- Telegram 凭证未配置或未启用时，cycle 静默跳过，不创建 DeliveryLog。

### Plan 枚举

### InstantPushLog 状态机

```text
PENDING ──claim──> SENDING ──sent──> SENT
SENDING ──retryable error──> FAILED ──due claim──> SENDING
SENDING ──permanent/max attempts──> SKIPPED
```

- `eventId + channel` 唯一约束与条件更新共同保证并发幂等。
- `instantPushEnabledAt` 限定首次启用边界；失败重试由 `FAILED + nextAttemptAt` 驱动。
- Free/到期订阅不可用，有效 Plus/Pro 与自用模式可用；阅读状态不阻止组织级推送。
- candidate/muted/rejected source 不得进入即时推送候选集。

| 值 | 含义 |
|------|------|
| `FREE` | 免费层。基础主题/信源/AI调用/导出配额。 |
| `PLUS` | Plus 层。更高配额，BYOK 必填（用户必须提供自己的 AI API Key）。 |
| `PRO` | Pro 层。最高配额，BYOK 可选（可用平台提供的 AI Key）。 |

### SubscriptionStatus 枚举

| 值 | 含义 |
|------|------|
| `ACTIVE` | 订阅有效，配额正常应用。 |
| `PAST_DUE` | 支付逾期，进入宽限期（当前仍允许使用，但提示续费）。 |
| `CANCELED` | 用户主动取消，当前计费周期结束前仍可用。 |
| `EXPIRED` | 订阅到期，降级为 FREE。 |

### FeedbackKind 枚举

### OrganizationCredential 凭证模型

凭证从 `Subscription` 拆分为独立的 `OrganizationCredential` 表，按 `credentialType` 分区（AI/SEARCH/BYOK/TELEGRAM/CCPAYMENT），每行一类凭证。

字段职责：

| 字段 | 职责 |
|------|------|
| `organizationId` | 关联 `Organization`，与 `credentialType` 组成唯一约束。 |
| `credentialType` | 凭证分区类型：`AI`/`SEARCH`/`BYOK`/`TELEGRAM`/`CCPAYMENT`。 |
| `encryptedKey` | AI/SEARCH/BYOK/Telegram 的 AES-256-GCM 密文。 |
| `encryptedSecret` | CCPayment App Secret 的 AES-256-GCM 密文。 |
| `keyHint` | 脱敏 hint（如 `sk-...xyz`），仅用于 Admin 展示。 |
| `baseUrl` | OpenAI-compatible endpoint URL（AI/BYOK）。 |
| `provider` | provider 标识（AI/Search/BYOK）。 |
| `model` | 模型名（AI/BYOK）。 |
| `appId` | CCPayment App ID（非密文）。 |
| `chatId` | Telegram 目标 Chat ID（非密文）。 |
| `enabled` | Telegram 投递是否启用。 |

规则：
- 加解密依赖 `ENCRYPTION_KEY` 环境变量，缺失时凭证相关 worker 任务必须 fail-fast，不得静默降级到明文。
- Admin 后台只展示 `keyHint`，可新增或覆盖 Key，但不可查看明文。
- Worker 运行时从 DB 读取并解密 Key → 注入 adapter → 调用完成后丢弃明文，不写入日志。
- 环境变量（`AI_API_KEY`、`BRAVE_SEARCH_API_KEY` 等）仅作为 DB 未配置时的 fallback，不是主配置方式。
- AI 模型列表（嗅探自 `GET /models`）为远端派生数据，不持久化到 `OrganizationCredential` 表；Admin 页面支持按需刷新并从下拉框选择模型，支持"自定义..."选项回退到自由输入。
- AI 凭证连接测试在 `GET /models` 不可用时自动回退到 `POST /chat/completions`（最小 payload）兜底验证。
- 自定义 provider 可通过"手动确认" checkbox 跳过自动测试，但服务端仍校验 API Key 非空。
- `Subscription` 保留订阅计划模型：`plan`/`status`/`currentPeriodStart`/`currentPeriodEnd`/`canceledAt`/`metadata`/`stripeCustomerId`/`stripeSubscriptionId`。
- 自用模式（`isSelfHosted=true`）跳过所有配额检查，适合自部署场景。

### Subscription Plan 状态机

```text
FREE ──pay PLUS──> PLUS
PLUS ──pay PRO───> PRO
PLUS ──cancel────> FREE (周期结束)
PRO ───cancel────> PLUS (周期结束)

ACTIVE ──payment overdue──> PAST_DUE
PAST_DUE ──grace period end> EXPIRED
PAST_DUE ──payment success─> ACTIVE
EXPIRED ──auto downgrade────> FREE
CANCELED ──period end───────> FREE
```

规则：
- 升级（FREE→PLUS→PRO）在支付确认后立即生效。
- 降级在当前计费周期结束后生效，避免用户立即失去已付费权益。
- `PAST_DUE` 给予宽限期，当前实现仍允许使用，但 UI 提示续费。
- `EXPIRED` 触发自动降级为 `FREE`，`Subscription.status` 改为 `EXPIRED` 后由周期任务或下次访问时收敛为 `FREE`/`ACTIVE`。
- 自用模式（`isSelfHosted=true`）跳过所有配额和支付状态检查，Plan 字段无意义。

### BYOK 凭证生命周期

```text
(未配置) ──upsert──> ENCRYPTED (per-user AES-256-GCM)
ENCRYPTED ──read──> 解密注入 adapter ──> 明文丢弃
ENCRYPTED ──delete──> (未配置)
ENCRYPTED ──test──> CredentialTestResult (不持久化)
```

规则：
- BYOK 是 per-user（而非 per-org）凭证，存储在 `Subscription.byokEncryptedKey` + `byokKeyHint` + `byokBaseUrl`/`byokProvider`/`byokModel`。
- Plus 计划 BYOK 必填（用户必须提供自己的 AI API Key）；Pro 计划 BYOK 可选（可用平台提供的 Key）。
- BYOK 凭证使用 `ENCRYPTION_KEY` 做 AES-256-GCM 加密，Admin 展示 `byokKeyHint` 脱敏 hint，不返回明文。
- Worker 运行时优先使用 BYOK（`shouldUseByok()` 判断），BYOK 未配置时 fallback 到组织级 AI 凭证。
- BYOK 连接测试复用 `testAiCredential` 逻辑（`GET /models` + `chat/completions` 兜底），结果不写入 DB。

### PaymentInvoice 状态机

```text
PENDING ──payment confirmed──> PAID
PENDING ──timeout/expire──────> EXPIRED
PENDING ──payment failed──────> FAILED
PAID ────(触发 Plan 升级)─────> (关联 Subscription.plan 更新)
```

规则：
- `PaymentInvoice` 关联 `organizationId` 和 `Subscription`，记录订单号（`orderId`）、金额（`amount`/`currency`）、provider（`ccpayment`/`stripe`）和 provider 元数据。
- CCPayment webhook 签名验证通过后，幂等更新 invoice 状态为 `PAID`，并触发 `Subscription.plan` 升级。
- 已 `PAID`/`EXPIRED`/`FAILED` 的 invoice 不再重复处理（幂等）。
- Stripe webhook 在事件类型为 `checkout.session.completed` 时更新 invoice 状态。



| Kind | 含义 | 对偏好影响 |
|------|------|-----------|
| `READ` | 用户已读 | 轻微提升相关 category/source 权重 |
| `SAVE` | 用户收藏 | 提升相关 category/source 权重 |
| `DISMISS` | 用户忽略 | 降低相关权重 |
| `EXPORT` | 用户导出 | 正反馈，提升相关权重 |
| `SOURCE_APPROVE` | 管理员批准信源 | 治理审计；不直接进入个人偏好 |
| `SOURCE_REJECT` | 管理员拒绝信源 | 治理审计；不直接进入个人偏好 |
| `CATEGORY_UP` | 详情页"多关注这类" | 只提升当前 Topic 的 category 权重，不改变事件状态/source 权重 |
| `CATEGORY_DOWN` | 详情页"少关注这类" | 只降低当前 Topic 的 category 权重，不改变事件状态/source 权重 |
| `SOURCE_QUALITY_UP` | 详情页"信源质量高" | 提升当前 Topic 的 source 权重 |
| `SOURCE_QUALITY_DOWN` | 详情页"信源质量低" | 降低当前 Topic 的 source 权重 |
| `SCORE_UP` | 详情页"评分偏高" | 提升当前事件分数相关 category/source 权重 |
| `SCORE_DOWN` | 详情页"评分偏低" | 降低当前事件分数相关 category/source 权重 |
| `MORE_LIKE_THIS` | 详情页"多看类似" | 提升当前事件相关 category/source/entity 权重 |
| `LESS_LIKE_THIS` | 详情页"少看类似" | 降低当前事件相关 category/source/entity 权重 |

## 领域术语表

| 术语 | 定义 |
|------|------|
| **Topic Profile** | 主题的机器可读画像。当前已消费并可编辑 keywords/entities/includeScope/excludeScope/importanceRules；新建主题时由 `buildTopicProfile()` 生成初稿。languagePreferences/digestStyle 尚无稳定契约，由 Issue #30 跟踪。 |
| **Gravity Score** | 情报事件的综合排序分。由 `calculateGravityScore()` 基于 importance、time、source quality 等因子计算，Dashboard 排序的基础分。 |
| **Preference Memory** | 按主题学到的用户偏好，以 `PreferenceMemory(key/value/confidence/explanation)` 存储。`SAVE/EXPORT` 提升权重，`READ` 轻微提升，`DISMISS` 降低；`CATEGORY_UP/DOWN` 显式调整当前 Topic 的类别。增强反馈（`SOURCE_QUALITY_UP/DOWN`、`SCORE_UP/DOWN`、`MORE/LESS_LIKE_THIS`）提供更细粒度的 source/score/entity 信号。偏好信号带 30 天半衰期时间衰减（`generatePreferenceDeltas` 中的 `applyTimeDecay`），旧信号自动衰减。用户可在偏好记忆页编辑权重或删除偏好。归纳时以 `topicId + key` 隔离。 |
| **Source Observation** | 信源质量观测快照，记录 hitRate/noiseRate/duplicateRate 等指标，作为信源治理审核证据。 |
| **Event Hash** | 情报事件去重哈希。当前由标题和 URL 生成，配合 `topicId + eventHash` 做幂等 upsert。 |
| **Content Hash** | Item 内容哈希，用于跨源重复检测。 |
| **Candidate Source** | 处于 `CANDIDATE` 状态的信源，尚未通过治理审核，不得进入正式抓取和简报。 |

Source Observation 指标口径：

- `hitRate`：该 source 的 Item 中，关联至少一个未归档 IntelligenceEvent 的比例；primary 和 secondary 报道都属于有效命中。
- `noiseRate`：`Item.status='FILTERED'` 的比例。
- `duplicateRate`：Item 已为 `DUPLICATE`，或只以 SECONDARY 角色关联未归档事件的比例；用于兼容旧数据未回填状态的情况。
- `eventCount`：上述关联中的未归档 event id 去重数量，不把归档的语义合并旧事件继续计入报告。
| **Source Discovery** | 自动信源发现流程。三条渠道：`keyword-search`（Brave Search API + RSS 探测）、`backlink-from-highscore`（高分事件原文页反查）、`outlink-network`（active source 外链网络）。 |
| **Tenant Scope** | 租户作用域。所有 tenant-owned 数据必须带 `organizationId`，user-specific state 必须带 `userId`。当前个人版使用默认 organization/user。 |
| **Deterministic Fallback** | AI 调用失败或未配置时的可解释规则降级路径。source recommendation 在无 `AI_API_KEY`/`AI_BASE_URL` 时使用此路径。 |
| **L1/L2 Staged Processing** | 阶段化情报处理。L1 = relevance/noise 过滤，L2 = event extraction/scoring/deduplication。源自旧 Python 原型，在 TypeScript 主路径中保留为可解释管线。 |
| **Topic-scoped** | 主题作用域。所有 Topic/Source/Item/IntelligenceEvent 数据都归属到特定 `topicId`。 |

## 实体关系概览

```text
Organization
  ├── Membership ── User
  │                 └── Session (Better Auth)
  │                 └── Account (Better Auth)
  ├── Subscription (1:1, 计划/状态/支付周期)
  │     └── PaymentInvoice (1:N, 支付订单记录)
  ├── OrganizationCredential (1:N per type, AI/SEARCH/BYOK/TELEGRAM/CCPAYMENT)
  ├── Topic
  │     ├── Source
  │     │     └── SourceObservation
  │     ├── Item
  │     │     └── IntelligenceEvent
  │     │           ├── UserItemState (per User)
  │     │           ├── FeedbackEvent
  │     │           └── Briefing
  │     │           └── DeliveryLog (per Briefing + channel)
  │     ├── PreferenceMemory (per User)
  │     ├── Briefing
  │     │     └── ExportEvent
  │     │     └── DeliveryLog
  │     └── TaskRun
  ├── FeedbackEvent
  ├── ExportEvent
  ├── SourceObservation
  ├── TaskRun
  ├── UsageEvent
  ├── DeliveryLog
  └── Report
```

唯一性约束：
- `Topic`: `(organizationId, name)` 唯一。
- `Source`: `(topicId, canonicalUrl)` 唯一。RSS URL 进入唯一性约束前必须 canonicalize。
- `Item`: `(topicId, canonicalUrl)` 唯一。
- `IntelligenceEvent`: `(topicId, eventHash)` 唯一（不再使用 `secondaryItemIds`，改为 EventItem 关联表）。
- `OrganizationCredential`: `(organizationId, credentialType)` 唯一。
- `UserItemState`: `(userId, eventId)` 唯一。
- `Membership`: `(organizationId, userId)` 唯一。
- `Subscription`: `organizationId` 唯一（1:1 with Organization）。
- `PreferenceMemory`: `(topicId, userId, key)` 唯一。
- `DeliveryLog`: `(briefingId, channel)` 唯一。
- `PaymentInvoice`: `orderId` + `provider` 组合唯一（防止重复订单）。
