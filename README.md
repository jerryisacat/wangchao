# 望潮 Wangchao

[English](README-en.md)

`望潮（Wangchao）` 是一个主题驱动的 AI 情报系统。用户创建关注主题，系统围绕主题管理信源、抓取公开信息、生成情报事件、学习反馈偏好，并输出 Dashboard 与 Markdown 简报。

当前版本以 TypeScript monorepo 为主路径，面向个人情报工作台部署和使用。旧 Python RSS 原型保存在 `legacy/python-prototype/`，仅作为历史参考。

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
  deployment.md        部署运维说明
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
- `legacy/python-prototype/` 仅作为历史参考保留，不参与当前运行路径。

## 参考文档

- `SPEC.md`: 产品目标和边界。
- `REFACTOR_PLAN.md`: Node.js/TypeScript 重构路线。
- `CODEGUIDE.md`: 当前代码结构和维护规则。
- `docs/deployment.md`: 部署、健康检查、日志和回滚说明。
