# AI-News-Dashboard 当前实现规格（SPEC）

> 本文档描述 **当前代码已经实现的产品与技术设计**，不是未来路线图。
>
> 规格依据：`README.md`、`CODEGUIDE.md`、`CHANGELOG.md`、`config.py`、`main.py`、`database.py`、`sources/`、`processors/`、`ai_service.py`、`response_utils.py`、`ranking.py`、`index.html`、`.env_example`、`pyproject.toml` 与根目录测试脚本。

## 1. 项目目标与边界

`AI-News-Dashboard` 是一条轻量级信息流情报处理管线，用于把 RSS/Atom 信息源转换为可排序、可摘要、可打标的结构化新闻数据。

当前实现目标：

1. 周期性抓取配置的 RSS/Atom feeds。
2. 将新条目写入 SQLite，并按 URL 去重。
3. 使用两阶段 OpenAI-compatible LLM 管线处理新闻：
   - L1：快速筛选低价值/噪音条目。
   - L2：生成中文标题、中文摘要、分数、分类，并做同事件合并。
4. 使用 Gravity Ranking 结合 L2 分数与时间衰减排序。
5. 输出 `dashboard.json` 与 `top5.json`，供静态前端或其他下游消费。
6. 通过单文件 `index.html` 展示 Dashboard。

当前明确边界：

- 当前只内置 RSS/Atom 抓取，不包含网页正文抓取、PDF 解析、登录源、付费源或搜索 API。
- 当前数据模型主要围绕新闻条目，不包含实体图谱、用户反馈、团队协作、审计流或多租户。
- 当前前端是静态展示页，不提供后端 API、管理后台、登录鉴权或在线配置。
- 当前 LLM 输出依赖 prompt 与兼容性解析，不提供强类型 schema migration 或数据库级 JSON 字段扩展。

## 2. 用户与运行角色

### 2.1 运行者

运行者负责部署服务、配置 `.env`、提供 LLM API Key、维护 RSS 源列表，并选择本地、Docker 或其他调度方式运行。

### 2.2 内容消费者

内容消费者通过以下方式读取结果：

- 浏览器打开静态 `index.html`，读取同目录 `dashboard.json`。
- 其他系统读取 `data/dashboard.json` 获取完整排序结果。
- 其他轻量终端读取 `data/top5.json` 获取 Top N 简表。

### 2.3 AI Agent / 维护者

维护者修改代码、prompt、配置模板、测试与文档时，应同步更新：

- `SPEC.md`：产品/技术规格入口。
- `CODEGUIDE.md`：代码结构和维护规则。
- `CHANGELOG.md`：变更记录。
- `.env_example`：新增环境变量时同步更新。

## 3. 核心工作流

主流程由 `main.py` 的无限循环驱动：

```text
启动 main.py
  ↓
加载 config.py 中的环境变量配置
  ↓
循环执行：
  1. sources.manager.SourceManager.fetch_all()
  2. processors.l1_filter.L1Filter.process_pending()
  3. processors.l2_scorer.L2Scorer.process_l1_passed()
  4. database.Database.get_recent_processed_news()
  5. ranking.calculate_gravity_score()
  6. 写出 dashboard.json / top5.json
  7. 按普通间隔或 quiet hours 间隔休眠
```

### 3.1 抓取阶段

- `SourceManager` 从 `config.RSS_FEEDS` 读取 feed URL 列表。
- 每个 feed 由 `RSSFetcher.fetch(url)` 使用 `feedparser.parse()` 解析。
- 条目统一为：`title`、`url`、`published_at`、`source_name`、`summary`。
- `db.add_news()` 插入 SQLite；`url` 是唯一键，已存在则忽略。

### 3.2 L1 快速筛选阶段

- `L1Filter.process_pending()` 读取 `status='pending'` 的条目。
- 每批最多 `L1_BATCH_SIZE` 条。
- prompt 来自：
  - `prompts/user_profile.md`
  - `prompts/l1_rules.md`
- LLM 返回 JSON 后由 `response_utils.parse_json_response()` 解析。
- 当前优先支持 flat schema：

```json
{
  "items": [
    {
      "id": 1,
      "category": "模型发布",
      "score": 91,
      "context": "保留理由"
    }
  ]
}
```

- 兼容旧 category bucket schema：`AI_Algorithms`、`Aerospace_HardTech`、`Major_Industry_Moves`。
- 分数 `>= 70` 的条目标记为 `l1_done`；否则标记为 `filtered`。
- 未被模型返回的 batch 内条目会被隐式标记为 `filtered`。
- 如果模型丢失或错配 ID，代码会尝试用标题 fuzzy match 找回。

### 3.3 L2 深度处理阶段

- `L2Scorer.process_l1_passed()` 读取 `status='l1_done'` 且 `l1_score >= 70` 的新条目。
- 每批最多 `L2_BATCH_SIZE` 条。
- 同时取最近窗口内已处理新闻，根据 Gravity Score 排序后选择 Top 20 作为去重上下文。
- prompt 来自：
  - `prompts/user_profile.md`
  - `prompts/l2_rules.md`
- 当前期望 LLM 返回 flat feed schema：

```json
{
  "feed": [
    {
      "id": 123,
      "merged_ids": [124],
      "category": "AI/模型发布",
      "title": "中文标题",
      "score": 87,
      "summary": "中文摘要",
      "url": "https://example.com/news"
    }
  ]
}
```

- 主条目写入 `l2_score`、`l2_summary`、`l2_title_zh`、`category`，并标记为 `processed`。
- `merged_ids` 中的条目会写成 `l2_score=0`、`l2_summary='Deduplicated/Merged'`、`status='processed'`。
- L2 未返回的新条目会被写成 `l2_score=0`、`l2_summary='Dropped by AI'`、`status='processed'`。
- 排行榜查询会过滤 `l2_score <= 0`，所以合并/丢弃项不会进入 `dashboard.json` 排名结果。

### 3.4 排名与输出阶段

- `main.py` 调用 `db.get_recent_processed_news(hours=RANKING_WINDOW_HOURS)` 获取窗口内已处理且 `l2_score > 0` 的新闻。
- 对每条新闻计算 Gravity Score。
- 按 Gravity Score 降序排序。
- 写出：
  - `DASHBOARD_OUTPUT_PATH`，默认 `data/dashboard.json`。
  - 同目录 `top5.json`，默认 `data/top5.json`。

### 3.5 休眠与 quiet hours

- 普通循环间隔为 `FETCH_INTERVAL_SECONDS`。
- 如果 `QUIET_HOURS_ENABLED=true` 且当前小时落在 quiet hours 范围内，则间隔乘以 `QUIET_HOURS_MULTIPLIER`。
- `calculate_sleep_seconds()` 将下一次运行对齐到间隔边界。

## 4. 数据模型与状态机

### 4.1 SQLite 表：`news`

`database.py` 当前自动创建单表 `news`：

| 字段 | 类型/含义 |
|------|-----------|
| `id` | 自增主键 |
| `url` | 唯一 URL，用于去重 |
| `title` | RSS 原始标题 |
| `source_name` | feed 标题或 `Unknown Source` |
| `published_at` | 发布时间 Unix timestamp；缺失时用当前时间 |
| `fetched_at` | 入库时间 Unix timestamp |
| `summary` | RSS summary/description |
| `l1_score` | L1 分数，默认 0 |
| `l1_reason` | L1 分类与保留/过滤理由文本 |
| `l2_score` | L2 分数，默认 0 |
| `l2_summary` | L2 中文摘要或合并/丢弃说明 |
| `l2_title_zh` | L2 中文标题 |
| `category` | L1/L2 分类文本，最终展示主要使用 L2 分类 |
| `status` | 处理状态 |

### 4.2 状态机

```text
pending
  ├─ L1 score >= 70 → l1_done
  └─ L1 score < 70 / 未返回 → filtered

l1_done
  ├─ L2 主条目返回 → processed, l2_score > 0
  ├─ L2 merged_ids → processed, l2_score = 0
  └─ L2 未返回 → processed, l2_score = 0
```

状态含义：

| status | 含义 |
|--------|------|
| `pending` | RSS 新入库，等待 L1 |
| `filtered` | L1 判定低价值或未被 L1 返回 |
| `l1_done` | L1 通过，等待 L2 |
| `processed` | L2 已处理、合并或丢弃 |

### 4.3 数据库边界

- `Database._get_conn()` 会自动创建数据库 parent directory。
- 当前没有正式 migration framework。
- `migrate_db.py` 存在但不是自动迁移系统。
- 扩展 schema 时需要同步修改数据库、processors、前端、测试与文档。

## 5. 信源处理现状

当前信源层只有 RSS/Atom：

- `sources/rss.py`：封装 `feedparser`，处理日期、标题、链接、来源名、摘要。
- `sources/manager.py`：遍历配置的 feed 列表，写入数据库。

已实现容错：

- feedparser 标记 `bozo` 时打印 warning，但仍尽量读取 entries。
- 单个 feed 抓取异常时返回空列表，不中断整个主循环。
- URL 为空的条目不会入库。
- URL 唯一约束避免重复入库。

未实现：

- HTTP timeout/retry 的显式配置。
- robots/版权策略判断。
- 全文抓取、正文抽取和网页反爬处理。
- 每个 feed 独立频率、启停状态、权重或标签。

## 6. AI 两阶段处理设计

### 6.1 AI 服务封装

`ai_service.py` 使用 OpenAI Python SDK 访问兼容 Chat Completions 的 API：

- `AI_BASE_URL`：API endpoint。
- `AI_API_KEY`：密钥。
- `AI_MODEL_L1` / `AI_MODEL_L2`：两阶段模型。
- `AI_TIMEOUT_SECONDS`：请求超时。
- `AI_MAX_RETRIES`：最大尝试次数。
- `AI_RETRY_DELAY_SECONDS`：重试等待秒数。
- `AI_RESPONSE_FORMAT_MODE`：`auto` / `on` / `off`。

`AI_RESPONSE_FORMAT_MODE=auto` 时：

1. 首次按调用方要求传 `response_format={"type":"json_object"}`。
2. 如果 provider 报 `response_format` 相关错误，自动重试一次不带 JSON mode。
3. 记住该模型不再发送 JSON mode。

### 6.2 LLM 输出清洗与兼容

`response_utils.py` 负责把不稳定的 LLM 输出转成可解析 JSON：

- 支持从 OpenAI SDK object、dict、message content list、`output_text` 等形态提取文本。
- 去除 Markdown code fence。
- 去除 `<thinking>` / `<reasoning>` 标签内容。
- 去除控制字符、零宽字符。
- 修复部分常见 JSON 问题：尾随逗号、未加引号 key、空值。
- 多个 JSON object 同时出现时，按 schema 特征打分选择候选。
- L1 支持标题 fuzzy match，降低模型 ID 丢失造成的漏处理。

### 6.3 失败处理边界

- L1/L2 无响应或 JSON 解析失败时，batch 函数通常返回本批 item 数量，让主循环继续推进到 bounded loop 限制。
- `main.py` 用 `MAX_L1_LOOPS`、`MAX_L2_LOOPS` 限制每个 cycle 的批处理次数，避免 AI/API 异常时在同一轮无限循环。
- 主循环顶层捕获异常，打印错误后休眠 60 秒。

## 7. Ranking 设计

`ranking.calculate_gravity_score(base_score, published_at_ts, gravity)` 当前公式：

```python
base_score * (offset / (age_hours + offset)) ** effective_gravity
```

其中：

- `base_score` 来自 L2 分数。
- `age_hours` 是当前时间与发布时间的小时差，最低为 0。
- `offset = 6.0` 小时，用于降低刚发布新闻的尖峰优势。
- `effective_gravity = GRAVITY * gravity_factor`。
- `gravity_factor = 1.0 - (base_score / 100.0) * 0.8`，并 clamp 到 `[0.15, 1.2]`。

效果：

- 高 L2 分数新闻衰减更慢。
- 低分新闻更快被新内容替代。
- 排名窗口由 `RANKING_WINDOW_HOURS` 控制。

## 8. 输出与前端

### 8.1 `dashboard.json`

默认路径：`data/dashboard.json`。

结构：

```json
{
  "generated_at": 1751738400.0,
  "generated_at_str": "2026-07-06T02:00:00",
  "config": {
    "gravity": 1.1,
    "window_hours": 72
  },
  "items": [
    {
      "id": 1,
      "url": "https://example.com/article",
      "title": "Original title",
      "source_name": "Source",
      "published_at": 1751734800.0,
      "fetched_at": 1751734900.0,
      "summary": "RSS summary",
      "l1_score": 80,
      "l1_reason": "Category: ... Context: ...",
      "l2_score": 90,
      "l2_summary": "中文摘要",
      "l2_title_zh": "中文标题",
      "category": "AI/模型发布",
      "status": "processed",
      "gravity_score": 86.5
    }
  ]
}
```

### 8.2 `top5.json`

默认路径：与 `dashboard.json` 同目录的 `top5.json`。

实际数量由 `TOP_N_ITEMS` 控制，默认 5。

结构：

```json
[
  {
    "title": "中文标题",
    "meta": "2H"
  }
]
```

`meta` 由 `format_time_ago()` 生成，格式为分钟、小时或天的短文本，例如 `30M`、`2H`、`1D`。

### 8.3 静态前端

`index.html` 是单文件静态页面：

- 读取同目录 `dashboard.json`。
- 渲染新闻标题、摘要、来源、分类、发布时间、Gravity Score 与原始标题。
- 每 5 分钟自动刷新一次。
- 对 RSS 与 AI 动态字段调用 `escapeHtml()` 后再插入模板，降低 XSS 风险。
- GitHub Corner 当前链接仍指向 upstream `t0saki/AI-News-Dashboard`。

## 9. 配置

配置由 `config.py` 在 import 时读取环境变量，并通过全局 `config` 暴露。

| 环境变量 | 默认值 | 含义 |
|----------|--------|------|
| `DB_PATH` | `data/news.db` | SQLite 数据库路径 |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `AI_API_KEY` | 空 | LLM API Key，实际运行必填 |
| `AI_MODEL_L1` | `gpt-4o-mini` | L1 模型 |
| `AI_MODEL_L2` | `gpt-4o` | L2 模型 |
| `MAX_L1_LOOPS` | `5` | 单 cycle 最多 L1 batch 次数 |
| `MAX_L2_LOOPS` | `5` | 单 cycle 最多 L2 batch 次数 |
| `L1_BATCH_SIZE` | `30` | L1 单批条数 |
| `L2_BATCH_SIZE` | `20` | L2 单批新条数 |
| `AI_MAX_RETRIES` | `2` | AI 请求最大尝试次数 |
| `AI_RETRY_DELAY_SECONDS` | `1.0` | AI 重试间隔 |
| `AI_TIMEOUT_SECONDS` | `600` | AI 请求超时 |
| `AI_RESPONSE_FORMAT_MODE` | `auto` | JSON mode 策略 |
| `FETCH_INTERVAL_SECONDS` | `600` | 普通抓取间隔 |
| `GRAVITY` | `1.1` | 排名时间衰减强度 |
| `RANKING_WINDOW_HOURS` | `72` | 排名窗口小时数 |
| `DASHBOARD_OUTPUT_PATH` | `data/dashboard.json` | dashboard 输出路径 |
| `TOP_N_ITEMS` | `5` | top5 输出条数 |
| `QUIET_HOURS_ENABLED` | `true` | 是否启用 quiet hours |
| `QUIET_HOURS_TZ_OFFSET` | `8` | quiet hours 时区偏移 |
| `QUIET_HOURS_START` | `22` | quiet hours 起始小时 |
| `QUIET_HOURS_END` | `10` | quiet hours 结束小时 |
| `QUIET_HOURS_MULTIPLIER` | `4` | quiet hours 间隔倍数 |
| `RSS_FEEDS` | 两个示例 feed | JSON array 格式 RSS 源列表 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 环境继承 | 代理设置，当前主要由依赖库/环境使用 |

## 10. 运行与部署

### 10.1 本地运行

```bash
uv sync
cp .env_example .env
uv run main.py
```

`.env` 至少需要配置可用的：

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_api_key_here
AI_MODEL_L1=gpt-4o-mini
AI_MODEL_L2=gpt-4o
```

### 10.2 Docker

```bash
docker build -t ai-news-dashboard .
docker run --env-file .env -v $(pwd)/data:/app/data ai-news-dashboard
```

可以通过挂载 `data/` 持久化 SQLite 与输出 JSON，也可以挂载 prompt 文件覆盖默认用户画像。

### 10.3 静态展示

将 `index.html` 与生成的 `dashboard.json` 放在同一目录，由任意静态服务器提供即可。

## 11. 测试验证

当前测试是无测试框架的脚本式测试：

```bash
uv run python tests_response_utils.py
uv run python tests_schema_compat.py
uv run python tests_runtime_safety.py
```

覆盖范围：

- `tests_response_utils.py`：LLM JSON 解析、thinking tag 清理、多 JSON 候选选择。
- `tests_schema_compat.py`：L1/L2 flat schema 兼容。
- `tests_runtime_safety.py`：数据库 parent directory 创建、bounded batch loop、零分 processed 过滤、前端 escaping 约束。

文档-only 修改提交前至少运行：

```bash
git diff --check
```

## 12. 安全与可信边界

### 12.1 不可信输入

以下输入均应视为不可信：

- RSS 标题、摘要、来源名和 URL。
- LLM 生成的标题、摘要、分类和分数。
- 外部 feed 的发布时间等元数据。

当前实现中的防护：

- 前端使用 `escapeHtml()` 转义动态字段。
- 后端用 `response_utils` 清理控制字符、零宽字符和常见 LLM 包装文本。
- SQLite 写入使用参数化 SQL。
- URL 唯一约束降低重复数据膨胀。
- `MAX_L1_LOOPS` / `MAX_L2_LOOPS` 降低 AI 故障导致的单轮死循环风险。

### 12.2 密钥与配置

- `AI_API_KEY` 应放在 `.env` 或运行环境变量中，不应提交。
- `.env_example` 只保存模板。
- `data/`、数据库、生成 JSON 和 `.venv` 不应作为常规源码提交。

### 12.3 LLM 可信边界

- LLM 输出不是可信事实源，只是排序、摘要和分类辅助。
- 当前没有自动事实核查、来源交叉验证或引用校验。
- 下游决策应保留原始 URL 并人工核验。

## 13. 当前限制

1. **单进程循环**：当前设计是一个长运行主循环，不是 worker queue 或 serverless job。
2. **无正式迁移框架**：数据库 schema 改动需要手工迁移和测试。
3. **RSS-only**：不支持网页全文、PDF、搜索 API、社交媒体 API 或登录源。
4. **静态前端能力有限**：没有筛选、搜索、收藏、反馈、登录和管理功能。
5. **prompt/schema 扩展需要同步代码**：新增 L2 字段不会自动入库或展示。
6. **AI 失败重试粒度粗**：失败 batch 依赖下一轮重试，没有 per-item retry queue。
7. **无观测系统**：当前主要用 `print()` 输出运行日志，没有 metrics、trace 或告警。
8. **无事实核查**：摘要和分类依赖模型，未与原文或多来源进行强校验。

## 14. 后续演进建议（未实现）

以下是建议方向，不代表当前已实现：

1. 增加 single-run 模式，便于 cron、systemd timer、GitHub Actions 或 Hermes cron 调度。
2. 引入正式 migration framework，管理 SQLite schema 演进。
3. 扩展商业财经/数据资产 schema，例如 `entities`、`market_impact`、`risk_level`、`opportunity`、`recommended_action`。
4. 增加全文抓取、公告/PDF 解析和来源可信度评分。
5. 增加 Telegram、Obsidian、日报/周报等输出器。
6. 将测试迁移到 `pytest`，补充 mock AI provider、SQLite fixture 和前端渲染测试。
7. 增加运行 metrics、错误告警、feed 健康状态和处理延迟统计。
