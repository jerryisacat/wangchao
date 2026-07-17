# AGENTS.md

> **⚠️ 开源仓库（MIT License）。** AI Agent 必须遵守：
> - 不得写入密钥、私有数据、商业策略或内部专有信息。
> - 文档和代码对开源社区友好，不假设内部上下文。
> - 用户要求写入不宜公开内容时，提醒并建议移到私有 fork。
> - `AGENTS_CHANGELOGS.md` 和 `DEVELOPE_LOGS.md` 是开发审计记录，不是产品文档。

本文件定义 AI Agent 在 `望潮（Wangchao）` 仓库中的协作规范。

## 1. 项目定位

`望潮（Wangchao）` 是一个主题驱动的 AI 情报系统：用户创建关注主题，系统自动发现和治理信源，抓取公开信息，通过 AI 完成相关性判断、事件抽取、去重、摘要、评分、简报生成，并通过阅读状态、反馈和导出行为学习偏好。

已开源（MIT License），商业化仅用于维护服务器运营，开源版本聚焦个人情报工作台体验。

## 2. 文档优先级

| 优先级 | 文件 | 规则 |
|---|---|---|
| 1 | `SPEC.md` | 产品目标、边界、数据模型的 source of truth。 |
| 2 | `REFACTOR_PLAN.md` | 技术选型、目标架构的核心依据。 |
| 3 | `AGENTS.md` | AI Agent 协作规则（本文件）。 |
| 4 | `CODEGUIDE.md`（L0+L1）+ `docs/L2-L4` | 代码结构、模块职责、数据流和命令说明，按 L0-L4 分层组织。 |
| 5 | `FRONTEND.md` | 前端视觉语言、交互规则、组件风格。 |
| 6 | `AGENTS_CHANGELOGS.md` | AI Agent 每轮修改审计日志。 |
| 7 | `DEVELOPE_LOGS.md` | 分阶段开发审计和延期功能追踪。 |
| 入口 | `README.md` / `README-en.md` | 用户入口说明，架构决策以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。 |

文档冲突时以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准。

## 3. 技术栈

| 层 | 选型 |
|---|---|
| Language | TypeScript |
| Package manager | `pnpm` |
| Monorepo | Turborepo |
| Web | Next.js App Router |
| UI | Tailwind CSS + shadcn/ui + lucide-react |
| DB | Postgres + Prisma |
| Worker | Node.js worker |
| AI | OpenAI-compatible adapter |
| Export | Markdown 优先，PDF 后置 |
| Deployment | GitHub → Railway：Web、Worker Cron、Source Discovery Cron、Report Cron、Instant Push Cron、Postgres |

## 4. 开发阶段

所有推荐阶段（0-15）已完成，阶段审计记录在 `DEVELOPE_LOGS.md`。后续功能迭代按独立 Issue 进行。

## 5. 代码治理规则

- 默认分支 `main`。
- 设计以 `SPEC.md` 和 `REFACTOR_PLAN.md` 为准；`README.md` 用于对外说明。
- 不提交 `.env`、密钥、token、`data/*`、生成 JSON、`.venv`、本地缓存。
- 新增环境变量同步 `.env_example` 和 `docs/L4-operations.md`。
- 修改目录、命令、数据流、DB、worker、API、输出契约，按 §8 文档分层归属规则同步对应文档层。
- LLM 输出一律视为不可信输入，后端 sanitize，前端安全渲染。
- 前端 mobile-first：320px/375px/414px 宽度下不依赖 hover、不横向滚动，点击区 ≥44px。
- 抓取、AI、简报、导出等长任务放在 worker，不进入 request lifecycle。

### 5.1 GitHub / Railway 部署与 commit 治理

部署目标：**GitHub 自动同步到 Railway**。当前 Railway project 包含以下 service：

| Railway service | Config file | 目标 |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | Next.js App Router、`/api/health` |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | 定时 RSS fetch、analysis、briefing、source observation |
| Source Discovery Cron | `deploy/railway/source-discovery-cron.railway.json` | 周期候选信源发现 |
| Report Cron | `deploy/railway/report-cron.railway.json` | 扫描 PENDING 状态的 Report 并生成 |
| Instant Push Cron | `deploy/railway/instant-push-cron.railway.json` | 高分情报即时推送 |

Commit 规则：
- 不把小修改默认 commit/push；只有重要功能更新、线上修复、DB/部署/环境变量变更、用户明确要求发布时才提交到 `main`。
- 仅文案微调、草稿、实验、临时调试产物保持未提交，除非用户明确要求。
- 准备 commit 前说明是否触发 Railway 自动部署，确认验证通过。
- 涉及 DB migration、Railway 配置、环境变量或 worker 调度的提交，视为高风险变更，提交前完成 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check` 并补充 DB/worker/smoke 验证。
- 保存中间状态用本地未提交改动或临时分支，不推送到 `main`。

### 5.2 API Key 与凭证管理

- API Key 通过 Admin 后台 `/admin/settings` 配置，环境变量仅作为 DB 未配置时的 fallback。
- 数据库中使用 AES-256-GCM 加密存储，加密密钥来自 `ENCRYPTION_KEY` 环境变量。
- Admin 后台不显示完整 Key，仅展示脱敏 hint（如 `sk-...xyz`）。
- Worker 运行时从 DB 读取并解密 → 注入 adapter → 调用完成后丢弃明文，不写入日志。

## 6. CommitLog 规则

Commit message 使用中文格式 `类型:修改内容`。

常见类型：`feat` `fix` `docs` `refactor` `test` `chore` `ci` `build` `perf` `security` `db`

## 7. AGENTS_CHANGELOGS.md 规则

每条记录至少包含：Cause、Changed、Files、Verification、Notes / Risk。

写入规则：
- 读取前几行判断顶部日期是否为当天；当天则插入当天标题下方（倒序），否则新增当天日期。
- 用户要求"只讨论 / 不写文件"时不更新。
- 不再更新 `CHANGELOG.md`。

## 8. 文档分层与阅读协议

代码结构文档采用 **L0-L4 分层**。L0/L1 在 `CODEGUIDE.md`，L2/L3/L4 在 `docs/` 下。

| 层 | 回答的问题 | 文件 |
|---|---|---|
| **L0** | 系统长什么样 | `CODEGUIDE.md` |
| **L1** | 为什么这样设计 | `CODEGUIDE.md` |
| **L2** | 系统处理什么 | `docs/L2-domain.md` |
| **L3** | 具体怎么实现 | `docs/L3-modules.md` |
| **L4** | 怎么跑起来 | `docs/L4-operations.md` |

### 8.1 阅读协议

**进场必读**：`AGENTS.md` → `SPEC.md` §1-3 → `CODEGUIDE.md` L0 → `CODEGUIDE.md` L1

**按任务按需读**：

| 任务类型 | 先读 | 再读 |
|---|---|---|
| 实体/状态机 | `docs/L2-domain.md` | `docs/L3-modules.md` 相关段 |
| 模块/文件 | `docs/L3-modules.md` 相关段 | `docs/L4-operations.md` |
| 环境变量/部署 | `docs/L4-operations.md` | `.env_example` |
| 架构/依赖 | `CODEGUIDE.md` L1 | `CODEGUIDE.md` L0 |
| Bug | `docs/L3-modules.md` + 调用链 | `docs/L2-domain.md` 状态机 |
| 前端组件 | `FRONTEND.md` + `docs/L3-modules.md` §apps/web | `docs/L4-operations.md` |

### 8.2 文档分层归属规则

修改代码后按以下归属表更新对应文档层。不跨层混写。

| 修改类型 | 更新文件 |
|---|---|
| 新增/删除 package 或 app | `CODEGUIDE.md` §L0.2 + `docs/L3-modules.md` |
| 依赖方向 | `CODEGUIDE.md` §L1.1 |
| entity 或状态机 | `docs/L2-domain.md` |
| 关键文件/调用链 | `docs/L3-modules.md` |
| 命令、环境变量、部署 | `docs/L4-operations.md` + `.env_example` |
| 安全/边界 | `CODEGUIDE.md` §L1 |
| 前端/交互/移动端 | `FRONTEND.md` + `docs/L3-modules.md` §apps/web |
| 产品目标 | `SPEC.md` |
| AI Agent 流程 | `AGENTS.md` |

维护原则：
- L0/L1 只放抽象架构和原则，不放文件级细节。L0/L1 变更需审慎。
- L3/L4 随实现演进同步更新。
- 新增、移动、删除文件后同步更新 `docs/L3-modules.md` 和 `CODEGUIDE.md` §L3 索引段。

## 9. 数据库规则

- Prisma schema 和 migrations 进入版本控制，不手改生产数据库。
- schema 变更必须包含 migration、测试、查询层更新、`docs/L2-domain.md` 和 `docs/L3-modules.md` 更新。
- tenant-owned 数据预留 `organizationId`，user-specific state 预留 `userId`。

## 10. API 契约规则

- AI adapter 保持 OpenAI-compatible，不绑定单一 vendor。
- Next.js route handlers 用于外部 API、webhooks、export downloads、status endpoints。
- Server Actions 用于内部产品 mutations。
- Worker 负责抓取、AI 分析、简报、导出。
- API schema 变更必须同步类型、调用方、测试和 `docs/L3-modules.md`。

## 11. 安全与隐私规则

- 不提交密钥、token、cookie、私有数据库或生成数据。
- `.env_example` 只能放占位符。
- RSS、网页内容、LLM 输出全部按不可信输入处理。
- candidate sources 不得无标注进入正式简报。
- 导出内容必须保留来源链接和生成时间。
- 日志不得输出密钥、认证 URL、敏感 headers。
- API Key 凭证管理遵循 §5.2。

## 12. 测试、验证和发布规则

最低验证：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

涉及 DB / worker / AI / UI 时补充：Prisma migration test、worker fixture run、AI parser fixture test、Playwright smoke test。

## 13. 任务结束检查

固定检查：`AGENTS.md`、`AGENTS_CHANGELOGS.md`、`CODEGUIDE.md`（L0/L1）、`docs/L2-domain.md`、`docs/L3-modules.md`、`docs/L4-operations.md`、`DEVELOPE_LOGS.md`

按变更类型追加检查（按 §8.2 归属规则定位）：

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