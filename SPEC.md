# 望潮（Wangchao）产品规格（SPEC）

> 本文档是望潮产品开发与重构的主要依据，描述**目标产品形态**。
>
> 当前 TypeScript 主路径已从旧 Python 原型绿地重构为 Next.js + PostgreSQL + Worker 的产品化形态，旧原型已在开源清洗中删除。SPEC 不再记录旧原型，只描述目标产品与已落地实现之间的落差。
>
> 为兼顾"目标规格"与"落地可见性"，关键能力处用 `> 现状：…` 标注当前实现进度或与目标的落差。实现细节的权威记录见 `docs/L2-domain.md`（领域模型）/ `docs/L3-modules.md`（模块职责）/ `docs/L4-operations.md`（命令与环境），数据模型以 `packages/db/prisma/schema.prisma` 为准。

## 1. 产品一句话

**望潮（Wangchao）** 是一个会学习用户偏好的主题情报 Agent：用户只需要创建关注主题，系统自动发现和评估信息源，持续抓取公开信息，每天生成结构化情报简报；用户通过阅读、已读、收藏、反馈和导出等动作训练系统，让它越来越理解自己的关注重点和判断标准。

## 2. 产品目标

### 2.1 用户真正想完成的事情

用户不是想维护 RSS，也不是想阅读更多新闻。用户想要：

1. 用自然语言告诉系统自己关心的主题。
2. 系统自动理解主题边界、关键实体、关键词、排除项和重要性标准。
3. 系统自动寻找、观察、评估和更新相关信息源。
4. 系统每天把主题相关的高价值变化整理成简报。
5. 用户可以快速标记已读、收藏、忽略、导出和反馈。
6. 系统根据每次反馈更新对用户兴趣的理解。
7. 有价值的信息可以沉淀到 Obsidian / Markdown / PDF / 主题时间线。

示例：

```text
用户输入：我想关注中国商业航空进展。

系统应理解并持续跟踪：
- C919 / C929 / ARJ21
- 中国商飞 COMAC
- 中国民航局适航认证
- 国产大飞机交付与商业运营
- 航司订单、航线运营、维修保障
- 航空发动机与供应链
- 国际适航、出口和海外运营

系统应主动过滤：
- 普通航班延误
- 航旅营销稿
- 空乘招聘
- 机场服务体验类软文
- 与商业航空进展无关的事故八卦
```

### 2.2 产品定位

当前落地优先级是**个人/单用户主题情报工作台**，先跑通主题、信源、采集、AI 分析、阅读状态、反馈学习和知识沉淀闭环。

同时，产品架构需要为未来商业化、多租户、团队权限和付费系统预留边界。这些能力不应阻塞 MVP，也不应让早期产品变成复杂的企业系统；但数据模型、工程结构和后台任务设计不应把“只能个人自用”固化成长期限制。

产品不应该以“添加 RSS 源”为核心入口，而应该以“创建关注主题”为核心入口。

```text
错误入口：添加 RSS 链接
正确入口：创建关注主题
```

## 3. 核心产品原则

1. **主题优先，而非信源优先**
   - 用户维护主题、兴趣和反馈。
   - 系统维护具体信源、抓取策略和质量评分。

2. **自动发现，但不盲目信任**
   - 系统可以自动发现候选源。
   - 候选源进入观察状态，经过可信度和历史表现评估后再进入正式源池。

3. **反馈即训练数据**
   - 已读、忽略、收藏、标注“不感兴趣”、标注“多关注这个方向”等行为都应该沉淀为偏好信号。
   - 系统需要把用户行为转化为主题权重、排除项、信源权重和 prompt profile 更新。

4. **情报不是新闻列表**
   - 输出应围绕“发生了什么、为什么重要、影响谁、是否需要继续跟踪”。
   - 多来源报道同一事件应合并，而不是重复出现。

5. **知识要沉淀**
   - 重要信息不应只停留在当天 dashboard。
   - 系统应支持导出为 Obsidian/Markdown/PDF，并能长期形成主题时间线和案例库。

6. **可解释和可纠偏**
   - 系统需要说明为什么推荐某条信息、为什么信任某个来源、为什么降低某类内容权重。
   - 用户反馈应可追溯。

7. **单用户优先，多租户可演进**
   - MVP 可以先按单用户体验设计，减少登录、组织、权限和付费系统对核心闭环的干扰。
   - 底层数据和服务边界应预留用户、组织、成员关系、资源归属、用量记录和权限检查位置。
   - 后续商业化能力应作为独立阶段逐步打开，而不是反向重写核心数据模型。
   - 平台运营后台（独立于工作区 OWNER/ADMIN 的运营控制面）作为多租户商业化后的必备能力规划，不阻塞个人情报闭环。详见 §6.0 与 §9 Phase 7。

## 4. 目标用户体验

### 4.1 创建主题

用户输入自然语言主题：

```text
我想关注中国商业航空进展。
```

系统生成主题草案：

```yaml
topic:
  name: 中国商业航空进展
  goal: 跟踪中国民用/商业航空产业从研发、认证、交付到商业运营和国际化的关键进展。
  include:
    - C919 / C929 / ARJ21
    - COMAC / 中国商飞
    - 适航认证与监管政策
    - 国产发动机与供应链
    - 航司订单、交付、商业运营
    - 国际适航、出口、海外航线
  exclude:
    - 普通航班延误
    - 航旅服务营销
    - 招聘与乘务员新闻
    - 与产业进展无关的事故八卦
  output_style:
    - 简体中文
    - 保留英文缩写和专有名词
    - 偏产业进展、政策、供应链和商业运营
```

用户可以确认或修改。

系统生成主题草案后，用户可确认或修改。主题画像（topic profile）作为 `Topic.profile` 存储为单一 JSON，聚合 `keywords` / `entities` / `includeScope` / `excludeScope` / `importanceRules` / `languagePreferences` / `digestStyle`。`languagePreferences.outputLanguage` 在 i18n 落地前固定为 `zh-CN`，AI event extraction 的摘要等用户可见字段不跟随原文语言，也不允许 topic profile 覆盖；`terminologyRules` 注入 system prompt；`digestStyle` 控制每日简报 renderer 的结构、事件数上限与详细程度。关键词另用于信源发现，完整画像进入 AI event extraction；AI 输入中的 topic name/description 始终来自 `Topic` 当前字段而非 profile 内的重复快照。规则 relevance 对 title/summary 做大小写不敏感的短语匹配：excludeScope 优先否决，keywords/entities/includeScope 作为可解释正信号；importanceRules 只进入 AI 评分，不伪装成 deterministic 规则。

> 现状：新建主题页只要求填写主题名称与描述，后端生成初始 profile 并用内置信源包 `packages/db/seed-sources.json` 匹配候选 RSS/Atom。候选源必须经真实 HTTP/HTTPS feed 验证并读取 feed title 后才写入 `Source.status='CANDIDATE'` 与 `SourceObservation.evidence`；无匹配或验证失败时仍创建主题，提示用户稍后在信源管理页继续发现。Worker 正文采集把 RSS `content:encoded` 或 Readability `article.content` 清洗为 Markdown 快照存入 `Item.rawContent`，并以 `contentStatus/contentSource/contentFetchedAt/contentErrorCode` 四轴记录采集结果；仅 `contentStatus='READY'` 且 Markdown 非空时才允许 AI extraction，正文截断到 8000 字符作为安全边界。采集/AI 失败时保留空摘要占位事件（`summary` 为空、`summaryStatus` 驱动 UI 提示），不进入简报、即时推送、专题报告证据或语义去重。采集层完整状态机与清洗规则见 `docs/L2-domain.md`「Item 状态机」。

### 4.2 每日主题简报

每天系统按主题生成简报：

```text
中国商业航空进展｜每日情报

一、今日最重要进展
1. C919 新增商业航线运营数据披露
   - 为什么重要：说明国产大飞机从示范运营进入更稳定商业化阶段。
   - 影响对象：中国商飞、东航、民航局、航材供应链。
   - 来源可信度：官方/高。
   - 建议动作：继续跟踪月度航班频次和机队可用率。

二、政策与适航
...

三、供应链与发动机
...

四、低价值信息已过滤
- 普通航班延误 12 条
- 航旅营销 8 条
```

每日简报按 UTC 自然日聚合该窗口内新建、来自 `ACTIVE` source 且 `summaryStatus='READY'` 的正式情报；已读不会让同日重要事件从简报消失。`Briefing` 以 `topicId + period + rangeStart` 唯一键 upsert，同窗口重跑只刷新同一份简报及其事件集合，不新增重复记录。周报（UTC 自然周，周一开始）与月报（UTC 自然月）在每次 Worker fetch cycle 中同样幂等生成，使用各自 `period + rangeStart` 窗口。Web 简报中心按组织分页提供完整历史与 Markdown 下载，支持按 DAILY/WEEKLY/MONTHLY 周期筛选；主题时间线页按 `occurredAt` 倒序展示主题全部正式事件（含 merged sources）。

> 现状：可配置业务时区（organization/user 级）尚未实现，当前固定 UTC。简报示例中“低价值信息已过滤 N 条”的统计目前未在简报 UI 单独呈现，FILTERED Item 数量可通过信源质量报告间接查看（见 §5.8）。

### 4.3 用户反馈

每条情报支持用户反馈：

- 标记已读。
- 收藏/稍后看。
- 不感兴趣。
- 这条太泛泛。
- 这个来源质量高/低。
- 多关注这个实体。
- 少关注这个子方向。
- 摘要有用/没用。
- 分类错误。
- 分数太高/太低。
- 导出到 Obsidian。

系统应把反馈转化为：

```yaml
preference_updates:
  increase_weight:
    - C929
    - 适航认证
    - 航空发动机供应链
  decrease_weight:
    - 普通航线开通
    - 航旅营销
  preferred_sources:
    - 中国商飞官网
    - 中国民航局
  muted_patterns:
    - 航旅促销
    - 服务体验软文
```

## 5. 大块功能模块

### 5.1 主题管理

主题是产品的一等对象。

每个主题至少包含：

| 字段 | 含义 |
|------|------|
| `id` | 主题唯一 ID |
| `organizationId` | 租户归属（见 §6.0） |
| `ownerUserId` | 主题所有者（可空，删除用户时置空） |
| `name` | 主题名称，`(organizationId, name)` 唯一 |
| `description` | 用户为什么关注这个主题（自然语言） |
| `profile` | 主题画像 JSON，聚合以下子字段 |
| `profile.keywords` | 关键词与扩展词，另用于信源发现 |
| `profile.entities` | 公司、机构、人物、产品、政策、地区等 |
| `profile.includeScope` | 应覆盖的子方向 |
| `profile.excludeScope` | 应排除的内容 |
| `profile.importanceRules` | 什么算重要，只进入 AI 评分 |
| `profile.languagePreferences` | 摘要语言占位与术语规则；`outputLanguage` i18n 前固定 `zh-CN`，`terminologyRules` 注入 system prompt |
| `profile.digestStyle` | 简报结构、详细程度与最大事件数 |
| `status` | `ACTIVE` / `PAUSED` / `ARCHIVED` |
| `createdAt / updatedAt` | 生命周期字段 |

主题管理功能包括：

- 创建主题。
- 根据自然语言生成主题草案。
- 编辑 include/exclude 范围。
- 编辑关键实体和关键词。
- 编辑主题名称和描述。
- 暂停/恢复主题（PAUSED 状态停止抓取和分析，保留历史数据）。
- 归档主题（ARCHIVED 状态停止所有 worker 处理，保留历史数据，可恢复）。
- 删除主题（硬删除，级联删除关联的信源、情报、简报和偏好，需二次确认）。
- 查看主题历史简报。
- 查看主题学习到的偏好。

### 5.2 自动信源发现与治理

系统围绕主题自动发现候选信源，而不是要求用户长期手动维护源。

信源状态：

| 状态 | 含义 |
|------|------|
| `CANDIDATE` | 自动发现的候选源，先观察，不进入正式抓取与简报；设置时自动起 14 天观察期 |
| `ACTIVE` | 已批准或高质量信源，进入正式抓取与简报 |
| `MUTED` | 低价值或噪音源，暂停抓取 |
| `REJECTED` | 明确拒绝，不再推荐，可重新审核回到 `ACTIVE` |

内置信源包（`packages/db/seed-sources.json`）中的种子源初始化为 `ACTIVE`，不单列 `seed` 状态。状态机详见 `docs/L2-domain.md`「Source 状态机」。

信源质量指标：

| 持久化字段 | 含义 |
|------|------|
| `trustScore` | 综合可信度，存于 `Source` |
| `qualityScore` | 综合质量分，存于 `Source` |

运行时派生指标存于 `SourceObservation`，作为信源治理审核证据：

| 指标 | 含义 |
|------|------|
| `hitRate` | 该源 Item 中关联至少一个未归档 IntelligenceEvent 的比例（primary 与 secondary 均计） |
| `noiseRate` | `Item.status='FILTERED'` 的比例 |
| `duplicateRate` | Item 为 `DUPLICATE` 或仅以 SECONDARY 关联未归档事件的比例 |

`SourceObservation` 另存 `evidence`（JSON）记录候选源推荐理由与审核轨迹。指标口径与候选源观察期复审机制见 `docs/L2-domain.md`。

发现渠道初期可以保守实现：

1. 从高分情报中的原始链接反向发现一手来源。
2. 从已有 active sources 的外链网络发现候选源。
3. 对主题关键词定期搜索 RSS/Atom 或官网公告入口。
4. 维护少量内置 source packs 作为 seed。

> 现状：`runSourceDiscoveryCycle()` 已聚合三条渠道——`keyword-search`（Brave Search API，`BRAVE_SEARCH_API_KEY` 未配置时跳过）、`backlink-from-highscore`、`outlink-network`。每条 candidate 写入 `discoveryChannel` / `recommendationReason` / `trustScore` 与 `SourceObservation.evidence`；Source recommendation 优先用 OpenAI-compatible adapter 生成推荐理由与相关性评分，未配置 AI 时走确定性兜底。每轮 discovery 写 `TaskRun(SOURCE_DISCOVERY)` 与 `UsageEvent(SOURCE_DISCOVERY)`。信源质量报告从真实关系计算 `hitRate/noiseRate/duplicateRate`，已归档的语义合并旧事件不再抬高指标。

重要原则：

- 自动发现不等于自动信任。
- candidate 源产出的内容默认不进入正式日报，或必须明确标注。
- 系统应定期生成“信源发现/质量报告”，让用户低成本批准、拒绝或继续观察。

### 5.3 信息采集与入库

采集层负责从 active/candidate sources 抓取内容并标准化。

初期支持：

- RSS/Atom。
- 公开网页基础抓取。
- 官方公告列表页。

后续扩展：

- PDF / 公告附件。
- GitHub releases / issues / trending。
- arXiv / 论文源。
- 政府公告。
- 公司 IR / filing。
- 搜索结果。
- 社媒链接观察。

统一内容对象：

| 字段 | 含义 |
|------|------|
| `id` | 信息条目 ID |
| `organizationId` | 租户归属 |
| `topicId` | 关联主题 |
| `sourceId` | 来源 |
| `url` / `canonicalUrl` | 原文链接与规范化链接，`(topicId, canonicalUrl)` 唯一 |
| `title` | 原始标题 |
| `summary` | 原始摘要或抓取摘要，可空 |
| `author` | 作者 |
| `rawContent` | 清洗后的 Markdown 正文快照，可空 |
| `contentStatus` | 正文采集状态：`PENDING` / `READY` / `INSUFFICIENT` / `FETCH_FAILED` / `UNSUPPORTED` |
| `contentSource` | 正文来源：`RSS_EMBEDDED` / `ARTICLE_HTML` / `LEGACY_TEXT` |
| `contentFetchedAt` | 正文采集时间 |
| `contentErrorCode` | 正文采集错误码 |
| `contentHash` | 内容哈希，用于跨源重复检测 |
| `status` | `FETCHED` / `FILTERED` / `ANALYZED` / `DUPLICATE` / `ERROR` |
| `publishedAt` | 发布时间 |
| `fetchedAt` | 抓取时间 |
| `rawMetadata` | feed/网页原始 metadata |

`Item` 状态机与正文采集独立门禁见 `docs/L2-domain.md`「Item 状态机」。

### 5.4 AI 情报分析

AI 分析不应只是摘要，而应围绕主题判断信息价值。

推荐处理阶段：

1. **Relevance Filter**：是否与主题相关。
2. **Noise Filter**：是否是营销、重复、泛泛新闻。
3. **Event Extraction**：抽取发生的事件。
4. **Deduplication**：合并同一事件多来源报道。
5. **Scoring**：按主题规则打分。
6. **Briefing Rewrite**：生成面向用户的中文情报摘要。
7. **Action/Follow-up**：判断是否值得继续跟踪。

情报 item 输出字段应包含：

| 字段 | 含义 |
|------|------|
| `title` | 事件标题 |
| `summary` | 简短摘要；采集/AI 失败时为空，由 `summaryStatus` 驱动 |
| `explanation` | 为什么重要 / AI 判断依据 |
| `category` | 子方向分类 |
| `entities` | 相关实体数组 |
| `score` | 重要性分数 |
| `gravityScore` | 综合排序分（importance/time/source quality 等因子），Dashboard 排序基础分 |
| `followUpSuggestion` | 后续跟踪建议 |
| `summaryStatus` | 摘要状态：`PENDING` / `READY` / `CONTENT_FETCH_FAILED` / `CONTENT_INSUFFICIENT` / `CONTENT_UNSUPPORTED` / `AI_FAILED` |
| `eventHash` / `titleHash` | 去重哈希，配合 `topicId + eventHash` 幂等 upsert |
| `mergeReason` | 合并原因 |
| `occurredAt` | 事件发生时间（周报/月报按此聚合） |
| `rawAiResponse` | AI 原始响应（JSON，用于审计） |

多来源合并通过独立 `EventItem` 关联表承载（`role: PRIMARY` / `SECONDARY`），不再用 JSON 数组字段。`IntelligenceEvent` 与 `Item` 的状态机见 `docs/L2-domain.md`。

> 现状：每个待分析 Item 建 `AI_RELEVANCE` TaskRun；配置 AI 时再建关联的 `AI_EVENT_EXTRACTION` TaskRun。LLM 成功/失败/规则 fallback 分别落入 `output` 或 `errorMessage`；逻辑 AI 调用（一次 adapter 调用计一次，内部 HTTP retry 不重复计数）计入 `UsageEvent(AI_CALL)`。每日简报与 Markdown 导出分别建 `BRIEFING_GENERATION` / `EXPORT_GENERATION` TaskRun，fetch/discovery/analysis/briefing/export 五类任务均有真实写入链路。TaskRun 状态机与 fallback 审计见 `docs/L2-domain.md`。

### 5.5 阅读状态管理

用户需要管理信息流，而不是每天看到重复内容。

阅读状态以 `UserItemState` 承载，`status` 枚举与 `IntelligenceEvent` 共用 `EventStatus`：

| 状态 | 含义 |
|------|------|
| `UNREAD` | 尚未阅读，默认进入信息流 |
| `READ` | 已读，默认不再出现在主信息流 |
| `SAVED` | 收藏或稍后看（`saved=true`） |
| `DISMISSED` | 忽略，同时作为负反馈信号 |
| `ARCHIVED` | 已归档，不再主动显示 |

`UserItemState` 以 `(userId, eventId)` 唯一，`saved` 与 `status` 双轨：对已收藏事件执行 read 写 `readAt` 但保留 `saved=true`，只有显式 unsave 才移出收藏；收藏集合以 `(userId, eventId)` 对应 `saved=true` 为查询依据，不得通过截取首页事件再过滤推断。状态机见 `docs/L2-domain.md`「IntelligenceEvent 状态机」。

功能要求：

- 标记单条已读。
- 批量标记当日简报已读。
- 已读内容默认隐藏。
- 可以查看历史与归档。
- dismissed 应参与偏好学习。

### 5.6 用户反馈与偏好学习

反馈系统是产品长期价值的核心。

反馈类型：

| `FeedbackKind` | 含义 | 对偏好影响 |
|------|------|------|
| `READ` | 用户已读 | 轻微提升相关 category/source 权重 |
| `SAVE` | 用户收藏 | 提升相关 category/source 权重 |
| `DISMISS` | 用户忽略 | 降低相关权重 |
| `EXPORT` | 用户导出 | 正反馈，提升相关权重 |
| `SOURCE_APPROVE` / `SOURCE_REJECT` | 管理员批准/拒绝信源 | 治理审计；不直接进入个人偏好 |
| `SOURCE_QUALITY_UP` / `SOURCE_QUALITY_DOWN` | 信源质量高/低 | 提升或降低当前 Topic 的 source 权重 |
| `SCORE_UP` / `SCORE_DOWN` | 评分偏高/偏低 | 调整当前事件分数相关 category 权重 |
| `CATEGORY_UP` / `CATEGORY_DOWN` | 多关注这类 / 少关注这类 | 只调整当前 Topic 的 category 权重 |
| `MORE_LIKE_THIS` / `LESS_LIKE_THIS` | 多看/少看类似 | 调整当前事件相关 category/source 权重 |

自由文本反馈（`note`）与实体级权重（`track_entity` / `mute_entity`）为后续增强。

反馈处理流程：

```text
用户反馈
  ↓
记录原始 feedback event
  ↓
LLM/规则归纳为 preference delta
  ↓
更新 topic profile / source score / entity weight / prompt memory
  ↓
后续 L1/L2/排序读取新的偏好
```

偏好更新必须可解释：

```text
因为你连续 3 次将“普通航线开通”标记为不感兴趣，系统已降低该子方向权重。
```

> 现状：偏好学习闭环已部分闭合。**已实现**：
> - 15 种 `FeedbackKind`（含增强反馈 `SOURCE_QUALITY_UP/DOWN`、`SCORE_UP/DOWN`、`MORE/LESS_LIKE_THIS`）写入 `FeedbackEvent`；
> - Worker `runPreferenceLearningCycle` 调 `generatePreferenceDeltas` 归纳为 `PreferenceMemory`，含 30 天半衰期时间衰减（`applyTimeDecay`）、`confidence` 与可解释 `explanation`，按 `topicId + key` 隔离；
> - 偏好影响 Dashboard 排序（`applyPreferenceWeights` 调整 `gravityScore`）与每日简报生成（`renderDailyBriefingMarkdown` 注入 preferences）；
> - 用户可在偏好记忆页编辑权重或删除偏好。
>
> **待闭合（目标形态尚未落地）**：
> - 偏好未回灌到 relevance filter（`excludeScope` / `keywords` 仍来自初始 profile，不来自 `PreferenceMemory`）；
> - 偏好未回灌到 AI event extraction 的 system prompt；
> - 偏好未影响信源抓取调度（频率/范围）；
> - 实体级权重（`track_entity` / `mute_entity`）尚未单独建模，当前归并到 category/source key。
>
> 即 §7.4 描述的"抓取 → 筛选 → 排序 → 摘要"四环闭环目前闭合"排序 + 摘要"两环。

### 5.7 知识库导出与沉淀

导出功能应优先面向 Obsidian/Markdown，但保留 PDF 路径。

导出对象：

- 单条情报。
- 当日主题简报。
- 一周主题周报。
- 主题时间线。
- 收藏集合。

导出格式：

- Markdown。
- Obsidian URI / Local REST API / 插件接口。
- PDF。
- JSON。

Markdown 示例：

```markdown
# C919 商业运营进展

- 主题：中国商业航空进展
- 分类：商业运营 / 交付
- 重要性：88
- 来源：中国商飞、民航局
- 发布时间：2026-xx-xx

## 摘要
...

## 为什么重要
...

## 相关实体
- 中国商飞
- 东航

## 后续跟踪
...

## 原文链接
- ...
```

每次导出写 `ExportEvent`（关联 `organizationId` / `topicId` / 可选 `eventId` / `briefingId`，记录 `format` / `fileName` / `contentHash` / `metadata`），同时作为该信息有价值的正反馈信号（`FeedbackKind.EXPORT`）。

> 现状：Markdown / JSON / PDF 三格式中，Markdown 与 JSON 已落地（`/exports/{briefings,events,topics}` 路由）；PDF 走渲染路径。Obsidian URI / Local REST API / 插件接口为后续增强。

### 5.8 Dashboard 与简报输出

主要输出形态：

1. **主题 Dashboard**
   - 每个主题一个页面。
   - 展示未读 Top 情报、已读/收藏、趋势、信源状态。

2. **每日 / 每周 / 每月简报**
   - 每个主题按 DAILY / WEEKLY / MONTHLY 生成结构化 `Briefing`（含 `content` 与 `markdown`）。
   - 支持浏览器、Telegram、Markdown 下载、Obsidian。
   - 投递记录写 `DeliveryLog`（每条 Briefing 每渠道一条，`briefingId + channel` 唯一保证幂等）。

3. **高分情报即时推送**
   - Plus/Pro 与自用模式可开启 Telegram 即时推送。
   - 每事件每渠道一条 `InstantPushLog`（`eventId + channel` 唯一），按 `InstantPushStatus` 状态机投递与重试。
   - 15 分钟从事件成功持久化起按 Cron best-effort 计算，不是来源发布时间后的硬 SLA。

4. **信源质量报告**
   - 新发现候选源。
   - 建议加入/观察/拒绝。
   - 当前 active sources 的表现（`hitRate` / `noiseRate` / `duplicateRate`）。

5. **主题时间线**
   - 按时间展示重要事件。
   - 支持周报/月报生成。

6. **专题报告**
   - 用户提交自然语言问题，系统从情报库已有 `IntelligenceEvent` / `Item` 检索证据，生成结构化 Markdown `Report`（`ReportStatus` 状态机），不发起全网搜索。

> 现状：1-5 已落地；专题报告（6）走 `runReportGeneration()`，证据不足时标记 `INSUFFICIENT_DATA` 并写 `coverageNote`。Telegram 投递与即时推送依赖 `OrganizationCredential(TELEGRAM)` 凭证，未配置或未启用时静默跳过。

## 6. 数据模型目标

数据模型以 `packages/db/prisma/schema.prisma` 为准，本节为可读概览。目标数据模型在 MVP 单用户模式下以最小形态存在，但已预留商业化与多租户所需的资源归属边界，避免后续从个人工具迁移到多租户产品时重写核心表结构。

### 6.0 商业化与租户边界

> 订阅制商业模型完整定义见 `docs/business-model.md`（Free/Plus/Pro 三层订阅、BYOK、Stripe/ccpayment 支付、配额引擎）。广告策略（Free 计划展示广告、自用模式可关闭）见其 §14，数据基础为 `Subscription.showAdsInSelfHosted`。

租户与计费相关模型：

```text
users
- id, email (unique), name?
- createdAt, updatedAt

organizations
- id, name, slug (unique)
- createdAt, updatedAt

memberships
- id, userId, organizationId
- role: MembershipRole = OWNER | ADMIN | MEMBER
- (organizationId, userId) 唯一

subscriptions              # Organization 1:1
- id, organizationId (unique)
- plan: Plan = FREE | PLUS | PRO
- status: SubscriptionStatus = ACTIVE | PAST_DUE | CANCELED | EXPIRED
- billingInterval, isSelfHosted, showAdsInSelfHosted
- stripeCustomerId?, stripeSubscriptionId?
- currentPeriodStart?, currentPeriodEnd?, canceledAt?, metadata?

organization_credentials  # 每行一类凭证，(organizationId, credentialType) 唯一
- id, organizationId, credentialType: AI | SEARCH | BYOK | TELEGRAM | CCPAYMENT
- encryptedKey?, encryptedSecret?, keyHint?      # AES-256-GCM 密文 + 脱敏 hint
- baseUrl?, provider?, model?, appId?, chatId?
- enabled, instantPushEnabled?, instantPushEnabledAt?

payment_invoices           # 支付订单
- id, organizationId, plan, amount, currency, status
- provider: ccpayment | stripe, providerOrderId?
- periodStart?, periodEnd?, metadata?

accounts / sessions        # Better Auth 兼容
- Account: (userId, providerId) 唯一，承载 email/password 与 OAuth
- Session: token 唯一，expiresAt 驱动过期

usage_events
- id, organizationId, userId?
- type: AI_CALL | FETCH | EXPORT | BRIEFING | SOURCE_GOVERNANCE | SOURCE_DISCOVERY | WEB_ACTION | INSTANT_PUSH
- quantity, unit, subjectType?, subjectId?, metadata?

webhook_events             # 支付回调幂等
- id, provider, recordId, organizationId
- (provider, recordId) 唯一
```

平台运营后台（#152，规划中，不阻塞个人情报闭环）：

```text
platform_admins            # 独立于 MembershipRole 的全局身份（规划中，由 #154 引入）
- id, userId, role: PLATFORM_OWNER | PLATFORM_ADMIN | PLATFORM_AUDITOR
- mfaEnabled?, lastReauthAt?

audit_logs                 # 不可变审计（规划中，由 #154 引入）
- id, actorType, actorId, action, targetType, targetId
- reason?, before?, after?, createdAt
- append-only

users（扩展，规划中）       # 五维独立状态，不合并单一 status（由 #153 引入）
- accountStatus: ACTIVE | SUSPENDED | DELETED
- verificationStatus: PENDING | VERIFIED
- activityStatus: ACTIVE | DORMANT
```

预留原则：

- 单用户 MVP 创建默认用户和默认组织，不要求真实注册登录。
- 主题、信源、条目、情报事件、反馈、偏好记忆和导出记录均关联 `organizationId`（tenant-owned）或 `userId`（user-specific state）。
- 完整权限系统、计费系统、团队管理 UI 与平台运营后台放到后续阶段，不阻塞主题情报闭环。
- 认证关闭的 self-hosted 模式默认不启用平台运营后台。

### 6.1 `topics`

```text
topics
- id
- organizationId
- ownerUserId?               # 删除用户时置空
- name                       # (organizationId, name) 唯一
- description?
- profile?                   # Json：keywords/entities/includeScope/excludeScope/importanceRules/languagePreferences/digestStyle
- status: ACTIVE | PAUSED | ARCHIVED
- createdAt, updatedAt
```

### 6.2 `sources`

```text
sources
- id
- organizationId, topicId
- kind: RSS | WEB
- status: CANDIDATE | ACTIVE | MUTED | REJECTED
- name, url, canonicalUrl       # (topicId, canonicalUrl) 唯一
- description?, recommendationReason?, discoveryChannel?
- trustScore, qualityScore     # 持久化质量分
- lastFetchedAt?, lastError?, lastErrorAt?, consecutiveFailures
- observeExpiresAt?            # 候选源 14 天观察期到期时间
- createdAt, updatedAt
```

运行时派生指标 `hitRate` / `noiseRate` / `duplicateRate` 存于 `source_observations`（§6.10）。

### 6.3 `items`

```text
items
- id
- organizationId, topicId, sourceId
- url, canonicalUrl            # (topicId, canonicalUrl) 唯一
- title, summary?, author?
- rawContent?                  # 清洗后的 Markdown 正文快照
- contentStatus: PENDING | READY | INSUFFICIENT | FETCH_FAILED | UNSUPPORTED
- contentSource?: RSS_EMBEDDED | ARTICLE_HTML | LEGACY_TEXT
- contentFetchedAt?, contentErrorCode?
- contentHash?
- status: FETCHED | FILTERED | ANALYZED | DUPLICATE | ERROR
- publishedAt?, fetchedAt
- rawMetadata?
- createdAt, updatedAt
```

### 6.4 `intelligence_events`

```text
intelligence_events
- id
- organizationId, topicId
- primaryItemId?               # 主来源 Item，删除时置空
- status: EventStatus = UNREAD | READ | SAVED | DISMISSED | ARCHIVED
- title, summary
- summaryStatus: PENDING | READY | CONTENT_FETCH_FAILED | CONTENT_INSUFFICIENT | CONTENT_UNSUPPORTED | AI_FAILED
- explanation?, category?, followUpSuggestion?
- entities[]                   # 字符串数组
- score, gravityScore
- eventHash?, titleHash?       # (topicId, eventHash) 唯一，幂等 upsert
- mergeReason?, occurredAt?
- rawAiResponse?
- createdAt, updatedAt
```

多来源合并通过 `event_items` 关联表（`eventId` / `itemId` / `role: PRIMARY | SECONDARY`）承载，不再用 `merged_item_ids_json`。

### 6.5 `user_item_states`

```text
user_item_states
- id
- userId, eventId              # (userId, eventId) 唯一
- status: EventStatus          # 与 IntelligenceEvent 共用枚举
- saved                        # 与 status 双轨
- readAt?
- createdAt, updatedAt
```

`archivedAt` / `dismissedAt` 不单列字段，由 `status=ARCHIVED` / `DISMISSED` 隐含，时间靠 `updatedAt` 推断。

### 6.6 `feedback_events`

```text
feedback_events
- id
- organizationId, topicId
- userId?, eventId?, itemId?, sourceId?
- kind: FeedbackKind          # 15 种，见 §5.6
- value?, reason?, metadata?
- createdAt
```

`target_type` / `target_value` 旧设计已替换为 `kind` 枚举 + 外键（eventId/itemId/sourceId）拆分。

### 6.7 `preference_memory`

```text
preference_memory
- id
- organizationId, topicId
- userId?
- key                          # (topicId, userId, key) 唯一
- value: Json                  # { signalCount, weight }
- explanation
- confidence
- createdAt, updatedAt
```

`memory_type` / `weight` / `evidence_json` 旧设计已替换为 `key` + `value.weight` + `explanation` + `confidence`；偏好信号带 30 天半衰期时间衰减（见 §5.6）。

### 6.8 `event_items`

```text
event_items
- id
- eventId, itemId
- role: PRIMARY | SECONDARY     # (eventId, itemId) 唯一
- mergedAt
```

### 6.9 `briefings`

```text
briefings
- id
- organizationId, topicId
- period: DAILY | WEEKLY | MONTHLY
- title, content
- markdown?                    # (topicId, period, rangeStart) 唯一，幂等 upsert
- rangeStart, rangeEnd
- generatedAt
- metadata?
- createdAt, updatedAt
```

### 6.10 `source_observations`

```text
source_observations
- id
- organizationId, topicId
- sourceId?, candidateUrl?
- hitRate, noiseRate, duplicateRate
- evidence?                    # Json：推荐理由与审核轨迹
- observedAt
- createdAt
```

### 6.11 `task_runs`

```text
task_runs
- id
- organizationId
- topicId?, sourceId?, itemId?, eventId?
- type: SOURCE_FETCH | CONTENT_FETCH | SOURCE_DISCOVERY | AI_RELEVANCE | AI_EVENT_EXTRACTION | BRIEFING_GENERATION | EXPORT_GENERATION | REPORT_GENERATION | TELEGRAM_DELIVERY | TELEGRAM_INSTANT_PUSH
- status: PENDING | RUNNING | SUCCEEDED | FAILED | CANCELED
- attempt, maxAttempts
- scheduledAt, startedAt?, finishedAt?
- errorMessage?, input?, output?   # output 截断到 100KB
- createdAt, updatedAt
```

### 6.12 `export_events`

```text
export_events
- id
- organizationId, topicId
- userId?, eventId?, briefingId?
- format: MARKDOWN | PDF | JSON
- fileName?, contentHash?, metadata?
- createdAt
```

### 6.13 `delivery_logs`

```text
delivery_logs
- id
- organizationId, briefingId
- channel: TELEGRAM            # (briefingId, channel) 唯一
- status: PENDING | SENT | FAILED | SKIPPED
- attempt, recipientRef?
- errorMessage?, errorCode?, sentAt?, metadata?
- createdAt, updatedAt
```

### 6.14 `instant_push_logs`

```text
instant_push_logs
- id
- organizationId, eventId
- channel: TELEGRAM            # (eventId, channel) 唯一
- status: PENDING | SENDING | SENT | FAILED | SKIPPED
- score, attempt
- recipientRef?, nextAttemptAt?, lockedAt?, sentAt?
- errorMessage?, errorCode?, metadata?
- createdAt, updatedAt
```

### 6.15 `reports`

```text
reports
- id
- organizationId
- question
- status: PENDING | GENERATING | COMPLETED | FAILED | INSUFFICIENT_DATA
- markdown?, summary?
- rangeStart?, rangeEnd?
- eventCount, itemCount
- topicIds[], sourceIds[]
- coverageNote?, generatedAt?, errorMessage?, metadata?
- createdAt, updatedAt
```

### 6.16 实体关系概览

完整实体关系与唯一性约束见 `docs/L2-domain.md`「实体关系概览」。核心拓扑：`Organization` 1:N `Topic` -> {`Source` -> `SourceObservation`, `Item` -> `IntelligenceEvent` -> {`EventItem`, `UserItemState`, `FeedbackEvent`, `Briefing` -> {`ExportEvent`, `DeliveryLog`}}, `PreferenceMemory`, `Briefing`, `TaskRun`}；`Organization` 1:1 `Subscription` 1:N `PaymentInvoice`，1:N `OrganizationCredential`。

## 7. 系统工作流目标

### 7.1 主题初始化

```text
用户输入主题
  ↓
生成 topic profile 草案
  ↓
创建 topic
  ↓
匹配内置信源包并验证 RSS/Atom
  ↓
写入初始 candidate sources 或提示暂无候选
```

### 7.2 信源发现

```text
topic profile
  ↓
搜索 / source pack / 高分链接反查 / active source 外链
  ↓
候选 source
  ↓
可信度初评
  ↓
进入 candidate 观察池
```

### 7.3 每日采集与分析

```text
active sources
  ↓
抓取 items
  ↓
去重入库
  ↓
主题相关性筛选
  ↓
事件抽取与合并
  ↓
评分与摘要
  ↓
生成 unread intelligence events
  ↓
生成每日简报
```

### 7.4 用户反馈学习

```text
用户操作：已读/收藏/忽略/反馈/导出
  ↓
记录 FeedbackEvent
  ↓
generatePreferenceDeltas 归纳（含 30 天衰减）
  ↓
upsert PreferenceMemory
  ↓
影响排序（gravityScore）+ 简报生成（preferences 注入）
  ↓
[待闭合] 回灌到抓取调度 / relevance filter / AI extraction prompt
```

> 现状：闭环当前闭合到"排序 + 摘要"两环；"抓取 / 筛选"两环待补（详见 §5.6）。

### 7.5 知识沉淀

```text
用户导出单条/简报/周报
  ↓
生成 Markdown / PDF / JSON
  ↓
写入 Obsidian 或下载
  ↓
记录 export event，作为该信息有价值的正反馈
```

## 8. 实现架构分层

当前仓库已绿地重构为 TypeScript 主路径，旧 Python 原型已在开源清洗中删除。实现细节按 L0-L4 抽象层级组织文档，详见 `CODEGUIDE.md` 及 `docs/` 下分层文件：

| 层 | 内容 | 文件 |
|---|---|---|
| L0 | 系统架构、运行时拓扑、主干数据流 | `CODEGUIDE.md` §L0 |
| L1 | 设计原则、依赖方向、安全与边界 | `CODEGUIDE.md` §L1 |
| L2 | 领域模型、状态机、术语 | `docs/L2-domain.md` |
| L3 | 模块职责、关键文件、调用链 | `docs/L3-modules.md` |
| L4 | 命令、环境变量、部署、测试 | `docs/L4-operations.md` |

文档分层归属规则和 AI Agent 阅读协议见 `AGENTS.md`。

## 9. MVP 分阶段建议

### Phase 0：规格与目标架构对齐

目标：明确本文档为开发方向，现有实现为可参考的引擎原型，目标架构可以按 Node.js / TypeScript 产品化方向重新设计。

产出：

- 本 `SPEC.md`。
- 更新 `README.md` / `CODEGUIDE.md`（L0-L4）/ `AGENTS_CHANGELOGS.md`。

### Phase 1：主题层与单用户状态

目标：从“全局新闻流”改为“主题新闻流”。

实现：

- 新增 `topics` 表。
- 支持创建/编辑一个或多个主题。
- 每个 item/event 关联 topic。
- 初始仍允许手动配置 RSS，但必须归属到 topic。
- 新增已读/收藏/忽略状态。

验收：

- 用户可以创建“中国商业航空进展”主题。
- 信息流按主题展示。
- 标记已读后不再出现在未读主流中。

### Phase 2：反馈系统与偏好记忆

目标：让用户反馈影响后续排序和筛选。

实现：

- 新增 `feedback_events`。
- 新增 `preference_memory`。
- 反馈按钮：不感兴趣、多关注、少关注、来源好/差、分数高/低。
- LLM/规则将反馈归纳成 topic preference delta。

验收：

- 用户多次反馈某类内容不感兴趣后，该类内容权重下降。
- 用户标记某实体继续跟踪后，相关内容权重上升。
- 系统能解释偏好变化原因。

### Phase 3：Obsidian / Markdown 导出

目标：支持知识沉淀。

实现：

- 单条情报导出 Markdown。
- 当日主题简报导出 Markdown。
- 浏览器下载 `.md`。
- 可选支持 Obsidian URI 或本地插件 API。

验收：

- 用户可以从浏览器导出一条情报或当天简报。
- 导出内容包含来源、摘要、为什么重要、实体、后续跟踪和原文链接。

### Phase 4：信源 Registry 与质量指标

目标：不再依赖裸 `RSS_FEEDS`。

实现：

- 新增 `sources` 表。
- source 状态：seed/candidate/active/muted/rejected。
- 每次抓取和 L1/L2 后更新 source 统计。
- 计算 historical_hit_rate、noise_score、duplicate_score。

验收：

- 系统可以展示每个 source 的历史表现。
- 噪音高的 source 可以自动降权或建议 muted。

### Phase 5：自动信源发现

目标：系统主动发现候选源。

实现：

- 从高分事件原文链接反查 source。
- 从 active source 外链发现 candidate。
- 从主题关键词搜索 RSS/公告入口。
- 每周生成候选信源报告。

验收：

- 系统每周提出候选信源建议。
- 用户可批准/拒绝/继续观察。
- 批准后的源进入 active pool。

### Phase 6：主题简报与时间线

目标：从新闻卡片升级为主题情报工作台。

实现：

- 每日主题 briefing。
- 主题事件时间线。
- 周报/月报生成。
- 信源质量报告。

验收：

- 用户可以查看某主题过去 7/30 天关键进展。
- 系统可以生成结构化周报。

### Phase 7：商业化、多租户与平台运营

> 订阅制商业模型详情见 `docs/business-model.md`（Free/Plus/Pro 三层订阅、BYOK、Stripe/ccpayment 支付、配额引擎）。平台运营后台规划见 #152 及其子 Issue #153-#159。

目标：在核心个人使用闭环稳定后，将预留边界打开为可商业化的产品基础，并建立独立于工作区 OWNER/ADMIN 的平台运营控制面。

实现：

- 引入真实用户认证。
- 引入 organization / membership / role。
- 为 topic/source/item/event/feedback/export 增加租户级访问边界。
- 记录 AI 调用、抓取、导出、简报生成等 usage events。
- 增加基础配额、审计日志和 billing placeholder。

验收：

- 不同 organization 的数据默认隔离。
- 用户只能访问自己有权限的主题和情报。
- 系统可以统计每个 organization 的用量。
- 商业化能力不破坏单用户本地使用体验。

> 现状：商业化基础（`Subscription` / `OrganizationCredential` / `PaymentInvoice` / Better Auth）已落地（migration `0010_subscription_plan_auth`、`0012_instant_push`）。平台运营后台（#152-#159）尚未开始，按依赖分阶段推进：

```text
Phase 7a（P0）：#153 认证 Schema 与用户生命周期 + #154 平台 RBAC 与不可变审计 + #155 工作区/平台边界分离
Phase 7b（P1）：#156 只读用户与工作区运营后台 + #157 账户暂停、会话吊销与统一授权门
Phase 7c（P1）：#158 订阅、用量、支付与任务健康诊断（#33 Stripe 阻塞完整 Stripe 运营视图）
Phase 7d（P2）：#159 受控运营操作、临时权益与客服备注
```

全局阻塞项（需产品/架构决策，见 #152）：平台管理员首账号初始化、MFA/重新认证/Session TTL、邮箱验证与账户匿名化、`PAST_DUE` 宽限期与 effective plan 口径、`/admin/*` 向 `/ops` 迁移兼容。

## 10. 非目标与边界

当前 MVP 不做完整实现：

- 真实收费、支付结算和订阅管理。
- 完整团队协作、组织管理后台和复杂权限系统。
- 企业私有数据接入。
- 大规模爬虫集群。
- 完全自动相信新信源。
- 替代人工判断的投资/政策决策。

不再作为长期非目标：

- 商业化。
- 多租户。
- 团队权限。
- 付费系统。

这些能力应作为后续阶段演进，但不应干扰早期个人主题情报工作台的核心体验。

必须避免：

- 把未验证候选源内容混入正式日报而不标注。
- 用户反馈只记录不生效（反馈必须回灌到排序/简报，并向筛选与抓取闭环演进）。
- 让用户继续手动维护大量 RSS。
- 把 LLM 对信源可信度的一次性判断当作最终结论。
- 把摘要工具误做成新闻列表。
- 平台管理员身份复用 `MembershipRole`、平台运营操作缺乏不可变审计。

## 11. 成功标准

MVP 成功标准：

1. 用户可以用自然语言创建主题，而不是手动配置 RSS。
2. 每天输出的简报大多数内容确实值得看。
3. 已读/忽略后，信息流不会反复展示旧内容。
4. 用户反馈 1-2 周后，系统明显减少不感兴趣内容。
5. 系统能推荐新的候选信源，并解释推荐原因。
6. 用户可以把重要情报沉淀到 Obsidian/Markdown。
7. 每个主题可以形成连续时间线，而不是孤立新闻卡片。
8. 数据模型和工程边界不阻碍后续引入用户、组织、权限、用量和付费能力。
9. 用户反馈在排序与简报生效后，进一步回灌到信源筛选与抓取，真正“越来越懂你”（见 §5.6 待闭合项）。

## 12. 产品描述与功能清单

### 12.1 产品描述

**望潮** 是一个以用户关注主题为中心、先面向个人使用并可演进为多租户商业化产品的 AI 情报系统。它自动发现并评估相关信息源，持续抓取公开信息，使用 LLM 进行相关性判断、去重、摘要、评分和结构化整理；用户通过阅读状态、反馈和导出行为训练系统，使其逐步形成个性化的关注边界和信源偏好，并将重要信息沉淀为长期知识资产。

### 12.2 大块功能

1. 主题管理。
2. 自动信源发现与信源治理。
3. 信息采集与标准化入库。
4. AI 情报分析与事件去重。
5. 重要性排序与每日/每周/每月主题简报。
6. 阅读状态管理。
7. 用户反馈与偏好学习。
8. Obsidian / Markdown / PDF 导出。
9. 主题时间线与知识沉淀。
10. 本地运行、配置、测试和部署机制。
11. 平台运营后台（#152，规划中）：独立于工作区的运营控制面，含用户/工作区/订阅/用量/会话检索与安全处置。
