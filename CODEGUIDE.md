# 望潮（Wangchao）— Codebase Structure Map

> **文档创建于 2026-07-06** | 当前主路径以 TypeScript monorepo 为准
>
> 技术路线以 `REFACTOR_PLAN.md` 为准：仓库已绿地重构为 Node.js / TypeScript / Next.js / Postgres / Prisma 架构。`README.md` / `README-en.md` 是当前用户入口说明。

本文件采用 **L0-L4 分层结构**。L0/L1（抽象层，稳定，高频阅读）在本文件；L2/L3/L4（细节层，按需阅读）在 `docs/` 下独立文件：

| 层 | 内容 | 文件 |
|---|---|---|
| **L0** | 系统架构、运行时拓扑、主干数据流 | 本文件 |
| **L1** | 设计原则、依赖方向、安全与边界 | 本文件 |
| **L2** | 领域模型、状态机、术语 | `docs/L2-domain.md` |
| **L3** | 模块职责、关键文件、调用链 | `docs/L3-modules.md` |
| **L4** | 命令、环境变量、部署、测试 | `docs/L4-operations.md` |

---

## L0 - 系统架构

### L0.1 整体架构图

**望潮（Wangchao）** 当前主路径是一个 TypeScript monorepo 情报系统。核心链路是：**Next.js 产品界面 → Postgres/Prisma 数据边界 → Node worker 抓取 RSS → 确定性情报管线/AI adapter 边界 → Dashboard、偏好记忆、简报、导出、信源治理、用量审计和健康检查**。

```text
User
  ↓
Next.js App Router
  ↓
Server components / server actions / route handlers
  ↓
Prisma
  ↓
Postgres

Worker scheduler
  ↓
Task table / TaskRun
  ↓
Source adapters
  ↓
Item normalization
  ↓
AI pipeline
  ↓
Intelligence events / briefings / preference memory
  ↓
Postgres
```

### L0.2 仓库布局与维度

| 维度 | 描述 |
|------|------|
| 运行时 | Node.js / TypeScript |
| 依赖管理 | `pnpm` workspace |
| 构建编排 | Turborepo |
| 数据库 | Postgres + Prisma |
| 信息源 | RSS/Atom feed，经 `packages/sources` 解析 |
| AI 接口 | OpenAI-compatible adapter，当前主情报管线以可解释规则为主 |
| 输出 | Next.js Dashboard、Markdown event/briefing export |
| 前端 | `apps/web` Next.js App Router |
| 后台任务 | `apps/worker` Node.js worker |
| 包管理 | `pnpm` workspace |
| Web app | `apps/web`，Next.js App Router，提供顶部导航产品壳、首页未读情报流、创建主题、信源管理、简报、已收藏、偏好记忆、`/api/health`、loading/error 状态和 shadcn/Radix/Tailwind v4 组件链。按 `FRONTEND.md` 重构为 Kinetic Intelligence 风格。 |
| Worker | `apps/worker`，Node.js TypeScript worker，支持 fetch、source discovery、instant push cycle 与 `--health` 健康检查 |
| 共享包 | `packages/core`, `packages/ai`, `packages/db`, `packages/sources` |
| DB 基础 | `packages/db`，Prisma/Postgres schema、migration、seed、lazy client、tenant/member role guard、usage event 与查询 helper |
| 情报管线 | `packages/core` + `apps/worker`，提供可解释 relevance/noise、event draft、dedupe hash、gravity ranking、feedback delta 和 preference ranking |
| 验证命令 | `CI=true pnpm typecheck`, `CI=true pnpm build`, `CI=true pnpm lint`, `CI=true pnpm test` |

### L0.3 主干数据流

```text
Topic + Source
  ↓ Worker runFetchCycle()
RSS feeds -> Item -> IntelligenceEvent
  ↓ Worker runAnalysisCycle()
relevance/noise filter -> event draft -> gravity score -> dedupe
  ↓ apps/web getTopicSourceWorkspace()
Dashboard / Markdown export / source governance / usage audit
```

### L0.4 文档优先级

| 优先级 | 文件 | 说明 |
|--------|------|------|
| 1 | `SPEC.md` | 产品目标、边界、数据模型和功能方向的 source of truth。 |
| 2 | `REFACTOR_PLAN.md` | 技术选型、目标架构和绿地重构阶段的核心依据。 |
| 3 | `AGENTS.md` | AI Agent 协作规则。 |
| 4 | `FRONTEND.md` | 前端视觉语言、交互规则、组件风格和页面组合方式。 |
| 5 | `CODEGUIDE.md`（本文件）+ `docs/L2-L4` | 当前代码结构、模块职责、数据流和命令说明。 |
| 6 | `AGENTS_CHANGELOGS.md` | AI Agent 每轮修改审计日志。 |
| 7 | `DEVELOPE_LOGS.md` | 分阶段开发审计和延期功能追踪。 |
| 入口说明 | `README.md` / `README-en.md` | 当前 TypeScript 主路径的用户入口说明；架构决策仍以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。 |
| 废弃 | `CHANGELOG.md` | 不再维护，由 `AGENTS_CHANGELOGS.md` 替代。 |

### L0.5 Legacy Python Prototype

旧 Python 原型已在开源清洗中删除（上游 `t0saki/AI-News-Dashboard` 无 LICENSE，直接开源有法律风险；TypeScript 主路径是全新实现，不受影响）。git history 仍保留历史，但当前代码树不再包含。新增功能继续在 TypeScript 模块中实现。

---

## L1 - 设计原则与边界

### L1.1 分层与依赖方向

代码按抽象层级组织，依赖方向单向向下：

```text
L0 基础设施（db/ai/sources）  ← 不依赖业务，可独立测试
  ↑
L1 领域逻辑（core）           ← 不依赖 apps，只依赖 L0 基础设施
  ↑
L3 应用入口（web/worker）     ← 编排 L0+L1，不反向依赖
```

规则：
- `packages/db`、`packages/ai`、`packages/sources` 不依赖 `packages/core`，更不依赖 `apps/*`。
- `packages/core` 不依赖 `apps/*`，只依赖 L0 基础设施包。
- `apps/web`、`apps/worker` 编排 L0+L1，是依赖链顶端。
- Database、Redis、provider SDK clients 必须通过 getter 函数 lazy init，避免 `next build` 在缺少 runtime env 时失败。

### L1.2 Worker 边界

- 抓取、AI 分析、简报、导出等长任务必须放在 worker，不放进 request lifecycle。
- Web app 只 enqueue 任务和读取 durable status，不执行长任务。
- Worker 负责抓取、item normalize、可解释分析、反馈归纳、简报生成和 source quality observation。
- Next.js route handlers 用于外部 API、webhooks、export downloads、status endpoints。Server Actions 用于内部产品 mutations。

### L1.3 Tenant 与权限边界

- tenant-owned 数据必须预留 `organizationId`；user-specific state 必须预留 `userId`。
- Topic/Source 写入必须先通过默认 organization/user 获取 `organizationId`/`userId`，再写入。
- Topic mutation 的 Prisma `where` 必须同时包含 `topicId + organizationId`；不能只依赖 Server Action 先做 membership 检查。
- `usage events` 记录 AI 调用、抓取、导出、简报生成等用量。
- MVP 可以使用默认 user/organization，不阻塞核心体验；真实商业化前必须替换为正式 auth/session provider。
- Prisma schema 和 migrations 进入版本控制；不直接手改生产数据库。schema 变更必须包含 migration、测试、查询层更新和文档更新。

### L1.4 不可信输入处理

- LLM 输出一律视为不可信输入，后端 sanitize，前端安全渲染。
- RSS、网页内容、LLM 输出全部按不可信输入处理。
- provider response 必须先 sanitize，再 parse，再 validate。
- 页面和 Markdown 导出只允许把 HTTP/HTTPS URL 渲染为外链。
- 情报正文、摘要、解释和来源名称不得全大写；来源和原文链接必须使用真实 `<a>`，外链补 `target="_blank"` 和 `rel="noreferrer"`。
- 日志不得输出密钥、认证 URL、敏感 headers。
- Topic profile 表单按字符串数组边界校验（条数、单项长度、总长度）；Worker 通过 `buildTopicProfileContext()` 清洗 JSON 数组，并从 Topic 行读取当前 name/description，避免信任过期或畸形 profile 副本。
- Deterministic relevance 只解释可可靠执行的短语规则：excludeScope 优先否决；keywords/entities/includeScope 提供正信号。importanceRules 是自然语言，只进入 AI prompt，不得用未定义启发式伪装成已执行。

### L1.5 候选源隔离

- Candidate sources 不得无标注进入正式简报。
- worker fetch 和 daily briefing 默认只使用 `ACTIVE` sources；candidate/muted/rejected 不得进入正式抓取和简报。
- Source discovery 只能写入 candidate pool，不得绕过治理流程直接标记为 `ACTIVE`；如果发现已存在 source，只更新推荐信息和 observation，不改变现有治理状态。
- Candidate-source content 必须通过真实 HTTP/HTTPS feed 验证，读取 feed title 后才能写入 `Source.status='CANDIDATE'` 和 `SourceObservation.evidence`。

### L1.6 反馈必须影响输出

- 阅读状态、反馈和导出行为必须创建 durable 信号。
- Dashboard 状态动作必须同时写 `IntelligenceEvent`、`UserItemState` 和 `FeedbackEvent`，为偏好学习保留信号。
- Preference memory 必须可解释（保留 `explanation`）。
- Preference delta 必须按 `topicId + key` 分组；同名 category 的反馈不得跨 Topic 抵消或合并。
- Dashboard 排序使用 `gravityScore` 作为基础分，再应用 `PreferenceMemory` 权重；不得只记录反馈而不影响排序。
- Preference learning 当前使用可解释规则：`SAVE/EXPORT` 提升 category/source 权重，`READ` 轻微提升，`DISMISS` 降低；详情页 `CATEGORY_UP/DOWN` 只改变当前 Topic 的 category 权重。后续可替换为 LLM 归纳，但必须保留可解释性。
- 单条情报导出应作为 `FeedbackEvent(kind='EXPORT')` 正反馈记录。
- Source governance 状态动作必须写 `SourceObservation`；approve/reject/mute 还应记录可追溯 evidence 和 `FeedbackEvent` 作为管理员治理审计，但不得把管理员操作直接等同于个人 `source_good/source_bad` 偏好。后者进入 PreferenceMemory 前需要独立用户反馈入口。

### L1.7 幂等与去重

- RSS URL 进入唯一性约束前必须 canonicalize；当前实现会去掉 hash、统一 hostname 小写并规整尾部 `/`。
- 当前分析管线用 `topicId + eventHash` 幂等 upsert 事件；`eventHash` 由标题和 URL 生成。
- `markItemFiltered()` 必须保留原有 `rawMetadata`，只追加过滤原因，避免丢失 RSS 原始追溯信息。

### L1.8 安全与隐私

- 不提交 `.env`、密钥、token、`data/*`、生成 JSON、`.venv`、本地缓存。
- `.env_example` 只能放占位符。
- 导出内容必须保留来源链接和生成时间。
- 商业化阶段必须补 tenant isolation、权限测试、usage audit。
- AI 凭证与搜索凭证相互独立：UI 通过独立表单实例各自管理状态，`upsertAiCredential` 和 `upsertSearchCredential` 分别操作 `Subscription` 表的不同字段，不互相阻断。删除某一类凭证不会影响另一类。
- Next.js 16 proxy（`apps/web/src/proxy.ts`）强制安全响应头：HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy；production CSP 使用每请求随机 nonce 授权 Next.js framework/Flight 内联脚本，根 layout 强制 request-time rendering 以确保所有路由的脚本获得当前 nonce；开发环境不启用 CSP，避免阻断 dev HMR。
- 外部 URL 在 fetch 前必须经过 SSRF 防护（`packages/sources/src/ssrf.ts`）：私有 IP、loopback、cloud metadata 一律阻断。
- 加密模块（`packages/db/src/crypto.ts`）使用 per-credential 随机 salt + scrypt KDF；旧格式密文保持向后兼容。
- AI 生成内容渲染前需经 HTML entity 逃逸（`sanitizeForDisplay`），入库前剥离危险标签（`sanitizeMarkdownSource`）。
- Worker 错误日志（`safe-log.ts`）只输出 `name/message/code`，不输出 `stack`、Prisma `meta` 或绝对路径。

---

## L2 - 领域模型与概念（详见 docs/L2-domain.md）

本节为索引摘要，完整内容见 `docs/L2-domain.md`。

| 小节 | 内容 | 链接 |
|---|---|---|
| 核心实体职责 | User/Org/Topic/Source/Item/Event/State/Feedback/Preference/Briefing/TaskRun/UsageEvent 职责表 | [docs/L2-domain.md#核心实体职责](L2-domain.md#核心实体职责) |
| 关键状态机 | Source / Item / IntelligenceEvent / TaskRun 状态转换图 | [docs/L2-domain.md#关键状态机](L2-domain.md#关键状态机) |
| FeedbackKind 枚举 | 14 种反馈类型及对偏好影响 | [docs/L2-domain.md#feedbackkind-枚举](L2-domain.md#feedbackkind-枚举) |
| 领域术语表 | Topic Profile / Gravity Score / Preference Memory / Source Observation 等 | [docs/L2-domain.md#领域术语表](L2-domain.md#领域术语表) |
| 实体关系概览 | 树状关系图和唯一性约束 | [docs/L2-domain.md#实体关系概览](L2-domain.md#实体关系概览) |

---

## L3 - 模块与调用链（详见 docs/L3-modules.md）

本节为索引摘要，完整内容见 `docs/L3-modules.md`。

| 包/目录 | 职责摘要 | 链接 |
|---|---|---|
| `packages/db` | Postgres/Prisma schema、migration、client、repositories 与可执行 repository fixtures | [docs/L3-modules.md#packagesdb](L3-modules.md#packagesdb) |
| `packages/core` | 领域逻辑：topic profile、relevance、event draft、gravity ranking、preference、Markdown | [docs/L3-modules.md#packagescore](L3-modules.md#packagescore) |
| `packages/ai` | OpenAI-compatible adapter、parser、source recommendation | [docs/L3-modules.md#packagesai](L3-modules.md#packagesai) |
| `packages/sources` | RSS/Web source adapter、search provider、discovery | [docs/L3-modules.md#packagessources](L3-modules.md#packagessources) |
| `apps/web` | Next.js App Router 产品界面 | [docs/L3-modules.md#appsweb](L3-modules.md#appsweb) |
| `apps/worker` | Node.js 后台 worker | [docs/L3-modules.md#appsworker](L3-modules.md#appsworker) |

关键文件索引：

| 文件 | 职责摘要 |
|---|---|
| `packages/db/prisma/migrations/0008_briefing_idempotency/migration.sql` | 清理历史重复简报并建立主题/周期/窗口唯一约束。 |
| `packages/db/prisma/migrations/0009_delivery_report_feedback/migration.sql` | 新增 DeliveryLog/Report 模型、Telegram 凭证字段、增强 FeedbackKind 枚举。 |
| `packages/db/src/extended-repositories.ts` | Telegram 凭证、DeliveryLog、Report CRUD、证据检索和偏好编辑函数。 |
| `packages/db/src/repositories.fixtures.ts` | Repository runtime fixtures，覆盖收藏、daily briefing、TaskRun、标题模糊合并和 SourceObservation 指标口径。 |
| `apps/worker/src/index.fixtures.ts` | Worker runtime fixture，覆盖 rule/LLM filter reason 的选择优先级。 |
| `apps/web/src/app/admin/usage/page.tsx` | OWNER/ADMIN 工作区成员与近 30 天用量审计页。 |
| `apps/web/src/app/admin/settings/credential-form.tsx` | AI/搜索凭证表单，模型嗅探下拉、自定义 provider 手动确认、计费提示 |
| `apps/web/src/app/admin/settings/telegram-form.tsx` | Telegram 凭证表单，Bot Token/Chat ID 输入、测试连接、密码显隐。 |
| `apps/web/src/app/admin/settings/providers.ts` | Provider 常量集中定义（`AI_PROVIDERS`/`SEARCH_PROVIDERS`/`defaultAiBaseUrl`），前后端统一数据源。 |
| `apps/web/src/app/reports/page.tsx` | 专题报告列表页，提交自然语言问题触发异步报告生成。 |
| `apps/web/src/app/reports/[reportId]/page.tsx` | 专题报告详情页，展示 Markdown 内容和覆盖说明。 |
| `apps/web/src/lib/report-data.ts` | 报告数据读取 helper（`getReportsPage`/`getReportDetail`）。 |
| `apps/web/src/proxy.ts` | Next.js 16 request proxy：每请求生成 nonce CSP，并设置 Web 安全响应头。 |
| `apps/web/src/lib/content-security-policy.ts` | Production CSP policy builder，约束 nonce/strict-dynamic 与 script/object 安全边界。 |
| `apps/web/scripts/content-security-policy.fixture.mjs` | CSP unit + production server smoke fixture，验证逐请求 nonce 与 framework/Flight script 属性。 |

关键调用链索引：

| 调用链 | 链接 |
|---|---|
| Fetch Cycle（抓取） | [docs/L3-modules.md#fetch-cycle抓取链路](L3-modules.md#fetch-cycle抓取链路) |
| Analysis Cycle（分析） | [docs/L3-modules.md#analysis-cycle分析链路](L3-modules.md#analysis-cycle分析链路) |
| Dashboard Reading Workflow（阅读） | [docs/L3-modules.md#dashboard-reading-workflow阅读链路](L3-modules.md#dashboard-reading-workflow阅读链路) |
| Preference Learning Cycle（偏好学习） | [docs/L3-modules.md#preference-learning-cycle偏好学习链路](L3-modules.md#preference-learning-cycle偏好学习链路) |
| Briefing and Markdown Export（简报与导出） | [docs/L3-modules.md#briefing-and-markdown-export简报与导出链路](L3-modules.md#briefing-and-markdown-export简报与导出链路) |
| Source Governance（信源治理） | [docs/L3-modules.md#source-governance信源治理链路](L3-modules.md#source-governance信源治理链路) |
| Source Discovery（信源发现） | [docs/L3-modules.md#source-discovery信源发现链路](L3-modules.md#source-discovery信源发现链路) |
| Commercial Readiness Boundary（商业化边界） | [docs/L3-modules.md#commercial-readiness-boundary商业化边界链路](L3-modules.md#commercial-readiness-boundary商业化边界链路) |
| Telegram Delivery（Telegram 投递） | [docs/L3-modules.md#telegram-deliverytelegram-投递链路](L3-modules.md#telegram-deliverytelegram-投递链路) |
| Report Generation（专题报告生成） | [docs/L3-modules.md#report-generation专题报告生成链路](L3-modules.md#report-generation专题报告生成链路) |
| Deployment and Health（部署与健康检查） | [docs/L3-modules.md#deployment-and-health部署与健康检查链路](L3-modules.md#deployment-and-health部署与健康检查链路) |

---

## L4 - 操作与运维（详见 docs/L4-operations.md）

本节为常用命令速查，完整内容见 `docs/L4-operations.md`。

```bash
# 本地运行
cp .env_example .env && pnpm install && pnpm db:generate && pnpm db:migrate && pnpm db:seed && pnpm dev

# 验证四件套
CI=true pnpm lint && CI=true pnpm typecheck && CI=true pnpm test && CI=true pnpm build

# Worker
pnpm worker:health
pnpm worker:source-discovery

# Prisma
pnpm db:validate && pnpm db:generate && pnpm db:migrate && pnpm db:wait && pnpm db:deploy && pnpm db:seed

# Smoke
pnpm smoke:web
```

完整命令、环境变量、部署、Docker Postgres、Railway 配置见 [docs/L4-operations.md](docs/L4-operations.md)。Railway 生产运维（GitHub 自动部署、Cron 观测、备份/回滚、环境变量矩阵、CI/CD）见 [docs/railway-runbook.md](docs/railway-runbook.md)。

---

## 维护规则

- `SPEC.md` 是后续产品开发与重构的主要依据，描述目标产品形态；当它与当前实现不一致时，应把当前代码视为可重构的引擎原型，而不是限制产品方向。
- `REFACTOR_PLAN.md` 是下一阶段技术选型和绿地重构路线的核心依据；涉及架构方向时优先参考它。
- `AGENTS.md` 是 AI Agent 协作规范；包含文档分层规则和阅读协议。
- `AGENTS_CHANGELOGS.md` 替代 `CHANGELOG.md`，记录每轮 AI Agent 修改审计；`CHANGELOG.md` 已废弃，不再继续维护。
- `DEVELOPE_LOGS.md` 记录每个开发阶段完成后的审计、缺失功能、已知风险和后续追踪事项。
- 修改项目目标、核心工作流、状态机、输出 schema、配置语义、安全边界或明确限制时必须同步更新 `SPEC.md`。
- 修改代码后必须运行相关测试；涉及运行时/数据库/前端安全时至少运行三份根目录测试脚本。
- 新增环境变量时同步更新 `.env_example` 和 `docs/L4-operations.md`。
- 修改数据流、状态机、输出 JSON schema、目录结构或新增测试脚本时同步更新对应文档层（见 `AGENTS.md` 文档分层规则）。
- 每次 AI Agent 对代码、文档、配置或仓库结构做出修改，都必须按 `AGENTS.md` 规则更新 `AGENTS_CHANGELOGS.md`。
- 不要提交 `.env`、`data/*`、生成的 `dashboard.json/top5.json` 或 `.venv`。
- 完整 shadcn/Radix/Tailwind v4 组件链已接入：Button/Card/Badge/Tabs/Input/Label/Textarea 均为 shadcn 标准实现，Tabs 基于 Radix 提供完整键盘导航和 ARIA。
