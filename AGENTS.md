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
| 3 | `AGENTS.md` | AI Agent 协作规则。 |
| 4 | `CODEGUIDE.md` | 当前代码结构、模块职责、数据流和命令说明。 |
| 5 | `AGENTS_CHANGELOGS.md` | AI Agent 每轮修改审计日志。 |
| 6 | `DEVELOPE_LOGS.md` | 分阶段开发审计和延期功能追踪。 |
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
| 13 | 部署运维 | env docs、health check、worker deploy、日志 | web/worker 可部署 | Phase 8+ |
| 14 | 订阅制商业化 | Free/Plus/Pro 三层订阅、BYOK、Stripe/ccayment 支付、配额引擎、用量仪表板 | 用户可订阅、升级、管理 BYOK | Phase 12 |

## 5. 代码治理规则

- 默认开发分支使用 `main`，除非仓库后续明确新增分支策略。
- 以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准做设计；`README.md` / `README-en.md` 用于对外说明当前主路径和运行入口。
- 不提交 `.env`、密钥、token、`data/*`、生成 JSON、`.venv`、本地缓存。
- 新增环境变量必须同步 `.env_example` 和 `CODEGUIDE.md`。
- 修改目录、命令、数据流、数据库、worker、API、输出契约，必须同步 `CODEGUIDE.md`。
- LLM 输出一律视为不可信输入，后端 sanitize，前端安全渲染。
- 抓取、AI、简报、导出等长任务必须放在 worker，不放进 request lifecycle。

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

## 8. CODEGUIDE.md 规则

`CODEGUIDE.md` 记录代码结构，不记录发布日志。

必须覆盖：

- 每个目录职责
- 重要文件目的
- 模块依赖关系
- 关键数据流
- 关键调用链
- 常用命令
- 测试/验证入口
- 环境变量
- 安全边界

新增、移动、删除文件后必须同步更新。Node.js 重构落地后，`CODEGUIDE.md` 应从 Python 原型结构改为 monorepo 结构。

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
- schema 变更必须包含 migration、测试、查询层更新、`CODEGUIDE.md` 更新。
- tenant-owned 数据预留 `organizationId`。
- user-specific state 预留 `userId`。
- usage events 记录 AI 调用、抓取、导出、简报生成等用量。
- MVP 可以使用默认 user / organization，不阻塞核心体验。

## 11. API / SDK / CLI / MCP 契约规则

- AI adapter 保持 OpenAI-compatible，不绑定单一 vendor。
- Next.js route handlers 用于外部 API、webhooks、export downloads、status endpoints。
- Server Actions 用于内部产品 mutations。
- Worker 负责抓取、AI 分析、简报、导出。
- API schema 变更必须同步类型、调用方、测试和 `CODEGUIDE.md`。
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

当前没有正式发布流程。新增部署后必须补充环境变量、worker health、日志、回滚策略和 `CODEGUIDE.md`。

## 14. 每轮任务结束前必须检查

固定检查：

- `AGENTS.md`
- `AGENTS_CHANGELOGS.md`
- `CODEGUIDE.md`
- `DEVELOPE_LOGS.md`

按变更类型追加检查：

| 变更 | 检查 |
|---|---|
| 产品目标 | `SPEC.md`、`REFACTOR_PLAN.md` |
| 架构/目录/命令 | `CODEGUIDE.md` |
| 环境变量 | `.env_example`、`CODEGUIDE.md` |
| DB schema | Prisma migration、测试、`CODEGUIDE.md` |
| API/输出契约 | 类型、调用方、测试、`CODEGUIDE.md` |
| 安全边界 | `SPEC.md`、测试 |
| AI Agent 修改 | `AGENTS_CHANGELOGS.md` |
| 阶段完成/审计 | `DEVELOPE_LOGS.md` |

`CHANGELOG.md` 已废弃，不再作为任务结束检查项。
