# 望潮 Wangchao 🌊

[English](README-en.md)

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/release/python-3120/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](Dockerfile)

> **AI 驱动的信息流情报雷达**：把 RSS/公开信息源自动转化为可阅读、可排序、可打标、可继续沉淀的结构化情报。

本仓库是基于 [`t0saki/AI-News-Dashboard`](https://github.com/t0saki/AI-News-Dashboard) 演进而来的私有定制分支，用于探索 **AI 技术新闻、商业财经、数据资产机会、政策/行业风险** 等垂直情报监控场景。

原项目 Demo Web: [AI News Dashboard](https://kindledash.t0saki.com/)

## 1. 项目定位

`望潮` 的核心不是“新闻阅读器”，而是一条轻量级 **信息流智能处理管线**：

```text
RSS / Atom feeds
  ↓
SQLite 入库与去重
  ↓
L1 快速筛选：过滤噪音，保留高价值事件
  ↓
L2 深度处理：中文标题、摘要、评分、分类、去重合并
  ↓
Gravity Ranking：重要性 × 时间衰减
  ↓
dashboard.json / top5.json / 静态 Dashboard
```

因此它可以用于：

| 场景 | 监控对象 | 产出 |
|------|----------|------|
| AI 技术雷达 | 模型发布、Agent、RAG、GitHub、论文、工程基础设施 | 技术摘要、重要性评分、趋势线索 |
| 商业财经雷达 | 公司新闻、财报、融资、并购、宏观政策 | 利好/利空、影响对象、行动提示 |
| 数据资产机会雷达 | 数据局政策、数据交易所、招投标、入表案例 | 商机线索、地区/主体/商业模式标签 |
| 风险预警 | 监管、诉讼、安全事故、供应链、地缘政治 | 风险等级、影响范围、后续跟踪建议 |
| 团队情报日报 | 任何可 RSS 化的信息源 | 每日 Top N、周报素材、知识库沉淀 |

## 2. 核心能力

- **两阶段 AI Pipeline**
  - `L1 Filter`：使用轻量模型快速过滤低价值信息，降低成本。
  - `L2 Scorer`：使用更强模型生成中文摘要、改写标题、评分、分类和去重。

- **结构化打标**
  - 当前默认 schema 输出标题、摘要、分数、分类。
  - 后续可扩展为商业/财经字段，例如 `entities`、`market_impact`、`risk_level`、`opportunity`、`recommended_action`。

- **Gravity Ranking**
  - 排名不是简单按发布时间排序，而是综合内容分数和时间衰减。
  - 高分重大事件衰减更慢，避免真正重要的新闻被短时噪音淹没。

- **智能去重**
  - L2 会把新新闻与当前 Top 20 旧新闻一起交给模型判断。
  - 同一事件的多来源报道会合并，保留最有信息量的来源。

- **OpenAI-compatible 模型支持**
  - 通过 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL_L1` / `AI_MODEL_L2` 接入任意兼容 Chat Completions 的服务。
  - `AI_RESPONSE_FORMAT_MODE=auto` 可在 provider 不支持 `response_format=json_object` 时自动降级重试。

- **轻量部署**
  - 本地 `uv run main.py`。
  - Docker 部署。
  - 输出静态 JSON，可被 `index.html`、Caddy/Nginx、Hermes cron、Telegram/Obsidian pipeline 继续消费。

## 3. 当前私有分支增强

相比 upstream，本私有分支已经完成第一轮稳定性和安全性加固：

| 类别 | 变更 |
|------|------|
| 运行安全 | 新增 `MAX_L1_LOOPS` / `MAX_L2_LOOPS`，避免 AI/API 故障时主循环死循环 |
| 数据库 | 支持 `DB_PATH`，并自动创建 SQLite parent directory |
| 排行榜 | `get_recent_processed_news()` 过滤 `l2_score <= 0`，避免合并/丢弃项进入榜单 |
| 前端安全 | `index.html` 对 RSS/AI 动态字段使用 `escapeHtml()` 转义，降低 XSS 风险 |
| 测试 | 新增 `tests_runtime_safety.py` 覆盖运行时安全回归 |
| 文档 | 新增 `CODEGUIDE.md` 和 `CHANGELOG.md`，便于 AI Agent 继续维护 |

## 4. 快速开始

### 4.1 本地运行

需要 Python 3.12+ 和 `uv`。

```bash
git clone git@github.com:jerryisacat/wangchao.git
cd wangchao
uv sync
cp .env_example .env
```

编辑 `.env`，至少填写：

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_api_key_here
AI_MODEL_L1=gpt-4o-mini
AI_MODEL_L2=gpt-4o
```

启动：

```bash
uv run main.py
```

### 4.2 Docker 运行

```bash
cp .env_example .env
mkdir -p data

docker build -t wangchao .
docker run -d \
  --name wangchao \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  wangchao
```

如需覆盖筛选偏好，可挂载自定义画像：

```bash
docker run -d \
  --name wangchao \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/user_profile.md:/app/prompts/user_profile.md \
  wangchao
```

### 4.3 查看 Dashboard

程序会生成：

- `data/dashboard.json`
- `data/top5.json`

将 `index.html` 与 `dashboard.json` 放在同一静态目录下即可展示网页 Dashboard。

## 5. 配置说明

核心配置来自 `.env`：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DB_PATH` | `data/news.db` | SQLite 数据库路径 |
| `AI_API_KEY` | 必填 | LLM 服务商 API Key |
| `AI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible API endpoint |
| `AI_MODEL_L1` | `gpt-4o-mini` | L1 快速筛选模型 |
| `AI_MODEL_L2` | `gpt-4o` | L2 深度处理模型 |
| `AI_MAX_RETRIES` | `2` | AI 请求最大尝试次数 |
| `AI_TIMEOUT_SECONDS` | `600` | AI 请求超时秒数 |
| `AI_RESPONSE_FORMAT_MODE` | `auto` | JSON mode 策略：`auto/on/off` |
| `FETCH_INTERVAL_SECONDS` | `600` | RSS 抓取循环间隔 |
| `MAX_L1_LOOPS` | `5` | 单个 cycle 最多处理多少个 L1 batch |
| `MAX_L2_LOOPS` | `5` | 单个 cycle 最多处理多少个 L2 batch |
| `L1_BATCH_SIZE` | `30` | L1 单批新闻数量 |
| `L2_BATCH_SIZE` | `20` | L2 单批新新闻数量 |
| `GRAVITY` | `1.1` | 时间衰减强度，越小衰减越慢 |
| `RANKING_WINDOW_HOURS` | `72` | 排行榜时间窗口 |
| `TOP_N_ITEMS` | `5` | `top5.json` 输出数量 |
| `RSS_FEEDS` | 见 `.env_example` | JSON array 格式 RSS 源 |
| `DASHBOARD_OUTPUT_PATH` | `data/dashboard.json` | Dashboard JSON 输出路径 |
| `QUIET_HOURS_ENABLED` | `true` | 夜间低频模式 |
| `QUIET_HOURS_TZ_OFFSET` | `8` | quiet hours 时区偏移 |
| `QUIET_HOURS_START` / `QUIET_HOURS_END` | `22` / `10` | quiet hours 起止小时 |
| `QUIET_HOURS_MULTIPLIER` | `4` | quiet hours 间隔倍数 |

## 6. Prompt 定制

Prompt 位于 `prompts/`：

| 文件 | 作用 |
|------|------|
| `prompts/user_profile.md` | 用户画像、关注领域、重要性层级和语言风格 |
| `prompts/l1_rules.md` | L1 筛选规则与 JSON schema |
| `prompts/l2_rules.md` | L2 去重、摘要、评分与 JSON schema |

如果要把它改成“商业财经雷达”，重点修改：

1. `user_profile.md`：从技术新闻偏好改成商业/财经/行业/政策偏好。
2. `l1_rules.md`：调整保留标准，例如重大政策、财报、融资、并购、监管、招投标。
3. `l2_rules.md`：扩展输出字段，例如：

```json
{
  "feed": [
    {
      "id": 123,
      "merged_ids": [],
      "category": "数据资产/政策机会",
      "title": "某地启动数据资产入表试点",
      "score": 92,
      "summary": "该试点验证地方公共数据从静态估值走向可审计现金流的路径。",
      "url": "https://example.com/news",
      "entities": ["某市数据局", "数据交易所"],
      "opportunity": "数据资产评估、API 运营、授权运营咨询",
      "risk_level": "medium",
      "recommended_action": "加入案例库并跟踪后续招标"
    }
  ]
}
```

> 注意：扩展 L2 schema 后，需要同步修改 `processors/l2_scorer.py`、`database.py`、`index.html`、`CODEGUIDE.md` 和测试。

## 7. 输出格式

### `dashboard.json`

完整 Dashboard 数据，包含生成时间、配置和按 Gravity Score 排序后的 items。

典型字段：

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
      "title": "Original title",
      "url": "https://example.com/article",
      "source_name": "Source",
      "published_at": 1751734800.0,
      "l2_title_zh": "中文标题",
      "l2_summary": "中文摘要",
      "l2_score": 90,
      "category": "AI/模型发布",
      "gravity_score": 86.5
    }
  ]
}
```

### `top5.json`

精简 Top N：

```json
[
  {
    "title": "中文标题",
    "meta": "2H"
  }
]
```

适合 E-ink、状态栏、Telegram 简报或其他轻量展示场景。

## 8. 测试与验证

当前测试是无测试框架的脚本式测试：

```bash
uv run python tests_response_utils.py
uv run python tests_schema_compat.py
uv run python tests_runtime_safety.py
```

语法检查：

```bash
uv run python -m py_compile \
  config.py database.py main.py \
  processors/l1_filter.py processors/l2_scorer.py \
  ai_service.py ranking.py response_utils.py \
  sources/manager.py sources/rss.py
```

提交前建议运行：

```bash
uv run python tests_response_utils.py && \
uv run python tests_schema_compat.py && \
uv run python tests_runtime_safety.py && \
git diff --check
```

## 9. 代码库导航

- `CODEGUIDE.md`：代码结构、模块职责、数据流、维护规则。
- `CHANGELOG.md`：私有分支变更记录。
- `CLAUDE.md`：Claude Code/AI Agent 简版操作指南。
- `README-en.md`：upstream 英文 README，当前未同步私有分支全部定制内容。

## 10. 后续改造方向

建议优先级：

1. **Single-run 模式**：新增 `run_once.py`，便于 Hermes cron、systemd timer 或 GitHub Actions 调度。
2. **商业财经 schema**：增加实体、影响方向、风险等级、机会线索、建议动作。
3. **数据资产机会雷达 Prompt**：面向数据局政策、数据交易所、入表案例、招投标和授权运营。
4. **Obsidian/Telegram 输出器**：把 `dashboard.json` 转为每日简报、周报素材和案例库条目。
5. **正文抓取与事实核查**：从 RSS 摘要扩展到正文、公告/PDF、公司 filing 或政策原文。
6. **正式测试框架**：迁移到 `pytest`，并增加 mock AI provider 与 SQLite fixture。

## 11. License 与归属

- Upstream: [`t0saki/望潮`](https://github.com/t0saki/望潮)
- 当前私有分支: `jerryisacat/wangchao`
- README 中保留 MIT badge 以匹配 upstream 描述；但 upstream 仓库目前未提供独立 `LICENSE` 文件。若未来要公开分发或商业复用，需要先补充/确认授权边界。
