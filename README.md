# 望潮 Wangchao

[English](README-en.md) | [MIT License](LICENSE)

`望潮（Wangchao）` 是一个**主题驱动的个人 AI 情报工作台**。你只需要告诉系统自己关心什么主题，系统围绕主题抓取公开信息、过滤噪音、生成结构化情报事件，并通过你的阅读和反馈越来越理解你真正想看的内容。

它不是一个 RSS 阅读器，也不是一个新闻聚合器。核心入口是**主题**，而不是信源。

> **这是一个开源项目（MIT License）。** 代码、文档、数据模型、worker 管线、前端界面全部公开。商业化仅用于维护服务器运营——给自己买杯咖啡，不是产品主线。
>
> **特别欢迎用 AI Agent 定制这个仓库。** Fork 之后，你可以让 Claude Code、Cursor、Copilot 或任何 coding agent 按照你的领域、信源、偏好和部署环境改造它。`AGENTS.md` 定义 AI Agent 协作规则和文档阅读协议，`CODEGUIDE.md` 是 L0/L1 架构总览，`docs/` 下按 L2-L4 分层组织领域模型、模块细节和操作运维，帮助 agent 按抽象层级快速理解这个仓库。
>
> ---
>
> ⚠️ **本仓库处于高频迭代阶段，尚未达到稳定可用状态，请勿直接用于生产环境。** API、Schema、UI 和 Worker 管线仍可能发生破坏性变更。如果你对主题驱动的 AI 情报系统感兴趣，欢迎 Star、Fork、提 Issues 和 PR 一起建设。

## 这个仓库是干嘛的

如果你符合下面任意一条，这个仓库可能对你有用：

- 你长期关注某个领域（商业航空、半导体、某条政策、某个开源生态），每天要从一堆 RSS / 公告 / 新闻里挑出真正值得看的。
- 你想让系统帮你过滤掉营销稿、航班延误、招聘八卦这类噪音，只留下"发生了什么、为什么重要"。
- 你希望自己的"已读 / 收藏 / 忽略 / 不感兴趣"能反过来训练系统，而不是每天看到重复的低价值内容。
- 你想把重要情报沉淀成 Markdown / Obsidian，而不是只停留在当天的信息流里。

当前版本是**个人 / 单用户**形态，已通过 Railway Web + Postgres 部署验证；Worker 可执行单轮抓取与分析，定时调度仍需在部署平台补齐。多租户、团队权限、付费系统是后续阶段，不阻塞当前体验。

## 信源是如何进入系统的

望潮的信源不是一次性配死的 RSS 列表，而是一个有生命周期的**信源治理流程**。每个信源都处于以下状态之一：

| 状态 | 含义 |
|------|------|
| `seed` | 初始种子源，由环境变量 `WANGCHAO_SEED_SOURCE_*` 或人工创建，高可信 |
| `candidate` | 候选源，先观察、不直接进入正式日报 |
| `active` | 已批准信源，Worker 会抓取，产出进入正式情报流 |
| `muted` | 噪音源，暂停或低频抓取 |
| `rejected` | 明确拒绝，不再推荐 |

**当前实现**的进入路径：

1. **种子源**：部署时 seed 读取一个多主题信源列表（优先级：`WANGCHAO_SEED_SOURCE_NAME`+`WANGCHAO_SEED_SOURCE_URL` 旧单源模式 > `WANGCHAO_SEED_SOURCES_URL` > 仓库内 `packages/db/seed-sources.json`），把列表中的源直接创建为 `ACTIVE`。默认 `WANGCHAO_SEED_SOURCES_URL` 指向本仓库 raw link，拉取失败时 fallback 到随部署 bundle 的本地文件。re-seed 不会重置你在 UI 上改过的源状态或主题 profile。
2. **新建主题自动候选源**：在"新增主题"页只填写主题名称和描述，Web 会生成初始 topic profile，并用 `packages/db/seed-sources.json` 匹配可验证 RSS/Atom。验证通过的源写入 `candidate` 观察池并记录 `SourceObservation.evidence`；即使没有候选源，主题也会创建成功。
3. **候选源**：在"信源管理"页通过表单提交一个 RSS URL，或点击"发现新源"触发自动发现，进入 `candidate` 观察池。
4. **批准 / 静音 / 拒绝**：在"信源管理"页对候选源执行治理动作，状态切换会写入 `SourceObservation` 和 `FeedbackEvent`，可追溯。
5. **质量观测**：Worker 每轮抓取后计算每个信源的 hit rate / noise rate / duplicate rate，快照写入 `SourceObservation`，作为后续治理决策依据。
6. **自动发现**：`runSourceDiscoveryCycle()` 支持关键词搜索 RSS、高分情报原文反查和 active source 外链网络三条渠道；候选源会带推荐理由、相关性评分、发现渠道和 `TaskRun` / `UsageEvent` 审计记录。无 `BRAVE_SEARCH_API_KEY` 时跳过关键词搜索，不阻塞其他渠道。

**重要边界**：`candidate` / `muted` / `rejected` 源的内容**不会**进入正式抓取和日报，必须先批准为 `active`。

## 未读情报是如何被筛选和录入的

情报从 RSS 原文到 Dashboard 上的未读卡片，经过 Worker 的一条确定性管线。每一轮 `runFetchCycle()` 执行以下步骤：

```text
1. 抓取     Worker 列出所有 ACTIVE 信源，逐个 fetch RSS/Atom
            每个 source 最多重试 3 次，每次写入独立 TaskRun 审计
   ↓
2. 入库     RSS item 规范化后 upsert 到 Item 表（status=FETCHED）
            按 contentHash 去重，保留原始 rawMetadata
   ↓
3. 相关性   对每个 FETCHED item 调用 evaluateRelevance()
            用 topic profile 的 keywords 做匹配，命中数 >= 阈值才相关
            相关 → 继续；不相关 → markItemFiltered()，status=FILTERED
   ↓
4. 抽取     createIntelligenceEventDraft() 生成情报事件草案：
            - title / summary / category(命中关键词)
            - eventHash(title+url 归一化) 作为去重键
            - gravityScore = baseScore × 时间衰减因子（越新越高）
   ↓
5. 写入     upsertIntelligenceEventFromItem() 按 topicId+eventHash 幂等写入
            IntelligenceEvent(status=UNREAD)，Item status=ANALYZED
   ↓
6. 偏好     runPreferenceLearningCycle() 汇总近期 FeedbackEvent
            生成 PreferenceMemory（可解释的权重 + 置信度）
   ↓
7. 简报     runDailyBriefingCycle() 按主题生成当日 Markdown 简报
            写入 Briefing 表，供 Web 端下载
   ↓
8. 信源     runSourceGovernanceObservationCycle() 快照信源质量指标
```

**关键设计点**：

- 当前情报管线以**可解释规则**为主（关键词匹配 + 时间衰减 + 反馈权重），不依赖 LLM 调用即可跑通闭环。`packages/ai` 提供 OpenAI-compatible 边界，后续可接入更深的语义抽取和简报改写，但仍会保留可解释性和幂等写入。
- Dashboard 主列表只展示 `UNREAD` 和 `SAVED` 事件，`READ` 和 `DISMISSED` 默认从主信息流隐藏。
- Dashboard 排序 = `gravityScore` 基础分 × `PreferenceMemory` 权重。你的反馈会直接影响下一轮排序，不只是被记录。

## 用户的反馈如何影响系统

每条情报支持：已读 / 收藏 / 忽略 / 导出。每个动作都会同时写 `IntelligenceEvent` 状态、`UserItemState` 和 `FeedbackEvent`，作为偏好学习的信号。

```text
SAVE / EXPORT  →  提升 category / source 权重（+2 信号）
READ           →  轻微提升（+0.5）
DISMISS        →  降低权重（-2）
```

Worker 的 `runPreferenceLearningCycle()` 把这些信号归纳成 `PreferenceMemory`，每条都带可解释的 `explanation`，例如：

```text
3 feedback signals increased the category preference for keyword:C919.
```

Dashboard 在渲染时读取 `PreferenceMemory`，对 `gravityScore` 应用权重乘子（0.4× ~ 1.6×）。你多次忽略某类内容后，该类内容会明显降权。

## 当前阶段

> ⚠️ **本仓库处于高频迭代阶段，尚未达到稳定可用状态，请勿直接用于生产环境。** API、Schema、UI 和 Worker 管线仍可能发生破坏性变更。

| 范围 | 状态 |
|------|------|
| 稳定性 | 高频迭代，API/Schema 可能变更，无向后兼容承诺 |
| 主技术栈 | TypeScript、pnpm、Turborepo、Next.js App Router、Prisma、Postgres、Node.js worker |
| Web | 主题创建、候选信源发现、情报流、事件详情、已读/收藏/忽略、偏好记忆、简报导出、信源治理、工作区成员/用量审计、`/api/health` |
| Worker | RSS 抓取、Item 写入、确定性情报管线、偏好归纳、daily briefing、source quality observation、`--health` |
| 数据库 | Prisma schema、首版 migration、seed、工作区模型、UsageEvent |

当前个人版已完成 Railway Web + Postgres 部署验证；Worker 已可运行单轮任务，定时调度仍需在部署平台补齐。

## 架构

```text
Next.js Web
  ↓ Server Actions / Route Handlers
packages/db
  ↓ Prisma
Postgres

Node Worker
  ↓ packages/sources
RSS feeds
  ↓ packages/core / packages/ai
Item → IntelligenceEvent → Briefing → UsageEvent
```

目录结构：

```text
apps/
  web/                 Next.js App Router 产品界面
  worker/              后台抓取、分析、简报和健康检查
packages/
  db/                  Prisma schema、migration、seed、repository boundary
  core/                领域逻辑、排序、偏好、Markdown 渲染
  ai/                  OpenAI-compatible adapter 和 parser
  sources/             RSS/source adapter
  ui/                  共享 UI 包
docs/
  L2-domain.md            L2 领域模型、状态机、术语表
  L3-modules.md           L3 模块职责、关键文件、调用链
  L4-operations.md        L4 命令、环境变量、部署、测试
  deployment.md            通用部署运维说明
  railway-deployment.md    Railway 部署完整指南
```

## 快速开始

需要 Node.js、pnpm 和 Postgres。

```bash
pnpm install
cp .env_example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

常用验证：

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm test
pnpm worker:health
```

Web health endpoint：

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

## 环境变量

`.env_example` 提供占位模板。真实密钥和数据库连接不得提交。

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `WANGCHAO_DEFAULT_ORGANIZATION_SLUG` | 默认工作区 slug |
| `WANGCHAO_DEFAULT_ORGANIZATION_NAME` | 默认工作区名称 |
| `WANGCHAO_DEFAULT_USER_EMAIL` | 默认用户邮箱 |
| `WANGCHAO_DEFAULT_USER_NAME` | 默认用户名称 |
| `WANGCHAO_SEED_SOURCES_URL` | 多主题信源列表 JSON 的 URL（Gist raw 或任意公开 JSON）。留空时默认拉本仓库 raw link，失败 fallback 到 `packages/db/seed-sources.json` |
| `WANGCHAO_SEED_SOURCE_NAME` | 旧单源模式：seed 源名称。与 `WANGCHAO_SEED_SOURCE_URL` 同时设置时生效，优先级高于列表 |
| `WANGCHAO_SEED_SOURCE_URL` | 旧单源模式：seed 源 RSS URL |
| `AI_BASE_URL` | OpenAI-compatible API endpoint |
| `AI_API_KEY` | AI provider API key |
| `AI_MODEL_L1` / `AI_MODEL_L2` | AI pipeline 默认模型配置；source recommendation 使用 `AI_MODEL_L1` |
| `BRAVE_SEARCH_API_KEY` | Brave Search API BYOK；为空时 source discovery 跳过关键词搜索 |
| `WANGCHAO_SEARCH_PROVIDER` | Search provider，当前支持 `brave` |
| `WANGCHAO_DISCOVERY_HIGHSCORE_THRESHOLD` | 高分情报原文反查阈值 |
| `WANGCHAO_DISCOVERY_LOOKBACK_DAYS` | 高分情报原文反查时间窗 |
| `WANGCHAO_DISCOVERY_WEEKLY_LIMIT` | 每轮每个 topic 最多写入候选源数量 |
| `WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT` | 每轮最多探测的高分原文页数量 |
| `WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT` | 每轮最多探测的 active source item 数量 |
| `WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE` | 每个 active item 最多探测的外链数量 |
| `WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS` | discovery 网页/RSS 探测超时 |
| `WANGCHAO_TOPIC_CREATE_SOURCE_LIMIT` | 新建主题时从内置信源包最多写入多少个候选源 |
| `WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS` | 新建主题时 RSS/Atom 候选源验证超时 |

## 开发阶段审计

本仓库按 `AGENTS.md` 和 `REFACTOR_PLAN.md` 分阶段开发。每个阶段完成后需要同步：

- `CODEGUIDE.md`（L0/L1）+ `docs/L2-domain.md` + `docs/L3-modules.md` + `docs/L4-operations.md`: 代码结构、数据流、命令和安全边界，按 L0-L4 分层归属更新。
- `DEVELOPE_LOGS.md`: 阶段审计、缺失功能、已知风险和后续追踪。
- `AGENTS_CHANGELOGS.md`: AI Agent 每轮修改审计日志。

`CHANGELOG.md` 已废弃，不再维护。

## 当前个人版边界

- 已通过 `pnpm db:generate`、`pnpm db:validate`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm worker:health`。
- 已完成 Railway Web + Postgres 生产 smoke test。
- 当前面向个人工作区使用，默认工作区身份由环境变量配置。
- Worker 可执行抓取、分析和简报生成；部署平台负责定时触发。
- AI 情报管线当前以可解释规则为主；`packages/ai` 提供 OpenAI-compatible 边界，source recommendation 已接入 OpenAI-compatible JSON 解析和兜底推荐。
- 自动信源发现已支持高分链接反查、外链网络和关键词搜索 RSS；部署平台可用 `pnpm worker:source-discovery` 周期触发。

## 参考文档

望潮的代码结构文档采用 L0-L4 分层组织，帮助 AI 和人工按抽象层级阅读：

- `SPEC.md`: 产品目标、边界、数据模型和功能方向的 source of truth。
- `REFACTOR_PLAN.md`: Node.js/TypeScript 重构路线。
- `AGENTS.md`: AI Agent 协作规范、文档分层规则和阅读协议。
- `CODEGUIDE.md`: **L0 系统架构 + L1 设计原则**，抽象层，高频阅读。
- `docs/L2-domain.md`: **L2 领域模型**，核心实体、状态机、术语表。
- `docs/L3-modules.md`: **L3 模块细节**，按包分章节的关键文件和调用链。
- `docs/L4-operations.md`: **L4 操作运维**，命令、环境变量、部署、测试。
- `FRONTEND.md`: 前端视觉语言、交互规则和页面组合规范。
- `docs/deployment.md`: 通用部署运维说明（健康检查、日志、备份、回滚）。
- `docs/railway-deployment.md`: Railway 部署完整指南。
- `AGENTS_CHANGELOGS.md`: AI Agent 工作审计日志。
- `DEVELOPE_LOGS.md`: 分阶段开发审计和延期功能追踪。

## 贡献与定制

望潮处于高频迭代阶段，欢迎社区贡献和 fork 定制。

- **提 Issue**：通过 [GitHub Issues](https://github.com/sunrunchen/wangchao/issues) 报告 bug 或提出功能建议。提供了 Bug 报告和功能请求模板。
- **提 PR**：欢迎 bug 修复、新信源适配器、文档改进和测试补全。建议先开 Issue 或 Discussion 讨论较大的改动。
- **用 AI Agent 定制**：Fork 这个仓库后，把 `AGENTS.md` 和 `CODEGUIDE.md` 喂给你的 coding agent（Claude Code、Cursor、Copilot 等），让它按照你的领域（半导体、政策、开源生态……）、信源、偏好评分规则和部署环境改造。这个项目就是为这种定制设计的。
- **讨论**：产品想法、使用问题、经验分享请发到 [GitHub Discussions](https://github.com/sunrunchen/wangchao/discussions)。

## 鸣谢

望潮继承自 [t0saki/AI-News-Dashboard](https://github.com/t0saki/AI-News-Dashboard) 的产品 idea——把 RSS 新闻流经 AI 筛选变成结构化情报。虽然这个仓库已经几乎完全重构为 TypeScript / Next.js / Postgres 技术栈，产品形态也从"新闻 Dashboard"演进为"主题驱动的情报工作台"，但最初的 idea 来自 t0saki 的原型。在此鸣谢。

本网站的 UI 设计使用了 [DesignPrompts](https://www.designprompts.dev) 的 prompt，在此鸣谢。

## License

[MIT](LICENSE)
