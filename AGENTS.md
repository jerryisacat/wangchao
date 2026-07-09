# AGENTS.md

> **⚠️ 这是一个开源仓库（MIT License）。** 任何 AI Agent 在本仓库工作时应遵守以下原则：
> - 所有提交内容都会进入公开历史，**不得写入任何密钥、私有数据、商业策略或内部专有信息**。
> - 文档和代码应该对开源社区友好——面向外部贡献者写说明，不要假设读者有内部上下文。
> - 如果用户要求写入不适宜公开的内容（商业路线图、定价、私有部署信息等），应主动提醒并建议移到私有 fork 或本地文档。
> - 保留 `AGENTS_CHANGELOGS.md` 和 `DEVELOPE_LOGS.md` 作为开发审计用途，但它们是开发过程记录，不是产品文档。

本文件定义 AI Agent 在 `望潮（Wangchao）` 仓库中的协作规范。除非用户明确要求偏离，本文件约束后续代码、文档、配置和仓库结构修改。

## 1. 项目定位

`望潮（Wangchao）` 是一个主题驱动的 AI 情报系统。用户创建关注主题，系统围绕主题发现和治理信源，抓取公开信息，通过 AI 完成相关性判断、事件抽取、去重、摘要、评分、简报生成，并通过阅读状态、反馈和导出行为学习偏好。

当前仓库已开源（MIT License），没有真实用户、生产数据或兼容承诺，允许绿地重构。商业化仅用于维护服务器运营，不是产品主线；开源版本聚焦个人情报工作台体验。

## 2. 文档优先级

| 优先级 | 文件 | 规则 |
|---|---|---|
| 1 | `SPEC.md` | 产品目标、边界、数据模型和功能方向的 source of truth。 |
| 2 | `REFACTOR_PLAN.md` | 技术选型、目标架构、重构阶段的核心依据。 |
| 3 | `AGENTS.md` | AI Agent 协作规则、文档分层规则和阅读协议。 |
| 4 | `CODEGUIDE.md`（L0+L1）+ `docs/L2-L4` | 代码结构、模块职责、数据流和命令说明，按 L0-L4 分层组织（见第 8 节）。 |
| 5 | `FRONTEND.md` | 前端视觉语言、交互规则、组件风格和页面组合方式。 |
| 6 | `AGENTS_CHANGELOGS.md` | AI Agent 每轮修改审计日志。 |
| 7 | `DEVELOPE_LOGS.md` | 分阶段开发审计和延期功能追踪。 |
| 入口说明 | `README.md` / `README-en.md` | 当前 TypeScript 主路径的用户入口说明；架构决策仍以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。 |
| 废弃 | `CHANGELOG.md` | 不再维护，由 `AGENTS_CHANGELOGS.md` 替代。 |

如果文档冲突，以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。

## 3. 技术栈

当前主技术栈以 `REFACTOR_PLAN.md` 为准：

| 层 | 当前主路径 |
|---|---|
| Language | TypeScript |
| Package manager | `pnpm` |
| Monorepo | Turborepo |
| Web | Next.js App Router |
| UI | Tailwind CSS + shadcn/ui + lucide-react |
| DB | Postgres |
| ORM | Prisma |
| Worker | Node.js worker |
| AI | OpenAI-compatible adapter |
| Export | Markdown 优先，PDF 后置 |
| Deployment | GitHub 自动同步到 Railway：Web、Worker Cron、Source Discovery Cron、Railway Postgres |

## 4. 推荐开发阶段

| 阶段 | 目标 | 主要交付物 | 完成标准 | 依赖 |
|---|---|---|---|---|
| 0 | 文档对齐 | `SPEC.md`、`REFACTOR_PLAN.md`、`CODEGUIDE.md` 一致 | 不再以旧 `README.md` 约束新实现 | 无 |
| 1 | Monorepo 基础 | `pnpm` workspace、Turborepo、TS config、基础 scripts | `pnpm build` / `pnpm typecheck` 可跑 | Phase 0 |
| 2 | 数据库基础 | Prisma schema、Postgres、migration、seed | migration 和 seed 成功 | Phase 1 |
| 3 | 产品壳 | Next.js app shell、设计 token、shadcn/ui | 有可扩展 UI 框架 | Phase 1 |
| 4 | 主题与信源 | Topic CRUD、source registry、RSS source 绑定 | 可创建主题并绑定信源 | Phase 2/3 |
| 5 | Worker 抓取 | RSS fetch、item normalize、TaskRun、幂等/重试 | worker 可写入 items | Phase 4 |
| 6 | AI adapter/parser | OpenAI-compatible client、JSON 清洗、schema 校验 | mock 测试覆盖失败模式 | Phase 5 |
| 7 | 情报管线 | relevance/noise、event extraction、scoring、dedupe、ranking | 生成 `IntelligenceEvent` | Phase 6 |
| 8 | Dashboard MVP | 未读列表、详情、已读/收藏/忽略 | 替代旧 `index.html` | Phase 7 |
| 9 | 反馈学习 | feedback events、preference memory、解释文案 | 反馈影响后续排序/筛选 | Phase 8 |
| 10 | 简报导出 | daily briefing、Markdown export | 可导出 Obsidian-friendly Markdown | Phase 8/9 |
| 11 | 信源治理 | candidate/active/muted/rejected、质量报告 | 可审核候选源 | Phase 7 |
| 12 | 商业化基础 | auth、organization、membership、usage events | tenant scope 有测试 | Phase 8+ |
| 13 | GitHub → Railway 部署运维 | env docs、health check、Railway Web/Worker Cron/Source Discovery Cron、日志、备份和回滚 | GitHub 自动同步可触发 Railway Web、Worker Cron 和 Source Discovery Cron 部署，并完成生产验证 | Phase 8+ |
| 14 | Legacy cleanup | 归档/删除旧 Python 原型 | 主路径 TypeScript-only | 新栈稳定后 |
| 15 | 订阅制商业化 | Free/Plus/Pro 三层订阅、BYOK、Stripe/ccayment 支付、配额引擎、用量仪表板 | 用户可订阅、升级、管理 BYOK | Phase 12 |

## 5. 代码治理规则

- 默认开发分支使用 `main`，除非仓库后续明确新增分支策略。
- 以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准做设计；`README.md` / `README-en.md` 用于对外说明当前主路径和运行入口。
- 不提交 `.env`、密钥、token、`data/*`、生成 JSON、`.venv`、本地缓存。
- 新增环境变量必须同步 `.env_example` 和 `docs/L4-operations.md`。
- 修改目录、命令、数据流、数据库、worker、API、输出契约，必须按第 8 节"文档分层归属规则"同步对应文档层。
- LLM 输出一律视为不可信输入，后端 sanitize，前端安全渲染。
- 前端必须原生支持移动端：任何新增或修改的用户路径都要按 mobile-first 设计，320px/375px/414px 宽度下不得依赖桌面 hover、不得横向滚动，主要导航、筛选、表单和情报动作必须可单手触达且点击区不小于 44px。
- 抓取、AI、简报、导出等长任务必须放在 worker，不放进 request lifecycle。

### 5.1 GitHub / Railway 自动部署与 commit 治理

本仓库部署目标是 **GitHub 自动同步到 Railway**。当前 GitHub integration 已连接，默认生产形态为同一个 Railway project 中的 Web service、Worker Cron service、Source Discovery Cron service 和 Railway managed Postgres。后续开发应优先利用 Railway 的 GitHub 自动部署、Config as Code、Cron Jobs、managed Postgres、healthcheck、rollback、backup/PITR 和日志能力来简化运维，而不是把这些能力重新做进应用层。

每个 Railway service 应使用对应的 Config as Code 文件：

| Railway service | Config file | 目标 |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | Next.js App Router、Server Actions、export routes、`/api/health` |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | 定时执行 RSS fetch、analysis、briefing、source observation |
| Source Discovery Cron | `deploy/railway/source-discovery-cron.railway.json` | 周期执行候选信源发现 |

默认分支上的 commit / push 可能通过 GitHub 自动同步直接触发 Railway Web、Worker Cron 或 Source Discovery Cron 服务重新部署。

除非用户明确要求调研、迁移或补充社区部署方式，AI Agent 不应把 Vercel、Fly.io、VPS 或其他平台作为当前实现的一等部署目标；相关内容只能作为历史说明、对比信息或外部贡献者自选方案，不能反向约束当前 GitHub → Railway 主路径。

因此 AI Agent 必须遵守：

- 不把每个小修小改都默认 commit / push；只有重要功能更新、修复线上问题、数据库/部署/环境变量变更、用户明确要求发布，或已经完成一组可验证的阶段性改动时，才提交到默认分支。
- 仅文案微调、讨论中的方案草稿、未验证实验、临时调试、日志补充或本地排查产物，默认保持为未提交工作区改动，除非用户明确要求提交。
- 准备 commit 前必须说明本次提交是否会触发 Railway 自动部署，并确认改动已通过与风险相匹配的验证。
- 涉及数据库 migration、部署脚本、Railway 配置、GitHub Actions、环境变量或 worker 调度的提交，必须视为可触发生产影响的高风险变更，提交前至少完成 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`，并按变更类型补充 DB/worker/smoke 验证。
- 如果只是为了保存中间状态，应优先使用本地未提交改动或临时分支，不要推送到会触发自动部署的默认分支。

## 6. CommitLog 规则

Commit message 使用中文格式：

```text
类型:修改内容
```

常见类型：

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`
- `ci`
- `build`
- `perf`
- `security`
- `db`

示例：

```text
docs:初始化 AI Agent 协作规范
db:新增主题和信源数据模型
feat:实现主题创建页面
```

## 7. AGENTS_CHANGELOGS.md 规则

`AGENTS_CHANGELOGS.md` 替代 `CHANGELOG.md`，用于记录 AI Agent 工作审计日志。

每条记录至少包含：

```markdown
### <简短标题>

- Cause: 为什么要做这次修改
- Changed: 实际修改了什么
- Files: 涉及哪些文件
- Verification: 做了哪些验证
- Notes / Risk: 风险、备注或未完成事项
```

写入规则：

- 每次只读取 `AGENTS_CHANGELOGS.md` 前几行，判断顶部日期是否为当天。
- 如果是当天，把本次记录插入当天标题下方，保持倒序。
- 如果不是当天，在文件顶部新增当天日期，再插入记录。
- 用户要求“只讨论 / 不写文件”时，不更新。
- 不再更新 `CHANGELOG.md`。

## 8. 文档分层规则与阅读协议

代码结构文档采用 **L0-L4 分层结构**。L0/L1 是抽象层，留在 `CODEGUIDE.md` 主文件；L2/L3/L4 是细节层，拆到 `docs/` 下独立文件。

### 8.1 分层定义

| 层 | 回答的问题 | 内容 | 文件 | 变更频率 |
|---|---|---|---|---|
| **L0** | 系统长什么样 | 整体架构图、仓库布局清单、主干数据流、文档优先级表 | `CODEGUIDE.md` | 低 |
| **L1** | 为什么这样设计 | 分层依赖方向、worker 边界、tenant 边界、不可信输入处理、候选源隔离、反馈影响输出、幂等去重、安全隐私 | `CODEGUIDE.md` | 低 |
| **L2** | 系统处理什么 | 核心实体职责表、状态机、FeedbackKind 枚举、领域术语表、实体关系概览 | `docs/L2-domain.md` | 中 |
| **L3** | 具体怎么实现 | 目录结构树、每个包/目录职责、关键文件表、关键函数表、前端维护规则、Worker cycle 函数、调用链汇总 | `docs/L3-modules.md` | 高 |
| **L4** | 怎么跑起来 | 本地运行命令、验证四件套、Prisma 命令、Docker Postgres、Railway 部署、环境变量全表、测试入口、验证注意事项 | `docs/L4-operations.md` | 中 |

### 8.2 文档阅读协议

AI Agent 进入仓库工作时应按以下顺序阅读文档。

**进场必读**（建立全局认知）：

1. `AGENTS.md` — 协作规则、文档分层规则和阅读协议（本文件）
2. `SPEC.md` §1-3 — 产品定位、目标、核心原则
3. `CODEGUIDE.md` L0 — 系统架构全景
4. `CODEGUIDE.md` L1 — 设计原则与边界

**按任务按需读**（下钻细节）：

| 任务类型 | 先读 | 再读 |
|---|---|---|
| 新增/修改实体或状态机 | `docs/L2-domain.md` | `docs/L3-modules.md` 相关模块段 |
| 新增/修改模块或文件 | `docs/L3-modules.md` 相关模块段 | `docs/L4-operations.md` 命令验证 |
| 新增环境变量或部署变更 | `docs/L4-operations.md` | `.env_example` |
| 修改架构或依赖方向 | `CODEGUIDE.md` L1 | `CODEGUIDE.md` L0 |
| 修 bug | `docs/L3-modules.md` 相关模块段 + 调用链 | `docs/L2-domain.md` 相关状态机 |
| 新增/修改前端组件 | `FRONTEND.md` + `docs/L3-modules.md` §apps/web | `docs/L4-operations.md` 验证命令 |

**读取规则**：

- 先 L0/L1 建立全局认知，再下钻 L2/L3/L4。不要一进场就全量读 L3/L4。
- L0/L1 发生变更时，必须重新通读确认影响面。
- `CODEGUIDE.md` 底部的 L2/L3/L4 索引段提供每个文件的摘要和锚点链接，可用于快速定位。
- 修改代码后，按"文档分层归属规则"（§8.3）更新对应文档层。

### 8.3 文档分层归属规则

修改代码或仓库结构后，必须按以下归属表更新对应文档层。不要把 L3 文件级细节回灌到 L0/L1。

| 修改类型 | 更新位置 | 具体文件 |
|---|---|---|
| 新增/删除 package 或 app | L0 仓库布局 + L3 对应模块段 | `CODEGUIDE.md` §L0.2 + `docs/L3-modules.md` |
| 新增/修改依赖方向 | L1 分层依赖方向 | `CODEGUIDE.md` §L1.1 |
| 新增/修改 entity 或状态机 | L2 领域模型 | `docs/L2-domain.md` |
| 新增/修改关键文件或调用链 | L3 对应模块段 | `docs/L3-modules.md` |
| 新增/修改命令、环境变量、部署 | L4 操作运维 | `docs/L4-operations.md` + `.env_example` |
| 安全/边界/不可信输入规则 | L1 对应小节 | `CODEGUIDE.md` §L1 |
| 前端视觉/交互规则 | `FRONTEND.md` + L3 §apps/web | `FRONTEND.md` + `docs/L3-modules.md` |
| 移动端体验、响应式布局、导航/卡片触达 | `FRONTEND.md` + L3 §apps/web | `FRONTEND.md` + `docs/L3-modules.md` |
| 产品目标/数据模型方向 | `SPEC.md` | `SPEC.md` |
| AI Agent 协作流程/审计规则 | `AGENTS.md` | `AGENTS.md` |

### 8.4 文档维护原则

- **L0/L1 保持稳定**：只放抽象后的架构和原则，不塞文件级细节。L0/L1 变更意味着架构级调整，需要审慎。
- **L3/L4 随实现演进**：新增文件、修改函数签名、调整调用链、变更环境变量时同步更新。
- **不跨层混写**：不要在 L0 架构图里放 L3 文件表，也不要在 L3 模块段里放 L1 设计原则。
- **索引段保持最新**：`CODEGUIDE.md` 底部的 L2/L3/L4 索引段摘要必须与对应文件内容一致。如果 `docs/L3-modules.md` 新增了一个模块段，`CODEGUIDE.md` §L3 索引也要加一行。
- 新增、移动、删除文件后必须同步更新 L3（`docs/L3-modules.md`）和 `CODEGUIDE.md` §L3 索引段。

## 9. DEVELOPE_LOGS.md 规则

`DEVELOPE_LOGS.md` 是分阶段开发审计和延期功能追踪文件，辅助 `AGENTS_CHANGELOGS.md` 使用。

用途：

- 每个开发阶段完成后，记录该阶段审计。
- 追踪阶段内发现但不方便立即完整开发的缺失功能。
- 记录可接受瑕疵、已知风险和后续补齐建议。

每个阶段审计至少包含：

- Phase: 阶段编号和名称
- Scope: 本阶段实际完成范围
- Alignment: 是否符合 `REFACTOR_PLAN.md` 和 `AGENTS.md`
- Missing: 缺失功能或未完全实现内容
- Bugs: 已知 bug 或风险
- Fixes: 本阶段已修复的问题
- Verification: 验证命令和结果
- Follow-up: 后续阶段需要追踪的事项

如果用户提到 `CHANGELOGS.md`，在当前仓库语境中按 `AGENTS_CHANGELOGS.md` 理解；不要新建传统 release changelog。

## 10. 数据库和 Migration 规则

目标数据库为 Postgres + Prisma。

规则：

- Prisma schema 和 migrations 进入版本控制。
- 不直接手改生产数据库。
- schema 变更必须包含 migration、测试、查询层更新、`docs/L2-domain.md` 和 `docs/L3-modules.md` 更新。
- tenant-owned 数据预留 `organizationId`。
- user-specific state 预留 `userId`。
- usage events 记录 AI 调用、抓取、导出、简报生成等用量。
- MVP 可以使用默认 user / organization，不阻塞核心体验。

## 11. API / SDK / CLI / MCP 契约规则

- AI adapter 保持 OpenAI-compatible，不绑定单一 vendor。
- Next.js route handlers 用于外部 API、webhooks、export downloads、status endpoints。
- Server Actions 用于内部产品 mutations。
- Worker 负责抓取、AI 分析、简报、导出。
- API schema 变更必须同步类型、调用方、测试和 `docs/L3-modules.md`。
- 当前仓库没有 MCP/CLI 契约；后续新增时必须文档化输入、输出、认证、安全边界。

## 12. 安全与隐私规则

- 不提交密钥、token、cookie、私有数据库或生成数据。
- `.env_example` 只能放占位符。
- RSS、网页内容、LLM 输出全部按不可信输入处理。
- candidate sources 不得无标注进入正式简报。
- 导出内容必须保留来源链接和生成时间。
- 商业化阶段必须补 tenant isolation、权限测试、usage audit。
- 日志不得输出密钥、认证 URL、敏感 headers。

## 13. 测试、验证和发布规则

当前新栈最低验证：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

涉及 DB / worker / AI / UI 时补充：

```bash
Prisma migration test
worker fixture run
AI parser fixture test
Playwright single-topic smoke test
```

正式发布流程以 GitHub 自动同步到 Railway 为目标：Web、Worker Cron、Source Discovery Cron 和 Railway Postgres 必须有清晰的环境变量、health check、日志、备份、回滚和 smoke 验证说明，并同步 `docs/L4-operations.md` / `docs/deployment.md`。新增部署相关能力时，默认服务于 GitHub → Railway 主路径，并优先复用 Railway 平台能力；除非用户明确要求，不新增其他平台的一等部署说明。

## 14. 每轮任务结束前必须检查

固定检查：

- `AGENTS.md`
- `AGENTS_CHANGELOGS.md`
- `CODEGUIDE.md`（L0/L1）
- `docs/L2-domain.md`
- `docs/L3-modules.md`
- `docs/L4-operations.md`
- `DEVELOPE_LOGS.md`

按变更类型追加检查（按文档分层归属规则定位，见 §8.3）：

| 变更 | 检查 |
|---|---|
| 产品目标 | `SPEC.md`、`REFACTOR_PLAN.md` |
| 架构/目录/命令 | `CODEGUIDE.md` L0/L1 + `docs/L3-modules.md` + `docs/L4-operations.md` |
| 环境变量 | `.env_example`、`docs/L4-operations.md` |
| DB schema | Prisma migration、测试、`docs/L2-domain.md`、`docs/L3-modules.md` |
| API/输出契约 | 类型、调用方、测试、`docs/L3-modules.md` |
| 安全边界 | `SPEC.md`、测试、`CODEGUIDE.md` L1 |
| AI Agent 修改 | `AGENTS_CHANGELOGS.md` |
| 阶段完成/审计 | `DEVELOPE_LOGS.md` |

`CHANGELOG.md` 已废弃，不再作为任务结束检查项。
