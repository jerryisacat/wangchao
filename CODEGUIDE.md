# AI-News-Dashboard — Codebase Structure Map

> **文档创建于 2026-07-06** | 以当前 `main.py`、`processors/`、`database.py`、`config.py` 与根目录 README 为准

## 1. 全局架构总览

**AI-News-Dashboard** 是一个轻量级信息流情报处理管线。核心链路是：**RSS 抓取 → SQLite 入库 → L1 快速筛选 → L2 深度摘要/评分/去重 → Gravity Ranking → JSON/静态前端输出**。

| 维度 | 描述 |
|------|------|
| 运行时 | Python 3.12+ |
| 依赖管理 | `uv` + `pyproject.toml` / `uv.lock` |
| 数据库 | SQLite，默认 `data/news.db`，可通过 `DB_PATH` 覆盖 |
| 信息源 | RSS/Atom feed，经 `feedparser` 解析 |
| AI 接口 | OpenAI-compatible Chat Completions API |
| AI 流程 | L1 快速过滤 + L2 深度评分与摘要 |
| 输出 | `data/dashboard.json` 与 `data/top5.json` |
| 前端 | 单文件静态 HTML，读取 `dashboard.json` 渲染卡片 |
| 部署 | Docker / 本地 `uv run main.py` |

## 2. 目录结构树

```text
AI-News-Dashboard/
├── README.md                         # 中文 README
├── README-en.md                      # 英文 README
├── CLAUDE.md                         # Claude Code 项目操作指南
├── SPEC.md                           # 当前产品/技术规格入口，描述已实现设计
├── CODEGUIDE.md                      # [本文件] 代码库结构手册
├── CHANGELOG.md                      # 变更日志，中文，按日期分组
├── pyproject.toml                    # Python 项目元数据与依赖
├── uv.lock                           # uv 锁定文件
├── .python-version                   # Python 版本声明
├── .env_example                      # 环境变量模板
├── Dockerfile                        # Docker 镜像构建
├── start.sh                          # 容器入口脚本
├── index.html                        # 静态前端 Dashboard
├── main.py                           # 主循环：fetch/L1/L2/ranking/output/sleep
├── config.py                         # 环境变量配置读取
├── database.py                       # SQLite schema 与数据访问层
├── ai_service.py                     # OpenAI-compatible 客户端与重试/fallback
├── ranking.py                        # Gravity Ranking 算法
├── response_utils.py                 # LLM 文本/JSON 解析、清洗、标题 fuzzy match
├── migrate_db.py                     # 旧 DB schema 迁移辅助脚本
├── debug_db.py                       # 本地 DB 调试脚本
├── tests_response_utils.py           # JSON 解析回归测试
├── tests_schema_compat.py            # L1/L2 schema 兼容测试
├── tests_runtime_safety.py           # 运行时安全与防回归测试
├── sources/
│   ├── manager.py                    # RSS source manager，批量抓取并写入 DB
│   └── rss.py                        # RSSFetcher，解析 feed 条目为统一 item
├── processors/
│   ├── l1_filter.py                  # L1 快速筛选，pending → l1_done/filtered
│   └── l2_scorer.py                  # L2 深度评分、中文摘要、去重合并
├── prompts/
│   ├── user_profile.md               # 用户画像、兴趣层级和评分偏好
│   ├── l1_rules.md                   # L1 输出 JSON schema 与过滤规则
│   └── l2_rules.md                   # L2 输出 JSON schema、去重和摘要规则
└── .github/workflows/
    └── docker-publish.yml            # GHCR 多架构 Docker 镜像发布 workflow
```

## 3. 核心数据流

```text
RSS feeds
  ↓ sources.manager.SourceManager.fetch_all()
news(status='pending')
  ↓ processors.l1_filter.L1Filter.process_pending()
news(status='l1_done' 或 'filtered')
  ↓ processors.l2_scorer.L2Scorer.process_l1_passed()
news(status='processed', l2_score > 0)
  ↓ main.py + ranking.calculate_gravity_score()
data/dashboard.json + data/top5.json
  ↓ index.html fetch('dashboard.json')
静态新闻卡片 Dashboard
```

### SQLite `news` 状态语义

| status | 含义 |
|--------|------|
| `pending` | RSS 新入库，尚未经过 L1 |
| `filtered` | L1 判定为低价值或噪音 |
| `l1_done` | L1 分数达到阈值，等待 L2 |
| `processed` | L2 已完成处理；排行榜默认只展示 `l2_score > 0` 的项目 |

## 4. 模块职责

### `main.py`

负责主循环编排：

1. 注册 Ctrl-C 退出 handler。
2. 调用 `source_manager.fetch_all()` 抓取 RSS。
3. 通过 `run_bounded_batches()` 限制每轮 L1/L2 最大批次数，避免 AI/API 故障时单个 cycle 死循环。
4. 读取最近处理完成的新闻，计算 Gravity Score。
5. 写出 `dashboard.json` 和 `top5.json`。
6. 按 `FETCH_INTERVAL_SECONDS` 与 quiet hours 规则对齐 sleep。

维护规则：

- 不要在主循环里直接写 AI prompt 或 SQL 细节。
- 新增循环处理必须有 per-cycle 上限或明确退出条件。
- 修改输出 JSON schema 时同步更新 `index.html` 和本文件。

### `config.py`

集中读取环境变量，实例化全局 `config`。

关键配置：

| 变量 | 说明 |
|------|------|
| `DB_PATH` | SQLite 路径，默认 `data/news.db` |
| `AI_BASE_URL` / `AI_API_KEY` | OpenAI-compatible endpoint 与密钥 |
| `AI_MODEL_L1` / `AI_MODEL_L2` | L1/L2 模型 |
| `MAX_L1_LOOPS` / `MAX_L2_LOOPS` | 单轮主循环最多处理多少个 L1/L2 batch |
| `L1_BATCH_SIZE` / `L2_BATCH_SIZE` | 单批发送给模型的新闻数量 |
| `AI_RESPONSE_FORMAT_MODE` | JSON mode 兼容策略：`auto/on/off` |
| `RSS_FEEDS` | JSON array 格式 RSS 源列表 |
| `DASHBOARD_OUTPUT_PATH` | `dashboard.json` 输出路径 |

### `database.py`

负责 SQLite schema 初始化与 news 表读写。

当前边界：

- `_get_conn()` 会自动创建 DB parent directory。
- `url` 是唯一键，用于 RSS 去重。
- `get_recent_processed_news()` 只返回 `l2_score > 0` 的 processed items，避免已合并/丢弃项进入排行榜。
- 当前没有 migration framework；schema 扩展需补 `migrate_db.py` 或引入正式迁移机制。

### `sources/`

- `rss.py` 将 RSS/Atom entries 统一成 `{title, url, published_at, source_name, summary}`。
- `manager.py` 按 `config.RSS_FEEDS` 逐个抓取并调用 `db.add_news()`。

维护规则：

- 新增非 RSS source 时，优先输出同一 item shape，避免污染 processors。
- 外部请求应补 timeout/retry/错误上下文；不要泄露带认证的 feed URL。

### `processors/l1_filter.py`

L1 快速筛选器：

- 输入：`status='pending'` 的新闻 batch。
- Prompt：`prompts/user_profile.md` + `prompts/l1_rules.md`。
- 输出：`items[]`，每个 item 包含 `id/category/score/context`。
- 分数 `>=70` 标记为 `l1_done`，否则 `filtered`。
- 兼容旧 schema category buckets，并通过标题 fuzzy match 对抗模型丢 ID。

### `processors/l2_scorer.py`

L2 深度处理器：

- 输入：`l1_done` 新项目 + 当前 Top 20 旧项目作为去重上下文。
- Prompt：`prompts/user_profile.md` + `prompts/l2_rules.md`。
- 输出：`feed[]`，每个 item 包含 `id/merged_ids/category/title/score/summary/url`。
- 主 item 写入中文标题、摘要、分数和分类。
- `merged_ids` 写成 `l2_score=0` 的 processed 项，排行榜查询会过滤。

### `ai_service.py`

封装 OpenAI-compatible Chat Completions：

- 使用 `openai.OpenAI(base_url=..., api_key=...)`。
- 支持 `AI_MAX_RETRIES` 与 `AI_RETRY_DELAY_SECONDS`。
- `AI_RESPONSE_FORMAT_MODE=auto` 时，如果模型拒绝 `response_format=json_object`，会自动重试并记住该模型不再发送 JSON mode。
- 通过 `response_utils.extract_text_response()` 兼容不同 provider response shape。

### `response_utils.py`

负责 AI 输出清洗与容错：

- 提取 message/content/output_text 等文本。
- 去除 Markdown fence、thinking/reasoning tag、控制字符和零宽字符。
- 尝试修复常见 JSON 问题：尾随逗号、未加引号 key、空值。
- 在多个 JSON object 中选择最像 L1/L2 schema 的候选。
- 对 L1 标题做 fuzzy matching，降低模型 ID 丢失造成的漏处理。

### `ranking.py`

Gravity Ranking：

```python
base_score * (offset / (age_hours + offset)) ** effective_gravity
```

特点：

- offset=6 小时，减少新文章“刚发布”尖峰。
- 高 `base_score` 会降低 effective gravity，让重大事件衰减更慢。
- 排名只应基于 L2 已处理且 `l2_score > 0` 的 item。

### `index.html`

静态前端：

- 读取同目录 `dashboard.json`。
- 渲染新闻卡片、分数、摘要、来源、发布时间和原始标题。
- 对 RSS/AI 动态字段使用 `escapeHtml()`，避免不可信内容直接进入 HTML template。

## 5. 环境变量与运行命令

### 本地运行

```bash
uv sync
cp .env_example .env
uv run main.py
```

### 测试

```bash
uv run python tests_response_utils.py
uv run python tests_schema_compat.py
uv run python tests_runtime_safety.py
```

### Docker

```bash
docker build -t news-dashboard .
docker run --env-file .env -v $(pwd)/data:/app/data news-dashboard
```

## 6. 维护规则

- `SPEC.md` 是当前实现的产品/技术规格入口；修改项目目标、核心工作流、状态机、输出 schema、配置语义、安全边界或明确限制时必须同步更新。
- 修改代码后必须运行相关测试；涉及运行时/数据库/前端安全时至少运行三份根目录测试脚本。
- 新增环境变量时同步更新 `.env_example` 和本文件。
- 修改数据流、状态机、输出 JSON schema、目录结构或新增测试脚本时同步更新 `CODEGUIDE.md`。
- 每次有意义的代码/文档变更同步更新 `CHANGELOG.md`。
- 不要提交 `.env`、`data/*`、生成的 `dashboard.json/top5.json` 或 `.venv`。
- LLM 输出必须按不可信输入处理；前端渲染前 escape，后端解析前 sanitize。
