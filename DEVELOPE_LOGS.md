# DEVELOPE_LOGS.md

本文件记录分阶段开发审计和延期功能追踪，辅助 `AGENTS_CHANGELOGS.md` 使用。它不是传统 release changelog；重点是记录每个阶段是否达成 `REFACTOR_PLAN.md` 和 `AGENTS.md` 目标、缺失功能、已知问题、修复情况和后续追踪项。

## 2026-07-11

## Phase 11: 信源治理（#10, #11）

- Phase: 11 — 信源发现与治理增强
- Scope: 多 provider 搜索、专用适配器、批量治理、候选源观察到期、Worker auto-mute
- Alignment: 符合 REFACTOR_PLAN.md Phase 11 信源治理目标和 SPEC.md 信源治理要求
- Missing: Playwright 手动 discovery 点击流（后续补充）；Tavily/Serper 真实 API key 测试
- Bugs: 无
- Fixes: 无
- Verification: pnpm typecheck, pnpm lint, pnpm test, pnpm build 全部通过
- Follow-up: SearXNG 自建实例部署文档；信源质量报告与治理 UI 更深度联动

### Wave 3：Railway 运维闭环（#19 + #20 + #21 + #22 + #23 + #24 + #15 + #3）

- Phase: Phase 13 (GitHub → Railway 部署运维)
- Scope: Worker 结构化日志（cycle-start/cycle-end JSON with type/duration/status/counters）；GitHub→Railway 主路径文档固化（`railway up` 降级为紧急 fallback）；Railway 运维 runbook（Cron 观测、排障、Postgres backup/PITR、migration 前检查、forward-compatible 原则、发布验证、HTTP smoke、回滚策略、环境变量矩阵、secret 最小化暴露）；Turborepo filtered build 脚本（可选优化，保留完整构建为安全默认）；HTTP smoke 脚本（无 Chromium 依赖）；GitHub Actions CI workflow（lint/typecheck/build/test/db validate）。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 13 和 `AGENTS.md` §5.1（GitHub → Railway 主路径）、§12（安全与隐私）、§13（测试验证发布）。三个 Railway service 的 Config as Code 保持 service-level 独立 config，root `railway.json` 仅用于 `railway up` fallback。环境变量矩阵明确 `DATABASE_URL` 通过 service reference 注入，AI/Search secret 按 service 最小化暴露。
- Missing: Worker Cron 和 Source Discovery Cron 需在 Railway dashboard 确认 cron 已启用（代码和 config 就绪，需运维操作）。Postgres backup 频率和保留期需在 Railway dashboard 确认。恢复演练需执行一次并记录。集中错误上报（Sentry 等）未接入。Playwright smoke 未在 CI 中运行（需 Chromium + Postgres）。Railpack filtered build 尚未在 Railway staging 验证 runtime `dist/` 完整性，暂不切换。
- Bugs: 无已知 bug。Worker stdout 输出格式从 pretty JSON 变为单行 JSON per event，下游如有解析需适配。
- Fixes: Worker 入口重写为结构化日志，每次 cycle 输出 `cycle-start` + `cycle-end` 两行 JSON，包含 cycle type、timestamp、durationMs、status 和全部计数器。Worker entry 从直接 `process.stdout.write(JSON.stringify(result, null, 2))` 变为 `emitStructuredLogEnd(cycleType, startTime, status, { result })`。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。`node scripts/http-smoke-check.mjs` ✓（6/6 build artifacts）。`pnpm railway:build:web` ✓（6 tasks）。`pnpm railway:build:worker` ✓（5 tasks）。
- Follow-up: 在 Railway dashboard 中为 Worker Cron 和 Source Discovery Cron 启用 cron job（§2.2 步骤）。确认 Postgres backup 频率/保留期（§4.1）。执行一次恢复演练（§4.4）。在 Railway staging 验证 filtered build runtime `dist/` 完整性后切换 build command（§1.5）。后续考虑在 CI 中加入 Playwright smoke（需 Chromium + Postgres service）。

### Wave 2：简报/导出/时间线（#28 + #8 + #4）

- Phase: Cross-phase / Phase 7 (情报管线) + Phase 8 (Dashboard MVP) + Phase 10 (简报导出)
- Scope: 实现周报/月报周期性简报生成（Worker cycle + 幂等 + Markdown renderer）、主题时间线页面（`listTimelineEvents` + Web UI）、Obsidian-friendly 导出文件名、主题批量导出、简报中心周期筛选 tabs。Playwright smoke 在 Docker Postgres 环境中跑通 `web.spec.ts`（8 pass / 6 skip）。
- Alignment: 符合 `SPEC.md` 5.7（主题时间线）、5.8（周报/月报）、7.5（周期性简报）和 `REFACTOR_PLAN.md` Phase 8/10。简报生成在 Worker 边界内执行；时间线查询只使用 ACTIVE source 产生的正式事件；导出记录 `ExportEvent` 审计。
- Missing: PDF 导出继续后置（由后续 Issue 跟踪）；Obsidian Local REST API 未实现（当前仅文件名优化）；`responsive.spec.ts` 有 pre-existing failure（top-nav 控件 <44px，需 CSS 修复，非本次改动引入）。
- Bugs: 无已知 bug。周报/月报在每次 fetch cycle 自动生成（幂等 upsert），Worker 调度频率变化不影响正确性。
- Fixes: 无。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。Playwright `web.spec.ts` ✓（8 pass / 6 skip）。

### Wave 1：核心信息管线增强（#26 + #30 + #27）

- Phase: Cross-phase / Phase 5 (Worker 抓取) + Phase 6 (AI adapter) + Phase 7 (情报管线) + Phase 10 (简报)
- Scope: 实现原文全文抓取（`fetchArticleContent` + readability）、Topic Profile 语言偏好与简报风格完整消费链（UI → 保存 → AI prompt → briefing renderer）、手动重新生成摘要（Server Action + UI + 频率限制）。
- Alignment: 符合 `SPEC.md` 4.1（Topic Profile 七组字段）、5.4（AI 分析使用全文）、5.8（简报风格可控）和 `REFACTOR_PLAN.md` Phase 5/6/7。原文抓取在 Worker 边界内执行，不进入 request lifecycle；LLM 输出仍视为不可信输入；语言偏好和简报风格都有文档化的默认值和旧数据兼容策略。
- Missing: Playwright smoke 未覆盖新增的"重新生成摘要"按钮（由 #4 跟踪）；原文抓取未做 robots.txt 尊重（当前仅做超时和内容长度限制）；`languagePreferences` 只支持 `zh-CN` 和 `en` 两种输出语言。
- Bugs: 无已知 bug。
- Fixes: 无。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。
- Follow-up: Playwright smoke 覆盖（#4）；原文抓取 robots.txt 尊重可在后续迭代补充；更多输出语言选项可按需扩展。

### SPEC/README 实现一致性审计 Round 8：画像范围的 deterministic relevance

- Phase: Cross-phase / Phase 6 AI adapter fallback + Phase 7 intelligence pipeline
- Scope: 验证用户可编辑的 entities/include/exclude/importance 是否在无 AI 和 AI 失败路径真正生效，规则原因是否持久化，以及 fallback event 是否保留实体。
- Alignment: excludeScope 现在是明确最高优先级否决；keyword/entity/includeScope 是分开计分且可追溯的正信号；规则只做短语包含，不声称理解自然语言 importance。决策、TaskRun、Item filter metadata 和 Event explanation 形成完整证据链。
- Missing: deterministic importance rule parser 不适合在无契约时臆测，当前 importanceRules 由 AI extraction 消费。#5 已关闭且 LLM relevance/extraction 主链路已存在；没有从本轮证据推导新的模糊“校准”Issue。
- Bugs: profile 三组字段完全不进入 fallback；exclude 与关键词同时命中仍会创建事件；fallback entities 固定空数组；filtered Item/TaskRun 丢失具体 rule 或 LLM noiseReason；编辑页文案错误暗示所有字段进入所有阶段。
- Fixes: 扩展 decision 信号、exclude veto、entity/include scoring、fallback category/entities/explanation、Web 中文解释与 Worker reason persistence；同步 SPEC/README 和 L1-L4/FRONTEND 边界。
- Verification: db validate、全仓 typecheck/lint/test、主体修改后的全仓 build、Playwright discovery 和 diff check 通过；最终 helper/fixture 增量由 typecheck/lint/test 覆盖，二次根 build 因 Codex 使用额度门禁未启动，具体边界见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮可审计 Item contentHash/canonicalUrl 去重是否真实阻止重复写入，或导出对象覆盖；完全缺失项继续先查现有 #8/#28 等 Issues。

### SPEC/README 实现一致性审计 Round 7：主题画像编辑与分析输入

- Phase: Cross-phase / Phase 4 Topic management + Phase 6 AI adapter/parser
- Scope: 验证创建时生成的 Topic Profile 是否可真实编辑、保存是否进入规则/发现/AI 消费路径、Topic identity 是否正确进入 extraction，以及 mutation 是否保留 tenant boundary。
- Alignment: keywords/entities/include/exclude/importance 已具备可读取、可编辑、校验、持久化和 Worker 消费闭环；规则 relevance/source discovery 继续读取 keywords，AI extraction 读取完整画像与 Topic 当前 identity。更新由 membership + organization-scoped Prisma where 双层约束。
- Missing: languagePreferences/digestStyle 没有任何数据契约或消费方，查重后新建 #30；不在本轮臆测结构。现有规则 fallback 只按 keywords 判定，不声称 include/exclude 已进入 deterministic scoring。
- Bugs: 编辑页文案声称关键词自动重匹配但 Action 不更新 profile；AI extraction 从不存在的 profile.name/description 取值且声明的 sourceName 从未查询；updateTopic 只按 id 更新；空 description 不能清除。
- Fixes: 增加五组画像编辑和输入边界；保留未知 JSON 字段；新增 tested context sanitizer；analysis query 读取 Topic identity；Worker 改用统一 context；update 加 organization scope；补 fixtures、UI 契约和分层文档。
- Verification: db validate、全仓 typecheck/lint/test/build、Playwright discovery、desktop/mobile Topic 编辑、六宽度响应式矩阵、320px 视觉检查和 diff check 通过；临时 Postgres 数据流与环境型首次失败详情见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮可审计规则 relevance 的 include/exclude 语义、AI/规则结果一致性或继续深挖导出对象覆盖；#30 负责 language/digest 完整闭环。

### SPEC/README 实现一致性审计 Round 6：类别反馈与 Topic 偏好隔离

- Phase: Cross-phase / Phase 8 Dashboard + Phase 9 feedback learning
- Scope: 核对 FeedbackKind 八个枚举是否都有真实入口/消费，PreferenceMemory 是否按 Topic 隔离，以及 README 所述“反馈影响下一轮排序”是否形成可执行闭环。
- Alignment: `CATEGORY_UP/DOWN` 现由详情页真实写入、规则归纳、即时 upsert 并参与 Dashboard 权重；显式类别反馈只改变 category，事件状态与 source preference 保持独立。所有 delta 按 `topicId + key` 分组，符合 SPEC 的 topic preference 边界和可解释要求。
- Missing: source_good/bad、score_too_high/low、track/mute entity、note，LLM 归纳、时间衰减、历史/编辑和 Worker relevance 应用仍由 #7 追踪；`SOURCE_APPROVE/REJECT` 当前用于治理审计而非 PreferenceMemory 归纳，不把其含义臆测为个人来源偏好。
- Bugs: `CATEGORY_UP/DOWN` 只有 schema/docs 无入口无查询；跨 Topic 同名 category 共享一个归纳 Map key，可能抵消信号并写入错误 topic；详情页“减少这类”实际执行的是 dismiss，文案混淆事件状态与类别偏好。
- Fixes: 新增 category up/down Server Action/repository/UI 与用量审计，学习链读取并只生成 category delta；复合分组隔离 Topic；dismiss 改名“忽略此条”；补 core/db fixtures、Playwright 入口断言和分层文档。
- Verification: db validate、全仓 typecheck/lint/test/build、Playwright test discovery 和 diff check 全部通过；core/db fixture 与 UI 契约覆盖范围、Turbopack 沙箱重跑说明见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮继续沿 SPEC/README 反查主题画像编辑、分析输入与保存契约，或深挖 export/briefing 的承诺边界；#7 保持 open 直至其增强验收标准完整满足。

### SPEC/README 实现一致性审计 Round 5：信源质量指标与工作区审计

- Phase: Cross-phase / Phase 7 event dedupe + Phase 11 source governance + Phase 12 usage boundary
- Scope: 验证 README 的 hit/noise/duplicate 是否由真实多来源关系产生，标题 fuzzy dedupe 是否确实只保留一个活跃事件，以及“工作区成员/用量审计”是否有可发现、受权限约束的页面而非 unused loader 数据。
- Alignment: 多来源合并现在同时维护 IntelligenceEvent、EventItem role 和 Item status 三层不变量；质量报告从未归档关系计算，符合 SPEC 的来源表现/重复率治理目标。成员/用量通过 dedicated OWNER/ADMIN loader 和页面展示，保持 organization scope，并明确只做个人版事实审计，不冒充 Phase 15 配额/账单。
- Missing: 质量趋势图、批量治理、候选源低频观察/到期提醒仍由 #10 追踪；订阅周期、额度、拦截原因和账单由 #14 追踪。历史已创建的重复 IntelligenceEvent 没有一次性全库修复 migration，但当前 semantic dedup 与关系口径可继续收敛新数据；仓库没有真实用户/兼容承诺，不在本轮臆测生产数据修复策略。
- Bugs: fuzzy title 命中后仍按新 hash upsert 导致第二条 event；旧/new primary 的 EventItem role 不同步；semantic merge 用 stale keepEvent snapshot 检查 relation，多个 merge event 可能撞唯一键；Item 从未进入 DUPLICATE，导致治理重复率恒 0；成员/用量每次主工作台查询却完全不展示。
- Fixes: fuzzy 分支按已有 id 更新并同步主次角色/状态；semantic relation 改 upsert、标记合并 Item 并清除归档旧事件的匹配 hash；source report 以 active relation 计算 hit/duplicate/eventCount；新增 `/admin/usage` 与设置入口、OWNER/ADMIN 守卫、30 天 type/unit 汇总；删除主工作台的无用成员/用量查询；补 DB fixtures、浏览器交互和响应式覆盖。
- Verification: 全仓 db validate/typecheck/lint/test/build、Playwright discovery 和 diff check 通过；临时 Postgres 验证 fuzzy/semantic/指标/usage 数据；生产构建浏览器验证 desktop/mobile、六宽度矩阵和 network-idle screenshot，具体数值见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮审计反馈学习是否真正覆盖 README/SPEC 声明的信号、衰减与分析阶段应用，重点检查 FeedbackKind 枚举是否存在无入口/无消费的壳；完全缺失项先与 #7 查重。

### SPEC/README 实现一致性审计 Round 4：全管线 TaskRun 与失败调用计量

- Phase: Cross-phase / Phase 5-10 worker pipeline + Phase 12 usage audit boundary
- Scope: 验证 schema 中六类 TaskRun 是否都有真实写入者，LLM extraction 失败后规则 fallback 是否仍保留错误证据，AI UsageEvent 是否漏记失败调用，以及 Markdown export 是否同时具备 ExportEvent、UsageEvent 和任务状态。
- Alignment: fetch/discovery/relevance/extraction/briefing/export 现在都通过同一 tenant-scoped TaskRun 生命周期记录 timing、attempt、output/error；符合 `REFACTOR_PLAN.md` 对 durable worker task status/errors/timing 的要求。分析失败可以降级但不会被伪装成“从未调用 AI”，符合 SPEC 的可解释、可审计边界。
- Missing: 当前没有 DB queue consumer，`PENDING`/`CANCELED` 仍是预留状态；进程被 SIGKILL/容器强杀时可能遗留 RUNNING，Web 也没有任务历史页。上述 Railway Cron + 应用 TaskRun 观测闭环由既有 Issue #20 继续追踪。
- Bugs: 四个 TaskRunType 枚举没有任何调用方；LLM extraction 失败只写 stderr；analysis/semantic dedup/source recommendation 的 AI_CALL 计量只覆盖成功结果；简报无事件时没有 durable skipped 证据；Markdown export 只有 ExportEvent/UsageEvent，没有成功/失败任务状态。
- Fixes: 增加通用 `createTaskRun()`；分析建立外层 relevance 与可选 extraction TaskRun；fallback 保留 failed extraction + successful relevance；简报按主题记录 upsert/skipped；两条 Markdown route 记录 export TaskRun；AI 用量改为逻辑 adapter 调用数并附成功/fallback metadata；删除没有 queue consumer 的死导出 `listPendingTaskRuns()`；更新 repository fixture 和 L2-L4/README/SPEC/deployment 文档。
- Verification: 全仓 generate/validate/typecheck/lint/test/build、Playwright test discovery 和 diff check 全部通过。临时 Postgres + mock RSS/AI 做真实成功/失败混合 Worker cycle，并用 SQL 核对六条 Worker TaskRun、AI_CALL 数量和 briefing；生产构建 Web route 返回 Markdown 200，SQL 核对 export TaskRun/ExportEvent/UsageEvent，详细结果见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮审计 README 所述 SourceObservation hit/noise/duplicate 计算是否真实反映 source 事件与去重数据，并继续核对工作区“成员/用量审计”是否只是汇总卡片壳；完全缺失项先与 #10/#14/#20 查重。

### SPEC/README 实现一致性审计 Round 3：简报日期幂等与完整历史

- Phase: Cross-phase / Phase 10 (简报导出) + Phase 8 (Dashboard MVP)
- Scope: 验证 Daily Briefing 是否按主题和日期范围选取事件、Worker 重跑是否幂等、已有重复数据能否安全迁移，以及 `/briefings` 是否能访问完整历史而非仅展示 Dashboard 预览上限。
- Alignment: Worker 现在以 UTC `[rangeStart, rangeEnd)` 作为每日窗口，正式信源、非忽略/归档事件才进入简报；`topicId + period + rangeStart` 同时由 Prisma 唯一约束和 repository upsert 保证幂等，符合 `SPEC.md` 5.9 的时间范围、来源可追溯和重复运行不应制造重复实体原则。独立分页历史符合 README 的可回看承诺。
- Missing: 用户/组织时区尚未建模，当前日界线固定 UTC；WEEKLY/MONTHLY 生成仍未实现，由既有 Issue #28 追踪。浏览器 smoke 新增了分页契约，但本轮没有启动带 41 条简报 fixture 的 Next 测试实例。
- Bugs: `runDailyBriefingCycle()` 原来读取所有未读/收藏事件且每次 `create()`，导致旧事件跨日重复、同日重跑重复；`/briefings` 复用 `listLatestBriefingsForDashboard(limit=5)`，第 6 条以后不可达。
- Fixes: 新增 UTC 日窗口 helper；repository 增加范围过滤和简报 upsert；新增组合唯一约束与可合并旧重复数据/关联/导出的 migration；简报页改为完整分页 loader；补 core boundary fixture、DB 查询/upsert/41 条分页 fixture 和 Playwright 页面契约；同步产品、入口、领域、模块、运维和前端文档。
- Verification: DB/Core fixtures、Prisma format/generate/validate、全仓 typecheck/lint/test/build、Playwright test discovery/compile、diff check 全部通过。临时 Postgres 16 实际执行 0001-0008，并验证最新记录保留、事件关联合并、ExportEvent 重定向及唯一约束拒绝重复插入。
- Follow-up: 下一轮继续核对 README 对 TaskRun/AI 管线的逐项承诺，重点检查 worker 失败/重试是否形成可查询审计记录；证据充分的壳实现直接修复，完全缺失能力先查重现有 Issue。

### SPEC/README 实现一致性审计 Round 2：完整收藏集合与状态语义

- Phase: Cross-phase / Phase 8 (Dashboard MVP) + Phase 9 (反馈学习)
- Scope: 验证 `/saved` 是否从用户状态读取完整收藏集合、分页是否覆盖首页上限之外的数据，以及收藏页 READ/unsave 动作是否具有独立且可追溯的状态语义。
- Alignment: `listSavedDashboardEvents()` 以 `UserItemState.saved=true` 和 organization/user 双重 scope 为 source of truth，符合 `SPEC.md` 5.5 的用户阅读状态与 5.7 的收藏集合目标；READ 保留收藏但仍写入 readAt/feedback，unsave 才移出集合，README 已同步当前真实行为。
- Missing: 浏览器 smoke 用例已补，但当前没有可控 Postgres，Docker/OrbStack daemon 也未运行，因此本轮以可执行 repository fixture + production build 证明查询和状态转换；后续部署或本地数据库可用时再执行两端浏览器写入验证。
- Bugs: `/saved` 只过滤首页 Top 30，旧收藏不可达；READ 将 `saved` 设为 false，等同隐式 unsave；页面忽略 workspace data mode 时还可能把读取错误显示为“暂无收藏”，改用 dedicated loader 后数据库错误进入统一 error boundary，不再伪装空集合。
- Fixes: 新增完整收藏分页 repository 和 Web loader；添加总数/页码/上一页/下一页；移动端分页布局；READ-preserves-save 状态转换；新增 DB runtime fixture 并让 `packages/db test` 从“只编译”升级为实际执行；统一 dashboard event display mapper；同步 L2/L3/L4 和 README。
- Verification: DB fixture、全仓 typecheck/lint/test/build、Playwright test discovery/compile、diff check 全部通过；详细命令见同日 `AGENTS_CHANGELOGS.md`。
- Follow-up: 下一轮审计 daily briefing 的日期幂等与历史列表完整性，并继续核对 README 的 TaskRun/AI 管线描述；存在实现壳则修复，完全缺失且未被 Issue 覆盖则查重建单。

### SPEC/README 实现一致性审计 Round 1：情报卡片原文入口

- Phase: Cross-phase / Phase 8 (Dashboard MVP) + ongoing implementation audit
- Scope: 从 `SPEC.md` 目标能力和 `README.md` 当前实现承诺反查 Web → repository → Worker/Core → Prisma 路径；本轮重点验证未读情报卡片的“原文”动作是否真正落到原始 Item URL，并对完全未开发能力执行 GitHub Issue 查重分流。
- Alignment: 修复后首页卡片与详情页都把 `primaryItemUrl`（含 `event-display.ts` 从 RSS metadata 提取的 Article URL）作为原文，Source feed 只作为“来源”，符合 `SPEC.md` 5.4/5.8 的来源可追溯要求、`README.md` 的情报录入说明和 `FRONTEND.md` 的卡片动作语义。
- Missing: `SPEC.md` 要求但代码完全未开发的主题时间线/周报/月报已建 #28；Telegram 每日简报投递已建 #29。PDF/Obsidian/批量导出由 #8 覆盖，丰富反馈与分析阶段偏好应用由 #7 覆盖，按需专题报告由 #17 覆盖，均避免重复。其余功能继续按下一轮调用链审计，不在证据不足时扩大实现范围。
- Bugs: 首页 `IntelligenceCard` 原来使用 `sourceUrl ?? itemUrl` 作为底部“原文”链接；绝大多数 RSS 事件都有 Source URL，导致按钮打开 feed 而非文章。详情页已正确优先 Item URL，形成同一事件两个入口行为不一致。
- Fixes: 拆分 `sourceLinkUrl` 与 `itemUrl`；“原文”只在有效 Item/Article URL 存在时显示，否则显示明确的“来源”；Playwright 增加卡片和详情页原文 href 一致性回归断言；同步 `docs/L3-modules.md`。
- Verification: `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 全部通过；构建首次在沙箱内因 Turbopack 端口权限失败，沙箱外同一命令通过，判定为环境限制而非代码错误。浏览器断言因本轮无本地数据库环境未执行。
- Follow-up: 下一轮优先审计“收藏集合是否只读取首页 Top 30”“每日简报是否按主题/日期幂等”以及 README 对 TaskRun/AI 管线的逐项表述；有实现壳则修复，完全缺失且无重复 Issue 则建单。

## 2026-07-10

### Phase 3/8：全站交互、响应式与可访问性多轮审计

- Phase: Cross-phase / Phase 3 (产品壳) + Phase 8 (Dashboard MVP)
- Scope: 以桌面和 320/375/414/768/1024/1440px 六档宽度逐页审计首页、简报、收藏、偏好、信源、主题列表/新建/详情/编辑、情报详情和 Admin 设置；修复首页/收藏页超框、收藏页旧网格压缩、纯图标入口难发现、控件不足 44px、酸黄 CTA 白字低对比、主题筛选语义、偏好置信度语义和取消收藏误写 `DISMISS`。
- Alignment: 符合 `FRONTEND.md` 的 mobile-first、无横向滚动、44px 触达、语义 token、键盘路径和高对比要求；状态语义同步 `docs/L2-domain.md`，前端调用链同步 `docs/L3-modules.md`。
- Missing: 未新增暗色/亮色主题切换；当前产品仍只提供既定暗色视觉语言。清除 API 凭证的二次确认仍是既有后续项。
- Bugs: 首轮发现 320px 首页和收藏页被长主题 Badge 撑宽；收藏页 `event-row` 遗留三列结构把正文放进 58px 列；全局未分层 `a { color: inherit }` 覆盖 `text-accent-foreground`，使主 CTA 变成酸黄底白字；“取消收藏”此前提交 `dismiss` 并跳回首页。
- Fixes: 长 Badge 限宽省略；收藏页改两列并增加详情/文字动作；主导航补偏好、主题和设置文字入口及当前态；Button/Input/Tabs 统一 44px；链接 hover 排除 Button；新增独立 `unsave` 状态动作，不创建负反馈；新增全站响应式 Playwright 回归。
- Verification: 本地 Prisma Postgres migration/seed + 审计 fixture；生产构建 smoke 11 passed / 1 skipped（唯一收藏被桌面轮先移除）；响应式矩阵 1 passed（11 页面 × 6 宽度）；最终桌面/移动截图抽查通过。完整仓库验证见本轮 `AGENTS_CHANGELOGS.md`。
- Follow-up: 后续 UI 变更继续运行 `pnpm smoke:web` 和响应式矩阵；避免 `next dev` 与 `next build` / `next start` 并发写同一 `.next`。

### Issue #11：Worker 抓取增强 — 并发、退避、错误追踪、Parser 加固

- Phase: Phase 5 (Worker 抓取) 增强 + Phase 11 (信源治理) 部分补齐
- Scope: 为 Worker 抓取管线增加并发控制（内联 pLimit）、指数退避 + jitter、HTTP 状态感知的错误分类、Source 级错误追踪字段（lastError/lastErrorAt/consecutiveFailures）、RSS/Atom parser 加固（content:encoded、Atom rel=alternate、数字字符引用）、质量报告显示 source 错误状态。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 5 的 Worker 抓取要求和 `AGENTS.md` §13 验证规则。退避策略避免对死源无差别重试；错误分类避免 4xx 无意义重试；Source 错误追踪补齐了 Phase 11 治理决策的数据来源。
- Missing: RSS/Atom parser 仍为 regex 基础，未替换为完整 XML parser（`fast-xml-parser` 等）；未实现 auto-mute（仅统计展示，治理决策留给人工）；并发压测未做。
- Bugs: 无已知 bug。
- Fixes: (1) `isFetchRssRetryable` 最初未覆盖 TypeError（fetch 网络失败的典型异常），review 后修复；(2) 最初引入 `p-limit` 依赖但因 ESM 构建冲突改为内联 pLimit。
- Verification: `pnpm typecheck` ✓ (7/7), `pnpm lint` ✓ (7/7), `pnpm test` ✓ (7/7), `pnpm build` ✓ (7/7), `git diff --check` ✓.
- Follow-up: Parser 完整 XML parser 替换可单独排期；auto-mute 可在人工治理运行稳定后评估；大规模 source 并发压测。

### Issue #12：AI Adapter 测试补齐 + Issue #16：前端表单 primitives 迁移

- Phase: Cross-phase / Phase 6 (AI adapter) + Phase 3 (前端组件)
- Scope: #12 在 `packages/ai` 新增 `adapter.fixtures.ts`，覆盖 12 个 adapter 场景（标准响应、output_text fallback、空 choices、multi-choice、4xx/5xx/429 错误重试、maxRetries 耗尽、非 JSON 错误体、AbortError、JSON mode fallback 和记忆）；在 `parser.fixtures.ts` 追加 8 个 parser 边界测试；修改 `openai-compatible.ts` 使 `!response.ok` 分支能处理非 JSON 错误体。#16 将 `topics/new` 和 `admin/settings` 两个表单页从 raw HTML 控件迁移到 shadcn `Input`/`Label`/`Textarea` primitives。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 6 的 AI adapter 测试覆盖要求和 Phase 3 的前端组件标准化要求。`AiHttpError` 非 JSON 错误体修复符合 AGENTS.md §12 "LLM 输出一律视为不可信输入"原则。表单迁移保留了 Server Action FormData field name，不改变提交行为。
- Missing: `sources/page.tsx` 的 `candidate-form` 和 `topics/[topicId]/edit/page.tsx` 的 `topic-form` 未迁移（留作后续）。`AiHttpError` 仍未导出，测试通过 `(error as any).status` 访问。`globals.css` 中 `.topic-form`/`.candidate-form` CSS 块保留（仍被其他页面引用）。
- Bugs: 无已知 bug。
- Fixes: 修复 `openai-compatible.ts` 在 provider 返回非 JSON 错误体（如纯文本 "Internal Server Error"）时抛出 SyntaxError 而非 `AiHttpError` 的问题。
- Verification: `pnpm typecheck` ✓ (7/7), `pnpm lint` ✓ (7/7), `pnpm test` ✓ (7/7), `pnpm build` ✓ (7/7), `git diff --check` ✓.
- Follow-up: 迁移 `sources/page.tsx` 和 `topics/[topicId]/edit/page.tsx` 表单；考虑导出 `AiHttpError` 供调用方做更精确的错误分类；考虑补充 streaming 支持边界文档。

### Phase 12 前置：Admin 后台 API Key 凭证管理

- Phase: Phase 12 (商业化基础) 前置 - 凭证管理基础设施
- Scope: 新增 `Subscription` 模型和 migration `0006_subscription_credentials`；新增 AES-256-GCM 加密工具 `packages/db/src/crypto.ts`；新增 DB repository 函数（`getSubscriptionCredentialView`/`upsertAiCredential`/`upsertSearchCredential`/`getDecryptedCredentials`）；Worker 三个工厂函数改为 async + DB 优先 + env fallback；新增 `/admin/settings` 页面和 Server Actions（OWNER/ADMIN 权限，脱敏展示，不可查看完整 Key）；TopNav 加齿轮入口；`.env_example` 新增 `ENCRYPTION_KEY`；AGENTS.md 新增 §5.2 凭证管理规则。
- Alignment: 符合 AGENTS.md §5.2（API Key 通过 Admin 后台配置）和 `docs/business-model.md` Step 1（Schema + Migration + AES 加密工具）。
- Missing: Plan/SubscriptionStatus 枚举和 Stripe/ccayment 字段未实现（Phase 15）；BYOK override 端点未实现；Key 验证端点未实现；无端到端测试覆盖（仅 typecheck 通过）。
- Bugs: 无已知 bug。注意：`ENCRYPTION_KEY` 未设置时 `upsertAiCredential`/`upsertSearchCredential` 会抛错；`getDecryptedCredentials` 在 `ENCRYPTION_KEY` 缺失时静默返回 null（fallback 到 env var），这是设计行为。
- Fixes: 无。
- Verification: `pnpm --filter @wangchao/db/worker/web exec tsc --noEmit` 全部通过；待跑完整 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
- Follow-up: Phase 15 在同表扩展 Plan/Stripe/配额字段和 BYOK `byok*` 字段；补 Playwright smoke test 覆盖 `/admin/settings` 页面；考虑在 `ensureDefaultWorkspace` 时自动创建空 `Subscription` 行。

### Phase 12 前置增强：Admin 凭证管理体验优化

- Phase: Phase 12 (商业化基础) 前置 - 凭证管理 UI/UX 增强
- Scope: 新增凭证删除（`deleteAiCredential` / `deleteSearchCredential`）和连接测试（`testAiCredential`）repository 函数 + Server Actions；重写 `/admin/settings` 页面：Tabs 布局替代双卡片堆叠、新增客户端 `CredentialForm` 组件（密码显隐、Provider 下拉 + 自动填充 Base URL、帮助链接、必填/可选标记、提交 loading 态）、状态区重构为 key-value 布局 + 更新时间、新增测试连接和清除凭证操作按钮。
- Alignment: 符合 AGENTS.md §5.2（API Key 通过 Admin 后台配置，加密存储，脱敏展示）和 `FRONTEND.md`（暗色 token、44px 触摸目标、移动端单列无横向滚动、focus-visible）。测试连接和清除凭证补齐了原 DEVELOPE_LOGS 中记录的 "Key 验证端点未实现" 缺口。
- Missing: 测试连接仅覆盖 OpenAI-compatible `/models` 端点，不支持 Anthropic 等非 OpenAI API 格式的 provider；清除凭证无二次确认弹窗（依赖浏览器原生 confirm 或后续 AlertDialog）；无 Playwright smoke test 覆盖新增操作。
- Bugs: 无已知 bug。Review 修复了 `credential-form.tsx` 中 `document.getElementById` 改为 `useRef` 的 React 惯用写法。
- Fixes: 无。
- Verification: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓, `pnpm build` ✓, `git diff --check` ✓.
- Follow-up: 补 Playwright smoke test 覆盖测试连接/清除凭证流；考虑 shadcn Select/AlertDialog 组件替代原生 `<select>` 和缺失的二次确认；测试连接可扩展支持 Anthropic 等非 OpenAI-compatible API 格式。

## 2026-07-08

### Phase 4/5：新建主题自动候选源

- Phase: Cross-phase / Phase 4 (主题与信源) + Phase 5 (自动信源发现)
- Scope: 新建主题页改为只收集主题名称和描述；Web Server Action 自动生成初始 topic profile，并从内置信源包匹配候选 RSS/Atom；候选源经真实 HTTP/HTTPS feed 验证后写入 `Source.status='CANDIDATE'` 和 `SourceObservation.evidence`；无候选源时主题仍创建成功并给出清晰提示。
- Alignment: 符合 Issue #2、`SPEC.md` 4.1/7.1、`REFACTOR_PLAN.md` Phase 4/5 和 `AGENTS.md`。候选源保持治理隔离，不进入 worker fetch/briefing；RSS/Atom 和 LLM/外部内容仍按不可信输入处理；新增环境变量已同步 `.env_example` 和 `CODEGUIDE.md`。
- Missing: 当前 V1 只匹配仓库内 `packages/db/seed-sources.json`，未在新建主题 request lifecycle 中调用 Brave/Web discovery 或 LLM 生成搜索词；后续可把更重的搜索和低频候选抓取交给 worker 周期继续扩展。
- Bugs: 端到端 smoke 发现 Next production server 下动态读取 `packages/db/seed-sources.json` 会按 `apps/web` cwd 拼错路径，已改为静态 JSON import；发现 RSS validator 会误把 item title 当 feed title，已改为排除 item/entry 后读取 feed/channel title；发现并行 Playwright 项目会让真实 RSS 验证和 Server Action 互相干扰，已改为 smoke 单 worker。
- Fixes: 新增 `buildTopicProfile()`；新增 `validateRssFeedUrl()` 和 fixture；新增 `createTopicAction()`、内置信源包匹配、并发候选验证与硬超时；新建主题表单移除 RSS/关键词字段；新增 Playwright smoke 用例；同步 README、SPEC、CODEGUIDE、环境变量和本日志。
- Verification: 已通过 `pnpm db:validate`、临时 Docker Postgres (`127.0.0.1:55438`) 上 `pnpm db:deploy`、`pnpm db:seed`；已通过 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`；已在沙箱外通过 `DATABASE_URL=... WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS=2000 pnpm smoke:web`，desktop/mobile 新建主题均通过，事件详情用例因临时库无事件按预期 skip；SQL 检查确认最新 smoke 主题写入 profile keywords，候选源为 `CANDIDATE` 且 evidence 包含 feed title/item count/validation URL/matched keywords。
- Follow-up: 后续可把新建主题后的更深自动发现排入 worker，不阻塞表单提交；可补一组可控本地 RSS fixture 的集成测试，减少公网 RSS 可用性对 smoke 的影响。

### Phase 5：自动信源发现

- Phase: Phase 5 (自动信源发现)
- Scope: 落地 worker 周期/手动触发的 source discovery 主路径：关键词搜索 RSS/Atom、从高分情报原文页反查 RSS/Atom、从 active source 最近 item 外链网络发现候选；候选源写入 `Source.status='CANDIDATE'`，携带发现渠道、推荐理由、0-1 相关性评分和 SourceObservation evidence；写入 `SOURCE_DISCOVERY` TaskRun/UsageEvent；Web 信源管理页可手动触发并展示推荐理由；新增周频 Railway cron 示例。
- Alignment: 符合 `SPEC.md` 5.2 / Phase 5、Issue #1 和 `AGENTS.md`。AI adapter 保持 OpenAI-compatible，Brave Search 通过 provider 接口隔离；无 key 时优雅降级；长任务在 worker 中执行；candidate/muted/rejected 仍不会进入 fetch/briefing；发现到已存在 active source 时只写 observation，不改变 source 状态。
- Missing: 尚未接入 Tavily/Serper/SearXNG、自建 SearXNG、专用 arXiv/GitHub releases/政府公告适配器、社媒观察、候选源低频抓取策略、批量治理或到期提醒；Playwright smoke 已通过，但没有新增专门点击“发现新源”的浏览器用例。
- Bugs: 首次真实 discovery 验证发现默认探测范围过大导致运行过慢，已增加 `WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT`、`WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT`、`WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE`、`WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS`。同次验证发现已存在 active source 不应写入 discovery 字段或计为候选，已改为仅写 `SourceObservation` 并计入 `existingSourcesObserved`。
- Fixes: 新增 `0002_source_discovery` migration；新增 `packages/sources/src/discovery.ts`、`packages/ai/src/source-recommendation.ts`；新增 `runSourceDiscoveryCycle()`、`runSourceDiscoveryAction()`、信源治理页“发现新源”按钮和推荐理由展示；新增 source/AI fixture 测试；同步 `.env_example`、`README.md`、`SPEC.md`、`CODEGUIDE.md`、Railway config 文档和本日志。
- Verification: 已通过 `pnpm db:generate`、`pnpm db:validate`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`。临时 Docker Postgres 验证 `pnpm db:deploy`、`pnpm db:seed`、worker 单轮抓取分析、`pnpm worker:source-discovery`，并用 SQL 检查 `SOURCE_DISCOVERY` TaskRun/UsageEvent、existing source observation、active source 未被 discovery 字段污染；直接执行 repository 写入验证新 candidate 的 `status/channel/reason/trustScore`。带临时数据库并在沙箱外运行 `pnpm smoke:web`，4 个 Playwright smoke tests 通过。
- Follow-up: 在真实部署中配置 `deploy/railway/source-discovery-cron.railway.json` 对应服务；用真实 `BRAVE_SEARCH_API_KEY` 和 AI key 验证关键词搜索/LLM 推荐路径；后续可补 Playwright 手动 discovery 点击流和 provider 扩展。

### 前端体验缺口补齐：详情页、URL 筛选和 smoke test

- Phase: Cross-phase / Phase 8 (Dashboard MVP) 体验补齐
- Scope: 新增 `/events/[eventId]` 情报详情页；首页主题筛选改为基于 topic id，并与 `q` 搜索和 `view=all|high|saved` URL 状态互相保留；情报卡片标题可进入详情页；事件状态动作支持 `returnTo` 回到详情页；新增 Playwright smoke 配置和 `pnpm smoke:web` 脚本。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 8 对 event detail、筛选状态和 Dashboard 主阅读工作流的目标，也符合 `CODEGUIDE.md` 对可点击、可刷新、可分享 URL 状态的要求。长任务仍不进入 request lifecycle，详情页通过 `packages/db` repository 读取。
- Missing: Playwright 用例已写入，但当前本机 Chromium 被 macOS sandbox 拦截，未能完成浏览器级执行；详情页尚未扩展 merged sources、反馈历史或更丰富实体/后续跟踪信息。
- Bugs: 修复首页 `topic` URL 参数用 topic id 生成却拿 topic name 比较，导致主题筛选无法正确过滤和高亮的问题；修复事件状态 action 固定回首页，详情页无法留在当前上下文的问题。验证过程中发现现有 `packages/core` test script 仍引用已删除 fixture dist，已改回当前可运行的 `tsc --noEmit` 测试入口；`packages/ai` source recommendation schema 常量补类型锚点以通过 build。
- Fixes: 新增 `getDashboardEventById()` repository；新增 `getDashboardEventDetail()` web data helper；新增 `apps/web/src/app/events/[eventId]/page.tsx`；补 `TopicFilter` URL 状态保留、首页 view 筛选、详情页样式、Playwright smoke tests 和文档说明。
- Verification: 已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`。使用临时 Docker Postgres (`127.0.0.1:55434`) 运行 `pnpm db:migrate`、`pnpm db:seed`、`pnpm --filter @wangchao/worker start`，生成 30 条事件；再用 Next production server HTTP smoke 验证 `/api/health` database `ok`、`/?q=OpenAI&view=high` 保留搜索/视图/主题链接状态、`/events/[eventId]` 返回详情内容、`/exports/events/[eventId]` 返回 200。`pnpm smoke:web` 启动 production server 成功，但 Chromium launch 因 `bootstrap_check_in ... MachPortRendezvousServer ... Permission denied` 失败，属于当前 macOS sandbox 限制。
- Follow-up: 在允许 Chromium 启动的本机/CI 环境跑 `pnpm smoke:web`；后续可扩展详情页 merged sources、反馈历史、实体和 follow-up suggestion。

## 2026-07-07

### 放宽前端整体间距

- Phase: Phase 8 (Dashboard MVP) 微调
- Scope: 全局放宽前端间距，不改配色和布局结构。
- Alignment: 符合 `FRONTEND.md` Kinetic Intelligence 视觉方向，不改变 token 和组件 API。
- Missing: 无。
- Bugs: 无。
- Fixes: 无。
- Verification: `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过。
- Follow-up: 如需进一步放大或恢复紧凑感，可调整 globals.css 中的间距变量。

### 生产环境清理 + 前端 Kinetic Intelligence 重构

- Phase: Cross-phase / production readiness + Phase 3 (产品壳) + Phase 8 (Dashboard MVP)
- Scope: 清理所有开发/测试残留内容（预览模式、硬编码凭据、fixture 协议、console.* 日志、测试 harness 文件）；按 `FRONTEND.md` 完成三步重构（Token 对齐、组件增强、首页重构 + 页面拆分为 6 个独立路由）。
- Alignment: 符合 `REFACTOR_PLAN.md` 的 Phase 3/8 目标，符合 `FRONTEND.md` 的完整实施步骤，符合 `AGENTS.md` 的安全与隐私规则（不提交密钥、LLM 输出视为不可信、候选源隔离）。
- Missing: 情报详情独立页面未实现（当前详情在卡片内展示）；情报流搜索功能已实现但未对接主题筛选 URL 参数的高亮状态；Playwright smoke test 未覆盖。
- Bugs: 无已知 bug。
- Fixes: 修复了预览模式静默降级导致生产环境显示假数据的问题；修复了 `prisma.config.ts` 硬编码 localhost 凭据的安全风险；修复了 `fixture:` 协议在生产 fetch 路径中的残留。
- Verification: 已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`。9 个前端路由正确编译。
- Follow-up: 情报详情独立页面；搜索与主题筛选联动；Playwright smoke test；Railway 生产部署验证。

### 对客准备：表单反馈、运行时命名和导出过滤

- Phase: Cross-phase / customer-facing readiness hardening
- Scope: 修复首页表单失败无反馈、运行时字段和 metadata 残留开发阶段命名、非 HTTP 内部源协议在页面和 Markdown 导出中泄露、离线 fixture 文案测试口吻、README 入口文档缺口感过强等问题。
- Alignment: 符合“正式对客前检查开发残留和不当描述”的目标，也符合 `AGENTS.md` 对安全渲染、接口契约、文档同步和每轮审计的要求。变更没有扩大商业化范围，重点是让现有个人版工作流在用户操作失败、成功、导出和健康检查时表现得像正式产品。
- Missing: 尚未完成最终 Railway 重新部署和生产端 smoke；Worker Cron 线上仍需在最终部署步骤中确认生效；真实登录/session provider 仍属于个人版边界之外，不阻塞当前个人使用版本。
- Bugs: 发现 Server Actions 捕获错误后只写服务端日志，用户会感觉按钮无反应；发现 worker health 暴露 `phase` 字段、运行时 metadata 使用 `deterministic-phase-*`；发现离线源配置下首页和事件 Markdown 可泄露 `fixture://`；发现离线 fixture 文案包含 “deterministic local item” 测试口吻；发现 README 的 Known Gaps/当前主要缺口像内部待办。
- Fixes: Server Actions 改为成功/失败后 redirect 到 `notice` / `error`，首页显示 `role=status` / `role=alert` 提示；worker health 改为 `runtime`；元数据改为 `explainable-rules`；首页和导出只渲染 HTTP/HTTPS 外链；事件 Markdown 过滤非 HTTP/HTTPS source feed；离线 fixture 文案产品化；README 改为个人版边界；同步 `CODEGUIDE.md`。
- Verification: 已通过受影响包 typecheck/build、`CI=true pnpm --filter @wangchao/core test`、全量 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；本地浏览器验证首页无高风险残留、无效 RSS 有错误提示、有效主题/RSS 有成功提示、事件收藏动作有成功提示；本地 worker health 返回 database `ok` 和 `runtime`；本地 worker 用离线源生成事件/简报；本地导出 route 返回 Markdown 附件，事件导出不再包含 `Source feed: fixture://...`。
- Follow-up: 额度恢复后执行最终 Railway 部署；部署后验证 `/api/health`、首页、`?view=high`、`?view=saved`、`?q=`、表单提交、状态动作、事件/简报导出和 Worker Cron。

### 对客准备：首页伪交互清理

- Phase: Cross-phase / customer-facing interaction readiness
- Scope: 将首页顶部搜索、事件视图 tabs、刷新、新主题入口和侧栏导航从伪交互清理为可用或静态状态；补齐信源状态中文展示和用量单位映射。
- Alignment: 符合当前“正式对客前检查开发残留和不当描述”的目标。变更没有扩大产品范围，只把已经展示在首屏和主工作流里的控件调整为用户可理解、可点击、可刷新、可分享的行为。
- Missing: 尚未完成浏览器级真实点击验证；搜索当前只过滤已加载到首页的 Dashboard events，不是全库全文搜索；顶部通知能力仍未实现，因此已移除按钮而不是保留假入口。
- Bugs: 发现搜索框、筛选按钮、静态 tabs、刷新按钮、新主题按钮和侧栏导航都存在“看起来能操作但没有真实行为”的问题；已改为 GET 查询、链接或静态状态。
- Fixes: 修改 `apps/web/src/app/page.tsx` 和 `apps/web/src/app/globals.css`；同步 `CODEGUIDE.md`。
- Verification: 已通过 `CI=true pnpm --filter @wangchao/web typecheck`、`CI=true pnpm --filter @wangchao/web build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；build 输出确认首页仍是 dynamic route；伪交互扫描确认首页不再保留通知、静态筛选按钮或静态 tabs 使用；已部署 Web deployment `a06032b1-7689-462b-be18-c6ecf1b3cbbe` 且状态 `SUCCESS`；已将 Railway `wangchao-web`、`wangchao-worker`、`Postgres` 统一 scale 到 `southeast-asia=1`，实际 region ID 为 `asia-southeast1-eqsg3a`；生产 `/api/health` 返回 HTTP 200、database `ok`、edge `hkg1`；生产首页、`?view=high`、`?view=saved`、`?q=Hacker` 页面可访问，HTML 扫描无高风险开发残留，并确认真实 RSS、工作区状态、搜索字段和新主题锚点存在。
- Follow-up: 用生产 URL 验证真实导出下载、表单提交和浏览器级真实点击；配置 Worker Cron。

## 2026-07-06

### 对客准备：开发残留和不当描述清理

- Phase: Cross-phase / customer-facing readiness cleanup
- Scope: 清理首页、导出 route、默认 seed、默认 workspace、`.env_example`、README、部署文档和 `CODEGUIDE.md` 中会让客户看到或误解的开发阶段描述；将无数据库 fallback 从样例情报改为空工作区预览；禁止无数据库时导出 fixture Markdown。
- Alignment: 符合当前“正式对客前检查开发残留”的目标，也符合 `AGENTS.md` 对安全、接口契约和文档同步的要求。变更没有扩大商业化范围，优先让个人版看起来和行为上更接近真实产品。
- Missing: 尚未完成生产重新部署与浏览器级 smoke test；尚未配置 Railway Cron；尚未接入真实登录/session provider；Server Action 错误仍只在服务端记录，没有在表单旁展示给用户；生产库中如果已经 seed 过旧 fixture source，需要单独清理或用新 seed/source 数据覆盖。
- Bugs: 发现无 `DATABASE_URL` 时事件/简报下载 route 会生成 `Fixture Event` / `Fixture Topic` Markdown，属于对客严重误导；已改为 503。发现首页和文档仍有 Phase、MVP、fixture、Prisma/Postgres 边界等内部描述；已改为产品语言或维护说明。
- Fixes: 更新 `apps/web/src/app/page.tsx`、`apps/web/src/lib/topic-source-data.ts`、`apps/web/src/app/exports/events/[eventId]/route.ts`、`apps/web/src/app/exports/briefings/[briefingId]/route.ts`、`packages/db/prisma/seed.ts`、`packages/db/src/repositories.ts`、`packages/core/src/index.ts`、`packages/sources/src/index.ts`、`.env_example`、`README.md`、`README-en.md`、`docs/deployment.md`、`CODEGUIDE.md`。
- Verification: 已用 `rg` 扫描用户可见和运行时代码中的 `Fixture`、`Phase`、`MVP`、`DATABASE_URL 未配置`、`Prisma/Postgres`、`Default Organization`、`owner@example` 等残留，确认高风险命中已清理；已通过 `git diff --check`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm --filter @wangchao/sources typecheck`、`CI=true pnpm --filter @wangchao/sources test`、`CI=true pnpm --filter @wangchao/db typecheck`、`CI=true pnpm --filter @wangchao/db build`；已设置 Railway Web/Worker 的 `WANGCHAO_SEED_SOURCE_*` 为真实 RSS；最终 Web deployment `1f7a1343-490e-419e-a1bc-1ce3260fb346` 为 `SUCCESS`，生产 `/api/health` 返回 HTTP 200、database `ok`、edge `hkg1`；生产首页 HTML 扫描 `Fixture|fixture://|DATABASE_URL|Phase|MVP|Server Action|Default Organization|owner@example` 无命中，并确认出现 `Hacker News 100+` / `https://hnrss.org/newest?points=100`；Worker deployment `7e08c762-230a-4227-b70a-b67e0c1bc0d9` 为 `SUCCESS`，日志显示 `fetchedSources=1`、`insertedOrUpdatedItems=20`、`createdOrUpdatedEvents=9`、`generatedBriefings=1`、`failedSources=0`。
- Follow-up: 配置 Worker Cron；验证导出 route 的真实 Markdown 下载；补浏览器级生产交互测试；后续如继续对客，需要接入真实登录/session provider。

### Phase 13 修复：Railway southeast-asia 迁移与生产首页动态化

- Scope: 将 Railway `Postgres`、`wangchao-web`、`wangchao-worker` 迁移到 `southeast-asia`；修复首页被静态预渲染导致生产仍显示 fixture fallback 的问题；重新部署 Web 并完成公网 smoke test。
- Alignment: 符合用户“优先香港和日本 / 全部迁移到 southeast-asia”的部署方向。Railway 实际使用 `asia-southeast1-eqsg3a`，公网请求经 `hkg1` edge，Web health 与数据库检查均正常。
- Missing: Worker 还没有配置成 Railway Cron；未完成浏览器真实点击/表单/下载验证；Postgres backup 和 rollback drill 仍未做。
- Bugs: 发现首页在 Next.js build 阶段被预渲染为静态页面，生产 runtime 虽有 `DATABASE_URL`，但首页 HTML 仍显示 `DATABASE_URL 未配置` fixture banner；已通过 `export const dynamic = "force-dynamic"` 修复。迁移过程中 Worker 有一次 DB 未 ready 导致 `P1001 DatabaseNotReachable`，随后成功运行。
- Fixes: 修改 `apps/web/src/app/page.tsx`，让首页强制动态渲染；重新部署 Web deployment `b41e26f3-53eb-43b3-b9c2-0630703f4b31`。
- Verification: Web status `SUCCESS`，Postgres status `SUCCESS`，Worker status `SUCCESS`；`curl /api/health` 返回 HTTP 200、database `ok`、edge `hkg1`；首页 HTTP 200，包含“已连接 Prisma/Postgres 数据边界”，不再显示 `DATABASE_URL 未配置`；本地 `CI=true pnpm --filter @wangchao/web build` 显示 `/` 为 dynamic route，`CI=true pnpm --filter @wangchao/web typecheck` 通过。
- Follow-up: 设置 Worker Cron；用浏览器检查生产首页布局和交互；测试创建主题、创建候选源、状态动作、Markdown 导出；替换默认 fixture RSS 为真实 RSS 源。

### Phase 13 执行：Railway 生产部署

- Scope: 通过 Railway CLI 创建 `wangchao` project，添加 `Postgres`、`wangchao-web`、`wangchao-worker`；使用 root `railway.json` 和 `WANGCHAO_RAILWAY_ROLE` 分发 Web/Worker 启动行为；设置服务环境变量；从本地目录上传部署 Web 和 Worker。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 13 和 `AGENTS.md`。Web 已完成生产构建、migration、seed 和服务启动；Worker 已在生产环境执行一轮抓取/分析/简报生成；Postgres 使用 Railway 托管服务并通过 service reference 注入。
- Missing: Web 公网域名尚未生成，原因是 `railway domain --service wangchao-web --port 3000 --json` 被当前审批系统拦截；Worker 还不是定时 Cron，只是在部署后执行一轮并停止；没有完成生产浏览器访问、`/api/health` HTTP 检查或 Railway backup/rollback drill。
- Bugs: 生产部署未暴露构建错误；Web logs 显示 migration/seed 成功，Worker logs 显示执行成功。仍保留平台配置风险：root `railway.json` 不能区分 Web healthcheck 与 Worker cron，后续需要通过 Railway dashboard/API/service config 精细化。
- Fixes: 新增 root `railway.json`；新增 `railway:build`、`railway:predeploy`、`railway:start` scripts；文档中明确当前实际部署方式和 Worker Cron 缺口。
- Verification: Web deployment `e8e52339-cb02-4f80-827f-ca91f7cbb558` 为 `SUCCESS` 且 logs 显示 Next.js ready；Worker deployment `d2ee612a-50a4-421c-895b-90c1cdf67ba9` 为 `SUCCESS`，logs 显示 `insertedOrUpdatedItems=2`、`analyzedItems=2`、`createdOrUpdatedEvents=2`、`generatedBriefings=1`、`failedSources=0`。
- Follow-up: 需要用户明确允许再次执行 Railway domain 生成命令，或在 dashboard 为 `wangchao-web` 生成 public domain；拿到域名后检查 `/api/health`、首页、创建主题、事件列表和导出；随后把 Worker 配置为 Railway Cron。

### Phase 13 补充：Railway 部署准备

- Scope: 为个人版部署新增 `deploy/railway/web.railway.json`、`deploy/railway/worker-cron.railway.json` 和 `deploy/railway/README.md`；根目录新增 `db:deploy`、`railway:web:*`、`railway:worker:*` 脚本；Web/Worker package 补生产 `start` 脚本；更新 `docs/deployment.md` 和 `CODEGUIDE.md`。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 13 和 `AGENTS.md`。当前 Web、Worker、Postgres 的 Railway 部署边界已明确：Web 服务负责 Next.js 和 `/api/health`，pre-deploy 执行 Prisma migration/seed；Worker Cron 服务按 UTC crontab 周期执行一轮后台任务并退出；两个服务共享 Railway Postgres。
- Missing: 尚未执行真实 Railway 部署；没有验证 Railway dashboard 中 config file path 是否已正确设置；没有验证 Railway Postgres 注入的 `DATABASE_URL`、Web service domain、Cron 实际触发、生产日志、备份和回滚演练。
- Bugs: 本轮未发现代码编译问题；仍保留平台差异风险：Railway 构建环境、Railpack 对 pnpm workspace 的解析、`preDeployCommand` 的 Prisma 7 engine 行为需要真实部署确认。
- Fixes: 新增 Railway config、部署脚本和文档；把 `pnpm db:deploy` 作为部署环境 migration 命令，与本地 `pnpm db:migrate` 区分。
- Verification: 已通过 Railway JSON 解析检查、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm railway:web:build`、`CI=true pnpm railway:worker:build`、`git diff --check`。
- Follow-up: 在 Railway 创建项目和 Postgres；分别创建 Web 与 Worker Cron 服务并设置 config file path；绑定 `DATABASE_URL` 与默认 workspace 环境变量；先部署 Web 并检查 `/api/health`，再部署 Worker Cron 并查看一轮任务日志。

### 个人版推进：迁移修复、离线 seed 源和 Web 表单稳定性

- Scope: 修复首版 Prisma migration 与 schema 的 `_BriefingEvents` 漂移；为 `packages/sources` 增加 `fixture://wangchao/ai-infrastructure` 离线 RSS feed；将 seed 默认 RSS source 改为 fixture 并允许 `WANGCHAO_SEED_SOURCE_*` 覆盖；修复 Web Server Action 表单校验错误会触发页面 error boundary 的问题；用真实 Postgres 临时库验证 Web health、浏览器创建主题/信源和数据库初始化。
- Alignment: 符合当前“先完成个人自用版本”的方向。商业化能力没有继续扩展，只保留默认 organization/user 边界；个人版第一启动路径更稳定：干净库可以正式 `pnpm db:migrate`，seed 不依赖公网，Web 表单异常不再导致整页崩溃。
- Missing: 由于当前环境提权额度限制，未能继续用本地 HTTP fixture 服务验证 worker 完整抓取闭环；浏览器插件随后拒绝继续访问 `127.0.0.1:3011`，未完成无崩溃复测。下载 route、事件状态按钮和真实 RSS worker fetch cycle 仍需在可访问源/事件数据下继续验证。
- Bugs: 发现 `0001_init` 手写 migration 对 Prisma 多对多表 `_BriefingEvents` 使用了 unique index，而当前 Prisma schema 期望复合主键和 `B` 索引，导致 `migrate dev` 会生成额外补丁 migration；已修复。发现 Server Action 中 `readRequiredUrl()` 对非 HTTP URL 直接 throw 会把页面打入 error boundary；已改为 action 内部记录警告并返回，避免整页崩溃。公网 HN RSS 抓取在当前环境失败，worker 正确记录 3 次 `TaskRun(FAILED)`，但没有生成 Item/Event/Briefing。
- Fixes: 修改 `packages/db/prisma/migrations/0001_init/migration.sql`、`packages/sources/src/index.ts`、`packages/db/prisma/seed.ts`、`apps/web/src/app/actions.ts`、`.env_example`；同步 `CODEGUIDE.md`。
- Verification: 已通过干净库 `DATABASE_URL=...wangchao_migrate_fixed_probe pnpm --filter @wangchao/db exec prisma migrate dev --schema prisma/schema.prisma`，只应用 `0001_init` 且不再生成补丁 migration；已通过干净库 `DATABASE_URL=...wangchao_personal_probe CI=true pnpm db:migrate`、`CI=true pnpm db:seed`、`CI=true pnpm worker:health`，确认 `_prisma_migrations=1`、`Organization/User/Topic/Source` seed 数据存在；已通过 Web `/api/health` 200 且 database `ok`；已通过浏览器提交 HTTP RSS 表单并在 Postgres 确认 `Browser Smoke` Topic/Source 写入；已通过 `node --input-type=module` 验证 `fixture://wangchao/ai-infrastructure` 解析出 2 条 items；已通过 `CI=true pnpm --filter @wangchao/sources typecheck`、`CI=true pnpm --filter @wangchao/db typecheck`、`CI=true pnpm --filter @wangchao/worker typecheck`、`CI=true pnpm --filter @wangchao/web typecheck`、`CI=true pnpm --filter @wangchao/web build`、`CI=true pnpm build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`。
- Follow-up: 用默认 fixture seed 在一个新库上跑完整 worker fetch/analyze/briefing cycle；为 Server Action 返回值接入可见表单错误提示，而不是只在服务端记录；补下载 route 和事件状态按钮 smoke test；准备一个你真实会用的 RSS 源，复测公网抓取、失败重试和内容质量。

### 跨阶段验证：本地 Docker Postgres 与数据库 smoke test

- Scope: 在本地启动 `wangchao-postgres-local` Postgres 16 容器，使用 `127.0.0.1:55433` 连接；验证 Prisma schema generate/validate、初始化 SQL、seed、核心 repository 写入链路、Markdown 渲染/导出记录和 worker health 数据库 ping。
- Alignment: 基本符合 `REFACTOR_PLAN.md` 和 `AGENTS.md` 对 Phase 2/4/7/8/10/11/12/13 的数据库验证要求。默认 organization/user、Topic、Source、Item、IntelligenceEvent、UserItemState、FeedbackEvent、SourceObservation、Briefing、ExportEvent、UsageEvent 均已在真实 Postgres 中完成写入或读取验证；worker health 使用真实 `DATABASE_URL` 返回 database `ok`。
- Missing: 未完成浏览器级 Server Action smoke test、Markdown 下载 route HTTP 验证、真实 RSS 网络抓取、worker fetch cycle 和 AI provider/mock 验证。当前 smoke test 通过脚本直接调用 `packages/db` 和 `packages/core` 的 build 产物，不等同于完整 Web E2E。
- Bugs: `pnpm db:migrate`、`prisma migrate deploy` 和 `prisma migrate status` 在当前环境均报 `Schema engine error` / `undefined`，未能通过 Prisma migrate 引擎正式套用 migration；本次临时用容器内 `psql` 执行 `packages/db/prisma/migrations/0001_init/migration.sql`，因此 `_prisma_migrations` 不具备正式迁移审计语义。普通沙箱下 seed 和 Node smoke 连接本地 Docker 端口会遇到 `EPERM`，需要提升权限执行本地 TCP/IPC 测试。
- Fixes: 未修改业务代码；更新 `CODEGUIDE.md` 记录本地 Docker Postgres 端口、验证命令和 Prisma migrate 风险；保留容器继续运行供后续测试使用。
- Verification: 已确认 Docker 容器 `wangchao-postgres-local` healthy；已通过 `DATABASE_URL=postgresql://wangchao:wangchao@127.0.0.1:55433/wangchao?schema=public CI=true pnpm db:validate`、`CI=true pnpm db:generate`、容器内 `psql -f /tmp/wangchao_0001_init.sql`、`CI=true pnpm db:seed`；seed 后 `organizations/users/memberships/topics/sources` 均有记录；数据库 smoke test 返回 `tableCount: 16`、`dashboardHasSavedEvent: true`、`governanceHasApprovedCandidate: true`、`eventMarkdownIncludesSource: true`、`briefingMarkdownIncludesEvent: true`；`CI=true pnpm worker:health` 返回 service `wangchao-worker`、database `ok`、status `ok`。
- Follow-up: 单独排查 Prisma 7 migrate 引擎错误，重建一个由 `pnpm db:migrate` 正式创建 `_prisma_migrations` 的干净测试库；启动 Web dev server 后补 `/api/health`、创建主题表单、事件状态动作、候选源治理和导出 route 的浏览器/HTTP smoke test；如需验证抓取链路，应准备可控 RSS fixture 或 mock server，避免依赖公网。

### 前端重构：FRONTEND.md Kinetic Intelligence 试点

- Scope: 按 `FRONTEND.md` 重构 `apps/web` 首页和全局样式：统一语义 token、酸黄品牌强调、硬边指标、`work-card`/`kinetic-card` 表面、顶部命令搜索、新建主题 kinetic 模块、情报流摘要/解释/来源外链、事件详情解释区、信源治理质量大数字、偏好记忆置信度条、按钮状态、焦点状态、响应式断点和 reduced-motion。
- Alignment: 基本符合 `FRONTEND.md`、`REFACTOR_PLAN.md` 和 `AGENTS.md`。前端仍是工作台而不是营销页；情报流保持高密度和稳定阅读；强 typography 主要集中在新建主题和指标区；信源治理、偏好记忆和详情区强化了可解释性；长任务和数据边界没有移入 request lifecycle。
- Missing: 未拆分独立路由或 client-side tabs；搜索输入仍是视觉/布局入口，未接真实搜索；未连接真实 Postgres 做创建主题、已读/收藏/忽略、Markdown 导出和信源治理 smoke test。
- Bugs: 发现顶部搜索输入和搜索图标按钮重复，已移除图标搜索按钮；发现来源和原文外链缺少外链标记，已补 `target="_blank"` 和 `rel="noreferrer"`；浏览器视口检查发现 Tabs trigger 高度为 36px，低于 44px 点击目标，已修复为 44px；移动端触达检查发现导出/简报/信源操作链接偏小，已提升到 44px。未发现 TypeScript/build 层面 bug。
- Fixes: 修改 `apps/web/src/app/page.tsx`、`apps/web/src/app/globals.css`、`apps/web/src/components/ui/button.tsx`；同步 `CODEGUIDE.md` 与本审计日志。
- Verification: 已通过 `CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；已用 `rg` 静态检查 `--accent: #dfe104`、`prefers-reduced-motion`、`:focus-visible`、`min-height: 44px`、响应式断点、`topic-lab`、`event-summary`、`event-reason`、`source-quality-score` 和 `confidence-meter`；已启动本地 dev server 并用浏览器在 320/375/414/768/1024/1440 视口验证无横向滚动、关键模块存在、reduced-motion/focus 规则存在、所有按钮点击目标不小于 44px，并截取 1440/375/320 视口截图；375px 稳定复测确认导出/简报/信源操作链接也不小于 44px。
- Follow-up: 接入搜索功能或移除占位输入；准备 Postgres 后补创建主题、已读/收藏/忽略、Markdown 导出和信源治理 smoke test；后续可把 Dashboard 子区拆为更小组件以降低 `page.tsx` 复杂度。

### 跨阶段验证加固：Prisma 7 兼容与 workspace 验证

- Scope: 在恢复依赖后补跑真实工具链验证；修复 `packages/core` fixture assertion 类型收窄；按 Prisma 7 要求新增 `packages/db/prisma.config.ts`、移除 schema datasource URL、引入 `@prisma/adapter-pg` 并改造 Prisma Client/seed adapter 初始化；集中处理 Prisma JSON input 类型；为 workspace package exports 增加 `types` 条件，保证未 build 时 TypeScript 能解析源码类型；将 worker health 脚本改为运行 build 后的 `dist/index.js`。
- Alignment: 符合 `REFACTOR_PLAN.md`、`AGENTS.md` 和 Phase 2/5/6/7/12/13/14 的共同验证要求。当前 TypeScript workspace 已能完成 Prisma generate/validate、typecheck、lint、test、build 和 worker health dry run，显著降低此前“只做静态检索”的风险。
- Missing: 仍未连接真实 Postgres 执行 migration/seed；没有验证真实数据库写入、worker fetch cycle、Web Server Action、导出 route、Dashboard 浏览器 smoke test 或 Playwright 视觉检查。
- Bugs: 修复真实 typecheck 暴露的问题：Prisma 7 不再支持 schema datasource `url`；Prisma Client 需要 driver adapter；JSON 字段写入类型不兼容 `Record<string, unknown>`；workspace package exports 只指向 `dist` 导致未 build 时 worker/web 看不到源码导出；worker health 使用 `tsx` 在当前沙箱中因 IPC pipe `EPERM` 失败；core fixture assertion function 不能触发类型收窄。
- Fixes: 新增 `packages/db/prisma.config.ts`；修改 `packages/db/src/client.ts`、`packages/db/prisma/seed.ts`、`packages/db/src/repositories.ts`、`packages/*/package.json`、`apps/worker/package.json`、`docs/deployment.md`、README 和 `CODEGUIDE.md`。
- Verification: 已通过 `CI=true pnpm db:generate`、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm worker:health`、`git diff --check`。worker health 在无 `DATABASE_URL` 时返回 database `skipped` 且 status `ok`。
- Follow-up: 准备本地或远程 Postgres 后运行 `pnpm db:migrate`、`pnpm db:seed`、worker fetch cycle、Web form actions、Markdown export routes 和浏览器 smoke test；评估是否补 Playwright 单主题 smoke test。

### Phase 14：Legacy cleanup / Python 原型归档

- Scope: 将根目录旧 Python 原型运行时代码、旧静态前端、旧 prompt、旧 Python 测试、`pyproject.toml`、`uv.lock` 和 `.python-version` 非破坏式移动到 `legacy/python-prototype/`；新增归档说明；更新 `README.md`、`README-en.md` 和 `CODEGUIDE.md`，把当前主路径改为 TypeScript monorepo，并把旧 Python 仅保留为行为参考。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 14 和 `AGENTS.md`。当前仓库根目录主路径已经是 TypeScript/pnpm/Turborepo/Next.js/Postgres/Prisma；旧 Python 原型不再混在根目录作为开发入口。因为 Node 新栈尚未完成真实编译/DB/browser 验证，本阶段选择归档而不是删除，降低参考行为丢失风险。
- Missing: 尚未彻底删除 legacy 目录；没有通过完整验证证明新栈稳定后可永久删除归档；没有迁移旧 prompt 语义到新的 AI pipeline prompt 契约。
- Bugs: 静态审计发现 `CODEGUIDE.md` 和 README 初版仍指向根目录旧 Python 文件，已改为 TypeScript 主路径和 `legacy/python-prototype/` 归档说明。后续真实 workspace 验证已证明 Node build/typecheck 不受根目录清理影响；仍保留未验证风险：是否有外部脚本依赖根目录 Python 文件。
- Fixes: 新增 `legacy/python-prototype/README.md`；移动旧 Python 原型文件和目录；更新 `README.md`、`README-en.md`、`AGENTS.md` 和 `CODEGUIDE.md` 的架构总览、目录树、核心数据流、模块职责和本地运行命令；将 `getProjectPhase()` 更新为 Phase 14。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 检查旧 Python 主路径引用，确认 README/CODEGUIDE 已切换到 TypeScript 主路径，剩余旧实现引用均位于 legacy 说明或历史审计语境；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test` 和 `CI=true pnpm build`。旧 Python 已不再是主路径，未运行 legacy Python 测试。
- Follow-up: 恢复依赖后跑完整 workspace 验证；新栈稳定后单独评估是否永久删除 `legacy/python-prototype/`；把旧 prompt 经验迁移到 `packages/ai` 或后续 prompt/module 文档。

### Phase 13：部署运维基础 MVP

- Scope: 新增 Web `/api/health` route，对 Web service 和可选 `DATABASE_URL` 做健康检查；新增 worker `runWorkerHealthCheck()` 和 `--health` CLI 模式，并暴露根脚本 `pnpm worker:health`；新增 `docs/deployment.md`，记录服务拆分、环境变量、健康检查、部署顺序、日志、备份和回滚边界；同步 `CODEGUIDE.md`。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 13 和 `AGENTS.md`。当前 Web/worker 都有独立健康检查入口，部署文档覆盖 env docs、worker process docs、logs、backup guidance 和 rollback guidance；仍保持 lazy init，缺少 `DATABASE_URL` 时 health 进入 fixture/skipped 语义，不阻塞本地浏览。
- Missing: 没有平台特定部署配置、Dockerfile、systemd/PM2/queue/scheduler、centralized error reporting、真实 backup job、observability drain、CI 部署流水线、secret manager 接入或生产回滚自动化。
- Bugs: 静态审计未发现明显逻辑断点；后续真实验证发现 worker health 使用 `tsx` 会在当前沙箱因 IPC pipe `EPERM` 失败，已改为运行 build 后的 `dist/index.js`。仍保留未验证风险：Web health endpoint 未通过运行时 HTTP 调用验证，真实 Postgres ping 未验证。
- Fixes: 新增 `apps/web/src/app/api/health/route.ts`；扩展 `apps/worker/src/index.ts` 支持 health check；新增 `apps/worker` 的 `health` script 和根 `worker:health` script；新增 `docs/deployment.md`；更新 `CODEGUIDE.md` 的目录、数据流和命令说明。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `/api/health`、`runWorkerHealthCheck()`、`worker:health`、`docs/deployment.md` 和 Phase 13 文档入口存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。未启动 Web 服务器调用 `/api/health`，也未连接真实 Postgres ping。
- Follow-up: 启动 Web 后用 `curl -fsS http://127.0.0.1:3000/api/health` 验证 health route；准备 Postgres 后验证真实 DB ping。Phase 14 已归档旧 Python 原型，后续仅需在新栈稳定后决定是否永久删除 legacy 目录。

### Phase 12：商业化基础 MVP

- Scope: 在 Prisma schema/migration 中新增 `UsageEventType` 和 `UsageEvent`；扩展默认 workspace 为 organization/user/member role 边界，并让 seed 复用默认租户环境变量；新增 membership role guard、成员列表、用量记录和近 30 天用量汇总；Web Server Actions 和 Markdown export routes 加入 role 检查与 usage event 记录；worker 抓取、daily briefing 和 source governance observation 写入用量流水；Dashboard 新增组织权限和用量审计卡片；同步 `.env_example` 和 `CODEGUIDE.md`。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 12 和 `AGENTS.md`。当前已覆盖 organization、membership、role guard、usage events、tenant-owned 数据和默认 user/organization MVP，能为未来多租户商业化提供最小权限与计量边界；`MEMBER` 可进行阅读/导出，`OWNER/ADMIN` 才能创建主题和治理信源。
- Missing: 没有真实登录/session provider、邀请成员、组织切换 UI、计费计划、限额拦截、Stripe/支付、usage billing aggregation、tenant isolation 自动化测试、RLS、admin portal 或审计导出；当前默认 workspace 仍是开发期占位，不适合真实商业化上线。
- Bugs: 静态审计发现默认 workspace 读取环境变量不能在共享 db 包中直接使用 `process.env`，已改为 `globalThis` runtime helper，避免额外 Node 类型依赖。仍保留未验证风险：Prisma enum/table migration、role guard、usage event 写入、Next route handler、Server Action、worker runtime 和 Dashboard 渲染均未通过真实 typecheck/build/DB/browser 验证。
- Fixes: 新增 `UsageEvent` 数据模型、`recordUsageEvent()`、`listUsageSummary()`、`listOrganizationMemberships()`、`assertMembershipRole()`；Web mutations/export routes 写入 usage events；worker 写入 FETCH/BRIEFING/SOURCE_GOVERNANCE usage events；Dashboard loader 和页面展示 tenant/membership/usage；补默认组织/用户环境变量，并同步 Prisma seed。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `UsageEvent` schema/migration、`recordUsageEvent()`、`assertMembershipRole()`、`listUsageSummary()`、web action/export route/worker 调用和 Phase 12 文档入口存在；已人工检查 `.env_example`、`CODEGUIDE.md`、`AGENTS_CHANGELOGS.md` 均同步。后续跨阶段验证已通过 `CI=true pnpm db:generate`、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。仍未运行 Playwright 或 Postgres 端到端验证。
- Follow-up: 本地 Postgres ready 后验证 role guard、UsageEvent 写入、用量汇总、Markdown export audit 和 worker usage audit；补充 tenant isolation 自动化测试、真实 session provider、组织切换、邀请、限额和计费。后续 Phase 13 已建立部署运维、health check、env docs、日志和 worker deploy 基础。

### Phase 11：信源治理 MVP

- Scope: 在 `packages/db` 新增候选 RSS 创建、source governance report、approve/mute/reject/observe 状态切换、source quality observation 记录；在 `apps/web` 新增候选源表单、质量报告卡片和治理动作按钮；在 `apps/worker` 每轮任务末尾写入 source quality observation；在 daily briefing 查询中明确只允许 `ACTIVE` source 事件进入正式简报。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 11 和 `AGENTS.md`。当前已覆盖 candidate/active/muted/rejected 状态流、候选源审核入口、hit/noise/duplicate 质量指标、source quality report 和 SourceObservation 记录；candidate sources 不会进入 active fetch，也不会进入正式 daily briefing。
- Missing: 没有自动信源发现、外链反查、source pack、周报式候选推荐、LLM 解释推荐原因、source trust score 自动更新、质量趋势图、批量治理、继续观察时长/到期提醒、候选源低频抓取策略或真实审核权限；没有 DB/browser/worker 端到端验证。
- Bugs: 静态审计发现事务数组加条件 spread 可能导致 TypeScript 推断风险，已改为 `$transaction(async transaction => ...)` callback；loader 中 `Promise.all` 缩进不清晰已修正。后续跨阶段 typecheck/build/worker health 已通过；仍保留未验证风险：真实 Postgres 写入、source governance 表单提交、candidate 不进入 fetch/briefing 的端到端行为和浏览器流程未验证。
- Fixes: 新增 `createCandidateRssSource()`、`listSourceGovernanceReport()`、`updateSourceGovernanceStatus()`、`recordSourceQualityObservation()`；新增 `createCandidateSourceAction()`、`updateSourceGovernanceAction()`；页面新增 `SourceActionForm`、candidate form、source quality list；worker 新增 `runSourceGovernanceObservationCycle()`；`listEventsForDailyBriefing()` 增加 active-source 过滤。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 db/web/worker 的 Phase 11 路径存在；已人工检查 daily briefing 查询包含 `primaryItem.source.status = ACTIVE`。后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`；未运行 Playwright 或 Postgres 端到端验证。
- Follow-up: 本地 Postgres ready 后验证创建候选源、approve/mute/reject/observe、source quality observation 写入、candidate 不进入 fetch/briefing 的端到端行为；补浏览器 smoke test。后续 Phase 12 已进入 auth/organization/membership/usage events 的商业化基础。

### Phase 10：简报与 Markdown 导出 MVP

- Scope: 在 `packages/core` 新增单条事件 Markdown 和 daily briefing Markdown 渲染、content hash 与 fixture 覆盖；在 `packages/db` 新增 daily briefing 事件读取、Briefing 创建、最新简报查询、简报/事件下载读取和 `ExportEvent` 记录；在 `apps/worker` 每轮任务末尾追加 daily briefing 生成；在 `apps/web` 新增最新简报卡片、简报 Markdown 下载 route 和单条事件 Markdown 下载 route。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 10 和 `AGENTS.md`。当前用户可以通过 Web 下载单条情报或已生成 daily briefing 的 Obsidian-friendly Markdown；导出内容包含生成时间、摘要、解释、来源和原文链接；daily briefing 生成发生在 worker，而不是 request lifecycle；下载 route 只读取持久化内容并记录 `ExportEvent`。
- Missing: 没有真实浏览器下载验证；没有 PDF、Obsidian URI、Local REST API、导出目录配置、批量导出、事件实体/后续跟踪的 LLM enrich；daily briefing 是确定性模板，不是 LLM rewrite；worker 当前每轮会为每个 active topic 生成一份简报，没有按日期去重或定时调度。
- Bugs: 静态审计未发现新格式问题；后续跨阶段 typecheck/build/worker health 已通过。仍保留未验证风险：真实 `Briefing` 写入、ExportEvent 写入、Markdown 下载 header、浏览器下载和 worker briefing cycle 未经过 DB/browser 端到端验证。
- Fixes: 新增 `renderEventMarkdown()`、`renderDailyBriefingMarkdown()`、`createContentHash()`；新增 `listEventsForDailyBriefing()`、`createDailyBriefing()`、`listLatestBriefingsForDashboard()`、`getBriefingMarkdownForDownload()`、`getEventMarkdownExportRecord()`、`recordMarkdownExport()`；页面新增 briefing 列表和下载链接；新增 `/exports/briefings/[briefingId]` 与 `/exports/events/[eventId]` route。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 core/db/web/worker 的 Phase 10 路径存在；已确认导出 route 文件存在。后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`；未运行 Playwright 或 Postgres 端到端验证。
- Follow-up: 本地 Postgres ready 后验证 worker 生成 Briefing、Web 下载 Markdown、ExportEvent 写入和单条事件导出正反馈；补 daily briefing 去重/调度策略。后续 Phase 11 已进入信源治理。

### Phase 9：反馈学习与偏好记忆 MVP

- Scope: 在 `packages/core` 新增 feedback-to-preference delta、preference key、preference weight ranking 和 fixture 覆盖；在 `packages/db` 新增近期反馈读取、`PreferenceMemory` dashboard 查询和 upsert；在 `apps/web` 的事件状态动作后立即归纳近期反馈并写入偏好记忆，Dashboard 读取偏好后重排情报并展示“已学习偏好”；在 `apps/worker` 每轮任务末尾追加 preference learning cycle。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 9 和 `AGENTS.md`。当前 `READ/SAVE/DISMISS/EXPORT` 反馈会成为可追溯 `FeedbackEvent`，被规则归纳为带 `confidence` 与 `explanation` 的 `PreferenceMemory`，并影响 Dashboard 排序。该闭环满足“反馈影响后续排序/筛选”的 MVP，但还不是最终 LLM/语义偏好学习。
- Missing: 没有 LLM 归纳 preference delta；没有显式“不感兴趣/多关注/少关注/来源好/差/分数高/低”等更丰富反馈按钮；没有跨时间衰减、冲突偏好合并、prompt 注入、worker 分析阶段过滤、真实偏好历史详情页或可编辑偏好 UI；没有真实 DB/browser 验证。
- Bugs: 静态审计发现 source-name preference 解释会被误判为 category，已修正为所有 `source*` key 都按 source 解释；`FeedbackEvent.kind` 从 Prisma enum 映射到当前支持的反馈类型时可能存在类型收窄风险，已加显式 cast。后续跨阶段 typecheck/build/worker health 已通过；仍保留未验证风险：真实 DB 中 nullable `userId` compound unique 语义、JSON value 写入、Server Action 提交和浏览器重排未验证。
- Fixes: 新增 `generatePreferenceDeltas()`、`applyPreferenceWeights()`、`preferenceKeysForEvent()`；新增 `listRecentFeedbackSignals()`、`listPreferenceMemoryForDashboard()`、`upsertPreferenceMemory()`；Dashboard loader 使用偏好权重重排事件；页面新增偏好记忆列表；worker 新增 `runPreferenceLearningCycle()`。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 core/db/web/worker 的 Phase 9 路径存在。后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`；未运行 Playwright 或 Postgres 端到端验证。
- Follow-up: 本地 Postgres ready 后验证 read/save/dismiss -> feedback -> preference memory -> dashboard rerank 的端到端闭环；后续继续增强 LLM 偏好归纳、偏好衰减和可编辑偏好 UI。Phase 10 已将导出接入审计链路。

### Phase 8：Dashboard MVP

- Scope: 将 `apps/web` 的未读情报区从静态数组改为 `IntelligenceEvent` 数据流；新增 Dashboard event fixture、事件详情面板、来源/时间/score/category 展示、空状态，以及已读、收藏、忽略三个 Server Action 表单动作；在 `packages/db` 新增 Dashboard event 查询和事件状态写入，状态动作同时写 `IntelligenceEvent`、`UserItemState` 和 `FeedbackEvent`。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 8 和 `AGENTS.md`。当前已覆盖 topic dashboard、unread/saved list、event detail、source display、loading/empty/error 延续、read/save/dismiss actions，并且动作保留 tenant/user scope。`READ` 和 `DISMISSED` 默认从主列表隐藏，符合 `SPEC.md` 对“已读/忽略后不反复展示旧内容”的方向。
- Missing: 没有真正浏览器端提交验证；没有事件详情路由、筛选 tab 的真实切换、批量已读、收藏集合页面、搜索、分页、键盘操作、乐观 UI、toast/error recovery 或 Playwright 视觉验证；状态动作尚未接入 Phase 9 偏好学习聚合，只写了基础 `FeedbackEvent`。
- Bugs: 审计发现侧边栏仍显示 Phase 4 状态，已改为 Phase 8。后续跨阶段 typecheck/build 已通过；仍保留未验证风险：Server Action 表单提交和数据库事务行为尚未通过真实 DB/browser run。
- Fixes: 新增 `listDashboardEvents()`、`updateDashboardEventState()`、`DashboardEventSummary` fixture、`updateDashboardEventStateAction()`；页面移除静态 events 数组，使用 `workspace.events` 渲染列表和详情；新增 `.event-actions`、`.icon-action`、`.event-detail` 等样式。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 Dashboard loader、Server Action、repository helper 和样式入口存在。后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test` 和 `CI=true pnpm build`；未运行 Playwright 或 Postgres 端到端验证。
- Follow-up: 本地 Postgres ready 后验证 read/save/dismiss 是否正确写入 `IntelligenceEvent`、`UserItemState`、`FeedbackEvent`；补 Dashboard 浏览器 smoke test。Phase 9 已消费这些反馈事件并更新 preference memory/ranking。

### Phase 7：情报管线 MVP

- Scope: 在 `packages/core` 实现确定性 relevance/noise 判定、topic keywords 提取、event draft 生成、event hash 和 gravity score；新增 intelligence fixtures 和 `packages/core` test 入口；在 `packages/db` 新增待分析 Item 查询、过滤标记和 IntelligenceEvent upsert；在 `apps/worker` 的 fetch cycle 后追加 analysis cycle，将 `FETCHED` items 转为 `UNREAD` IntelligenceEvent 或 `FILTERED` Item。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 7 和 `AGENTS.md`。当前已经具备 relevance/noise、event extraction draft、scoring、dedupe hash、gravity ranking、worker 长任务边界和 tenant scope；抓取后的 Item 可以进入情报事件主链路。由于实现是确定性 MVP，还没有真正使用 Phase 6 的 LLM adapter/parser 完成语义抽取。
- Missing: 没有真实 LLM prompt、schema、provider mock 或 parser 接入；没有跨多 item 的事件合并、相似标题聚类、引用来源聚合、人工反馈影响排序、质量解释模板或真实 Postgres worker 端到端验证；fixtures 已写但未能实际执行。
- Bugs: 审计发现 `markItemFiltered()` 初版会覆盖 `rawMetadata`，导致 RSS 原始追溯信息丢失；已改为读取并合并原 metadata 后追加 `filteredReason`。仍保留未验证风险：Prisma JSON 类型、worker import/export、TypeScript 编译和运行时数据库写入尚未通过真实 typecheck/build/worker run。
- Fixes: 新增 `evaluateRelevance()`、`createIntelligenceEventDraft()`、`calculateGravityScore()`、`runIntelligenceFixtures()`、`listFetchedItemsForAnalysis()`、`markItemFiltered()`、`upsertIntelligenceEventFromItem()` 和 worker `runAnalysisCycle()`；修复过滤元数据覆盖问题。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 core -> worker -> db 的 Phase 7 路径与 fixture 入口存在。未运行 `pnpm --filter @wangchao/core test`、workspace typecheck/build/test 或真实 worker/Postgres 验证，因为当前 `pnpm` 会触发依赖自动安装并访问 registry，之前已因 DNS/配额阻塞中断。
- Follow-up: 恢复联网/依赖后先运行 `CI=true pnpm install --no-frozen-lockfile`、`pnpm --filter @wangchao/core test`、`pnpm --filter @wangchao/db typecheck`、`pnpm --filter @wangchao/worker typecheck` 和完整 workspace 验证；随后用本地 Postgres 跑一次 worker，确认 Item 状态和 IntelligenceEvent 写入；后续应把确定性 MVP 替换/增强为基于 `packages/ai` 的 LLM relevance、event extraction、dedupe/merge 和解释生成。

### Phase 6：AI adapter 与 parser

- Scope: 将 `packages/ai` 从占位 descriptor 扩展为 OpenAI-compatible Chat Completions adapter、共享 AI 类型、LLM response sanitizer、JSON object extractor、常见 JSON 修复、轻量 schema validation 和 parser fixtures；`test` script 改为编译后运行 fixtures。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 6 和 `AGENTS.md`。adapter 不绑定 vendor SDK，使用 OpenAI-compatible `/chat/completions`；具备 retry、timeout、JSON mode fallback、响应文本抽取、response sanitization、schema validation 和 malformed-output recovery。因为依赖恢复仍阻塞，尚不能证明 TypeScript tests 实际通过。
- Missing: 没有真实 provider mock server 测试；没有覆盖 streaming、多 choice、tool calls、复杂 nested schema、array root JSON、provider 非 JSON 错误体；没有接入 Phase 7 relevance/event extraction prompt；fixture 测试脚本已写但未能实际执行。
- Bugs: 静态审计发现 fixture runner 直接使用 `process` 会让 `packages/ai` 需要 Node 类型依赖；已改为 package script 动态 import 执行 fixture 函数，保持包无新增依赖。仍保留未验证风险：`fetch`/`Response` 类型、adapter HTTP error 处理和 TS 编译未通过真实 typecheck。
- Fixes: 新增 `OpenAiCompatibleAdapter`、`createOpenAiCompatibleAdapter()`、`sanitizeModelText()`、`extractJsonCandidate()`、`parseJsonObject()`、`validateJsonObject()` 和 `runParserFixtures()`；新增 JSON mode unsupported model 记忆，避免 fallback 后继续发送不兼容 response_format。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查确认 adapter/parser/fixtures 导出存在。尝试 `pnpm --filter @wangchao/ai test`，但 pnpm 触发 workspace 自动安装并访问 registry，因 DNS 持续失败被中断；未完成 `tsc`、fixtures、build、lint 或端到端 provider mock 验证。
- Follow-up: 恢复联网/配额后运行 `CI=true pnpm install --no-frozen-lockfile`、`pnpm --filter @wangchao/ai test` 和完整 workspace 验证；后续 Phase 7 应基于这些 parser/adapter API 实现 relevance/noise、event extraction/scoring、dedupe 和 gravity ranking，并补更完整的 parser fixtures。

### Phase 5：Worker 抓取管线

- Scope: 为 `packages/sources` 实现无新增依赖的 RSS/Atom fetch + parse + normalize；为 `packages/db` 增加 active RSS source 查询、source fetch TaskRun 创建/完成/失败、source `lastFetchedAt` 更新和 Item 幂等 upsert；为 `apps/worker` 实现 `runFetchCycle()`，逐个抓取 active RSS source，最多尝试 3 次，并写入 `Item`。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 5 和 `AGENTS.md`。抓取和长任务在 worker 中执行，没有放进 request lifecycle；RSS fetch、item normalize、URL canonicalization、source fetch status、TaskRun 错误记录、attempt 上限和幂等 upsert 都已有代码路径。因为本地依赖和 Postgres 仍未恢复，尚不能证明 worker 能真实写入 Postgres。
- Missing: 没有真实 RSS 网络抓取验证；~~没有并发控制~~（已补齐：内联 pLimit + WANGCHAO_FETCH_CONCURRENCY）、~~退避等待~~（已补齐：指数退避 + jitter + WANGCHAO_FETCH_BACKOFF_BASE_MS）、~~source 级错误统计~~（已补齐：lastError/lastErrorAt/consecutiveFailures + 质量报告显示）；RSS parser 已加固（content:encoded、Atom rel=alternate、数字实体），但仍为 regex 基础，未替换为完整 XML parser；未实现 auto-mute（留人工决策）。
- Bugs: 静态审计发现初版 TaskRun 虽有 attempt 字段但没有实际重试行为；已补 `MAX_FETCH_ATTEMPTS=3` 的重试循环，每次尝试写独立 TaskRun。仍保留未验证风险：Prisma JSON 类型、worker TypeScript 编译和运行时模块解析未通过真实 typecheck/build。
- Fixes: 新增 `fetchRssFeed()` / `parseRssFeed()` / `NormalizedSourceItem`；新增 `listActiveRssSourcesForFetch()`、`createSourceFetchTaskRun()`、`completeTaskRun()`、`failTaskRun()`、`recordSourceFetchSuccess()`、`upsertFetchedItems()`；worker 新增 `runFetchCycle()` 和 bounded retry。
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 worker -> sources -> db 的 Phase 5 路径存在。未运行 `pnpm typecheck/build/test`，因为当前 `node_modules` 链接未恢复，pnpm 会触发 registry 访问并持续 DNS 失败；未运行真实 worker/Postgres/RSS 端到端验证。
- Follow-up: 恢复联网/配额后运行 `CI=true pnpm install --no-frozen-lockfile`、`pnpm --filter @wangchao/sources typecheck`、`pnpm --filter @wangchao/db typecheck`、`pnpm --filter @wangchao/worker typecheck` 和完整 workspace 验证；本地 Postgres ready 后使用 seed source 跑一次 `pnpm --filter @wangchao/worker dev`，确认 `Item` 和 `TaskRun` 写入。后续 Phase 6/7 需要接入 AI adapter、parser、relevance/event extraction 和 ranking。

### Phase 4：主题与信源 MVP

- Scope: 为 `packages/db` 增加默认 workspace、Topic 创建、active RSS source 绑定、Topic/Source overview 和 URL canonicalization helper；为 `apps/web` 增加 `@wangchao/db` workspace 依赖、Server Action 表单处理、Topic/Source 数据 loader、创建主题并绑定 RSS 的页面表单、主题/信源列表和数据库/fixture 状态提示。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 4 和 `AGENTS.md`。当前代码已具备 Topic CRUD 中的创建入口、topic profile keywords 字段、manual RSS source attachment、source status `ACTIVE` 写入，以及 tenant/user 默认边界；长任务仍未进入 request lifecycle。因为数据库验证和运行环境未恢复，尚不能证明“用户可在真实 web UI 中成功创建主题并绑定信源”的完整完成标准。
- Missing: ~~还没有 Topic 编辑/删除/暂停/归档~~（已在后续实现：`getTopicById()`/`listAllTopics()`/`updateTopic()`/`updateTopicStatus()`/`deleteTopic()` + Server Actions + `/topics` 列表页 + `/topics/[topicId]` 详情页 + `/topics/[topicId]/edit` 编辑页，见 AGENTS_CHANGELOGS 2026-07-10）；还没有 Source 编辑、muted/rejected/candidate 审核流；没有真正运行 Prisma migration/seed 后的端到端写入验证；~~没有成功跑 `pnpm typecheck/build/lint/test`~~（已补齐验证）；没有浏览器提交表单验证。
- Bugs: 静态审计发现 Prisma transaction helper 可能存在 transaction client 类型不兼容风险，已把事务内写入展开修复。仍存在未验证风险：`@wangchao/db` 的 dist/type 输出未重新生成，当前 `node_modules` 链接未恢复，Next/TS 编译结果未知。
- Fixes: 新增 `createTopicWithActiveRssSource()`、`attachActiveRssSource()`、`ensureDefaultWorkspace()`、`listTopicSourceOverview()` 和 `canonicalizeUrl()`；新增 `createTopicWithSourceAction()` 表单验证；页面增加数据库/fixture/error mode 提示，避免本地缺数据库时静默误导。
- Verification: 已运行 `git diff --check`，通过；已运行静态文件存在性检查和 `rg` 调用链检查，确认 Server Action 与 repository helper 已连通。尝试 `PNPM_CONFIG_OFFLINE=true pnpm --filter @wangchao/web typecheck`，但 pnpm 仍触发自动安装并访问 registry，因 DNS 失败持续重试后被中断；未完成 typecheck/build/lint/test。
- Follow-up: 恢复联网/配额后先运行 `CI=true pnpm install --no-frozen-lockfile`、`pnpm --filter @wangchao/db db:generate`、`pnpm --filter @wangchao/db typecheck`、`pnpm --filter @wangchao/web typecheck` 和完整 workspace 验证；本地 Postgres ready 后运行 migration/seed，并通过浏览器提交一次 Topic + RSS 表单。后续阶段需要补完整 Topic CRUD、Source 状态治理、错误提示 UI 和权限测试。

### Phase 3：产品壳与设计系统基础

- Scope: 将 `apps/web` 从 Phase 1 占位页扩展为 Next.js App Router 产品壳；新增侧边导航、顶部工具栏、指标卡、未读情报列表、处理管线、空/提示状态、route-level `loading.tsx` 和 `error.tsx`；新增 `components.json`、本地 `cn()`、Button/Card/Badge/Tabs primitives 和全局设计 token。
- Alignment: 基本符合 `REFACTOR_PLAN.md` Phase 3 的产品壳、导航、主题 token、dashboard layout primitives、empty/loading/error states 目标；符合 `AGENTS.md` 中“长任务不进入 request lifecycle”和 Next.js App Router 主路径要求。页面只展示静态 fixture，不读取数据库或启动 worker，边界仍清晰。
- Missing: 未能通过 `shadcn init -d` 完整初始化 Tailwind/shadcn/Radix 组件链，因为当前依赖恢复仍受网络 DNS/配额限制影响；当前 Tabs 只是静态外观，不具备真正切换状态；页面尚未接入 Phase 2 数据库、Topic CRUD、Source registry 或真实 worker 状态；没有浏览器视觉验证截图。
- Bugs: 可用静态检查未发现明显布局/空白问题；由于无法完成 TypeScript/Next build，仍保留潜在 TS/Next 编译风险。`pnpm --filter @wangchao/web typecheck` 触发自动依赖安装并长时间 DNS 重试，已中断，未获得有效类型检查结果。
- Fixes: 避免新增网络依赖，使用本地 primitives 和 CSS token 落地产品壳；页面使用 lucide 图标、固定尺寸按钮/指标/列表行和响应式断点，减少文字溢出与布局抖动风险；新增 error/loading 状态避免只有 happy path。
- Verification: 已运行 `git diff --check`，通过。尝试运行 `pnpm --filter @wangchao/web typecheck`，但因 `node_modules` 链接未恢复触发自动安装，普通沙箱 DNS 持续失败，命令被中断，未完成。未运行 build/lint/test/Playwright。
- Follow-up: 恢复联网/配额后先运行 `CI=true pnpm install --no-frozen-lockfile`，再运行 `pnpm --filter @wangchao/web typecheck`、`CI=true pnpm build`、`CI=true pnpm lint`、`CI=true pnpm test`；随后启动 web 并做桌面/移动端视觉检查。后续 Phase 4 需要把静态 topic/source/event fixture 替换成真实 Topic CRUD 和 Source 绑定。
- Update (2026-07-08): Issue #16 follow-up 已关闭。shadcn/Radix/Tailwind v4 组件链已完整接入（见 `AGENTS_CHANGELOGS.md` 同日"前端组件链迁移到 shadcn/Radix/Tailwind v4"条目）。`pnpm --filter @wangchao/web typecheck` 和 `build` 均通过。Tabs 现基于 Radix 提供完整 a11y。Form primitive（Input/Label/Textarea）已落地。

### Phase 2：数据库基础

- Scope: 新增 `packages/db` 的 Prisma/Postgres 基础，包括 `schema.prisma`、首版 SQL migration、seed 脚本、懒加载 Prisma Client、tenant/topic scoped 查询 helper、根目录 DB scripts、`.env_example` 的 `DATABASE_URL` 模板，以及 `pnpm-workspace.yaml` 的 Prisma approved builds。
- Alignment: 部分符合 `REFACTOR_PLAN.md` Phase 2 和 `AGENTS.md` 数据库规则。schema 覆盖 `User`, `Organization`, `Membership`, `Topic`, `Source`, `Item`, `IntelligenceEvent`, `UserItemState`, `FeedbackEvent`, `PreferenceMemory`, `Briefing`, `ExportEvent`, `SourceObservation`, `TaskRun`，并提前放入 `organizationId` / `userId` / `topicId` 边界，符合未来商业化和多租户预留方向。
- Missing: 未能完成真正的本地 Postgres migration 和 seed 执行；当前没有运行中的本地 Postgres，也没有 `pg_isready` / `psql`；本轮后半段联网安装被系统配额限制拦截，导致 `node_modules` workspace 链接未能恢复，Prisma CLI、typecheck、build、lint、test 暂时无法完整执行。查询 helper 只覆盖 topic/source/event/task 的基础列表，尚未覆盖完整 CRUD、写入、事务和权限测试。
- Bugs: 静态审计中发现根目录缺少 DB 快捷命令、Prisma 依赖使用 range 可能导致未来自动漂移；已修复。当前未发现 schema 文件层面的模型缺失，但未经过 Prisma CLI 实际 validate/generate，因此仍保留 Prisma 语法/版本兼容风险。
- Fixes: 固定 `prisma` 和 `@prisma/client` 为 `7.8.0`；新增根 `db:*` scripts；补 `DATABASE_URL` 模板；允许 `prisma` 和 `@prisma/engines` build scripts；用静态检查确认 schema 和 migration 均包含 Phase 2 目标的 14 个核心模型/表。
- Verification: 已运行 `node` 静态检查确认 `schema.prisma` 包含 14 个核心模型，`migration.sql` 包含 14 个核心表；已运行 `git diff --check`，通过。尝试运行 `pnpm install --no-frozen-lockfile` 时普通沙箱因 DNS 失败；一次联网安装已下载并更新锁文件但因 approved builds 中断；批准 Prisma build 后，后续联网安装被系统配额限制拦截。`pnpm db:validate` 触发自动安装并因同样网络限制失败，未能完成。
- Follow-up: 恢复联网/配额后先运行 `CI=true pnpm install --no-frozen-lockfile`，再运行 `pnpm db:validate`、`pnpm db:generate`、`CI=true pnpm typecheck`、`CI=true pnpm build`、`CI=true pnpm lint`、`CI=true pnpm test`；准备本地 Postgres 后运行 `pnpm db:migrate` 和 `pnpm db:seed`。后续 Phase 4/5 需要补 topic/source CRUD、item 写入、TaskRun 状态流和事务边界测试。

### Phase 1：Monorepo 基础

- Scope: 建立 TypeScript monorepo 基础，包括根 `package.json`、`pnpm-workspace.yaml`、`turbo.json`、`tsconfig.base.json`、`apps/web`、`apps/worker` 以及 `packages/core`, `packages/ai`, `packages/db`, `packages/sources`, `packages/ui` 占位包。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 1 的 Monorepo foundation 目标；符合 `AGENTS.md` 指定的 pnpm / Turborepo / Next.js / TypeScript 技术路线。长任务仍保留在 worker 路径，web 只建立产品壳占位。
- Missing: 尚未进入 Phase 2 数据库基础；没有 Prisma schema、Postgres 连接、migration、seed、真实 lint 工具、单元测试框架或 shadcn/ui 初始化。当前 `test`/`lint` 仅以 `tsc --noEmit` 作为 Phase 1 基础门槛。
- Bugs: 初次验证发现两个配置 bug：web `tsconfig` 继承 `declarationMap` 但关闭 declaration；worker 未声明 ESM 导致 `import.meta` 报错。初次 build 还发现 `next/font/google` 构建期外部网络依赖。均已修复。
- Fixes: 为 web 禁用 `declarationMap`；为 worker package 增加 `"type": "module"`；移除 `next/font/google` 并改用 CSS 系统字体；在 Next config 设置 `turbopack.root`；补 `.pnpm-store/` 忽略规则。
- Verification: 已运行 `CI=true pnpm typecheck`、`CI=true pnpm build`、`CI=true pnpm lint`、`CI=true pnpm test`、`git diff --check`，均通过。
- Follow-up: Phase 2 需要引入 Prisma/Postgres 数据模型；Phase 3 需要真正初始化设计系统和产品壳；后续应补正式测试框架，替换当前以 typecheck 代替 lint/test 的临时做法。

### Phase 0：文档对齐与阶段审计机制

- Scope: 初始化分阶段开发审计机制，将 `DEVELOPE_LOGS.md` 纳入 Agent 工作流，并更新 `AGENTS.md` / `CODEGUIDE.md` 以明确每个阶段完成后需要审计。
- Alignment: 符合 `REFACTOR_PLAN.md` Phase 0 的文档对齐目标；符合 `AGENTS.md` 要求的任务结束检查和审计记录方向。技术路线继续以 `REFACTOR_PLAN.md` 为核心，旧 `README.md` 不作为新实现约束。
- Missing: 尚未开始 Phase 1 monorepo 基础开发；尚未创建 `package.json`、`pnpm-workspace.yaml`、Turborepo 配置、TypeScript 配置或应用目录。
- Bugs: 本阶段未修改运行代码，未发现代码 bug；文档层面存在一个命名风险：用户提到 `CHANGELOGS.md`，仓库实际规范文件为 `AGENTS_CHANGELOGS.md`，已在 `AGENTS.md` 中明确按后者理解。
- Fixes: 新增本文件；更新 `AGENTS.md`，加入 `DEVELOPE_LOGS.md` 规则；更新 `CODEGUIDE.md`，加入该文件职责。
- Verification: 已运行 `git diff --check`，通过；本阶段不需要运行 Python 或 Node 测试。
- Follow-up: Phase 1 需要建立 pnpm/Turborepo/TypeScript monorepo 基础，并在完成后对 build/typecheck 可用性、缺失功能和 bug 进行审计。
