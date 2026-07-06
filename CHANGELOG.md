# CHANGELOG.md

> Deprecated: 本文件已废弃，不再继续维护。AI Agent 每轮修改审计请记录到 `AGENTS_CHANGELOGS.md`；项目当前技术路线以 `REFACTOR_PLAN.md` 为准。

本文件记录 `望潮（Wangchao）` 私有分支的重要变更，帮助维护者和 AI Agents 快速理解项目状态。

格式约定：

- 最新日期在最上方。
- 每次有意义的代码、文档或架构变更都作为独立段落记录。
- 每段说明因果链：为什么需要变更、具体改了什么、形成了什么边界或验证结果。
- 提交信息使用 Conventional Commits，并在提交中署名小咕。

## [Unreleased]

### 2026-07-06

**Node.js refactor plan and commercialization boundary**：因为下一阶段重构方向已经从 Python 本地原型转向 Node.js / TypeScript / Next.js / Postgres / Prisma 的产品化架构，并需要为未来多租户商业化预留空间，所以新增 `REFACTOR_PLAN.md`，记录目标技术栈、monorepo 结构、worker 边界、数据模型、绿地重构阶段、测试验证和主要风险。由于当前 fork 没有真实用户和生产数据，计划明确不需要 Python 过渡层或兼容迁移，旧 Python 实现只作为行为参考。`SPEC.md` 同步将“商业化、多租户、团队权限和付费系统”从长期非目标调整为 MVP 后续阶段能力：当前仍优先跑通个人/单用户主题情报工作台，但数据模型和工程边界需要预留 user / organization / membership / usage event 等商业化基础。

**CI/Docker cleanup**：因为望潮下一阶段会基于新版 SPEC 重新设计运行、部署和自动化流程，现有 upstream 遗留的 Docker 镜像构建、GHCR 发布 workflow、容器入口脚本和旧 AI 编程指南都不应继续约束项目，所以删除 `.github/workflows/docker-publish.yml`、`Dockerfile`、`.dockerignore`、`start.sh` 与 `CLAUDE.md`，并同步清理 README / README-en / CODEGUIDE 中的 CI、Docker 和旧 AI 编程指南引用。

**AI coding files cleanup**：因为下一阶段需要重新生成仓库级 AI 编程指南，避免旧 Claude Code 指南继续约束后续开发，所以删除根目录 `CLAUDE.md`，并同步从 README 导航与 CODEGUIDE 目录树中移除相关条目。后续如需 AI 编程规则，应基于新版 SPEC 和重构目标重新生成。

**Product rename to 望潮**：因为产品定位已经从新闻 Dashboard 演进为“在信息潮汐中追踪主题信号”的个人情报 Agent，所以将产品名确定为 `望潮（Wangchao）`，并同步更新 README、SPEC、CODEGUIDE、CLAUDE、前端标题、Python project name、Docker image name 和启动日志。GitHub 私有仓库也将从 `jerryisacat/AI-News-Dashboard` 重命名为 `jerryisacat/wangchao`，保留 upstream 指向原始公开仓库。

**Target product SPEC rewrite**：因为后续产品开发与重构应围绕“主题驱动、自动信源发现、用户反馈学习、阅读状态管理和知识沉淀”的目标形态，而不是被当前 RSS + 静态 Dashboard 原型限制，所以重写 `SPEC.md` 为目标产品规格。新版 SPEC 将产品定义为“主题情报雷达”，明确用户以自然语言创建关注主题，系统自动发现和评估信源、持续抓取公开信息、生成每日主题简报，并根据已读、收藏、忽略、反馈和导出行为更新偏好记忆。`CODEGUIDE.md` 同步调整维护规则：当前代码应视为可重构的引擎原型，后续开发以 SPEC 的目标产品形态为准。

**SPEC documentation baseline**：因为私有分支需要一个面向产品与技术设计的 source of truth，所以新增 `SPEC.md`，按当前代码而非未来设想梳理项目目标与边界、用户/运行角色、核心工作流、SQLite 数据模型与状态机、RSS 信源处理、L1/L2 两阶段 AI 处理、Gravity Ranking、JSON/静态前端输出、配置、运行部署、测试验证、安全可信边界、当前限制和后续演进建议。`CODEGUIDE.md` 同步标记 `SPEC.md` 为产品规格入口，后续修改数据流、状态机、输出 schema 或安全边界时需要同步更新。

**README repositioning**：因为私有分支的目标已经从单纯 AI 新闻 Dashboard 扩展为商业财经、数据资产机会和行业风险等垂直情报雷达，所以重写 `README.md`，明确项目定位为“RSS/公开信息源 → AI 筛选/摘要/打标/排序 → 结构化情报输出”的通用管线。README 同步记录私有分支增强、核心配置、Prompt 定制方式、输出格式、测试命令、后续 single-run/Hermes cron/Obsidian/Telegram 改造方向，以及 upstream 授权边界注意事项。

**Private fork baseline**：因为原始公开仓库不能在 GitHub fork network 内直接变成 private fork，所以创建 `jerryisacat/AI-News-Dashboard` private mirror，保留 upstream remote 指向 `t0saki/AI-News-Dashboard`，origin 指向私有仓库。该边界让后续商业情报、财经雷达、数据资产机会监控等定制实验可以在私有仓库中推进，同时仍可按需从 upstream 拉取更新。

**Runtime safety hardening**：因为 L1/L2 AI 调用失败或 JSON 解析失败时，原主循环可能在同一个 cycle 反复处理同一批 `pending/l1_done` 项并形成死循环，所以 `main.py` 新增 `run_bounded_batches()`，并用 `MAX_L1_LOOPS`、`MAX_L2_LOOPS` 限制单轮 L1/L2 最大批次数。该变更让失败项目留到下一轮重试，避免 daemon 卡在 AI 故障路径，`.env_example` 同步新增相关配置。

**Database and ranking safety**：因为本地运行时 `data/` 不存在会导致 SQLite 初始化失败，所以 `database.py` 在连接前自动创建 DB parent directory，并让 `DB_PATH` 可通过环境变量覆盖。因为 L2 去重合并项会以 `l2_score=0` 写为 `processed`，所以 `get_recent_processed_news()` 现在过滤 `l2_score <= 0`，避免合并/丢弃项进入排行榜和 `dashboard.json`。

**Frontend XSS hardening**：因为 RSS 标题、来源、摘要以及 AI 生成内容都属于不可信输入，而 `index.html` 原先直接把这些字段插入 template string，所以前端新增 `escapeHtml()` 并在 URL、标题、摘要、分类、来源和原始标题渲染处统一转义。该变更降低公开静态部署时恶意 feed 或模型输出注入 HTML/脚本的风险。

**Regression tests and repository guide**：因为本次变更触及运行时循环、数据库初始化、排行榜过滤和前端安全边界，所以新增 `tests_runtime_safety.py` 覆盖 DB parent directory 创建、bounded batch loop、零分 processed item 过滤和前端 escape 约束。新增 `CODEGUIDE.md` 作为仓库结构手册，记录当前模块职责、数据流、环境变量、测试命令和维护规则。
