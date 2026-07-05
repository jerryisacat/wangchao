# 望潮（Wangchao）产品规格（SPEC）

> 本文档是后续产品开发与重构的主要依据。
>
> 它描述的是**目标产品形态**，不再局限于当前 `望潮（Wangchao）` 的既有 RSS + Dashboard 实现。当前代码可以视为第一版信息处理引擎原型：已具备 RSS 抓取、SQLite 入库、L1/L2 AI 筛选、去重、摘要、评分、Gravity Ranking 和静态 JSON/HTML 输出；但后续开发应以本文档的目标产品为准。

## 1. 产品一句话

**望潮（Wangchao）** 是一个会学习用户偏好的个人主题情报 Agent：用户只需要创建关注主题，系统自动发现和评估信息源，持续抓取公开信息，每天生成结构化情报简报；用户通过阅读、已读、收藏、反馈和导出等动作训练系统，让它越来越理解自己的关注重点和判断标准。

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

当前目标是**个人自用的主题情报工作台**，先不考虑商业化、多租户、团队权限和付费系统。

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
- 暂停/恢复主题。
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

可以先按单用户本地模式设计，不需要多用户认证。

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
LLM 生成 topic profile 草案
  ↓
用户确认/修改
  ↓
创建 topic
  ↓
生成初始 seed/candidate source discovery tasks
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

## 8. 当前代码与目标架构的关系

当前代码中可复用的部分：

| 当前模块 | 可复用方向 |
|----------|------------|
| `sources/rss.py` | RSS fetcher adapter |
| `database.py` | SQLite 本地存储起点，但需要 schema 重构 |
| `processors/l1_filter.py` | 可演进为主题相关性/噪音过滤阶段 |
| `processors/l2_scorer.py` | 可演进为情报事件抽取、摘要、评分阶段 |
| `ai_service.py` | OpenAI-compatible LLM adapter |
| `response_utils.py` | LLM JSON 解析与容错工具 |
| `ranking.py` | 可作为 importance/time ranking 的初始实现 |
| `index.html` | 可作为静态 dashboard 原型，但目标需要交互式前端 |
| `tests_*` | 回归测试起点 |

需要重构的部分：

1. `news` 单表需要拆成 topic/source/item/event/state/feedback/preference 等更明确的模型。
2. `RSS_FEEDS` 不应继续作为主要产品入口，应迁移为 source registry / source packs / discovered sources。
3. Prompt 文件不应只有全局 `user_profile.md`，需要按 topic 生成 topic profile。
4. 静态 HTML 需要演进为可交互 dashboard，至少支持已读、收藏、反馈、导出。
5. 主循环需要从“全局抓取所有 RSS”演进为按 topic/source/task 的调度。
6. 输出需要从单一 `dashboard.json` 演进为 topic-scoped API/JSON/briefing/export。

## 9. MVP 分阶段建议

### Phase 0：规格与当前实现对齐

目标：明确本文档为开发方向，现有实现为引擎原型。

产出：

- 本 `SPEC.md`。
- 更新 `README.md` / `CODEGUIDE.md` / `CHANGELOG.md`。

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

## 10. 非目标与边界

当前阶段不做：

- 商业化、付费、团队多租户。
- 复杂权限系统。
- 企业私有数据接入。
- 大规模爬虫集群。
- 完全自动相信新信源。
- 替代人工判断的投资/政策决策。

必须避免：

- 把未验证候选源内容混入正式日报而不标注。
- 用户反馈只记录不生效。
- 让用户继续手动维护大量 RSS。
- 把 LLM 对信源可信度的一次性判断当作最终结论。
- 把摘要工具误做成新闻列表。

## 11. 成功标准

个人自用版本成功的标准：

1. 用户可以用自然语言创建主题，而不是手动配置 RSS。
2. 每天输出的简报大多数内容确实值得看。
3. 已读/忽略后，信息流不会反复展示旧内容。
4. 用户反馈 1-2 周后，系统明显减少不感兴趣内容。
5. 系统能推荐新的候选信源，并解释推荐原因。
6. 用户可以把重要情报沉淀到 Obsidian/Markdown。
7. 每个主题可以形成连续时间线，而不是孤立新闻卡片。

## 12. 产品描述与功能清单

### 12.1 产品描述

**望潮** 是一个以用户关注主题为中心的个人 AI 情报系统。它自动发现并评估相关信息源，持续抓取公开信息，使用 LLM 进行相关性判断、去重、摘要、评分和结构化整理；用户通过阅读状态、反馈和导出行为训练系统，使其逐步形成个性化的关注边界和信源偏好，并将重要信息沉淀为长期知识资产。

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
