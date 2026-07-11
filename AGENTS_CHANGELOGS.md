## 2026-07-11

### fix:第七轮 SPEC/README 实现审计 — 落实主题画像编辑与 Worker 输入

- Cause: SPEC 将 Topic Profile 定义为主题管理核心，既有编辑页却只保存 name/description，并用“关键词会自动重新匹配”文案伪装 profile 更新；实际 Server Action 不读写任何 profile 字段。Worker AI extraction 又从 profile JSON 读取 `name/description`，但 `buildTopicProfile()` 从未写这两个字段，导致模型长期收到空主题名/描述。`updateTopic()` 的 Prisma where 还只有 topic id，没有 organizationId 二次防线。
- Changed: 主题编辑页新增 keywords、entities、includeScope、excludeScope、importanceRules 五组真实字段，服务端做必填、总长度、条数、单项长度与去重校验，保留未知 profile 字段并标记 editor source；description 现在可显式清空。新增 `buildTopicProfileContext()` 统一清洗并限制 JSON 数组，并始终使用 Topic 行的当前 name/description。待分析 Item 查询补齐这两个字段及此前只存在于输入类型、实际始终为空的 sourceName，Worker extraction 改用统一 context。`updateTopic()` 改为 topicId + organizationId 更新。修正文案与移动端表单规则。
- Files: `packages/core/src/index.ts`, `packages/core/src/index.fixtures.ts`, `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`, `apps/worker/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/topics/[topicId]/edit/page.tsx`, `apps/web/src/app/globals.css`, `tests/smoke/web.spec.ts`, `SPEC.md`, `README.md`, `README-en.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `FRONTEND.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:validate` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7），`pnpm build` ✓（7/7，按已知 Turbopack 端口限制在沙箱外执行），`pnpm exec playwright test --list` ✓（16 tests），`git diff --check` ✓。临时 Postgres 16-alpine 实际执行 0001-0008 migrations，创建 Topic/Source/Item 后更新五组画像；`listFetchedItemsForAnalysis()` + `buildTopicProfileContext()` 返回当前 name/description 和完整新画像，错误 organizationId 更新被拒绝。production Web + 隔离 DB 下，Topic 管理/编辑 desktop 与 mobile 最终均通过；12 页面 × 6 宽度响应式矩阵通过。320px full-page 截图确认五组画像值、保存说明和按钮完整可见。首次 desktop 导航用例瞬态停留在详情页，单独重跑 1 passed；首次 Playwright 在沙箱内因 MachPort 权限失败，均与代码结果分开记录。`agent-browser` CLI 仍不在 PATH，按 skill fallback 到仓库 Playwright。
- Notes / Risk: `language_preferences` 与 `digest_style` 完全没有代码契约；GitHub connector 用三组中英文关键词查重均为 0，已创建 Issue #30，要求从可版本化契约、UI 到 extraction/briefing 消费完整落地。既有 #9 已关闭且其核心 profile 编辑要求由本轮补实；本轮不猜测 #30 的 JSON 结构。

### fix:第六轮 SPEC/README 实现审计 — 补齐类别反馈并隔离跨主题偏好

- Cause: Prisma 与 L2 已声明 `CATEGORY_UP/CATEGORY_DOWN`，但 Web 没有写入入口、偏好查询也不读取，属于枚举与文档壳。进一步反查 `generatePreferenceDeltas()` 发现归纳 Map 只用 `category:*`/`source:*` 作 key，没有带 `topicId`；两个 Topic 共享同名 category 时，正负反馈会互相抵消并把结果错误写给首个 Topic，违反 SPEC 的按主题偏好边界。
- Changed: 情报详情新增“多关注这类 / 少关注这类”，与“忽略此条”明确分离；新增 tenant-scoped category feedback repository 与 Server Action，写 `CATEGORY_UP/DOWN` 后即时刷新 PreferenceMemory 和 UsageEvent，不修改事件状态，也不连带修改 source 权重。学习查询纳入两类信号；core 对显式类别反馈只生成 category key，并以 `topicId + key` 复合分组隔离同名类别。首页旧“减少”改为准确的“忽略”。同时纠正文档边界：管理员 `SOURCE_APPROVE/REJECT` 是治理审计，不冒充尚未实现的个人 `source_good/source_bad` 偏好。
- Files: `packages/core/src/index.ts`, `packages/core/src/index.fixtures.ts`, `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`, `packages/db/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/events/[eventId]/page.tsx`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `tests/smoke/web.spec.ts`, `SPEC.md`, `README.md`, `README-en.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `FRONTEND.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:validate` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7），`pnpm build` ✓（7/7；沙箱内 Turbopack 因禁止绑定内部端口失败，按规则在沙箱外重跑后完整通过），`pnpm exec playwright test --list` ✓（16 tests），`git diff --check` ✓。core fixture 覆盖同名 category 跨 Topic 正负信号不抵消、category 动作不生成 source delta；DB fixture 覆盖 tenant-scoped 写入及 learning query 纳入 `CATEGORY_UP/DOWN`；Playwright 契约覆盖详情页三种相互独立的“忽略 / 多关注 / 少关注”入口。
- Notes / Risk: 更丰富的 source/score/entity/note 反馈、时间衰减、冲突历史、可编辑 UI 和 Worker relevance 阶段应用仍由既有 Issue #7 跟踪，本轮不重复建 Issue，也不声称该增强范围完成。当前规则按最近 100 条反馈重算，未改变该既有窗口。

### fix:第五轮 SPEC/README 实现审计 — 修正信源质量指标与工作区审计

- Cause: `README.md` 承诺 Worker 会计算真实 hit/noise/duplicate 并提供工作区成员/用量审计。反查发现 `duplicateRate` 只统计 `Item.status='DUPLICATE'`，但任何代码都不会写该状态，因此重复率长期为 0；标题模糊匹配虽然找到已有事件，随后仍按新 eventHash upsert，会实际创建第二条事件，EventItem 主次角色也不完整。成员与用量虽在 `getTopicSourceWorkspace()` 每次读取，却没有任何页面渲染，属于性能开销和展示壳。
- Changed: `upsertIntelligenceEventFromItem()` 改为模糊/精确命中后按已有 event id 更新，维护唯一 PRIMARY EventItem，将旧 primary 改为 SECONDARY/DUPLICATE，新 primary 保持 ANALYZED；`mergeSemanticEvents()` 使用 relation upsert 合并 Item，避免 stale snapshot 唯一键冲突并标记 DUPLICATE，同时清空归档旧事件的匹配 hash，防止未来输入重新命中 archived row。`listSourceGovernanceReport()` 改按未归档 primary/secondary EventItem 计算 Item 命中率、secondary 重复率和唯一 active event 数，并兼容历史未回填 DUPLICATE 的关系数据。新增 OWNER/ADMIN `/admin/usage`，展示工作区、成员角色和近 30 天按 type/unit 分组的 UsageEvent；主工作台不再白查成员/用量，设置页提供入口并补页面权限守卫。同步移动端单列样式、语义标题和 Playwright 路径。
- Files: `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/admin/usage/page.tsx`（新）, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/app/globals.css`, `tests/smoke/web.spec.ts`, `tests/smoke/responsive.spec.ts`, `SPEC.md`, `README.md`, `README-en.md`, `FRONTEND.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:validate` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7；DB fixture 覆盖 fuzzy existing-id update、角色/状态与指标口径），`pnpm build` ✓（7/7，包含 `/admin/usage`），`pnpm exec playwright test --list` ✓（16 tests），`git diff --check` ✓。临时 Postgres 16 实际构造三个来源：同标题不同 URL 最终 `firstEventId === fuzzyEventId`，仅 1 条未归档 event；最新 Item=PRIMARY/ANALYZED，旧标题匹配与语义合并 Item=SECONDARY/DUPLICATE；页面数据分别显示 Fuzzy 0%、Primary 50%、Semantic 100% duplicate rate，active eventCount 均为 1。生产构建浏览器验证 admin audit desktop/mobile 2 passed，12 页面 × 6 宽度响应式矩阵通过；network-idle 截图确认内容可见、bodyLength=295、Next error overlay=0。`agent-browser` CLI 不在 PATH，按 skill fallback 到仓库已安装 Playwright，并明确区分工具缺失与页面结果。
- Notes / Risk: 现有 quality score 权重/治理阈值未改，本轮只修正输入数据口径；历史 Item 即使尚未回填 DUPLICATE，也会通过 active SECONDARY relation 得到正确重复率。没有新增 Issue：provider/批量治理/候选复审仍由 #10 覆盖，配额/计费周期/商业用量仪表盘仍由 #14 覆盖；本页是个人版的事实审计视图，不声称已实现订阅额度。

### fix:第四轮 SPEC/README 实现审计 — 补齐全管线 TaskRun 审计

- Cause: `REFACTOR_PLAN.md` 将 TaskRun 定义为持久化 worker 状态、重试、错误和耗时的边界，`docs/L2-domain.md` 也列出了六种任务类型；实际代码却只有 `SOURCE_FETCH` / `SOURCE_DISCOVERY` 会写 TaskRun，`AI_RELEVANCE`、`AI_EVENT_EXTRACTION`、`BRIEFING_GENERATION`、`EXPORT_GENERATION` 只是 schema 枚举壳。LLM extraction 失败只写 stderr 并回退规则，AI UsageEvent 又只统计成功响应，导致失败调用和后续阶段无法在数据库审计。
- Changed: 新增通用 tenant-scoped `createTaskRun()`，fetch/discovery helper 复用同一 RUNNING/attempt/timing 契约。分析周期为每个 Item 写 `AI_RELEVANCE`，有 AI runtime 时另写 `AI_EVENT_EXTRACTION`；成功、filtered、provider 失败和规则 fallback 都收口到 output/errorMessage。简报按主题写 `BRIEFING_GENERATION`，无事件也记录 `skipped-no-events`；事件/简报 Markdown route 写 `EXPORT_GENERATION` 并在 ExportEvent/UsageEvent 完成后收口。AI UsageEvent 改按逻辑 adapter 调用计量（含最终失败调用，内部 HTTP retry 不重复计数），source recommendation/semantic dedup 同步避免只统计成功。删除无调用方的 `listPendingTaskRuns()`，L2 状态机改为当前真实的 RUNNING → SUCCEEDED/FAILED，明确 PENDING/CANCELED 是未实现的队列预留。
- Files: `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`, `packages/db/src/index.ts`, `apps/worker/src/index.ts`, `apps/web/src/app/exports/briefings/[briefingId]/route.ts`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `SPEC.md`, `README.md`, `README-en.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `docs/deployment.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:generate` ✓，`pnpm db:validate` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7，DB fixture 实际执行 TaskRun 生命周期），`pnpm build` ✓（7/7，沙箱外 Turbopack），`pnpm exec playwright test --list` ✓（16 tests），`git diff --check` ✓。临时 Postgres 16 + 本地 RSS/OpenAI-compatible mock 完整运行 Worker：2 Items、2 Events、1 Briefing；数据库确认 `SOURCE_FETCH=SUCCEEDED`、`AI_RELEVANCE=2 SUCCEEDED`、`AI_EVENT_EXTRACTION=1 SUCCEEDED + 1 FAILED`、fallback relevance output 为 `llmFallback=true`、`BRIEFING_GENERATION=SUCCEEDED`，所有 TaskRun 均有 startedAt/finishedAt，AI_CALL quantity=2 且 metadata 为 1 successful/1 fallback。生产构建 Web route 实际下载简报 Markdown 200，并确认 `EXPORT_GENERATION=SUCCEEDED`、ExportEvent=1、EXPORT UsageEvent=1。
- Notes / Risk: `PENDING`/`CANCELED`、进程被强杀后的 stale RUNNING 恢复和 Web 任务观测仍不是当前代码能力；现有 Issue #20 已覆盖 Railway Cron + TaskRun 双层观测闭环，本轮不重复建 Issue。TaskRun 仅保存模型名、阶段结果和错误消息，不保存 API Key 或原始凭证明文。

### fix:第三轮 SPEC/README 实现审计 — 简报日期幂等与完整历史

- Cause: `SPEC.md` 5.9 和 `README.md` 将每日简报描述为按主题、按时间范围生成且可回看，但 Worker 原实现每轮读取全部未读/收藏事件后直接 `Briefing.create()`，没有日期窗口或唯一性约束；同一天重复运行会生成重复简报，旧事件也会反复进入后续日期。`/briefings` 同时复用 Dashboard 的 5 条预览查询，更早历史不可达。
- Changed: 新增 UTC 日窗口 helper；Worker 按主题查询 `[rangeStart, rangeEnd)` 内、非忽略/归档且正式信源产生的事件，并以 `topicId + period + rangeStart` upsert 每日简报。Prisma 新增组合唯一约束和 `0008_briefing_idempotency` migration；迁移保留每组最新简报、合并事件关联、重定向既有导出记录后再建立唯一索引。简报页改用独立 repository/loader 分页读取完整历史，展示周期、覆盖日期、更新时间和总数；新增 core/db fixtures 与 Playwright 历史分页契约。同步 SPEC、双语 README、L2-L4、FRONTEND 和 CODEGUIDE。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0008_briefing_idempotency/migration.sql`（新）, `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`, `packages/db/src/index.ts`, `packages/core/src/index.ts`, `packages/core/src/index.fixtures.ts`, `apps/worker/src/index.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/briefings/page.tsx`, `apps/web/src/app/globals.css`, `tests/smoke/web.spec.ts`, `SPEC.md`, `README.md`, `README-en.md`, `FRONTEND.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:format` ✓，`pnpm db:generate` ✓，`pnpm db:validate` ✓，`pnpm --filter @wangchao/db test` ✓，`pnpm --filter @wangchao/core test` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7），`pnpm build` ✓（7/7），`pnpm exec playwright test --list` ✓（16 tests 可发现/编译）。临时 Postgres 16 实际依次执行 migration 0001-0008：重复简报由 2 条收敛为最新 1 条，两个事件关联均保留，旧 ExportEvent 指向新简报，唯一索引存在且重复插入按预期失败。`git diff --check` ✓。
- Notes / Risk: 日窗口当前固定为 UTC；用户可配置时区、周报/月报仍是后续能力。完全缺失项未重复建 Issue：导出与简报去重由既有 #8 覆盖，周报/月报由 #28 覆盖。Playwright 新断言本轮完成发现/编译，但未启动带 fixture 的 Web 浏览器写入场景；DB 行为由实际 Postgres migration test 和 repository fixture 覆盖。

### fix:第二轮 SPEC/README 实现审计 — 补齐完整收藏集合

- Cause: `SPEC.md` 5.5/5.7 和 `README.md` 将收藏描述为可持续管理的用户集合，但 `/saved` 实际复用首页 `listDashboardEvents(limit=30)` 后再过滤；第 31 条及更早的收藏无法出现。继续反查状态动作时发现，收藏页“标记已读”还会把 `saved` 清零，形成隐式取消收藏，与独立“取消收藏”动作冲突。
- Changed: 新增 `listSavedDashboardEvents()`，按 `organizationId + userId + UserItemState.saved=true` 查询、统计并分页，页码越界自动收敛；`/saved` 改用 dedicated loader，展示收藏总数和上一页/下一页，移动端分页纵向排布。已收藏事件执行 READ 时保留 `saved=true/SAVED`，同时写入 `readAt` 和 READ feedback；只有显式 unsave 才移出集合。新增可实际执行的 `packages/db` repository fixture，覆盖 tenant/user scope、65 条/3 页分页、越界页和 read-preserves-save 状态转换；Playwright 用例同步覆盖分页语义、已读不减少条目、取消收藏才减少条目。统一 Web event record → display summary 映射，避免首页、收藏、详情三处漂移。
- Files: `packages/db/src/repositories.ts`, `packages/db/src/repositories.fixtures.ts`（新）, `packages/db/src/index.ts`, `packages/db/package.json`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/saved/page.tsx`, `apps/web/src/app/globals.css`, `tests/smoke/web.spec.ts`, `README.md`, `README-en.md`, `FRONTEND.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm --filter @wangchao/db test` ✓（实际执行 repository fixture），`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7），`pnpm build` ✓（7/7，沙箱外 Turbopack），`pnpm exec playwright test --list` ✓（14 tests 可发现/编译），`git diff --check` ✓。本轮没有可控 Postgres/浏览器数据环境（Docker daemon 未运行），未执行会写状态的 Playwright smoke。
- Notes / Risk: 分页每页 30 条，repository 强制 1-100 的 page size；查询完全基于用户状态，不再依赖 organization 级 `IntelligenceEvent.status='SAVED'`，为后续多用户隔离保留正确边界。本轮未新增 GitHub Issue，因为确认的是已有功能壳的实现缺陷并已直接修复。

### fix:第一轮 SPEC/README 实现审计 — 修正情报卡片原文链接

- Cause: 按 `SPEC.md` 5.4/5.8、`README.md`“未读情报是如何被筛选和录入”以及 `FRONTEND.md` 的原文动作承诺反查真实调用链时，发现首页情报卡片把 `Source.url` 作为“原文”首选地址；RSS Source URL 通常是 feed 本身，因此该按钮虽然可点击，实际没有打开 `Item.url` 指向的原始文章，与详情页行为不一致。
- Changed: 情报卡片将来源名称链接与原文动作拆成两个语义：来源名称继续指向 Source URL（缺失时可回退到 Item URL），“原文”只使用清洗后的 `primaryItemUrl`；事件没有可用原文时改为明确的“来源”动作，不再把 feed 冒充原文。Playwright 回归用例新增卡片与详情页原文 href 一致性断言。同步更新 L3 调用链说明。审计同时确认完全未开发且既有 Issue 未覆盖的“主题时间线/周月报”和“Telegram 简报投递”，查重后建立 #28、#29；PDF/Obsidian/批量导出、丰富反馈、按需专题报告分别由既有 #8、#7、#17 覆盖，未重复建单。
- Files: `apps/web/src/components/intelligence/intelligence-card.tsx`, `tests/smoke/web.spec.ts`, `docs/L3-modules.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7），`pnpm build` ✓（7/7；沙箱内首次因 Turbopack 创建内部端口被拒，沙箱外重跑通过），`git diff --check` ✓。Playwright 断言已加入，但本轮工作区没有 `.env` / 可控测试数据库，未执行会读取真实事件的浏览器场景。
- Notes / Risk: 本轮只修复入口 URL 语义，不改变抓取、事件持久化或导出契约。分支上已有独立 commit `921f7b3`（`README.md` 与环境变量错误提示），本轮提交不混入该 commit 的内容；推送分支时会一并发布尚未推送的既有 commit。

### feat:AI 凭证嗅探模型列表 + chat/completions 兜底测试 + 自定义 provider 手动确认

- Cause: (1) 用户需要知道 OpenAI-compatible 端点有哪些可用模型，而非手动猜测模型名；(2) `GET /models` 端点不是所有 provider 都支持（DeepSeek、Azure、代理），导致 AI 凭证测试标记失败；(3) 自定义 provider 无法通过自动测试，UI 会卡死在"测试不通过"状态；(4) AI/搜索 Provider 常量在前后端双源维护，存在不一致风险；(5) 用户需要明确 AI 凭证与搜索凭证相互独立。
- Changed:
  - `apps/web/src/app/admin/settings/providers.ts`：新建 Provider 常量集中文件，统一 `AI_PROVIDERS`、`SEARCH_PROVIDERS`、`defaultAiBaseUrl` 函数，替代前端 `credential-form.tsx` 内联常量与后端 `actions.ts` 独立函数。
  - `packages/db/src/repositories.ts`：`testAiCredential` 新增 `POST /chat/completions` 兜底逻辑：当 `GET /models` 返回 404/405/415/501 或网络超时/Abort 时，自动回退到发送最小 chat 请求验证凭证有效性；新增 `listAiModels` 函数，通过 `GET /models` 嗅探可用模型列表，按 id 字典序排序返回；新增 `AiModelListResult`、`AiModelListInput` 类型。
  - `packages/db/src/index.ts`：导出 `listAiModels`、`AiModelListResult`、`AiModelListInput`。
  - `apps/web/src/app/actions.ts`：新增 `listAiModelsAction`（OWNER/ADMIN 守卫，不写 DB，不写 UsageEvent）；`defaultAiBaseUrl` 改为从 `./admin/settings/providers` 导入。
  - `apps/web/src/app/admin/settings/credential-form.tsx`：AI 凭证表单新增"刷新模型列表"按钮，嗅探成功后显示 `<select>` 下拉选择模型（含 `ownedBy` 信息），支持"自定义..."选项回退到自由输入；新增自定义 provider 的手动确认 checkbox（勾选后覆盖 `testResult` 为通过状态，允许保存）；新增计费提示文案（测试将发送最小 API 请求）；Provider 常量改为从 `./providers` 导入。
  - `apps/web/src/app/admin/settings/page.tsx`：新增"AI 凭证与搜索凭证相互独立，可分别保存与清除"说明文案；AI 凭证表单传入 `listModelsAction` prop。
- Files: `apps/web/src/app/admin/settings/providers.ts`（新），`packages/db/src/repositories.ts`，`packages/db/src/index.ts`，`apps/web/src/app/actions.ts`，`apps/web/src/app/admin/settings/credential-form.tsx`，`apps/web/src/app/admin/settings/page.tsx`，`AGENTS_CHANGELOGS.md`。
- Verification: `pnpm typecheck` ✓，`pnpm lint` ✓，`pnpm test` ✓，`pnpm build` ✓，`git diff --check` ✓。
- Notes / Risk: (1) `POST /chat/completions` 兜底会发送一次真实请求（`max_tokens: 1`），极少量费用已通过 UI 提示告知用户；(2) `listAiModels` 返回的模型列表为远端嗅探派生数据，不持久化，刷新页面后需重新获取；(3) 自定义 provider 的"手动确认"生效后，再次切回自动测试通过的 provider 会清空手动确认状态。

## 2026-07-10

### fix:全站交互与响应式多轮审计

- Cause: 需要逐页验证交互是否畅通、功能是否易发现、组件是否遮挡/超框，以及暗色配色的可读性，并在每轮修复后继续覆盖下一组断点。
- Changed: 修复 320px 首页/收藏页横向超框和收藏页正文列压缩；主导航增加偏好入口并为主题/设置保留文字与当前页状态；首页筛选改用正确的 `nav` + `aria-current`；收藏/信源动作补文字标签，收藏标题可进入详情；Button/Input/Tabs/密码显隐控件统一至少 44px；修复全局链接色覆盖酸黄 CTA 黑字的问题；偏好置信度补 `progressbar` 语义；新增 `unsave` 状态动作，使取消收藏留在当前页并且不写 `DISMISS`；新增六档宽度全站 Playwright 回归。
- Files: `apps/web/src/app/actions.ts`, `apps/web/src/app/admin/settings/credential-form.tsx`, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/preferences/page.tsx`, `apps/web/src/app/saved/page.tsx`, `apps/web/src/app/sources/page.tsx`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/components/intelligence/topic-filter.tsx`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/components/ui/button.tsx`, `apps/web/src/components/ui/input.tsx`, `apps/web/src/components/ui/tabs.tsx`, `packages/db/src/repositories.ts`, `tests/smoke/web.spec.ts`, `tests/smoke/responsive.spec.ts`, `FRONTEND.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`.
- Verification: 本地 Prisma Postgres migration/seed/fixture；`CI=true pnpm lint` ✓；`CI=true pnpm typecheck` ✓；`CI=true pnpm test` ✓；`CI=true pnpm build` ✓；`git diff --check` ✓；生产构建 `pnpm smoke:web` 11 passed / 1 skipped；响应式矩阵 11 页面 × 6 宽度 ✓；最终 414px/1024px 截图抽查 ✓。
- Notes / Risk: `next dev` 与 `next build` / `next start` 不应并发写同一个 `apps/web/.next`；本轮没有 commit/push，不会触发 Railway 自动部署。

### fix:凭证测试后的 Key 输入保持

- Cause: “测试当前配置”的 Server Action 返回后会刷新 Server Component 数据；凭证输入框此前是非受控字段，浏览器可能清空密码值。于是界面仍显示“测试通过”，但随后保存请求缺少 `searchApiKey` 或 `aiApiKey`，服务端正确触发必填防御校验。
- Changed: `apps/web/src/app/admin/settings/credential-form.tsx` 将 API Key 改为客户端受控状态；测试动作、成功状态和后续保存均读取同一份 Key 状态。AI 与搜索表单各自拥有独立状态，测试其中一个不会影响另一个。`apps/web/src/app/actions.ts` 移除凭证保存与测试路径对通用 `readRequiredField()` 的依赖，改为只校验各自 Key，并返回明确的 AI/搜索 Key 缺失提示，避免“请补全必填内容后再提交”掩盖根因。
- Files: `apps/web/src/app/admin/settings/credential-form.tsx`, `apps/web/src/app/actions.ts`, `AGENTS_CHANGELOGS.md`.
- Verification: `pnpm typecheck` ✓，`pnpm lint` ✓，`pnpm test` ✓，`pnpm build` ✓，`git diff --check` ✓。
- Notes / Risk: Key 只保存在当前浏览器页面的 React 内存和原生表单字段中，不会写入 Local Storage、URL 或日志；刷新/离开页面仍会清空。

### fix:先测试再保存 API 凭证

- Cause: `/admin/settings` 的“测试连接”在凭证表单外，只能测试数据库中已保存的旧 Key；新填入的 Key 无法先测，用户会在保存流程中遇到笼统的必填提示，且不符合先验证后持久化的操作顺序。
- Changed:
  - `apps/web/src/app/admin/settings/credential-form.tsx`：将 AI/搜索凭证的测试按钮放进各自表单，测试当前输入；测试成功前禁用保存，修改 Key、Provider 或 AI Base URL 后要求重新测试，并在原位展示成功/失败反馈。
  - `apps/web/src/app/admin/settings/page.tsx`：移除测试已保存凭证的表单外按钮，将两个独立测试 Server Action 传入 AI/搜索表单。
  - `apps/web/src/app/actions.ts`：测试 Server Action 改为校验当前 FormData、执行权限检查后返回序列化测试结果，不重定向、不写入凭证。
  - `packages/db/src/repositories.ts`、`packages/db/src/index.ts`：连接测试函数改为接收临时 Key/Provider/Base URL 输入，避免测试路径解密或读取数据库中的旧凭证。
  - `docs/L3-modules.md`：同步“测试当前输入 → 测试通过 → 保存”的凭证配置链路。
- Files: `apps/web/src/app/admin/settings/credential-form.tsx`, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/app/actions.ts`, `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`.
- Verification: `pnpm db:generate` ✓，`pnpm typecheck` ✓，`pnpm lint` ✓，`pnpm test` ✓，`pnpm build` ✓，`git diff --check` ✓。首次 sandbox 内构建被 Turbopack CSS 处理的端口限制拦截，受限环境外复跑通过。
- Notes / Risk: AI 测试仍使用 OpenAI-compatible `{Base URL}/models`；不兼容该端点的 provider 可能需要手动确认或后续扩展其专用校验协议。

### fix:凭证表单客户端校验 + 搜索凭证测试连接

- Cause: (1) 提交 API Key 时，React Server Action 的 `<form action={serverAction}>` 绕过浏览器原生 `required` 属性校验，空值直达服务端 `readRequiredField` 后才报错"请补全必填内容后再提交"；(2) 搜索凭证 tab 缺少"测试连接"功能，与 AI 凭证 tab 不对称。
- Changed:
  - `apps/web/src/components/ui/input.tsx`：从普通函数组件改为 `React.forwardRef`，支持 `ref` 转发。
  - `apps/web/src/app/admin/settings/credential-form.tsx`：新增 `apiKeyRef`（`useRef<HTMLInputElement>`）+ `validationError` 状态 + `handleSubmit` 客户端前置校验：API Key 为空时 `preventDefault()` + 红色文字提示 + 自动聚焦；移除 `required` HTML 属性（避免浏览器原生校验与 Server Action 冲突）。
  - `packages/db/src/repositories.ts`：新增 `testSearchCredential(prisma, scope)` 函数，按 `provider`（brave → `GET /res/v1/web/search` + `X-Subscription-Token` / serpapi → `GET /search?api_key=...` / tavily → `POST /search` + body）调用对应 API 验证 Key 有效性，10s 超时，`custom` 或不支持的 provider 返回"暂不支持自动测试"提示。
  - `packages/db/src/index.ts`：导出 `testSearchCredential`。
  - `apps/web/src/app/actions.ts`：新增 `testSearchCredentialAction` Server Action（OWNER/ADMIN 守卫，调用 `testSearchCredential`，按 `result.ok` 设置 notice/error）。
  - `apps/web/src/app/admin/settings/page.tsx`：搜索凭证 tab 增加"测试连接"按钮（Zap 图标，ghost 样式），导入 `testSearchCredentialAction`。
  - `docs/L3-modules.md`：更新 `input.tsx` 描述（forwardRef）、`testSearchCredential` 函数条目、`credential-form.tsx` 描述（客户端校验）、`actions.ts` 描述（testSearchCredentialAction）、`page.tsx` 描述（搜索测试连接）、调用链（测试连接链路更新）。
- Files: `apps/web/src/components/ui/input.tsx`, `apps/web/src/app/admin/settings/credential-form.tsx`, `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/admin/settings/page.tsx`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`.
- Verification: `pnpm --filter @wangchao/web typecheck` ✓（预存 Prisma client 未生成问题不影响本次改动）, `pnpm --filter @wangchao/web lint` ✓, `pnpm --filter @wangchao/db exec tsc --noEmit` 因 Prisma client 未生成为预存错误。
- Notes / Risk: (1) 客户端校验仅检查 API Key 非空，服务端 `readRequiredField` 仍保留为防御性校验；(2) `testSearchCredential` 对 Brave/SerpAPI/Tavily 做真实 API 调用，需配置了有效的搜索 Key 的测试连接才会成功；(3) `custom` 走"暂不支持自动测试"分支，不会抛错。

## 2026-07-10

### feat:API 配置页面体验优化 - Tabs 布局、密码显隐、Provider 下拉、测试连接、清除凭证

- Cause: `/admin/settings` 页面体验粗糙：两张雷同卡片纵向堆叠无层次、Provider 是纯文本输入无引导、无密码显隐切换、无提交 loading 态、无法清除已保存凭证、无法测试连接是否有效、状态展示信息密度低、内联 style 混用。
- Changed:
  - `packages/db/src/repositories.ts`：新增 `deleteAiCredential(prisma, scope)` / `deleteSearchCredential(prisma, scope)`（upsert null 清除加密字段）、`testAiCredential(prisma, scope)`（调 `getDecryptedCredentials` 后 `GET {baseUrl}/models` 验证连接，10s 超时，返回 `CredentialTestResult`）、`CredentialTestResult` 接口。
  - `packages/db/src/index.ts`：导出 `deleteAiCredential` / `deleteSearchCredential` / `testAiCredential` / `CredentialTestResult`。
  - `apps/web/src/app/actions.ts`：新增 `deleteAiCredentialAction` / `deleteSearchCredentialAction`（OWNER/ADMIN 守卫，记录 `credential-delete` UsageEvent，redirect 反馈）、`testAiCredentialAction`（OWNER/ADMIN 守卫，调用 `testAiCredential`，根据 `result.ok` 设置 notice/error）。
  - `apps/web/src/app/admin/settings/credential-form.tsx`（新增）：`"use client"` 组件 `CredentialForm`，支持 `mode: "ai" | "search"`；密码显隐切换（Eye/EyeOff，`type="button"` 防误提交）；Provider 下拉选择（AI: OpenAI/Azure/Anthropic/Groq/DeepSeek/自定义，Search: Brave/SerpAPI/Tavily/自定义）+ 已知 Provider 自动填充 Base URL（ref 实现，非 DOM query）；Provider 帮助链接（`target="_blank" rel="noopener noreferrer"`）；必填/可选标记；`useFormStatus` 提交 loading 态（Loader2 spinner + "保存中..."）。
  - `apps/web/src/app/admin/settings/page.tsx`（重写）：两张卡片改为 `Tabs` 布局（AI 凭证 / 搜索凭证，带图标）；状态区重构为 key-value `<dl>` 布局（Key/端点/模型），显示更新时间（`formatDate` helper）；AI tab 增加"测试连接"（Zap 图标，ghost）和"清除凭证"（Trash2 图标，danger）操作；Search tab 增加"清除凭证"操作；所有内联 `style={{}}` 替换为 Tailwind 类。
- Files: `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/admin/settings/credential-form.tsx`（新增）, `apps/web/src/app/admin/settings/page.tsx`.
- Verification: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm test` ✓, `pnpm build` ✓.
- Notes / Risk: (1) 测试连接调用 `GET {baseUrl}/models`，部分 OpenAI-compatible provider 可能不支持该端点，会返回非 200 但不代表 Key 无效；(2) 清除凭证是 upsert null，如果 subscription 行不存在会创建空行（设计安全）；(3) Provider 下拉使用原生 `<select>`，option 显式设置 `bg-[#121216]` 保证暗色主题可读性；(4) 密码显隐切换按钮 `tabIndex={-1}` 避免干扰表单 Tab 流。

### test+refactor:Worker 抓取增强 — 并发、退避、错误追踪、Parser 加固（Issue #11）

- Cause: Worker 抓取管线存在 4 个问题：(1) 顺序抓取无并发控制，source 多时易超时；(2) 重试 3 次零延迟、不区分 4xx/5xx/网络错误；(3) Source 模型无错误追踪字段；(4) RSS parser 不支持 content:encoded、Atom rel=alternate、数字字符引用。
- Changed:
  - `packages/db/prisma/schema.prisma`：Source 模型新增 `lastError String?`、`lastErrorAt DateTime?`、`consecutiveFailures Int @default(0)`。
  - `packages/db/prisma/migrations/0007_source_error_tracking/migration.sql`：新增 migration。
  - `packages/db/src/repositories.ts`：新增 `recordSourceFetchFailure`（原子 increment consecutiveFailures）；修改 `recordSourceFetchSuccess` 重置错误字段；`SourceGovernanceRecord` 增加 3 个字段；`listSourceGovernanceReport` 返回新字段。
  - `apps/worker/src/index.ts`：引入内联 `pLimit` 并发控制（替代 p-limit 依赖，避免 ESM 构建冲突）；fetch loop 从顺序 for 改为 `pLimit` + `Promise.all`；`fetchSourceWithRetries` 增加指数退避（base * 2^(attempt-1) * jitter 0.5-1.0）+ 错误分类（retryable → 继续，non-retryable → 立即 break）；`fetchSourceAttempt` 失败时写入 Source 错误字段。
  - `packages/sources/src/index.ts`：新增 `FetchRssError`（携带 HTTP status）+ `isFetchRssRetryable`（408/429/5xx/AbortError/TypeError → retryable，4xx → non-retryable）；`fetchRssFeed` 抛 `FetchRssError`；parser 加固：`content:encoded` 优先于 description、Atom `rel="alternate"` 过滤、数字字符引用解码。
  - `packages/sources/src/parser.fixtures.ts`：新增 6 个 parser 边界 fixture。
  - `apps/web/src/app/sources/page.tsx`：质量报告显示 source 连续失败次数和最近错误信息。
  - `apps/web/src/lib/topic-source-data.ts`：`SourceGovernanceSummary` 增加 3 个字段映射。
  - `.env_example`：新增 `WANGCHAO_FETCH_CONCURRENCY`、`WANGCHAO_FETCH_BACKOFF_BASE_MS`。
  - `docs/L4-operations.md`：新增 Worker 抓取环境变量章节 + migration 计数更新到 7。
  - `docs/L3-modules.md`：新增 parser.fixtures.ts 条目。
  - `apps/web/package.json`、`apps/worker/package.json`：短暂加入 p-limit 后因 ESM 构建冲突移除，改用内联 pLimit。
- Files: 13 个文件（详见上方）。
- Verification: `pnpm typecheck` ✓ (7/7), `pnpm lint` ✓ (7/7), `pnpm test` ✓ (7/7), `pnpm build` ✓ (7/7), `pnpm --filter @wangchao/sources build` 后手动运行 parser/discovery fixtures 通过。
- Notes / Risk: (1) 内联 pLimit 在并发 5+ 时行为与 p-limit 一致，但未做大规模压测；(2) Source 错误字段写入会增加每轮 worker ~N 次 DB update（N = failed source 数），可接受；(3) Parser 加固仅覆盖最高影响缺口（content:encoded、Atom rel、数字实体），完整 XML parser 替换未做；(4) 质量统计部分（SourceObservation + listSourceGovernanceReport + web UI）已 ~80% 完成，本次补齐 fetch 级错误追踪。

### refactor:迁移表单到 shadcn Input/Label/Textarea primitives（Issue #16）

- Cause: `Input`、`Label`、`Textarea` 三个 shadcn primitives 已存在于 `apps/web/src/components/ui/`，但被 0 个页面使用。`topics/new` 和 `admin/settings` 仍使用 raw `<input>` / `<textarea>` / `<label>` + 手写 CSS 类（`.topic-form`、`.candidate-form`、`.topic-name-input`），是"声称完成但实际没落地"的技术债。
- Changed:
  - `apps/web/src/app/topics/new/page.tsx`：`<label>` -> `<Label htmlFor>`、`<input>` -> `<Input>`、`<textarea>` -> `<Textarea>`；表单容器 `topic-form` -> `grid gap-3`；label+input 组包裹为 `grid gap-2 text-muted-foreground text-xs font-bold`；`topicName` Input 通过 className 保留大字号（`min-h-16 border-2 text-[clamp(1.25rem,3vw,2rem)] font-black`）。
  - `apps/web/src/app/admin/settings/page.tsx`：两个表单（AI 凭证、搜索凭证）共 6 个字段全部从 raw `<label>`+`<input>` 迁移到 `<Label>`+`<Input>`；表单容器 `candidate-form` -> Tailwind 等价类 `grid gap-3 border border-border rounded-md bg-[#0f0f13] p-4`；保留所有 `name`/`type`/`required`/`placeholder`/`autoComplete`/`defaultValue` 属性。
  - `globals.css` 中的 `.topic-form`/`.candidate-form` CSS 块保留不动，因为 `sources/page.tsx` 和 `topics/[topicId]/edit/page.tsx` 仍引用。
- Files: `apps/web/src/app/topics/new/page.tsx`, `apps/web/src/app/admin/settings/page.tsx`.
- Verification: `pnpm --filter @wangchao/web typecheck` ✓, `pnpm --filter @wangchao/web build` ✓, `pnpm typecheck` ✓ (7/7), `pnpm lint` ✓ (7/7), `pnpm test` ✓ (7/7), `pnpm build` ✓ (7/7), `git diff --check` ✓.
- Notes / Risk: `sources/page.tsx` 的 `candidate-form` 和 `topics/[topicId]/edit/page.tsx` 的 `topic-form` 未迁移，留作后续。`Label` 是 `"use client"` 组件，在 Server Component 页面中导入无问题（Next.js 自动处理 client boundary）。

### test:补齐 AI Adapter 测试覆盖（Issue #12）

- Cause: `packages/ai` 的测试覆盖不足，`OpenAiCompatibleAdapter` 的 retry、timeout、JSON mode fallback、错误处理路径，以及 parser 的复杂输入边界均缺少 fixture 覆盖。
- Changed:
  - 新增 `packages/ai/src/adapter.fixtures.ts`，导出 `runAdapterFixtures()`，覆盖 12 个场景：标准响应、output_text fallback、空 choices、multi-choice 取 `choices[0]`、4xx 不可重试、5xx 重试后成功、429 重试后成功、maxRetries 耗尽、非 JSON 错误体、AbortError 重试后失败、JSON mode fallback、JSON mode 记忆。
  - 在 `packages/ai/src/parser.fixtures.ts` 的 `runParserFixtures()` 末尾追加 8 个 parser 边界测试：嵌套对象、root array 拒绝、markdown fence 包裹、截断 JSON、夹带解释文本、think 标签+markdown fence 混合、trailing comma 修复、unquoted key 修复。
  - 修改 `packages/ai/src/openai-compatible.ts` 使 `!response.ok` 分支能处理非 JSON 错误体：先 `try { await response.json() }`，失败则 `catch { await response.text() }`，将文本作为 `AiHttpError` 的 body。
  - `packages/ai/package.json` 的 test script 末尾追加 `adapter.fixtures.js` 执行。
- Files: `packages/ai/src/adapter.fixtures.ts`（新增）, `packages/ai/src/parser.fixtures.ts`, `packages/ai/src/openai-compatible.ts`, `packages/ai/package.json`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`.
- Verification: `pnpm --filter @wangchao/ai test` ✓（5 个 fixture 文件全部通过）, `pnpm --filter @wangchao/ai typecheck` ✓, `git diff --check` ✓.
- Notes / Risk: `openai-compatible.ts` 的改动是最小改动：仅影响 `!response.ok` 分支的错误体读取逻辑，成功路径不受影响。`AiHttpError` 仍未导出，测试通过 `(error as any).status` 访问。`@wangchao/web` 的 typecheck/test 失败是预存问题（`.next/types` 生成文件冲突），与本次改动无关。

### fix:修复 Worker Cron 部署后 prisma.organization.upsert() crash

- Cause: commit `dc0cbb5`（Admin 后台 API Key 配置）在 `Organization` model 新增了 `subscription Subscription?` relation 和 migration `0006`，但 Railway 的 worker 和 source-discovery cron 服务没有 predeploy 步骤。当 GitHub 自动同步同时触发 web 和 worker 部署时，worker 在 web 的 migration 完成前就启动并调用 `prisma.organization.upsert()`，Prisma 7.x WASM query compiler 因数据库 schema 与 client schema 不匹配而抛出 `Invalid invocation`（错误信息被截断），导致 worker crash。此外 worker 的 catch 块仅输出 `error.message`，Prisma 7.x driver adapter 模式下错误信息不完整，增加了排查难度。
- Changed:
  - `deploy/railway/worker-cron.railway.json` 和 `deploy/railway/source-discovery-cron.railway.json` 新增 `preDeployCommand`，在启动前运行 `pnpm railway:worker:predeploy`（即 `pnpm db:wait && pnpm db:deploy`），确保数据库可达且 migration 已应用。
  - `package.json` 新增 `railway:worker:predeploy` 脚本。
  - `apps/worker/src/index.ts` 的 catch 块增加 `error.stack`、Prisma `code` 和 `meta` 输出，避免 Prisma 7.x driver adapter 模式下错误信息被截断。
- Files: `deploy/railway/worker-cron.railway.json`, `deploy/railway/source-discovery-cron.railway.json`, `package.json`, `apps/worker/src/index.ts`, `AGENTS_CHANGELOGS.md`, `docs/L4-operations.md`, `docs/railway-deployment.md`.
- Verification: `pnpm typecheck` ✓, `pnpm lint` ✓, `pnpm build` ✓, `git diff --check` ✓.
- Notes / Risk: 三个 Railway 服务（web、worker cron、source-discovery cron）的 predeploy 都会运行 `db:wait && db:deploy`。Prisma `migrate deploy` 是幂等的，已应用的 migration 不会重复执行，因此多服务并行 predeploy 不会冲突。predeploy 会使 cron 服务的部署时间增加约 3-5 秒（db:wait 探测 + migrate deploy 检查），但不影响 cron 执行时间窗口。

### fix #25 + feat #9: 情报卡片摘要修复 + 主题管理补齐

- Cause: GitHub issue #25（HN RSS 卡片显示"原文链接已收录"UI 导航提示而非 LLM 摘要）和 #9（Topic 编辑/暂停/归档/删除生命周期管理缺失）。
- Changed:
  - #25: `createIntelligenceEventDraft()` 规则回退路径不再使用原始 RSS summary（含 `Article URL:`/`Points:`/`# Comments:` 等元数据），改为 `buildRuleFallbackSummary()` 清洗后使用 title 作为 fallback；`formatEventSummary()` 不再返回"原文链接已收录..."提示文案，改为清洗 RSS 元数据标记后用 title 作正文；worker LLM 失败时记录结构化 stderr 日志；导出 route 也使用 `buildEventDisplayFields()` 清洗 summary。
  - #9: 新增 `getTopicById()`/`listAllTopics()`/`updateTopic()`/`updateTopicStatus()`/`deleteTopic()` repository 函数；新增 `updateTopicAction`/`updateTopicStatusAction`/`deleteTopicAction` Server Actions（OWNER/ADMIN 守卫）；新增 `/topics` 列表页、`/topics/[topicId]` 详情页、`/topics/[topicId]/edit` 编辑页、`DeleteTopicButton` 客户端组件（二次确认）；TopNav 增加主题管理入口；`TopicSummary` 增加 `status` 字段。
- Files: `packages/core/src/index.ts`, `packages/core/src/index.fixtures.ts`, `packages/core/package.json`, `apps/web/src/lib/event-display.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/topics/page.tsx`, `apps/web/src/app/topics/[topicId]/page.tsx`, `apps/web/src/app/topics/[topicId]/edit/page.tsx`, `apps/web/src/components/topics/delete-topic-button.tsx`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `apps/worker/src/index.ts`, `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `tests/smoke/web.spec.ts`, `docs/L2-domain.md`, `docs/L3-modules.md`.
- Verification: `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm test` ✓ (含新增 `runCoreFixtures()` 测试), `pnpm build` ✓, `git diff --check` ✓.
- Notes / Risk: Topic 删除为硬删除+级联，UI 有二次确认保护。Worker 不需要改动（已通过 repository `status: "ACTIVE"` 过滤自动跳过 PAUSED/ARCHIVED 主题）。`event-display.ts` 新增 `title` 参数，调用方 `topic-source-data.ts` 和 export route 已同步更新。现有数据库中已写入的旧 RSS 元数据 summary 会在下次展示/导出时被清洗，但 DB 中的原始值不变。

### 扩充系统默认信源包

- Cause: 用户确认新增一批系统默认信源，用于扩大新建主题时内置信源包匹配范围。
- Changed: 将 `packages/db/seed-sources.json` 从 1 个 AI 主题扩展到 8 个主题、34 个 RSS/Atom 源，覆盖 AI 基础设施、云平台与 DevOps、开源与软件工程、网络安全、算力与半导体、科技商业、标准与政策、中文科技；对初始候选清单中不可用的 RSS 地址做稳定替换（DeepMind、PostgreSQL、MSRC、a16z），机器之心当前未找到可验证官方 RSS，未写入默认包。
- Files: `packages/db/seed-sources.json`, `AGENTS_CHANGELOGS.md`。
- Verification: 已通过 JSON parse 与重复 URL 检查（8 topics / 34 sources / 0 duplicate URLs）；已联网验证 34 个写入后的 feed 均返回 HTTP 200 且包含 RSS/Atom 根节点；`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`git diff --check` 均通过。
- Notes / Risk: 本次只改默认信源数据和审计日志，不改变 seed schema、数据库 schema 或治理状态机。已有部署 re-seed 仍遵守 create-only 逻辑，不会重置用户在 UI 中治理过的 source status。

### Admin 后台 API Key 配置（Subscription 凭证管理）

- Cause: 用户要求不通过环境变量配置 API Key，而是在 Admin 后台配置；Admin 后台不显示完整 Key，只可新增或覆盖；AGENTS.md 需同步更新凭证管理规则。
- Changed: 新增 `Subscription` Prisma 模型（`organizationId` 1:1，含 AI 凭证和搜索凭证字段，AES-256-GCM 加密存储）和 migration `0006_subscription_credentials`；新增 `packages/db/src/crypto.ts` 加密工具（`encryptCredential`/`decryptCredential`/`maskKeyHint`）；新增 DB repository 函数 `getSubscriptionCredentialView`、`upsertAiCredential`、`upsertSearchCredential`、`getDecryptedCredentials`；Worker 三个工厂函数 `createSearchProvider`/`createSourceRecommendationRuntime`/`createAnalysisRuntime` 改为 async 并接收 `(prisma, organizationId)`，DB 优先读取凭证、env var fallback；新增 `/admin/settings` 页面（展示脱敏 hint、不显示完整 Key、表单可新增/覆盖 Key）和 Server Actions `upsertAiCredentialAction`/`upsertSearchCredentialAction`（OWNER/ADMIN 权限）；TopNav 新增齿轮图标入口；`.env_example` 新增 `ENCRYPTION_KEY`；AGENTS.md 新增 §5.2 凭证管理规则和 §12 安全规则；同步 `docs/L2-domain.md`、`docs/L3-modules.md`、`docs/L4-operations.md`、`docs/business-model.md`。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0006_subscription_credentials/migration.sql`, `packages/db/src/crypto.ts`, `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `apps/worker/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/app/globals.css`, `.env_example`, `AGENTS.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `docs/business-model.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm --filter @wangchao/db exec tsc --noEmit` 通过；`pnpm --filter @wangchao/worker exec tsc --noEmit` 通过；`pnpm --filter @wangchao/web exec tsc --noEmit` 通过；待跑完整 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
- Notes / Risk: 此实现是 Phase 15 BYOK/Subscription 模型的前置基础，字段名用 `ai*`/`search*` 而非 `byok*`，Phase 15 可在同表扩展 Plan/Stripe 字段。`ENCRYPTION_KEY` 为必填环境变量（当使用 Admin 配置时）。Migration `0006` 会通过 Railway Web predeploy 自动执行（`pnpm db:deploy`）。Worker 读取 Key 时若 DB 无配置或 `ENCRYPTION_KEY` 未设置，会 fallback 到 env var，保持向后兼容。

### 修复 Railway Web predeploy 数据库冷启动失败

- Cause: 最近一次 Railway Web deployment 在 build 成功后，于 predeploy 执行 `prisma migrate deploy` 时遇到 `P1001: Can't reach database server at postgres.railway.internal:5432`；Railway Postgres 日志显示数据库稍后才 ready，属于睡眠/冷启动窗口内没有等待数据库可达。
- Changed: 新增 `scripts/wait-for-database.mjs`，从 `DATABASE_URL` 解析 host/port 并做不泄露连接串的 TCP readiness 重试；新增根脚本 `pnpm db:wait`；将 `railway:predeploy` 和 `deploy/railway/web.railway.json` 的 predeploy 改为 `pnpm db:wait && pnpm db:deploy && pnpm db:seed`；同步 `.env_example`、`CODEGUIDE.md`、`docs/L3-modules.md`、`docs/L4-operations.md` 和 `docs/deployment.md`。
- Files: `scripts/wait-for-database.mjs`, `package.json`, `deploy/railway/web.railway.json`, `.env_example`, `CODEGUIDE.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `docs/deployment.md`, `AGENTS_CHANGELOGS.md`。
- Verification: 已通过 `pnpm db:wait` failure-path smoke（10ms timeout，未输出完整连接串）、`pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`git diff --check`；`CI=true pnpm build` 在沙箱内因 Turbopack 创建进程/绑定端口被拒绝失败，非沙箱重跑同一命令通过（7/7 packages）。提交 `19d9d5d` 推送后，Railway Web deployment `8a58ab54-c682-4385-8afb-beb8f3b85bc1` 使用新 predeploy，日志显示 `db:wait` 第 2 次探测连上 Postgres，`0003_event_merge`、`0004_title_hash`、`0005_event_item` migration 全部应用成功，seed 成功，Next.js 启动；生产 `/api/health` 返回 `status: ok`、database `ok`。
- Notes / Risk: 脚本只输出 host/port 和错误码，不输出数据库用户名、密码或完整 URL。Postgres 仍配置为可 sleep；本修复解决 predeploy 冷启动等待问题，但长期生产可考虑关闭数据库 sleep 或增加更明确的 Railway health/backup 策略。

## 2026-07-09

### 修复移动端真实渲染与 RSS/HTML 摘要泄露

- Cause: 用户截图反馈移动端仍存在真实渲染问题：顶部宽度不一致、搜索区域过窄、卡片内直接展示 `<p>Article URL...` HTML 源码和长 URL，导致手机阅读不可用。
- Changed: 新增 `apps/web/src/lib/event-display.ts`，在工作台列表和详情页返回前清洗展示字段：RSS/HTML 摘要转为用户文案、提取 Article URL 作为真正原文链接、解释文案本地化；补强移动端 CSS，搜索框使用全宽自适应列、页面头部允许全宽、卡片来源/摘要/解释长文本断行、顶部 CTA 在窄屏等宽居中、底部增加 Safari 工具栏避让空间；同步更新 `docs/L3-modules.md`。
- Files: `apps/web/src/lib/event-display.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/globals.css`, `docs/L3-modules.md`。
- Verification: 已运行 `CI=true npx --yes pnpm@11.7.0 lint`、`typecheck`、`test` 全部通过；首次完整链路在 `build` 阶段被工具 600s 超时截断，随后单独重跑 `CI=true npx --yes pnpm@11.7.0 build` 通过；`git diff --check` 通过；展示清洗源码断言（提取 Article URL、移除裸 URL、本地化 matched keywords、fallback 原文文案）全部 PASS。
- Notes / Risk: 这是对已部署移动端适配不足的修复；push 到默认分支会再次触发 Railway 自动部署，部署后必须用真实手机宽度截图复验。

### 明确移动端原生支持并优化前端触达

- Cause: 用户要求在 AGENTS.md 中明确必须对移动端做原生支持，并进行前端优化。
- Changed: 在 `AGENTS.md` 增加 mobile-first 硬性协作规则；优化顶部导航 active 状态、触摸横向滚动与窄屏 CTA；将情报卡片动作改为带文字标签的触摸按钮；补充 safe-area、搜索/筛选 44px 触达与窄屏两列动作布局；同步更新 `FRONTEND.md` 和 `docs/L3-modules.md`。
- Files: `AGENTS.md`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/app/globals.css`, `FRONTEND.md`, `docs/L3-modules.md`。
- Verification: 已运行 `npx --yes pnpm@11.7.0 db:generate`；`CI=true npx --yes pnpm@11.7.0 lint`、`typecheck`、`test`、`build` 全部通过；`git diff --check` 通过；移动端源码断言（AGENTS mobile-first、TopNav active/touch scroll、safe-area、44px、卡片动作文字/两列）全部 PASS。
- Notes / Risk: 纯前端与协作规范更新；push 到默认分支可能触发 Railway 自动部署。

# AGENTS_CHANGELOGS.md

本文件是 AI Agent 工作审计日志，替代已废弃的 `CHANGELOG.md`。每条记录说明修改的原因、实际变更、涉及文件、验证方式和风险。

## 2026-07-09

### Step B 迭代：Dashboard/Briefing 多来源展示 + 标题归一化 + EventItem 联结表 + 语义聚类

- Cause: Step A 落地了多来源合并的基础设施和字段扩展，但用户侧无法感知多来源价值（Dashboard/Briefing 只展示主源），且去重仍局限于精确 hash 匹配。
- Changed:
  - B2: Dashboard 卡片 header 行增加 `mergedSourceCount > 1` 时展示"另有 N 个来源报道"
  - B3: Briefing Markdown 渲染时在 Source 行后列出 "Also reported by: xxx"；`listEventsForDailyBriefing` 批量查询 secondary source 信息
  - B4: 新增 `semantic-dedup.ts` — 独立 LLM prompt 做事件对语义比较；worker 新增 `runSemanticDedupCycle`（48h 窗口、按 topic 分组、实体预过滤、LLM 判断、置信度≥0.7 触发合并）
  - B5: 新增 `EventItem` 联结表替代 `secondaryItemIds` 数组，携带 role/mergedAt/mergeReason 元数据；`mergeSemanticEvents` 事务函数；保留 `secondaryItemIds` 为 deprecated
  - B1: `normalizeTitleForFuzzyMatch()` 去除站点后缀；`createTitleHash()` 生成标题 hash；`upsertIntelligenceEventFromItem` 精确 hash 未命中时做标题 hash + ±24h 模糊匹配
- Files: `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/lib/topic-source-data.ts`, `packages/db/src/repositories.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0004_title_hash/migration.sql`, `packages/db/prisma/migrations/0005_event_item/migration.sql`, `packages/core/src/index.ts`, `packages/ai/src/semantic-dedup.ts`, `packages/ai/src/semantic-dedup.fixtures.ts`, `packages/ai/src/index.ts`, `packages/ai/package.json`, `packages/db/src/index.ts`, `apps/worker/src/index.ts`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `pnpm typecheck`（7/7）、`pnpm lint`（7/7）、`pnpm test`（7/7）、`pnpm build`（7/7）、`pnpm db:validate`、`git diff --check`
- Notes / Risk: `secondaryItemIds` 保留 deprecated 确保已有数据兼容；语义聚类 LLM 调用有 API 成本，通过实体预过滤和置信度阈值控制；Step A 的 migration 0003 + 本次 0004/0005 共 3 个新 migration，未部署到生产库前无风险。

### 情报事件多来源合并、实体抽取和后续跟踪（Issue #6 Step A）

- Cause: Issue #6 指出现阶段 IntelligenceEvent 仅支持单来源（primaryItem），缺少 entities、followUpSuggestion 字段，且 hash 冲突时旧来源被覆盖丢失。SPEC.md §5.4 明确要求这三个字段作为情报输出。DEVELOPE_LOGS.md Phase 8 follow-up 已标记为后续扩展项。
- Changed:
  - DB: `IntelligenceEvent` 新增 `entities String[]`、`followUpSuggestion String?`、`mergeReason String?`、`secondaryItemIds String[]` 字段；migration `0003_event_merge`
  - Repository: `upsertIntelligenceEventFromItem` 改为 hash 冲突时旧 primaryItemId 推入 secondaryItemIds（不再覆盖丢失来源），写入 mergeReason
  - AI Extraction: prompt schema 增加 entities 和 followUpSuggestion 输出要求；parser 解析新字段；fallback 返回空默认值
  - Core: `AiEventExtraction`、`IntelligenceEventDraft`、`MarkdownEventInput` 增加新字段；`renderEventMarkdown` 展示 entities 和 followUpSuggestion
  - Worker: `extractionToAiEventExtraction` 传递新字段；`runAnalysisCycle` 调用 upsert 时传入
  - Web: 详情页展示实体 Badge 列表、后续跟踪建议、合并原因；导出 route 传递新字段
  - 文档: L2-domain.md 更新 IntelligenceEvent 描述和多来源合并规则；L3-modules.md 补充 event-extraction.ts 和 createIntelligenceEventDraftFromExtraction
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_event_merge/migration.sql`, `packages/db/src/repositories.ts`, `packages/ai/src/event-extraction.ts`, `packages/ai/src/event-extraction.fixtures.ts`, `packages/core/src/index.ts`, `apps/worker/src/index.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/events/[eventId]/page.tsx`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `docs/L2-domain.md`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`
- Verification: 待 Phase 8 执行 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm db:validate`
- Notes / Risk: 新字段均为 nullable 或带默认值，不影响已有事件数据；旧 AI 输出不含新字段时通过 `?? []` / `?? ""` 兜底；secondaryItemIds 数组通过 includes 去重防止重复推入；Step B（语义聚类、独立 EventItem 联结表）留作后续迭代。

### 明确 GitHub 自动同步到 Railway 的部署目标

- Cause: 用户指出部署目标应是 GitHub 自动同步到 Railway，GitHub integration 已连接；要求未来开发注意利用 Railway 的平台优势，并同步 `README.md` 和 `AGENTS.md`。
- Changed: 在 `AGENTS.md` 技术栈中明确 Deployment 为 GitHub 自动同步到 Railway；将 Phase 13 调整为 GitHub → Railway 部署运维；重写 GitHub / Railway 自动部署治理段，明确当前 GitHub integration 已连接、默认生产形态为 Railway Web、Worker Cron、Source Discovery Cron 和 Railway managed Postgres，并要求后续开发优先复用 Railway 的 Config as Code、Cron、managed Postgres、healthcheck、rollback、backup/PITR 和 logs。更新 `README.md` 当前阶段、部署方式、目录说明、个人版边界和参考文档，明确 GitHub → Railway 是主部署路径。
- Files: `AGENTS.md`, `README.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已检查 `AGENTS.md` 相关章节、`README.md` 部署相关段落、`CODEGUIDE.md` L0/L1 和 `docs/L4-operations.md` Railway 部署说明；本次仅修改文档和审计日志，未改运行时代码、部署配置或环境变量。
- Notes / Risk: 本次不会立即触发 Railway 配置变化；如果这些文档变更 commit 到默认分支，仍可能因 GitHub 自动同步触发 Railway 文档-only 部署。

## 2026-07-08

### 前端组件链迁移到 shadcn/Radix/Tailwind v4

- Cause: Issue #16 要求评估并补齐 shadcn/Radix/Tailwind 组件链。原前端使用本地 primitives + 1631 行纯原生 CSS，`components.json` 形同虚设，Tabs 无键盘导航/ARIA，无 Form 组件。用户选择路径 A（完整切换到标准组件链）。
- Changed: 安装 Tailwind v4 + `@tailwindcss/postcss` + `class-variance-authority` + `clsx` + `tailwind-merge` + `@radix-ui/react-tabs` + `@radix-ui/react-slot` + `radix-ui` 聚合包；新建 `postcss.config.mjs`；`globals.css` 顶部加 `@import "tailwindcss"` 和 `@theme` 块映射语义 token 为 `--color-*`；`cn()` 升级为 `twMerge(clsx(...))`；通过 `shadcn add` 生成标准 Button/Card/Badge/Tabs/Input/Label/Textarea；自定义 Button 增加 `primary`/`danger` 变体和 44px 最小点击区域；自定义 Card 增加 `work`/`kinetic` variant；自定义 Badge 增加 `accent`/`success`/`warning`/`danger` 语义变体；Tabs 现基于 Radix 提供完整键盘导航和 ARIA；所有页面 `<Link className="ui-button...">` 迁移到 Button `asChild`；表单 `<button className="ui-button...">` 迁移到 shadcn Button；删除 globals.css 中已废弃的 `.ui-button-*`/`.ui-card-*`/`.ui-badge-*`/`.ui-tabs-*`/`.metric-*`/`.metrics-grid` CSS 块和对应响应式规则。
- Files: `apps/web/package.json`, `apps/web/postcss.config.mjs`(new), `apps/web/src/app/globals.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/{button,card,badge,tabs,input,label,textarea}.tsx`, `apps/web/src/components/layout/top-nav.tsx`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/app/{page,saved,preferences,briefings,sources,events/[eventId],topics/new}/page.tsx`, `apps/web/src/app/error.tsx`, `CODEGUIDE.md`, `docs/L3-modules.md`, `FRONTEND.md`, `AGENTS_CHANGELOGS.md`
- Verification: `pnpm --filter @wangchao/web typecheck` 通过；`pnpm --filter @wangchao/web build` 通过（Next.js 16 + Turbopack，所有 11 条路由生成成功）。尚未运行完整 `pnpm lint`/`pnpm test`/`pnpm build`（根 workspace 级）和浏览器视觉检查。
- Notes / Risk: Kinetic Intelligence 视觉风格（酸黄、硬边、网格背景、topic-lab 水印、shimmer 动效、reduced-motion）全部保留为 `@layer components` 自定义类，未迁移为纯 Tailwind 工具类，以控制工作量并避免视觉回归。`radix-ui` 聚合包提供 Slot/Tabs/Label 等 primitives。Tabs 现在具备真正的 a11y 行为（键盘箭头导航、roving tabindex、aria-selected/aria-controls）。本次会触发 Railway 自动部署（web 依赖变更 + globals.css 变更），已通过 typecheck + build 验证。

- Cause: 随着代码量增长，原 `CODEGUIDE.md` 扁平 6 节结构把所有抽象层混在一起（基础设施、领域逻辑、编排、接口层全塞进一个超长数据流图），AI 和人工都难定位。需要按抽象层级重组文档，方便逐层下钻。
- Changed: 将 `CODEGUIDE.md` 重组为 L0（系统架构）+ L1（设计原则与边界）主文件 + L2/L3/L4 索引段。新建 `docs/L2-domain.md`（领域模型/状态机/术语表）、`docs/L3-modules.md`（按包分章节的模块细节和调用链）、`docs/L4-operations.md`（命令/环境变量/部署/测试）。在 `AGENTS.md` 新增第 8 节"文档分层规则与阅读协议"，明确分层定义、阅读协议、分层归属规则和维护原则。更新 `SPEC.md` 第 8 节为分层指引表。更新 `README.md`/`README-en.md` 引用新文档结构。
- Files: `CODEGUIDE.md`, `docs/L2-domain.md`(new), `docs/L3-modules.md`(new), `docs/L4-operations.md`(new), `AGENTS.md`, `SPEC.md`, `README.md`, `README-en.md`, `AGENTS_CHANGELOGS.md`
- Verification: 纯文档重组，无代码改动，无需 lint/typecheck/build。已检查所有内部链接锚点一致、无内容丢失（原 CODEGUIDE 内容按分层归属迁移到对应文件）。
- Notes / Risk: L3/L4 文件锚点链接使用 GitHub markdown 自动生成格式，后续如发现锚点不匹配需修正。本次不触发 Railway 自动部署（纯文档变更）。

### 修复 Railway Cron 服务运行时 workspace dist 缺失

- Cause: Web 配置修复并 push 后，Railway GitHub 自动部署触发 `wangchao-worker`，其 cron config 仅构建 worker 包，运行时缺少 `@wangchao/ai/dist/index.js`，导致 deployment `CRASHED`。
- Changed: 将 `deploy/railway/worker-cron.railway.json` 和 `deploy/railway/source-discovery-cron.railway.json` 的 build command 从 `pnpm railway:worker:build` 改为 `pnpm railway:build`，让 cron services 与 Web service 一样保留完整 workspace build 输出；同步 `CODEGUIDE.md` 和 `deploy/railway/README.md`。
- Files: `deploy/railway/worker-cron.railway.json`, `deploy/railway/source-discovery-cron.railway.json`, `CODEGUIDE.md`, `deploy/railway/README.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过三个 Railway JSON 配置解析检查、`pnpm railway:build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `git diff --check`。
- Notes / Risk: 该修复会再次触发 Railway 自动部署；预期能解决 worker/source-discovery 运行时找不到 workspace dist 的问题，但会增加 cron service build 范围。

### 修复 Railway Web Config as Code 构建命令

- Cause: Railway Web service 切换到 `deploy/railway/web.railway.json` 后，GitHub 自动部署中的 Web-only build 无法解析 `@wangchao/*` workspace 包，导致最新 Web deployment 失败。
- Changed: 将 `deploy/railway/web.railway.json` 的 build command 从 `pnpm railway:web:build` 改为 `pnpm railway:build`，让 Web service 在 Railpack 中执行完整 monorepo 构建；同步 `CODEGUIDE.md` 和 `deploy/railway/README.md`，说明该配置是为了保留 workspace 包解析上下文。
- Files: `deploy/railway/web.railway.json`, `CODEGUIDE.md`, `deploy/railway/README.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `node` JSON 解析检查、`pnpm railway:build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `git diff --check`。
- Notes / Risk: 该配置会增加 Web deployment 构建范围，但避免 per-service Web 构建在 Railway/Railpack 中裁剪 workspace 依赖；本地未 commit/push，不会立即触发 GitHub 自动部署。

### 明确 GitHub/Railway 自动部署提交边界

- Cause: 用户计划采用 Railway 连接 GitHub 自动部署，并要求在 `AGENTS.md` 明确说明 commit / push 可能触发部署，避免 AI Agent 把小修小改默认提交到默认分支。
- Changed: 在 `AGENTS.md` 新增“GitHub / Railway 自动部署与 commit 治理”规则，说明默认分支 commit / push 可能触发 Railway Web、Worker 或 Cron 服务重新部署；要求只有重要功能更新、线上修复、部署/DB/环境变量变更、用户明确要求发布或完成可验证阶段性改动时才提交，并要求提交前说明部署影响与完成相应验证。
- Files: `AGENTS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已检查文档位置和规则表述；本次仅修改协作规范与审计日志，未改运行时代码、部署配置或环境变量。
- Notes / Risk: 规则本身不会启用 GitHub 自动部署；后续真正连接 Railway GitHub integration 或新增 GitHub Actions 时，仍需单独同步 `CODEGUIDE.md`、部署文档和验证流程。

### 新建主题自动生成 profile 并发现候选源

- Cause: 修复 GitHub Issue #2，将新建主题入口从“必须手动绑定 RSS”调整为“只填写主题名称和描述”，并在创建后自动生成关键词/profile、匹配内置信源包和写入可治理候选源。
- Changed: 新增 `createTopicAction()`，创建主题时生成 `Topic.profile` 初稿，并基于 `packages/db/seed-sources.json` 匹配候选 RSS/Atom；新增 RSS feed validator，要求 HTTP/HTTPS、真实 RSS/Atom 根节点和 feed title，并记录 feed title、item count、validation URL、匹配关键词等 `SourceObservation.evidence`；新建主题页面移除关键词/RSS 字段；新增 smoke 覆盖“只需名称和描述”；Playwright smoke 改为单 worker 以避免真实 Server Action 与公网 RSS 验证并行干扰；同步 `.env_example`、`README.md`、`SPEC.md`、`CODEGUIDE.md` 和 `DEVELOPE_LOGS.md`。
- Files: `apps/web/src/app/actions.ts`, `apps/web/src/app/topics/new/page.tsx`, `apps/web/package.json`, `packages/core/src/index.ts`, `packages/sources/src/index.ts`, `packages/sources/src/discovery.fixtures.ts`, `tests/smoke/web.spec.ts`, `playwright.config.ts`, `.env_example`, `README.md`, `SPEC.md`, `CODEGUIDE.md`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`, `pnpm-lock.yaml`
- Verification: 已通过 `pnpm db:validate`、临时 Docker Postgres 上 `pnpm db:deploy` 应用 0001/0002 migration、`pnpm db:seed`；已通过 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`；已通过沙箱外 `pnpm smoke:web`（desktop/mobile 共 4 passed，2 skipped；详情页跳过因临时库未运行 worker 生成事件）。SQL 验证最新 smoke 主题包含 `profile.keywords`，候选源以 `CANDIDATE` 写入，`SourceObservation.evidence` 包含 feed title、feed item count、validation URL、matched keywords 和 discovery channel。
- Notes / Risk: 新建主题的候选源发现仍依赖公网 RSS 响应；为避免表单长时间等待，默认 `WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS=2000`，超时或无匹配时主题仍会创建成功并提示用户去信源管理页继续发现。真实部署中可按网络质量调高该值。

### 实现 Phase 5 自动信源发现

- Cause: 修复 GitHub Issue #1，落地 SPEC Phase 5 自动信源发现，让系统可围绕主题主动发现候选 RSS/Atom 信源，并接入现有 source governance 状态机。
- Changed: 新增 `SOURCE_DISCOVERY` TaskRun/UsageEvent 枚举、`Source.recommendationReason`、`Source.discoveryChannel` 和 migration；新增 sources discovery 模块（Brave Search provider、RSS/Atom 探测、外链提取、topic query 生成）及 fixture；新增 AI source recommendation prompt/JSON 解析/sanitize/fallback 及 fixture；worker 新增 `runSourceDiscoveryCycle()`、`--source-discovery` CLI、关键词搜索/高分反查/外链网络三渠道、小批量限流和审计写入；Web 信源页新增“发现新源”按钮、推荐理由/发现渠道展示；新增 Railway 周频 discovery cron 示例；同步 `.env_example`、`SPEC.md`、`README.md`、`CODEGUIDE.md`、`deploy/railway/README.md` 和 `DEVELOPE_LOGS.md`。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0002_source_discovery/migration.sql` (新建), `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `packages/sources/src/discovery.ts` (新建), `packages/sources/src/discovery.fixtures.ts` (新建), `packages/sources/src/index.ts`, `packages/sources/package.json`, `packages/ai/src/source-recommendation.ts` (新建), `packages/ai/src/source-recommendation.fixtures.ts` (新建), `packages/ai/src/parser.fixtures.ts` (新建), `packages/ai/src/index.ts`, `packages/ai/package.json`, `apps/worker/src/index.ts`, `apps/worker/package.json`, `apps/web/src/app/actions.ts`, `apps/web/src/app/sources/page.tsx`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/package.json`, `deploy/railway/source-discovery-cron.railway.json` (新建), `.env_example`, `README.md`, `SPEC.md`, `CODEGUIDE.md`, `deploy/railway/README.md`, `package.json`, `pnpm-lock.yaml`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`
- Verification: 已通过 `pnpm db:generate`、`pnpm db:validate`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`。临时 Docker Postgres 上顺序验证 `pnpm db:deploy` 应用 0001/0002 migration、`pnpm db:seed`、`pnpm --filter @wangchao/worker start` 生成 1874 条 item/29 条事件/1 份简报；`pnpm worker:source-discovery` 在无 Brave/AI key 时跳过关键词搜索，完成 `SOURCE_DISCOVERY` TaskRun/UsageEvent 写入，并正确把已存在 active source 计为 observed 而不污染 active source；直接验证 `createCandidateRssSource()` 对新 URL 写入 `CANDIDATE`、`discoveryChannel`、`recommendationReason`、`trustScore=0.9`。带临时数据库并在沙箱外重跑 `pnpm smoke:web`，4 个 Playwright desktop/mobile smoke tests 全部通过。
- Notes / Risk: 本地 seed 拉取 GitHub raw link 时返回 404/timeout 后按设计 fallback 到仓库内 `packages/db/seed-sources.json`。Brave Search 和 AI recommendation 均为 BYOK；未配置时不会阻塞 discovery，但关键词搜索会跳过、推荐理由走 deterministic fallback。

### 补齐前端详情页、URL 筛选联动和 smoke test

- Cause: 用户要求按前端体验缺口计划落地：情报详情独立页面、搜索与主题筛选 URL 高亮联动、Playwright smoke test 覆盖。
- Changed: 新增 `/events/[eventId]` 情报详情页，卡片标题跳转到稳定详情 URL，详情页包含主题/来源/时间/分数/解释、已读/收藏/减少、Markdown 导出和原文链接；新增 `getDashboardEventById()` 和 `getDashboardEventDetail()`；首页 `topic` 参数改为 topic id 过滤并正确高亮，搜索表单和主题/视图筛选互相保留 `topic`、`q`、`view=all|high|saved`；事件状态 action 支持 `returnTo`；新增 Playwright 配置、`pnpm smoke:web` 和 smoke 用例；同步 `CODEGUIDE.md`、`DEVELOPE_LOGS.md`。
- Files: `apps/web/src/app/events/[eventId]/page.tsx` (新建), `apps/web/src/app/page.tsx`, `apps/web/src/app/actions.ts`, `apps/web/src/app/globals.css`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/components/intelligence/topic-filter.tsx`, `apps/web/src/lib/topic-source-data.ts`, `packages/db/src/repositories.ts`, `packages/db/src/index.ts`, `playwright.config.ts` (新建), `tests/smoke/web.spec.ts` (新建), `package.json`, `pnpm-lock.yaml`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`。临时 Docker Postgres + `pnpm db:migrate` + `pnpm db:seed` + worker 单轮运行生成事件后，HTTP smoke 验证 `/api/health`、`/?q=OpenAI&view=high`、`/events/[eventId]`、`/exports/events/[eventId]`。`pnpm smoke:web` 可启动 production server，但当前 macOS sandbox 阻止 Chromium 启动（`MachPortRendezvousServer ... Permission denied`），浏览器级执行需在允许 Playwright Chromium 的环境重跑。
- Notes / Risk: 本轮验证过程中发现并修复已有测试/构建漂移：`packages/core` test script 仍引用已删除 fixture dist，已改为当前可运行的 `tsc --noEmit`；`packages/ai/src/source-recommendation.ts` schema 常量补 `JsonSchema` 类型锚点以通过 build。工作区中已有 source discovery 相关未提交改动，本轮未回退。

## 2026-07-07

### seed 改为多主题信源列表 + 仓库 raw link 默认拉取

- Cause: 原 seed 只创建单个 RSS 源（默认 Hacker News），在国内网络经常抓取失败；用户希望用仓库内维护的信源清单，部署后能自动拉最新版。需要支持多主题、每主题多源，且 re-seed 不能重置用户在 UI 上的 mute/reject 决策和 topic profile 编辑。
- Changed: 新增 `packages/db/seed-sources.json`（默认 3 个验证可访问的 AI 主题 RSS：OpenAI Blog / Hugging Face Blog / Google Research Blog，Anthropic 因无公开 RSS 不放）。重写 `packages/db/prisma/seed.ts`：解析优先级为 `WANGCHAO_SEED_SOURCE_NAME`+`WANGCHAO_SEED_SOURCE_URL` 旧单源模式 > `WANGCHAO_SEED_SOURCES_URL`（默认值为本仓库 raw link）> 本地 `packages/db/seed-sources.json` fallback；URL 模式带 5s timeout 和 schema 校验，失败 stderr warn 后 fallback；topic 和 source 改为 create-only（已存在的不重置 status、不覆盖 profile，保留 UI 编辑）。新增 `WANGCHAO_SEED_SOURCES_URL` 到 `.env_example`，`WANGCHAO_SEED_SOURCE_*` 注释改为 legacy。同步 `README.md` 信源发现路径说明和 env 表格、`CODEGUIDE.md` seed 命令段说明。
- Files: `packages/db/seed-sources.json` (新建), `packages/db/prisma/seed.ts`, `.env_example`, `README.md`, `CODEGUIDE.md`, `AGENTS_CHANGELOGS.md`
- Verification: 待运行 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build` 和 `pnpm db:seed` dry run 验证。
- Notes / Risk: 默认 raw link 指向 `jerryisacat/wangchao` 仓库 main 分支，仓库改名或分支调整时需同步 `seed.ts` 中的 `DEFAULT_SEED_SOURCES_URL` 常量。create-only 意味着修改 `seed-sources.json` 后对已部署的旧 topic/source 不会生效，只有新 topic/source 才会被创建——这是刻意设计，避免重置用户决策。

### 更新 README 明确迭代状态 + 新增 Issue 模板

- Cause: 用户要求 README 明确"高频迭代、未达稳定可用状态"的定位，欢迎社区 Issues/PR，并参考现有 Issues 创建模板。
- Changed: 更新 `README.md`：顶部和"当前阶段"章节加入 ⚠️ 警告标注（高频迭代、API/Schema 可能破坏性变更、请勿直接用于生产环境）；"贡献与定制"章节改为指引 Issues/Discussions/PR/AI Agent 定制四条路径。新建 `.github/ISSUE_TEMPLATE/`：`config.yml`（关闭空白 issue，引导到 Discussions）、`01-bug-report.yml`（Bug 报告模板：版本、区域、当前/期望行为、复现步骤、运行环境）、`02-feature-request.yml`（功能请求模板：解决问题、建议方案、替代方案、补充信息）。
- Files: `README.md`, `.github/ISSUE_TEMPLATE/config.yml` (新建), `.github/ISSUE_TEMPLATE/01-bug-report.yml` (新建), `.github/ISSUE_TEMPLATE/02-feature-request.yml` (新建), `AGENTS_CHANGELOGS.md`
- Verification: 模板格式符合 GitHub Issue Forms 规范（YAML schema），内容覆盖 bug 和功能请求两大场景。
- Notes / Risk: 未创建 `CONTRIBUTING.md`（README 中移除了对此文件的引用）；未读取到 GitHub 上已有的 Issues（API 额度不足），模板基于项目当前阶段特点设计。

### 新增自用模式到商业模型文档

- Cause: 用户要求管理员可以在后台配置自用模式，跳过所有订阅限制。
- Changed: 更新 `docs/business-model.md` 新增 §3.5 自用模式章节；更新 §4 AI 调用策略流程图增加自用模式优先判断；更新 §5.2 Subscription 表新增 `isSelfHosted` 字段；更新 §8 前端页面新增自用模式设置页和隐藏规则。
- Files: `docs/business-model.md`, `AGENTS_CHANGELOGS.md`
- Verification: 内容一致性检查通过，自用模式影响范围覆盖配额检查、AI 调用、前端展示和支付入口。
- Notes / Risk: 自用模式仅 OWNER/ADMIN 可操作，开关记录审计日志，仅影响当前 Organization。

### 制定订阅制商业模型并写入文档

- Cause: 用户要求明确定义 Free/Plus/Pro 三层订阅商业模型，作为 Phase 15 的开发依据，但不立即开发。
- Changed: 新建 `docs/business-model.md`（13 个章节，覆盖价值主张、三层计划、AI 调用策略、数据模型、配额检查、Stripe/ccpayment 支付集成、前端页面、安全要求、客户分层和待讨论事项）；更新 `AGENTS.md` 新增 Phase 15（订阅制商业化）开发阶段；更新 `SPEC.md` §6.0 和 §9 引用商业模型文档。
- Files: `docs/business-model.md` (新建), `AGENTS.md`, `SPEC.md`, `AGENTS_CHANGELOGS.md`
- Verification: 内容与用户讨论的 Free/Plus/Pro 模型一致（Plus $9.99/年 BYOK，Pro $19.99/月 官方 AI + BYOK 80% 备援，硬截断策略）；文档优先级已写入 AGENTS.md。
- Notes / Risk: 4 个待讨论问题已标注（配额数字、Pro 无 BYOK 行为、BYOK Provider 范围、ccpayment API）；未修改代码；ccpayment 集成细节需后续补充。

### 放宽前端整体间距

- Cause: 用户反馈"字跟框太紧凑了"，整体视觉呼吸感不足。
- Changed: 全局放宽间距，不改变配色和布局结构。情报卡片 padding 16px→20px、标题行高 1.35→1.4、字号 16px→17px、摘要行高 1.6→1.65、各元素间距统一 +2-4px；情报流卡片间 gap 10px→14px；通用 UI 卡片 header/content padding 16px→18px、标题行高 1.2→1.3；`.app-main` 增加 `gap: 16px` 统一顶层区段间距并移除子页面内联 `marginTop: 20`；状态横幅 padding 11px 12px→12px 14px；列表行（event-row/briefing-row 等）padding 12px→14px；表单 label gap 7px→8px、input padding 10px 11px→11px 12px；新建主题页内联 padding 20px 16px→24px 20px。
- Files: `apps/web/src/app/globals.css`, `apps/web/src/app/sources/page.tsx`, `apps/web/src/app/briefings/page.tsx`, `apps/web/src/app/saved/page.tsx`, `apps/web/src/app/preferences/page.tsx`, `apps/web/src/app/topics/new/page.tsx`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`
- Verification: `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过，9 个路由正确编译。
- Notes / Risk: 配色、圆角、字体、组件结构均未改动，仅调整间距/行高/字号。`.app-main` 新增 gap 后子页面内联 marginTop 已移除以避免双重间距。

### 重写 README 让用户能看懂仓库是干嘛的

- Cause: 用户反馈"看完 README 还是不知道这个仓库是干嘛的"。原 README 偏实现清单，没有讲清产品定位、信源发现机制和未读情报筛选录入流程。
- Changed: 重写 `README.md`。新增"这个仓库是干嘛的"（目标用户画像）、"信源是如何进入系统的"（seed/candidate/active/muted/rejected 状态机和当前实现路径）、"未读情报是如何被筛选和录入的"（Worker `runFetchCycle()` 八步管线的确定性流程图和关键设计点）、"用户的反馈如何影响系统"（FeedbackEvent → PreferenceMemory → 排序乘子的闭环说明）。补充 `WANGCHAO_SEED_SOURCE_*` 环境变量到表格。明确标注自动信源发现是 SPEC Phase 5 未实现项，避免读者把目标形态误当成当前能力。
- Files: `README.md`, `AGENTS_CHANGELOGS.md`
- Verification: 内容对照 `SPEC.md` §5.2/§5.4/§7、`CODEGUIDE.md` §3 数据流、`apps/worker/src/index.ts` `runFetchCycle()` 和 `packages/core/src/index.ts` `evaluateRelevance()`/`createIntelligenceEventDraft()` 实际实现核对，确保描述的是当前代码行为而非目标形态。
- Notes / Risk: 只改了中文 `README.md`，英文 `README-en.md` 未同步，后续如需保持双语一致需单独更新。`CODEGUIDE.md` 不需要改，因为代码结构未变。

### 撰写 Railway 部署指南并更新 README 索引

- Cause: 仓库缺少完整的 Railway 部署操作文档，只有简短的 Config as Code 说明和通用部署运维文档。需要一份覆盖项目创建、服务配置、环境变量、部署命令、健康检查和定时任务的完整指南。
- Changed: 新建 `docs/railway-deployment.md`（11 个章节，覆盖前置条件、项目结构、创建项目和服务、环境变量、部署、验证、定时任务、更新部署、常见问题、当前部署信息和参考文件）；更新 `README.md` 参考文档索引和目录结构；同步 `CODEGUIDE.md` 目录结构树。
- Files: `docs/railway-deployment.md` (新建), `README.md`, `CODEGUIDE.md`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`
- Verification: 文档内容基于实际 Railway 部署操作验证；部署信息（project ID、service ID、public URL）来自 `railway status` 和 `railway variables` 命令输出。

### 生产环境清理：移除开发/测试内容

- Cause: 代码中存在大量开发阶段残留内容（预览模式降级、硬编码凭据、fixture 协议、console.* 日志、测试 harness 文件），需要清理后才能安全部署到生产环境。
- Changed:
  - **CRITICAL**: 移除 `topic-source-data.ts` 的预览模式降级，`DATABASE_URL` 未配置时直接抛出错误。
  - **CRITICAL**: 移除 `prisma.config.ts` 的硬编码 `127.0.0.1:5432` Postgres URL 和 `wangchao:wangchao` 凭据。
  - **CRITICAL**: 移除 `packages/sources` 的 `fixture:` 协议支持、`buildFixtureRssFeed()`、`fixtureItemsFor()` 和所有硬编码 fixture 数据。
  - **HIGH**: 删除 `packages/core/src/intelligence.fixtures.ts` 和 `packages/ai/src/parser.fixtures.ts`（未被任何 source 导入的测试 harness）。
  - **HIGH**: 移除 `packages/core` 的 `getRuntimeLabel()` 函数，worker `describeWorker()` 和 `WorkerHealthCheckResult` 不再使用 `runtime` 字段。
  - **HIGH**: 替换 `console.log/warn/error` 为 `process.stdout.write` / `process.stderr.write`。
  - **MEDIUM**: `.env_example` 凭据改为占位符，seed source 改为可选。
  - **MEDIUM**: 表单 placeholder 中的真实服务名（Hacker News、hnrss.org）改为通用示例文案。
- Files: `apps/web/src/lib/topic-source-data.ts`, `packages/db/prisma.config.ts`, `packages/sources/src/index.ts`, `packages/core/src/intelligence.fixtures.ts` (deleted), `packages/ai/src/parser.fixtures.ts` (deleted), `packages/core/src/index.ts`, `apps/worker/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/topics/new/page.tsx`, `apps/web/src/app/sources/page.tsx`, `.env_example`, `CODEGUIDE.md`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`
- Verification: 已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`。

### 前端 Kinetic Intelligence 重构

- Cause: 用户要求按 `FRONTEND.md` 完整三步计划重构前端：Token 对齐 → 组件增强 → 首页重构 + 页面拆分。
- Changed: 新建 13 个文件（AppShell、TopNav、IntelligenceCard/Feed、TopicFilter、EmptyState、StatusBanner、PageHeader、5 个子页面），修改 8 个文件（Badge accent tone、Card variant prop、250+ 行新 CSS、layout 使用 AppShell、page.tsx 从 1045 行重写为 ~120 行情报流、actions redirect 路径适配）。
- Files: 参见本文件上方列表。
- Verification: 已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`。9 个路由正确编译：`/`、`/topics/new`、`/sources`、`/briefings`、`/saved`、`/preferences`、`/api/health`、`/exports/briefings/[briefingId]`、`/exports/events/[eventId]`。

### 补齐对客前表单反馈和内部协议过滤

- Cause: 用户要求一次性修复产品中残留的开发阶段代码和不当描述，并在全部修完后再部署；继续审计时发现 Server Actions 失败只写服务端日志、worker health 使用 `phase` 字段、运行时元数据保留 `deterministic-phase-*`、离线源可能把 `fixture://` 暴露到页面和 Markdown 导出。
- Changed: Server Actions 成功/失败后通过 `notice` / `error` URL 参数回跳并在首页显示用户可见反馈；worker health 字段从 `phase` 改为 `runtime`；运行时元数据改为 `explainable-rules`；首页示例文案改为中文产品语境；README/README-en 改为个人版边界说明；首页来源链接和详情原文链接只允许 HTTP/HTTPS；事件 Markdown 导出过滤非 HTTP/HTTPS source feed；离线 RSS fixture 文案去除本地/确定性测试口吻；同步 `CODEGUIDE.md`。
- Files: `apps/web/src/app/actions.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/api/health/route.ts`, `apps/worker/src/index.ts`, `packages/core/src/index.ts`, `packages/sources/src/index.ts`, `README.md`, `README-en.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `CI=true pnpm --filter @wangchao/web typecheck`、`CI=true pnpm --filter @wangchao/worker typecheck`、`CI=true pnpm --filter @wangchao/core typecheck`、`CI=true pnpm --filter @wangchao/sources typecheck`、`CI=true pnpm --filter @wangchao/web build`、`CI=true pnpm --filter @wangchao/worker build`、`CI=true pnpm --filter @wangchao/core build`、`CI=true pnpm --filter @wangchao/core test`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；本地浏览器 smoke 确认首页无高风险残留、无效 RSS 提交显示“请输入有效的 HTTP 或 HTTPS RSS 地址。”、有效主题/RSS 提交显示“主题已创建，已绑定 RSS 信源。”、事件收藏动作显示“情报状态已更新。”；本地 worker health 返回 database `ok` 和 `runtime`；本地 worker 用离线源生成 2 条事件和 1 份简报；首页不再显示 `fixture://` 链接；事件 Markdown 导出不再输出 `Source feed: fixture://...`。
- Notes / Risk: 后续需要在额度恢复后完成最终 Railway 部署和生产 smoke；本轮最后的本地网络复扫和 Railway 操作被当前审批系统额度限制拦截，未触发新的 Railway 部署，符合用户“全部修完后再部署”的要求。

### 记录首页未读情报流重构计划

- Cause: 用户确认当前首页应从工程控制台改为聚焦未读情报的信息流，并要求把重构计划写入文档。
- Changed: 更新 `FRONTEND.md`，明确首页定位为未读情报阅读流；新增顶部导航、中间限宽单列、首页保留/移出模块、情报卡片信息结构、新增主题与信源管理二级入口、首页重构实施顺序等规则。
- Files: `FRONTEND.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`；已用 `rg` 确认 `首页重构计划`、`未读情报阅读流`、`顶部导航 + 中间限宽` 和本审计标题写入目标文档。
- Notes / Risk: 本轮只写入文档计划，未修改 `apps/web` 实现；后续落地时需要同步 `CODEGUIDE.md`、运行前端验证并做移动端视觉检查。

### 移除首页伪交互并接入 URL 筛选

- Cause: 继续推进对客前清理时发现首页仍有搜索、刷新、新主题、筛选 tabs 和侧栏导航等看起来可交互但实际无行为的控件；这类伪交互会降低正式对客可信度。
- Changed: 首页搜索改为 `q` URL 参数过滤情报；未读情报 tabs 改为 `view=all|high|saved` 链接；刷新改为真实首页链接；新主题改为跳转到创建主题表单；侧栏导航从 button 改为静态状态；信源治理状态 badge 改为中文状态文案；补充用量单位映射；同步 `CODEGUIDE.md`。
- Files: `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `CI=true pnpm --filter @wangchao/web typecheck`、`CI=true pnpm --filter @wangchao/web build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；build 输出确认 `/` 仍为 dynamic route；伪交互扫描确认首页不再保留通知、静态筛选按钮或静态 tabs 使用；已部署 Web deployment `a06032b1-7689-462b-be18-c6ecf1b3cbbe` 且状态 `SUCCESS`；`/api/health` 返回 HTTP 200、database `ok`、Railway edge `hkg1`；生产首页、`?view=high`、`?view=saved`、`?q=Hacker` 页面可访问，HTML 扫描无 `Fixture|fixture://|DATABASE_URL|Prisma/Postgres|Phase|MVP|Server Action|Default Organization|owner@example` 高风险命中，并确认存在 `Hacker News 100+`、`工作区已连接`、`name="q"` 和 `id="new-topic"`。
- Notes / Risk: 已用 Railway CLI 将 `wangchao-web`、`wangchao-worker`、`Postgres` 统一 scale 到 `southeast-asia=1`，实际 region ID 为 `asia-southeast1-eqsg3a`；后续仍需补浏览器级真实点击、导出下载和表单提交流程验证。

## 2026-07-06

### 清理对客前开发残留和不当描述

- Cause: 当前产品准备正式对客，需要移除用户可见的开发阶段文案、fixture 假数据导出和旧配置误导，降低生产使用时的误解风险。
- Changed: 首页指标、状态条、卡片说明、信源治理和用量审计文案改为产品语言；无数据库/数据库异常时改为空工作区预览，不再展示样例情报；事件/简报导出 route 在无数据库时返回 503，不再生成 fixture Markdown；默认 seed 和 workspace 值改为个人版正式语义与真实 RSS，并在 seed 中清理旧 `AI Infrastructure` / `Wangchao Fixture RSS` 数据；重写 `.env_example` 移除旧 Python 原型变量；同步 README、部署文档和 `CODEGUIDE.md`。
- Files: `.env_example`, `README.md`, `README-en.md`, `docs/deployment.md`, `CODEGUIDE.md`, `apps/web/src/app/page.tsx`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `apps/web/src/app/exports/briefings/[briefingId]/route.ts`, `packages/core/src/index.ts`, `packages/db/src/repositories.ts`, `packages/db/prisma/seed.ts`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行多轮 `rg` 扫描用户可见和运行时代码中的 `Fixture`、`Phase`、`MVP`、`DATABASE_URL 未配置`、`Prisma/Postgres`、`Default Organization`、`owner@example` 等残留，最终高风险扫描只剩历史审计和离线 fixture 协议说明；已通过 `git diff --check`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm --filter @wangchao/sources typecheck`、`CI=true pnpm --filter @wangchao/sources test`、`CI=true pnpm --filter @wangchao/db typecheck`、`CI=true pnpm --filter @wangchao/db build`；已设置 Railway Web/Worker 的 `WANGCHAO_SEED_SOURCE_*` 为真实 RSS；最终 Web deployment `1f7a1343-490e-419e-a1bc-1ce3260fb346` 为 `SUCCESS`，生产 `/api/health` 返回 HTTP 200、database `ok`、edge `hkg1`；生产首页 HTML 扫描 `Fixture|fixture://|DATABASE_URL|Phase|MVP|Server Action|Default Organization|owner@example` 无命中，并确认出现 `Hacker News 100+` / `https://hnrss.org/newest?points=100`；Worker deployment `7e08c762-230a-4227-b70a-b67e0c1bc0d9` 为 `SUCCESS`，日志显示 `fetchedSources=1`、`insertedOrUpdatedItems=20`、`createdOrUpdatedEvents=9`、`generatedBriefings=1`、`failedSources=0`。
- Notes / Risk: 过程中有一次 Web deployment `31f81575-198f-470c-a2ce-78cb739449cd` 因 seed topic upsert 唯一键冲突失败，已修复 upsert where 条件并用后续 deployment 恢复；`packages/sources` 与测试 fixture 文件仍保留离线 fixture 能力，属于测试/离线验证入口；历史审计日志仍保留旧词汇以保持审计真实性；Worker Cron、真实登录/session provider 和浏览器级生产交互验证仍是上市前缺口。

### 迁移 Railway 到 southeast-asia 并修复生产首页预渲染

- Cause: 用户要求优先香港/日本，并明确将 Railway 部署全部迁移到 `southeast-asia`；迁移后生产检查发现首页仍显示 fixture fallback，需要排查生产环境问题。
- Changed: 使用 Railway CLI 将 `wangchao-web`、`wangchao-worker`、`Postgres` scale 到 `southeast-asia`，实际 region ID 为 `asia-southeast1-eqsg3a`；发现 `apps/web/src/app/page.tsx` 被 Next.js 静态预渲染，导致 build-time 无 `DATABASE_URL` 时固化 fixture banner；新增 `export const dynamic = "force-dynamic"`；重新部署 Web；同步 `CODEGUIDE.md`、`docs/deployment.md`、`DEVELOPE_LOGS.md`。
- Files: `apps/web/src/app/page.tsx`, `CODEGUIDE.md`, `docs/deployment.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: `railway service status` 确认 `wangchao-web` deployment `b41e26f3-53eb-43b3-b9c2-0630703f4b31` 为 `SUCCESS`、`Postgres` deployment `22e8c2d1-02c6-43c4-b44a-361be85e95aa` 为 `SUCCESS`、`wangchao-worker` deployment `77041cd0-1d8f-4e06-9faf-82a834143709` 为 `SUCCESS`；`curl https://wangchao-web-production.up.railway.app/api/health` 返回 HTTP 200、database `ok`、Railway edge `hkg1`；首页 HTTP 200 且内容包含“已连接 Prisma/Postgres 数据边界”；本地 `CI=true pnpm --filter @wangchao/web build` 显示 `/` 为 dynamic route，重跑 `CI=true pnpm --filter @wangchao/web typecheck` 通过，`git diff --check` 通过。
- Notes / Risk: Worker 在 Postgres 切区期间出现过一次 `P1001 DatabaseNotReachable`，随后成功执行一轮；Worker 当前仍是部署后运行一次并停止，尚未配置 Railway Cron；首页动态渲染修复降低了 build-time env 固化风险，但后续还需要浏览器级交互验证。

### 执行 Railway 生产部署

- Cause: 用户要求完成 Railway 部署并提供生产测试链接，用于后续生产环境排查。
- Changed: 安装并登录 Railway CLI；创建 Railway project `wangchao`；添加 `Postgres`、`wangchao-web`、`wangchao-worker` 服务；新增 root `railway.json` 和 root Railway dispatcher scripts，使本地未提交代码可通过 `railway up --service ...` 部署到不同服务；设置 Web/Worker 环境变量；部署 Web 和 Worker；同步部署文档、代码结构和开发审计。
- Files: `package.json`, `railway.json`, `docs/deployment.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: Railway Web deployment `e8e52339-cb02-4f80-827f-ca91f7cbb558` 状态 `SUCCESS`；Web logs 显示 `pnpm db:deploy` 成功应用 `0001_init` migration、`pnpm db:seed` 成功、Next.js 在 Railway 注入端口启动；Worker deployment `d2ee612a-50a4-421c-895b-90c1cdf67ba9` 状态 `SUCCESS` 且 stopped=true，logs 显示 worker 执行一轮，`fetchedSources=1`、`insertedOrUpdatedItems=2`、`createdOrUpdatedEvents=2`、`generatedBriefings=1`、`failedSources=0`。
- Notes / Risk: 生成 Web 公网域名的 `railway domain --service wangchao-web --port 3000 --json` 命令被当前审批系统拦截，尚未生成测试链接；Worker 当前是部署后执行一轮并停止，还不是 Railway Cron；Railway TypeScript SDK 包名按 CLI 提示安装失败，未使用 `railway config apply`。

### 准备 Railway 部署配置

- Cause: 用户决定个人版先使用 Railway 部署，需要为当前 TypeScript monorepo 准备可部署的 Web、Worker Cron、Postgres migration/seed 和操作文档。
- Changed: 新增 Railway Web 与 Worker Cron Config as Code 示例；新增 Railway 专用 build/start 脚本和 `db:deploy` 脚本；为 Web/Worker package 补生产 start 命令；更新部署文档、Railway 操作说明和 `CODEGUIDE.md` 的目录/命令说明；补充分阶段审计记录。
- Files: `package.json`, `apps/web/package.json`, `apps/worker/package.json`, `deploy/railway/README.md`, `deploy/railway/web.railway.json`, `deploy/railway/worker-cron.railway.json`, `docs/deployment.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 Railway JSON 解析检查、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm railway:web:build`、`CI=true pnpm railway:worker:build`、`git diff --check`。
- Notes / Risk: 本轮只准备仓库侧部署资产，没有登录 Railway 或执行真实部署；Railway Postgres 变量绑定、服务 config file path、生效后的 pre-deploy migration、Cron 执行、生产域名 `/api/health` 和备份策略仍需上线时验证。

### 推进个人版数据库和 worker 可测性

- Cause: 用户明确先不处理商业化，要求开始编码完成个人自用版本；当前首要阻塞是数据库迁移不稳定、worker 依赖公网 RSS、Web 表单错误会导致页面崩溃。
- Changed: 修复 `0001_init` 中 `_BriefingEvents` 与 Prisma schema 的漂移；新增 `fixture://wangchao/ai-infrastructure` 离线 RSS feed；seed 默认源改为 fixture 且支持 `WANGCHAO_SEED_SOURCE_NAME` / `WANGCHAO_SEED_SOURCE_URL` 覆盖；Web Server Actions 捕获错误并记录警告，避免表单校验失败触发 error boundary；同步 `.env_example`、`CODEGUIDE.md` 和 `DEVELOPE_LOGS.md`。
- Files: `.env_example`, `packages/db/prisma/migrations/0001_init/migration.sql`, `packages/db/prisma/seed.ts`, `packages/sources/src/index.ts`, `apps/web/src/app/actions.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过干净库 `pnpm db:migrate` 和 `pnpm db:seed`，确认 `_prisma_migrations=1` 且默认 organization/user/topic/source 存在；已通过 Web `/api/health` 返回 database `ok`；已通过浏览器提交 HTTP RSS 表单并确认 Topic/Source 写入 Postgres；已验证 `fixture://wangchao/ai-infrastructure` 可解析 2 条 RSS items；已通过 `CI=true pnpm build`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、相关包 typecheck 和 Web build。
- Notes / Risk: 当前环境公网 HN RSS 抓取失败，worker 只验证到失败重试和 TaskRun 记录；本地 HTTP fixture 服务和后续浏览器复测被权限/浏览器策略拦截，未继续绕过。下一步需要用默认 fixture seed 跑 worker 完整 fetch/analyze/briefing cycle，并把 Server Action 错误返回接到可见 UI。

### 验证本地 Docker Postgres 数据库链路

- Cause: 用户要求在本地拉起 Postgres Docker 并进行下一步测试，需要补齐此前未完成的真实数据库验证。
- Changed: 启动并验证 `wangchao-postgres-local` Postgres 16 容器；在 `5432` 已被占用时改用 `127.0.0.1:55433`；记录本地 Docker Postgres 命令、数据库 smoke test 结果、worker health 结果和 Prisma migrate 引擎风险；补充跨阶段开发审计。
- Files: `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `docker inspect` health 检查、容器内 `psql select current_user/current_database/version()`、`CI=true pnpm db:validate`、`CI=true pnpm db:generate`、容器内执行 `packages/db/prisma/migrations/0001_init/migration.sql`、`CI=true pnpm db:seed`、数据库级 smoke test、`CI=true pnpm worker:health`；smoke test 确认 16 张表、已保存 Dashboard event、已 approve candidate source、Markdown event/source 和 briefing/event 内容均可生成。
- Notes / Risk: `pnpm db:migrate`、`prisma migrate deploy` 和 `prisma migrate status` 在当前环境均报 `Schema engine error`，本次用 `psql` 临时套用 SQL，不代表 Prisma migrate 引擎已修复；Web 浏览器级 Server Action、下载 route、真实 RSS 抓取仍未验证。

### 按 FRONTEND.md 重构 Web 工作台视觉

- Cause: 当前 `apps/web` 仍偏通用 SaaS 工作台，需要按照 `FRONTEND.md` 的 Kinetic Intelligence 规范落地前端表现层，同时保留 Dashboard 的高密度阅读和操作效率。
- Changed: 对齐 `globals.css` 语义 token、酸黄强调、硬边网格、work/kinetic card、按钮状态、焦点状态、44px 点击目标、响应式单列和 reduced-motion；重构首页顶部搜索、指标卡、新建主题 kinetic 模块、情报流摘要/解释/来源外链、事件详情“为什么重要/影响对象”、信源治理质量大数字与指标、偏好记忆置信度条；扩展 Button `danger` 变体；修复 Tabs trigger 高度不足 44px 的点击目标问题，并把导出/简报/信源操作链接提升到 44px 触达面积；同步 `CODEGUIDE.md` 和 `DEVELOPE_LOGS.md`。
- Files: `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/ui/button.tsx`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已通过 `CI=true pnpm lint`、`CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check`；已用浏览器在 320/375/414/768/1024/1440 视口验证无横向滚动、关键模块存在、reduced-motion/focus 规则存在、所有按钮点击目标不小于 44px，并截取 1440/375/320 视口截图；375px 稳定复测确认导出/简报/信源操作链接也不小于 44px；已启动本地 Next dev server 并确认 `http://127.0.0.1:3010` 可访问。
- Notes / Risk: 真实创建主题、状态动作、导出、信源治理 smoke test 仍需连接数据库后补；搜索输入目前是前端入口，尚未接入真实搜索逻辑。

### 新增前端设计规范

- Cause: 用户希望按照 Kinetic Typography 风格生成前端设计规范，用于后续统一望潮 Web UI 的视觉语言和交互边界。
- Changed: 新增 `FRONTEND.md`，将原风格收敛为适合情报工作台的 Kinetic Intelligence 规范，覆盖设计原则、token、页面组合、组件变体、动效、响应式、可访问性和实施顺序；同步 `CODEGUIDE.md` 的文档优先级、目录树和关键文件说明。
- Files: `FRONTEND.md`, `CODEGUIDE.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`。
- Notes / Risk: 本轮只新增设计文档，没有改动实际 `apps/web` 组件或样式；后续落地时需要补浏览器视觉检查和 workspace 验证。

### 修复 Prisma 7 兼容并补全 workspace 验证

- Cause: 恢复依赖后真实 `pnpm typecheck` 暴露 Prisma 7、JSON 类型、workspace package exports 和 worker health 脚本问题；此前多个阶段只完成静态验证，需要补实际工具链验证。
- Changed: 新增 Prisma 7 `prisma.config.ts`，移除 schema datasource URL；引入 `@prisma/adapter-pg` 并改造 Prisma Client/seed 初始化；集中转换 Prisma JSON input；修复 core fixture assertion 类型收窄；为 workspace packages 增加 `exports.types` 指向源码；worker health 改为运行 build 后的 `dist/index.js`；更新 README、`CODEGUIDE.md`、`docs/deployment.md` 和 `DEVELOPE_LOGS.md` 的验证状态。
- Files: `README.md`, `README-en.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`, `docs/deployment.md`, `package.json`, `pnpm-lock.yaml`, `packages/*/package.json`, `packages/core/src/intelligence.fixtures.ts`, `packages/db/prisma.config.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts`, `packages/db/src/client.ts`, `packages/db/src/repositories.ts`, `apps/worker/package.json`
- Verification: 已通过 `CI=true pnpm db:generate`、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`CI=true pnpm worker:health`、`git diff --check`。
- Notes / Risk: 仍未连接真实 Postgres 执行 migration/seed，也未做 Web 浏览器 smoke test、Server Action 端到端、worker fetch cycle 或 Playwright 视觉验证。

### 对齐 README 与 TypeScript 主路径

- Cause: Phase 14 已将旧 Python 原型归档，但 `README.md` / `README-en.md` 仍描述 Python/SQLite/静态 JSON 主路径，和当前仓库状态冲突。
- Changed: 重写中英文 README，改为 TypeScript monorepo、Next.js、Prisma/Postgres、Node worker、health check、审计文件和 legacy 归档说明；同步 `AGENTS.md` 与 `CODEGUIDE.md` 中 README 的文档角色；更新 `DEVELOPE_LOGS.md` 的 Phase 14 审计，移除 README 未重写的遗留项。
- Files: `README.md`, `README-en.md`, `AGENTS.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `rg` 检查 README/文档中的旧 Python 主路径引用；已运行 `git diff --check`，通过。
- Notes / Risk: README 现在描述目标主路径和当前实现；真实 `pnpm` 验证已在后续记录中补齐，但 DB/browser 端到端仍未验证。

### 归档旧 Python 原型并完成 Phase 14 cleanup

- Cause: 按 `REFACTOR_PLAN.md` Phase 14 推进 legacy cleanup，让仓库根目录主开发路径切换为 TypeScript monorepo，同时保留旧 Python 原型作为行为参考。
- Changed: 将旧 Python runtime、processors、sources、prompts、旧静态 `index.html`、旧 Python tests、Python 项目文件移动到 `legacy/python-prototype/`；新增归档说明；更新 `CODEGUIDE.md`，移除根目录 Python 主路径描述，改为 TypeScript monorepo 架构和 legacy 说明；更新项目阶段标识；同步 `DEVELOPE_LOGS.md`。
- Files: `legacy/python-prototype/**`, `packages/core/src/index.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 检查 `CODEGUIDE.md` 中旧 Python 根路径引用，确认剩余引用均位于 legacy 说明语境。
- Notes / Risk: 由于真实 DB/browser 端到端尚未验证，本阶段选择归档而不是删除；README 已在后续记录中重写为 Node.js 主路径。

### 建立 Phase 13 部署运维基础 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 13 推进 deployment and operations，让 Web 和 worker 在正式部署前具备健康检查、环境变量说明、日志边界和回滚指导。
- Changed: 新增 Web `/api/health` route，支持可选数据库 ping；扩展 worker，新增 `runWorkerHealthCheck()` 和 `--health` CLI 模式；新增 worker/package 根健康检查脚本；新增 `docs/deployment.md` 记录服务拆分、环境变量、健康检查、部署顺序、日志、备份和回滚；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `package.json`, `apps/worker/package.json`, `apps/worker/src/index.ts`, `apps/web/src/app/api/health/route.ts`, `docs/deployment.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `/api/health`、`runWorkerHealthCheck()`、`worker:health`、`docs/deployment.md` 和 Phase 13 文档入口存在。
- Notes / Risk: 当前没有平台特定部署配置、worker scheduler、集中错误上报、生产备份任务或 CI/CD；TypeScript/Next/Prisma 编译和 worker health dry run 已在后续记录中验证，Web health runtime 与真实 Postgres ping 仍未验证。

### 建立 Phase 12 商业化基础 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 12 推进 commercial readiness，让当前单用户 MVP 具备组织、成员角色、权限断言和用量审计基础，为未来多租户商业化预留边界。
- Changed: `packages/db` 新增 UsageEvent schema/migration、membership 查询、role guard、usage event 记录和用量汇总；Prisma seed 复用默认租户环境变量；Web Server Actions 与 Markdown export routes 加入权限检查和 usage event；worker 抓取、简报和信源治理观测写入 usage event；Dashboard 新增组织权限与近 30 天用量审计；补默认组织/用户环境变量；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `.env_example`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0001_init/migration.sql`, `packages/db/prisma/seed.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/exports/briefings/[briefingId]/route.ts`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/topic-source-data.ts`, `apps/worker/src/index.ts`, `packages/core/src/index.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `UsageEvent`、`recordUsageEvent()`、`assertMembershipRole()`、`listUsageSummary()`、web/export/worker usage 调用和 Phase 12 文档入口存在；已人工检查 `.env_example`、`CODEGUIDE.md` 和阶段审计记录；后续跨阶段验证已通过 `CI=true pnpm db:generate`、`CI=true pnpm db:validate`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 当前没有真实 auth/session provider、组织切换、邀请、付费计划、限额拦截或 tenant isolation 自动化测试；仍未完成真实 Postgres 写入验证和浏览器验证。

### 建立 Phase 11 信源治理 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 11 推进 source governance，让候选源、启用源、静音源、拒绝源有可审核状态流，并生成可追溯质量报告。
- Changed: `packages/db` 新增候选 RSS 创建、source governance report、source status 更新、SourceObservation 质量观测；`apps/web` 新增候选源表单、source quality report、approve/observe/mute/reject 操作；`apps/worker` 新增 source quality observation cycle；daily briefing 查询增加 active-source 过滤；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/topic-source-data.ts`, `apps/worker/src/index.ts`, `packages/core/src/index.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `createCandidateRssSource()`、`listSourceGovernanceReport()`、`updateSourceGovernanceStatus()`、`recordSourceQualityObservation()`、web governance actions 和 worker governance cycle 存在；已人工检查 daily briefing 查询只使用 active source；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 当前没有自动信源发现或 LLM 推荐解释；质量报告是规则型 MVP。仍未完成真实 Postgres 写入验证和浏览器审核流程验证。

### 建立 Phase 10 简报与 Markdown 导出 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 10 推进 briefing and Markdown export，让情报事件和 daily briefing 可以沉淀为 Obsidian-friendly Markdown，并记录导出审计。
- Changed: `packages/core` 新增 event/daily briefing Markdown 渲染和 content hash；`packages/db` 新增 daily briefing 事件读取、Briefing 创建、最新简报查询、下载读取和 ExportEvent 记录；`apps/worker` 新增 daily briefing generation cycle；`apps/web` 新增最新简报卡片、单条事件导出链接、简报下载 route 和事件下载 route；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/core/src/index.ts`, `packages/core/src/intelligence.fixtures.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/worker/src/index.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/exports/briefings/[briefingId]/route.ts`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `renderDailyBriefingMarkdown()`、`renderEventMarkdown()`、`createDailyBriefing()`、`recordMarkdownExport()`、worker briefing cycle 和 web export routes 存在；已确认导出 route 文件存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 当前是确定性 Markdown 模板，不是 LLM briefing rewrite；仍未完成真实 Postgres 写入验证和浏览器下载验证。worker 当前每轮生成 briefing，后续需要按日期/任务调度去重。

### 建立 Phase 9 反馈学习与偏好记忆 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 9 推进 feedback and preference memory，让 Phase 8 记录的已读、收藏、忽略反馈不只是审计记录，而是能归纳成可解释偏好并影响 Dashboard 排序。
- Changed: `packages/core` 新增反馈信号归纳、偏好 key、偏好权重排序和 fixtures；`packages/db` 新增近期反馈读取、PreferenceMemory dashboard 查询和 upsert；`apps/web` 在事件状态动作后归纳近期反馈、写入偏好记忆，并在 Dashboard loader 中应用偏好权重重排事件；页面新增“已学习偏好”卡片；`apps/worker` 新增 preference learning cycle；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/core/src/index.ts`, `packages/core/src/intelligence.fixtures.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/topic-source-data.ts`, `apps/worker/src/index.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `generatePreferenceDeltas()`、`applyPreferenceWeights()`、`listRecentFeedbackSignals()`、`upsertPreferenceMemory()`、Dashboard preference rendering 和 worker preference cycle 路径存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 当前是规则型 MVP，不是 LLM 归纳；仍未完成真实 Postgres 写入验证、浏览器验证和 feedback -> preference -> rerank 端到端验证。

### 建立 Phase 8 Dashboard MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 8 推进 Dashboard MVP，让 Phase 7 生成的 `IntelligenceEvent` 成为 Web 主阅读流，并提供已读、收藏、忽略动作。
- Changed: `packages/db` 新增 Dashboard event 查询和状态写入，状态动作同时写 `IntelligenceEvent`、`UserItemState` 与 `FeedbackEvent`；`apps/web` 新增 Dashboard event fixture、事件详情、来源展示、空状态、已读/收藏/忽略 Server Action 表单和对应样式；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/topic-source-data.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 Dashboard loader、Server Action、repository helper 和样式入口存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test` 和 `CI=true pnpm build`。
- Notes / Risk: 当前仍未完成真实 Postgres 写入验证和浏览器交互验证；筛选 tab、批量已读、收藏集合、分页留给后续阶段，反馈学习聚合已在 Phase 9 MVP 中接入。

### 建立 Phase 7 情报管线 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 7 推进 AI intelligence pipeline，让 Phase 5 抓取到的 Item 可以经过 relevance/noise、事件草稿、评分、去重 hash 和排序，进入 Dashboard 可消费的 IntelligenceEvent 主链路。
- Changed: `packages/core` 新增确定性 relevance/noise、topic keywords、event draft、event hash、gravity score 和 intelligence fixtures；`packages/db` 新增待分析 Item 查询、过滤标记、IntelligenceEvent upsert，并修复过滤时覆盖 `rawMetadata` 的风险；`apps/worker` 在 fetch cycle 后追加 analysis cycle；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/core/package.json`, `packages/core/src/index.ts`, `packages/core/src/intelligence.fixtures.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/worker/src/index.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 `evaluateRelevance()`、`createIntelligenceEventDraft()`、`runAnalysisCycle()`、`listFetchedItemsForAnalysis()`、`upsertIntelligenceEventFromItem()` 和 fixture 入口存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm test`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 当前 Phase 7 是确定性 MVP，没有接入 Phase 6 的真实 LLM adapter/parser；仍未完成本地 Postgres worker 端到端验证。

### 建立 Phase 6 OpenAI-compatible adapter 与 parser

- Cause: 按 `REFACTOR_PLAN.md` Phase 6 推进 AI adapter/parser，为后续 relevance/noise、event extraction 和 briefing 阶段提供 provider-neutral 的 LLM 调用与 JSON 解析边界。
- Changed: `packages/ai` 新增 OpenAI-compatible Chat Completions adapter、共享类型、JSON mode fallback、timeout/retry、response sanitizer、JSON object extraction、常见 JSON 修复、schema validation 和 parser fixtures；更新 `packages/ai` test script；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/ai/package.json`, `packages/ai/src/index.ts`, `packages/ai/src/types.ts`, `packages/ai/src/openai-compatible.ts`, `packages/ai/src/parser.ts`, `packages/ai/src/parser.fixtures.ts`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查确认 adapter/parser/fixtures 导出存在；后续跨阶段验证已通过 `CI=true pnpm test` 和完整 workspace 验证。
- Notes / Risk: parser fixtures 已跑通；adapter 仍未经过 mock provider 或真实 provider HTTP 验证。

### 建立 Phase 5 Worker RSS 抓取管线

- Cause: 按 `REFACTOR_PLAN.md` Phase 5 推进 worker fetch pipeline，让 Phase 4 绑定的 active RSS sources 可以由后台 worker 抓取并幂等写入 Item。
- Changed: `packages/sources` 新增无依赖 RSS/Atom fetch、parse、normalize 和 content hash；`packages/db` 新增 active RSS source 查询、TaskRun 创建/完成/失败、source fetch 成功记录和 Item upsert helper；`apps/worker` 新增 `runFetchCycle()`、逐 source 抓取、最多 3 次 retry 和 CLI 输出；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `packages/sources/src/index.ts`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `packages/core/src/index.ts`, `apps/worker/package.json`, `apps/worker/src/index.ts`, `pnpm-lock.yaml`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行 `rg` 静态调用链检查，确认 worker -> sources -> db 的 Phase 5 路径存在；后续跨阶段验证已通过 `CI=true pnpm typecheck`、`CI=true pnpm build` 和 `CI=true pnpm worker:health`。
- Notes / Risk: 真实 worker/Postgres/RSS 端到端未验证；RSS parser 是 MVP 级轻量实现，后续应替换为正式 parser 或补 fixture tests。

### 建立 Phase 4 主题与 RSS 信源 MVP

- Cause: 按 `REFACTOR_PLAN.md` Phase 4 推进 Topic CRUD 和 manual RSS source attachment，为单主题闭环提供创建主题和绑定 active RSS source 的入口。
- Changed: 在 `packages/db` 新增默认 workspace、Topic 创建、active RSS source 绑定、Topic/Source overview 和 URL canonicalization helper；在 web 新增 `@wangchao/db` 依赖、Server Action、Topic/Source 数据 loader、创建主题并绑定 RSS 表单、主题/信源列表和数据库/fixture 状态提示；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md`。
- Files: `apps/web/package.json`, `pnpm-lock.yaml`, `packages/db/src/index.ts`, `packages/db/src/repositories.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过；已运行静态文件存在性检查和 `rg` 调用链检查。尝试 `PNPM_CONFIG_OFFLINE=true pnpm --filter @wangchao/web typecheck`，但 pnpm 仍触发自动安装并访问 registry，因 DNS 失败持续重试后被中断，未完成。
- Notes / Risk: 真实数据库写入、Prisma generate、Next typecheck/build 和浏览器表单提交仍未验证；当前页面无 `DATABASE_URL` 时回退 fixture，表单提交需要本地 Postgres 和 Prisma migration ready。

### 建立 Phase 3 Next.js 产品壳

- Cause: 按 `REFACTOR_PLAN.md` Phase 3 推进产品壳与设计系统基础，为后续 Topic/Source/Worker/AI workflow 提供可扩展界面框架。
- Changed: 新增 `apps/web/components.json`、本地 `cn()` helper、Button/Card/Badge/Tabs primitives、route loading/error 状态；重写首页为主题情报工作台，包含侧边导航、顶部操作、指标卡、未读情报列表、处理管线和空/提示状态；重写全局 CSS token、布局、组件样式和响应式规则；同步 `CODEGUIDE.md` 与 `DEVELOPE_LOGS.md` 的 Phase 3 审计。
- Files: `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/**`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/loading.tsx`, `apps/web/src/app/error.tsx`, `apps/web/src/app/globals.css`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `git diff --check`，通过。尝试运行 `pnpm --filter @wangchao/web typecheck`，但因当前 `node_modules` 链接未恢复而触发自动安装，普通沙箱 DNS 持续失败，命令被中断，未完成。
- Notes / Risk: 当前为离线落地的 shadcn 风格本地 primitives，尚未通过 shadcn CLI 初始化完整 Tailwind/Radix 组件链；首页使用静态 fixture 数据，未接入数据库或 worker。恢复联网/配额后必须补完整安装、typecheck、build、lint、test 和视觉验证。

### 建立 Phase 2 Prisma/Postgres 数据库基础

- Cause: 按 `REFACTOR_PLAN.md` Phase 2 和 `AGENTS.md` 数据库规则推进分阶段开发，需要为后续 topic/source/worker/AI pipeline 建立 tenant-ready 数据模型、migration、seed 和访问边界。
- Changed: 新增 Prisma schema、首版 Postgres migration、seed 脚本、懒加载 Prisma Client、tenant/topic scoped repository helpers、根目录 DB scripts 和 `DATABASE_URL` 模板；固定 Prisma 版本；更新 `pnpm-workspace.yaml` approved builds；同步 `CODEGUIDE.md` 和 `DEVELOPE_LOGS.md` 的 Phase 2 审计。
- Files: `.env_example`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/db/package.json`, `packages/db/prisma/**`, `packages/db/src/**`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `node` 静态检查确认 `schema.prisma` 包含 14 个核心模型且 `migration.sql` 包含 14 个核心表；已运行 `git diff --check`，通过。Prisma CLI validate/generate、workspace typecheck/build/lint/test、本地 migration/seed 因当前依赖恢复和本地 Postgres 环境受限未完成。
- Notes / Risk: 本轮普通沙箱安装多次因 DNS 失败；一次联网安装已更新锁文件并下载依赖，但后续恢复安装被系统配额限制拦截，导致 `node_modules` workspace 链接暂不可用。恢复联网/配额后必须先补跑 `pnpm install`、Prisma validate/generate 和完整 workspace 验证。

### 建立 Phase 1 TypeScript monorepo 基础

- Cause: 按 `REFACTOR_PLAN.md` Phase 1 和 `AGENTS.md` 要求开始分阶段开发，需要先建立 pnpm/Turborepo/TypeScript/Next.js monorepo 基础。
- Changed: 新增根 `package.json`、`pnpm-workspace.yaml`、`turbo.json`、`tsconfig.base.json`、Next.js web app、Node worker、五个共享 packages 占位模块和 `pnpm-lock.yaml`；更新 `.gitignore`、`CODEGUIDE.md`、`DEVELOPE_LOGS.md`。
- Files: `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `apps/web/**`, `apps/worker/**`, `packages/**`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification: 已运行 `CI=true pnpm typecheck`、`CI=true pnpm build`、`CI=true pnpm lint`、`CI=true pnpm test`、`git diff --check`，均通过。
- Notes / Risk: 当前 lint/test 仍是 `tsc --noEmit` 占位；尚未引入 Prisma、真实测试框架、shadcn/ui 或业务功能。安装依赖时因沙箱网络失败，已通过授权网络完成 `CI=true pnpm install`。

### 建立分阶段开发审计机制

- Cause: 用户要求后续按 `AGENTS.md` 分阶段开发，并在每个阶段完成后审计是否符合 `REFACTOR_PLAN.md` 和 `AGENTS.md`、是否缺功能、是否有 bug，同时维护 `DEVELOPE_LOGS.md` 追踪延期功能。
- Changed: 新增 `DEVELOPE_LOGS.md`；更新 `AGENTS.md`，加入 `DEVELOPE_LOGS.md` 规则和任务结束检查项；更新 `CODEGUIDE.md`，加入该文件职责和文档优先级。
- Files: `AGENTS.md`, `AGENTS_CHANGELOGS.md`, `CODEGUIDE.md`, `DEVELOPE_LOGS.md`
- Verification: 已运行 `git diff --check`，通过。
- Notes / Risk: 本阶段仅完成 Phase 0 文档和审计机制；尚未开始 Phase 1 monorepo 基础代码开发。

### 初始化 AI Agent 协作规范

- Cause: 用户要求为当前仓库初始化 AI Agent 协作规范，并明确 `AGENTS_CHANGELOGS.md` 替代 `CHANGELOG.md`，技术路线以 `REFACTOR_PLAN.md` 为核心。
- Changed: 新增 `AGENTS.md` 作为仓库级 Agent 协作规范；新增本审计日志；更新 `CODEGUIDE.md` 的文档优先级、目录树和维护规则；在 `CHANGELOG.md` 顶部标记废弃。
- Files: `AGENTS.md`, `AGENTS_CHANGELOGS.md`, `CODEGUIDE.md`, `CHANGELOG.md`
- Verification: 已运行 `git diff --check`，通过。
- Notes / Risk: 本次只初始化协作文档，不修改运行代码；`CODEGUIDE.md` 仍主要描述当前 Python 原型，Node.js 绿地重构落地后需要重写为 monorepo 结构。
