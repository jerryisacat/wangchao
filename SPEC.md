# 望潮（Wangchao）产品规格（SPEC）

> 本文档是后续产品开发与重构的主要依据。
>
> 它描述的是**目标产品形态**，不再局限于当前 `望潮（Wangchao）` 的既有 RSS + Dashboard 实现。当前代码可以视为第一版信息处理引擎原型：已具备 RSS 抓取、SQLite 入库、L1/L2 AI 筛选、去重、摘要、评分、Gravity Ranking 和静态 JSON/HTML 输出；但后续开发应以本文档的目标产品为准。

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

当前 TypeScript 主路径的 V1 落地方式是：新建主题页只要求用户填写主题名称和描述；后端先生成包含 `keywords`、`entities`、`includeScope`、`excludeScope`、`importanceRules`、`languagePreferences`（输出语言 + 术语规则）和 `digestStyle`（简报结构 + 详细程度 + 最大事件数）的初始 topic profile，再用内置信源包 `packages/db/seed-sources.json` 匹配候选 RSS/Atom。主题编辑页可读取并修改上述七组画像字段；保存使用 tenant-scoped update。`languagePreferences.outputLanguage` 控制 AI extraction prompt 的输出语言；`languagePreferences.terminologyRules` 注入 system prompt；`digestStyle` 控制 daily briefing renderer 的结构、事件数上限和详细程度。无 AI 或 AI 失败时，规则 relevance 对 title/summary 做大小写不敏感的短语匹配：excludeScope 优先否决，keywords/entities/includeScope 作为可解释正信号；importanceRules 只进入 AI 评分，不伪装成 deterministic 规则。关键词另用于信源发现，完整画像进入 AI event extraction；AI 输入中的 topic name/description 始终来自 Topic 当前字段而不是 profile 内的重复快照。Worker 抓取 RSS 后会异步抓取原文全文（基于 `@mozilla/readability` + `linkedom`），写入 `Item.rawContent`；AI event extraction 在 `rawContent` 可用时优先使用全文，无全文时 fallback 到 RSS summary，超长全文截断到 8000 字符。用户可在情报详情页手动触发"重新生成摘要"（频率限制：每事件每分钟最多 1 次），缺少 AI 凭证时给出友好提示。候选源必须经过真实 HTTP/HTTPS feed 验证并读取 feed title，验证通过后才写入 `Source.status='CANDIDATE'` 和 `SourceObservation.evidence`；没有匹配或验证失败时仍创建主题，并提示用户稍后在信源管理页继续发现。

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

当前 TypeScript 主路径以 UTC 自然日作为 daily briefing 的稳定时间窗口：只聚合该窗口内新建、来自 `ACTIVE` source 且未被忽略/归档的正式情报；已读不会让同日重要事件从简报消失。`Briefing` 使用 `topicId + period + rangeStart` 唯一键 upsert，同一主题同一天重复运行 Worker 只刷新同一份简报及其事件集合，不新增重复记录；Web 简报中心分页提供完整历史和 Markdown 下载。可配置业务时区、周报/月报与主题时间线仍由后续能力扩展。

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
| `name` | 主题名称 |
| `goal` | 用户为什么关注这个主题 |
| `include_scope` | 应覆盖的子方向 |
| `exclude_scope` | 应排除的内容 |
| `keywords` | 关键词与扩展词 |
| `entities` | 公司、机构、人物、产品、政策、地区等 |
| `language_preferences` | 输出语言与术语规则 |
| `importance_rules` | 什么算重要 |
| `digest_style` | 简报结构与详细程度 |
| `created_at / updated_at` | 生命周期字段 |

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
| `seed` | 初始种子源，人工或系统内置，高可信 |
| `candidate` | 自动发现的候选源，先观察，不直接进入正式日报 |
| `active` | 已批准或高质量信源，进入正式抓取与简报 |
| `muted` | 低价值或噪音源，暂停或低频抓取 |
| `rejected` | 明确拒绝，不再推荐 |

信源质量指标：

| 指标 | 含义 |
|------|------|
| `authority_score` | 官方性/权威性 |
| `relevance_score` | 与主题相关程度 |
| `originality_score` | 原创/一手信息程度 |
| `citation_quality` | 是否引用原始文件/公告/数据 |
| `noise_score` | 噪音比例 |
| `duplicate_score` | 与其他源重复程度 |
| `freshness_score` | 时效性 |
| `historical_hit_rate` | 历史高价值命中率 |
| `trust_score` | 综合可信度 |

发现渠道初期可以保守实现：

1. 从高分情报中的原始链接反向发现一手来源。
2. 从已有 active sources 的外链网络发现候选源。
3. 对主题关键词定期搜索 RSS/Atom 或官网公告入口。
4. 维护少量内置 source packs 作为 seed。

当前 TypeScript 主路径已落地：

- `runSourceDiscoveryCycle()` 聚合 `keyword-search`、`backlink-from-highscore`、`outlink-network` 三条渠道。
- `keyword-search` 默认使用 Brave Search API，`BRAVE_SEARCH_API_KEY` 未配置时跳过该渠道，不阻塞其他发现路径。
- 每条 candidate source 写入 `discoveryChannel`、`recommendationReason`、`trustScore` 和 `SourceObservation.evidence`。
- Source recommendation 优先使用 OpenAI-compatible adapter 生成一句推荐理由和 0-1 相关性评分；未配置 AI 或调用失败时使用确定性兜底推荐。
- 每轮 discovery 写入 `TaskRun(type='SOURCE_DISCOVERY')` 和 `UsageEvent(type='SOURCE_DISCOVERY')`。
- 信源质量报告从当前真实关系计算：`hitRate` 是该源 Item 中进入未归档 IntelligenceEvent（primary 或 secondary）的比例；`noiseRate` 是 FILTERED Item 比例；`duplicateRate` 是被合并为 secondary 报道的 Item 比例。事件数按未归档 event id 去重，已归档的语义合并旧事件不会继续抬高指标。

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
| `topic_id` | 关联主题 |
| `source_id` | 来源 |
| `url` | 原文链接 |
| `canonical_url` | 规范化链接 |
| `title` | 原始标题 |
| `summary` | 原始摘要或抓取摘要 |
| `content` | 可选正文 |
| `published_at` | 发布时间 |
| `fetched_at` | 抓取时间 |
| `language` | 语言 |
| `raw_metadata` | feed/网页原始 metadata |

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
| `event_title` | 事件标题 |
| `brief_summary` | 简短摘要 |
| `why_it_matters` | 为什么重要 |
| `topic_relevance` | 与主题关系 |
| `entities` | 相关实体 |
| `category` | 子方向分类 |
| `importance_score` | 重要性分数 |
| `confidence_score` | 置信度 |
| `source_quality` | 来源质量 |
| `merged_sources` | 合并来源 |
| `follow_up_suggestion` | 后续跟踪建议 |
| `generated_at` | 生成时间 |

当前 TypeScript 主路径为每个待分析 Item 建立 `AI_RELEVANCE` TaskRun；配置 AI 时再建立关联同一 Item 的 `AI_EVENT_EXTRACTION` TaskRun。LLM 成功、失败和规则 fallback 分别落入 `output` 或 `errorMessage`，不会只存在于 stderr；所有逻辑 AI 调用（一次 adapter 调用计一次，内部 HTTP retry 不重复计数，包括最终失败后 fallback 的调用）都会计入 `UsageEvent(type='AI_CALL')`。每日简报和 Markdown 导出分别建立 `BRIEFING_GENERATION`、`EXPORT_GENERATION` TaskRun，因此 fetch、discovery、analysis、briefing、export 六类已声明任务都有真实写入链路。

### 5.5 阅读状态管理

用户需要管理信息流，而不是每天看到重复内容。

阅读状态：

| 状态 | 含义 |
|------|------|
| `unread` | 尚未阅读，默认进入信息流 |
| `read` | 已读，默认不再出现在主信息流 |
| `saved` | 收藏或稍后看 |
| `archived` | 已归档，不再主动显示 |
| `dismissed` | 忽略，同时作为负反馈信号 |

功能要求：

- 标记单条已读。
- 批量标记当日简报已读。
- 已读内容默认隐藏。
- 可以查看历史与归档。
- dismissed 应参与偏好学习。

### 5.6 用户反馈与偏好学习

反馈系统是产品长期价值的核心。

反馈类型：

| 类型 | 含义 |
|------|------|
| `not_interested` | 对这条/这类不感兴趣 |
| `more_like_this` | 多推类似内容 |
| `less_like_this` | 少推类似内容 |
| `source_good` | 来源质量好 |
| `source_bad` | 来源质量差 |
| `wrong_category` | 分类错误 |
| `score_too_high` | 分数过高 |
| `score_too_low` | 分数过低 |
| `track_entity` | 继续跟踪某实体 |
| `mute_entity` | 降低某实体权重 |
| `note` | 自由文本反馈 |

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

当前 TypeScript 主路径已落实基础闭环：READ/SAVE/DISMISS/EXPORT 与详情页的“多关注这类 / 少关注这类”都会写入原始 `FeedbackEvent`；后两者分别使用 `CATEGORY_UP` / `CATEGORY_DOWN`，只调整当前 Topic 下对应 category 的权重，不连带修改 source 偏好。规则归纳结果即时写入可解释的 `PreferenceMemory` 并影响 Dashboard 排序。同名 category 的信号必须按 `topicId` 隔离，不能跨主题抵消或合并。更丰富的 source/score/entity/note 反馈、衰减、历史编辑和 Worker 分析阶段应用仍属于后续增强范围。

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

### 5.8 Dashboard 与简报输出

主要输出形态：

1. **主题 Dashboard**
   - 每个主题一个页面。
   - 展示未读 Top 情报、已读/收藏、趋势、信源状态。

2. **每日简报**
   - 每个主题每天生成结构化 summary。
   - 支持浏览器、Telegram、Markdown、Obsidian。

3. **信源质量报告**
   - 新发现候选源。
   - 建议加入/观察/拒绝。
   - 当前 active sources 的表现。

4. **主题时间线**
   - 按时间展示重要事件。
   - 支持周报/月报生成。

## 6. 数据模型目标

MVP 体验可以先按单用户本地模式设计，不需要完整多用户认证、团队协作和付费系统。但目标数据模型应预留未来商业化所需的资源归属边界，避免后续从个人工具迁移到多租户产品时重写核心表结构。

### 6.0 商业化与租户边界预留

> 订阅制商业模型的完整定义见 `docs/business-model.md`。以下 Schema 边界为该模型提供数据基础。

以下模型可以在 MVP 中以最小形态存在，也可以作为后续阶段引入；但主题、信源、条目、情报事件、反馈和导出记录的设计应能自然挂接这些边界。

```text
users
- id
- email
- name
- created_at
- updated_at

organizations
- id
- name
- slug
- created_at
- updated_at

memberships
- id
- user_id
- organization_id
- role              # owner/admin/member/viewer
- created_at
- updated_at

usage_events
- id
- organization_id
- user_id
- event_type        # ai_call/fetch/export/briefing/source_discovery
- quantity
- metadata_json
- created_at
```

预留原则：

- 单用户 MVP 可以创建默认用户和默认组织，不要求真实注册登录。
- 主题、信源、条目、情报事件、反馈、偏好记忆和导出记录应能关联到 `user_id` 或 `organization_id`。
- 完整权限系统、计费系统和团队管理 UI 放到后续阶段，不阻塞主题情报闭环。

### 6.1 `topics`

```text
topics
- id
- name
- goal
- include_scope_json
- exclude_scope_json
- keywords_json
- entities_json
- importance_rules_json
- digest_style_json
- status
- created_at
- updated_at
```

### 6.2 `sources`

```text
sources
- id
- topic_id
- name
- type
- site_url
- feed_url
- status              # seed/candidate/active/muted/rejected
- language
- region
- authority_score
- relevance_score
- originality_score
- trust_score
- noise_score
- duplicate_score
- historical_hit_rate
- discovered_by
- discovered_at
- approved_at
- last_fetched_at
- last_success_at
- failure_count
- created_at
- updated_at
```

### 6.3 `items`

```text
items
- id
- topic_id
- source_id
- url
- canonical_url
- title
- summary
- content
- published_at
- fetched_at
- language
- raw_metadata_json
- processing_status
```

### 6.4 `intelligence_events`

```text
intelligence_events
- id
- topic_id
- primary_item_id
- event_title
- brief_summary
- why_it_matters
- category
- entities_json
- importance_score
- confidence_score
- source_quality_score
- merged_item_ids_json
- follow_up_suggestion
- created_at
- updated_at
```

### 6.5 `user_item_states`

```text
user_item_states
- id
- event_id
- state              # unread/read/saved/archived/dismissed
- read_at
- saved_at
- archived_at
- dismissed_at
- created_at
- updated_at
```

### 6.6 `feedback_events`

```text
feedback_events
- id
- topic_id
- event_id
- source_id
- feedback_type
- target_type        # item/source/entity/category/summary/score/free_text
- target_value
- note
- created_at
```

### 6.7 `preference_memory`

```text
preference_memory
- id
- topic_id
- memory_type        # include/exclude/entity/source/style/scoring
- key
- value
- weight
- evidence_json
- created_at
- updated_at
```

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
记录行为与反馈
  ↓
归纳 preference delta
  ↓
更新 topic profile / source score / entity weights
  ↓
影响下一轮抓取、筛选、排序和摘要
```

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

旧 Python 原型的参考行为映射见 `REFACTOR_PLAN.md` §9。文档分层归属规则和 AI Agent 阅读协议见 `AGENTS.md`。

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

### Phase 7：商业化与多租户基础

> 订阅制商业模型详情见 `docs/business-model.md`（Free/Plus/Pro 三层订阅、BYOK、Stripe/ccpayment 支付、配额引擎）。

目标：在核心个人使用闭环稳定后，将预留边界打开为可商业化的产品基础。

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
- 用户反馈只记录不生效。
- 让用户继续手动维护大量 RSS。
- 把 LLM 对信源可信度的一次性判断当作最终结论。
- 把摘要工具误做成新闻列表。

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

## 12. 产品描述与功能清单

### 12.1 产品描述

**望潮** 是一个以用户关注主题为中心、先面向个人使用并可演进为多租户商业化产品的 AI 情报系统。它自动发现并评估相关信息源，持续抓取公开信息，使用 LLM 进行相关性判断、去重、摘要、评分和结构化整理；用户通过阅读状态、反馈和导出行为训练系统，使其逐步形成个性化的关注边界和信源偏好，并将重要信息沉淀为长期知识资产。

### 12.2 大块功能

1. 主题管理。
2. 自动信源发现与信源治理。
3. 信息采集与标准化入库。
4. AI 情报分析与事件去重。
5. 重要性排序与每日主题简报。
6. 阅读状态管理。
7. 用户反馈与偏好学习。
8. Obsidian / Markdown / PDF 导出。
9. 主题时间线与知识沉淀。
10. 本地运行、配置、测试和部署机制。
