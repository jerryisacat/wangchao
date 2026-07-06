# 望潮 Wangchao

[English](README-en.md)

`望潮（Wangchao）` 是一个**主题驱动的个人 AI 情报工作台**。你只需要告诉系统自己关心什么主题，系统围绕主题抓取公开信息、过滤噪音、生成结构化情报事件，并通过你的阅读和反馈越来越理解你真正想看的内容。

它不是一个 RSS 阅读器，也不是一个新闻聚合器。核心入口是**主题**，而不是信源。

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

1. **种子源**：部署时通过 `WANGCHAO_SEED_SOURCE_NAME` / `WANGCHAO_SEED_SOURCE_URL` 环境变量创建默认 RSS 源，或在"信源管理"页手动添加。
2. **候选源**：在"信源管理"页通过表单提交一个 RSS URL，进入 `candidate` 观察池。
3. **批准 / 静音 / 拒绝**：在"信源管理"页对候选源执行治理动作，状态切换会写入 `SourceObservation` 和 `FeedbackEvent`，可追溯。
4. **质量观测**：Worker 每轮抓取后计算每个信源的 hit rate / noise rate / duplicate rate，快照写入 `SourceObservation`，作为后续治理决策依据。

**重要边界**：`candidate` / `muted` / `rejected` 源的内容**不会**进入正式抓取和日报，必须先批准为 `active`。

**未来阶段（SPEC Phase 5，当前未实现）**：从高分情报的原文链接反查一手来源、从 active 源外链网络发现候选、按主题关键词定期搜索 RSS。当前版本聚焦在"人工提交 + 系统观测治理"的闭环。

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

## 当前状态

| 范围 | 状态 |
|---|---|
| 主技术栈 | TypeScript、pnpm、Turborepo、Next.js App Router、Prisma、Postgres、Node.js worker |
| Web | 主题/RSS 表单、情报流、事件详情、已读/收藏/忽略、偏好记忆、简报导出、信源治理、工作区成员/用量审计、`/api/health` |
| Worker | RSS 抓取、Item 写入、确定性情报管线、偏好归纳、daily briefing、source quality observation、`--health` |
| 数据库 | Prisma schema、首版 migration、seed、工作区模型、UsageEvent |
| 旧原型 | 已归档到 `legacy/python-prototype/` |

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
  deployment.md            通用部署运维说明
  railway-deployment.md    Railway 部署完整指南
legacy/
  python-prototype/    已归档旧 Python 原型
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
| `WANGCHAO_SEED_SOURCE_NAME` | seed 阶段创建的默认 RSS 源名称，留空则不创建 |
| `WANGCHAO_SEED_SOURCE_URL` | seed 阶段创建的默认 RSS 源 URL |
| `AI_BASE_URL` | OpenAI-compatible API endpoint |
| `AI_API_KEY` | AI provider API key |
| `AI_MODEL_L1` / `AI_MODEL_L2` | 后续 AI pipeline 默认模型配置 |

## 开发阶段审计

本仓库按 `AGENTS.md` 和 `REFACTOR_PLAN.md` 分阶段开发。每个阶段完成后需要同步：

- `CODEGUIDE.md`: 当前代码结构、数据流、命令和安全边界。
- `DEVELOPE_LOGS.md`: 阶段审计、缺失功能、已知风险和后续追踪。
- `AGENTS_CHANGELOGS.md`: AI Agent 每轮修改审计日志。

`CHANGELOG.md` 已废弃，不再维护。

## 当前个人版边界

- 已通过 `pnpm db:generate`、`pnpm db:validate`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm worker:health`。
- 已完成 Railway Web + Postgres 生产 smoke test。
- 当前面向个人工作区使用，默认工作区身份由环境变量配置。
- Worker 可执行抓取、分析和简报生成；部署平台负责定时触发。
- AI 情报管线当前以可解释规则为主；`packages/ai` 提供 OpenAI-compatible 边界，可按需要接入更深的语义抽取和简报改写。
- 自动信源发现（高分链接反查、外链网络、关键词搜索 RSS）是 SPEC Phase 5 目标，当前未实现。
- `legacy/python-prototype/` 仅作为历史参考保留，不参与当前运行路径。

## 参考文档

- `SPEC.md`: 产品目标、边界、数据模型和功能方向的 source of truth。
- `REFACTOR_PLAN.md`: Node.js/TypeScript 重构路线。
- `FRONTEND.md`: 前端视觉语言、交互规则和页面组合规范。
- `CODEGUIDE.md`: 当前代码结构和维护规则。
- `docs/deployment.md`: 通用部署运维说明（健康检查、日志、备份、回滚）。
- `docs/railway-deployment.md`: Railway 部署完整指南（项目创建、服务配置、环境变量、部署命令、定时任务）。
- `AGENTS.md`: AI Agent 协作规范。
- `AGENTS_CHANGELOGS.md`: AI Agent 工作审计日志。
- `DEVELOPE_LOGS.md`: 分阶段开发审计和延期功能追踪。
