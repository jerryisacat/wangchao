# CHANGELOG.md

本文件记录 `AI-News-Dashboard` 私有分支的重要变更，帮助维护者和 AI Agents 快速理解项目状态。

格式约定：

- 最新日期在最上方。
- 每次有意义的代码、文档或架构变更都作为独立段落记录。
- 每段说明因果链：为什么需要变更、具体改了什么、形成了什么边界或验证结果。
- 提交信息使用 Conventional Commits，并在提交中署名小咕。

## [Unreleased]

### 2026-07-06

**Private fork baseline**：因为原始公开仓库不能在 GitHub fork network 内直接变成 private fork，所以创建 `jerryisacat/AI-News-Dashboard` private mirror，保留 upstream remote 指向 `t0saki/AI-News-Dashboard`，origin 指向私有仓库。该边界让后续商业情报、财经雷达、数据资产机会监控等定制实验可以在私有仓库中推进，同时仍可按需从 upstream 拉取更新。

**Runtime safety hardening**：因为 L1/L2 AI 调用失败或 JSON 解析失败时，原主循环可能在同一个 cycle 反复处理同一批 `pending/l1_done` 项并形成死循环，所以 `main.py` 新增 `run_bounded_batches()`，并用 `MAX_L1_LOOPS`、`MAX_L2_LOOPS` 限制单轮 L1/L2 最大批次数。该变更让失败项目留到下一轮重试，避免 daemon 卡在 AI 故障路径，`.env_example` 同步新增相关配置。

**Database and ranking safety**：因为本地运行时 `data/` 不存在会导致 SQLite 初始化失败，所以 `database.py` 在连接前自动创建 DB parent directory，并让 `DB_PATH` 可通过环境变量覆盖。因为 L2 去重合并项会以 `l2_score=0` 写为 `processed`，所以 `get_recent_processed_news()` 现在过滤 `l2_score <= 0`，避免合并/丢弃项进入排行榜和 `dashboard.json`。

**Frontend XSS hardening**：因为 RSS 标题、来源、摘要以及 AI 生成内容都属于不可信输入，而 `index.html` 原先直接把这些字段插入 template string，所以前端新增 `escapeHtml()` 并在 URL、标题、摘要、分类、来源和原始标题渲染处统一转义。该变更降低公开静态部署时恶意 feed 或模型输出注入 HTML/脚本的风险。

**Regression tests and repository guide**：因为本次变更触及运行时循环、数据库初始化、排行榜过滤和前端安全边界，所以新增 `tests_runtime_safety.py` 覆盖 DB parent directory 创建、bounded batch loop、零分 processed item 过滤和前端 escape 约束。新增 `CODEGUIDE.md` 作为仓库结构手册，记录当前模块职责、数据流、环境变量、测试命令和维护规则。
