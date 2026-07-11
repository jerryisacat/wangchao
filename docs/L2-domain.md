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
| `Subscription` | Organization 的 1:1 凭证与订阅配置。存储 AES-256-GCM 加密的 AI/搜索 API Key，仅保留脱敏 `keyHint`，不存明文。是 Phase 15 BYOK/订阅模型的前置实体，后续扩展 Plan/Stripe 字段。 |
| `Topic` | 用户创建的情报主题，包含 topic profile、状态和 owner。 |
| `Source` | RSS/Web 信源注册条目，带 candidate/active/muted/rejected 状态和质量分。 |
| `Item` | worker 抓取并规范化后的原始条目。 |
| `IntelligenceEvent` | AI 抽取、去重、评分后的情报单元。支持多来源合并（primaryItem + secondaryItems），携带实体和后续跟踪建议。 |
| `UserItemState` | 用户对某条情报的阅读/收藏/忽略状态。 |
| `FeedbackEvent` | 原始行为和显式反馈记录，为偏好学习保留信号。 |
| `PreferenceMemory` | 可解释的、按主题学到的用户偏好记忆。 |
| `Briefing` | 每日/每周/每月生成的主题简报。 |
| `ExportEvent` | Markdown/PDF/JSON 导出记录和正价值反馈信号。 |
| `SourceObservation` | 候选/活跃信源的质量观测指标和审核证据。 |
| `TaskRun` | worker 任务状态、重试、错误和输入输出审计。 |
| `UsageEvent` | AI 调用、抓取、导出、简报生成等用量记录。 |

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
- 当前分析管线用 topic profile keywords 做规则 relevance/noise；AI extraction 另外读取 entities/includeScope/excludeScope/importanceRules、当前 Source name，并从 Topic 行读取当前 name/description。标题和 URL 生成 `eventHash`，用 `topicId + eventHash` 幂等 upsert 事件。
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

- `DAILY` 使用 UTC 自然日半开区间 `[rangeStart, rangeEnd)`；当前尚未实现 organization/user 可配置业务时区。
- 同一 `topicId + period + rangeStart` 只能存在一条 Briefing。Worker 同日重跑通过 upsert 刷新内容、`generatedAt` 和事件关系，不新增重复记录。
- Daily briefing 按 `IntelligenceEvent.createdAt` 选择当日新进入情报库的事件；`UNREAD`、`READ`、`SAVED` 可进入，`DISMISSED`、`ARCHIVED` 不进入。
- 正式简报只允许 primary item 属于 `ACTIVE` source；candidate/muted/rejected 继续隔离。
- Web 简报历史按 organization 分页读取，不能通过固定 Top-N 结果冒充完整历史。

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

### FeedbackKind 枚举

### Subscription 凭证模型

`Subscription` 与 `Organization` 是 1:1 关系（`organizationId @unique`），集中存储该组织下所有 AI 和搜索 provider 的凭证。

字段职责：

| 字段 | 职责 |
|------|------|
| `organizationId` | 关联 `Organization`，唯一约束，每个组织仅一条 `Subscription`。 |
| `aiEncryptedKey` | AI provider API Key 的 AES-256-GCM 密文。 |
| `aiBaseUrl` | OpenAI-compatible base URL。 |
| `aiProvider` | provider 标识（如 `openai`、`deepseek`），用于 adapter 路由。 |
| `aiKeyHint` | 脱敏 hint（如 `sk-...xyz`），仅用于 Admin 展示，不可反推明文。 |
| `aiModel` | 默认 AI 模型名。 |
| `searchEncryptedKey` | 搜索 provider API Key 的 AES-256-GCM 密文。 |
| `searchProvider` | 搜索 provider 标识（如 `brave`）。 |
| `searchKeyHint` | 搜索 Key 脱敏 hint。 |

规则：
- 加解密依赖 `ENCRYPTION_KEY` 环境变量，缺失时凭证相关 worker 任务必须 fail-fast，不得静默降级到明文。
- Admin 后台只展示 `aiKeyHint`/`searchKeyHint`，可新增或覆盖 Key，但不可查看明文。
- Worker 运行时从 DB 读取并解密 Key → 注入 adapter → 调用完成后丢弃明文，不写入日志。
- 环境变量（`AI_API_KEY`、`BRAVE_SEARCH_API_KEY` 等）仅作为 DB 未配置时的 fallback，不是主配置方式。
- 当前 `Subscription` 只承载凭证；Phase 15 将在同一张表上扩展 Plan/Stripe/配额字段，演进为完整 BYOK + 订阅模型。
- AI 模型列表（嗅探自 `GET /models`）为远端派生数据，不持久化到 `Subscription` 表；Admin 页面支持按需刷新并从下拉框选择模型，支持"自定义..."选项回退到自由输入。
- AI 凭证连接测试在 `GET /models` 不可用时自动回退到 `POST /chat/completions`（最小 payload）兜底验证，确保 Azure、DeepSeek 等非标准 `/models` 端点的凭证也能正常测试。
- 自定义 provider 可通过"手动确认" checkbox 跳过自动测试，但服务端仍校验 API Key 非空。



| Kind | 含义 | 对偏好影响 |
|------|------|-----------|
| `READ` | 用户已读 | 轻微提升相关 category/source 权重 |
| `SAVE` | 用户收藏 | 提升相关 category/source 权重 |
| `DISMISS` | 用户忽略 | 降低相关权重 |
| `EXPORT` | 用户导出 | 正反馈，提升相关权重 |
| `SOURCE_APPROVE` | 管理员批准信源 | 治理审计；不直接进入个人偏好 |
| `SOURCE_REJECT` | 管理员拒绝信源 | 治理审计；不直接进入个人偏好 |
| `CATEGORY_UP` | 详情页“多关注这类” | 只提升当前 Topic 的 category 权重，不改变事件状态/source 权重 |
| `CATEGORY_DOWN` | 详情页“少关注这类” | 只降低当前 Topic 的 category 权重，不改变事件状态/source 权重 |

## 领域术语表

| 术语 | 定义 |
|------|------|
| **Topic Profile** | 主题的机器可读画像。当前已消费并可编辑 keywords/entities/includeScope/excludeScope/importanceRules；新建主题时由 `buildTopicProfile()` 生成初稿。languagePreferences/digestStyle 尚无稳定契约，由 Issue #30 跟踪。 |
| **Gravity Score** | 情报事件的综合排序分。由 `calculateGravityScore()` 基于 importance、time、source quality 等因子计算，Dashboard 排序的基础分。 |
| **Preference Memory** | 按主题学到的用户偏好，以 `PreferenceMemory(key/value/confidence/explanation)` 存储。`SAVE/EXPORT` 提升权重，`READ` 轻微提升，`DISMISS` 降低；`CATEGORY_UP/DOWN` 显式调整当前 Topic 的类别。归纳时以 `topicId + key` 隔离。 |
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
  ├── Subscription (1:1, 凭证与订阅配置)
  ├── Topic
  │     ├── Source
  │     │     └── SourceObservation
  │     ├── Item
  │     │     └── IntelligenceEvent
  │     │           ├── UserItemState (per User)
  │     │           ├── FeedbackEvent
  │     │           └── Briefing
  │     ├── PreferenceMemory (per User)
  │     ├── Briefing
  │     │     └── ExportEvent
  │     └── TaskRun
  ├── FeedbackEvent
  ├── ExportEvent
  ├── SourceObservation
  ├── TaskRun
  └── UsageEvent
```

唯一性约束：
- `Topic`: `(organizationId, name)` 唯一。
- `Source`: `(topicId, canonicalUrl)` 唯一。RSS URL 进入唯一性约束前必须 canonicalize。
- `Item`: `(topicId, canonicalUrl)` 唯一。
- `IntelligenceEvent`: `(topicId, eventHash)` 唯一。
- `UserItemState`: `(userId, eventId)` 唯一。
- `Membership`: `(organizationId, userId)` 唯一。
- `Subscription`: `organizationId` 唯一（1:1 with Organization）。
- `PreferenceMemory`: `(topicId, userId, key)` 唯一。
