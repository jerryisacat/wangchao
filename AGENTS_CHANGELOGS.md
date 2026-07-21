## 2026-07-21

### Fix: 第四轮视觉检查收束报告、时间线与主题表单

- Cause: Railway 与代码巡检发现专题报告正文仍用等宽 `<pre>` 承载，标题、列表和外链缺乏阅读层级；报告历史行和提交区会在窄屏挤压主内容；主题时间线暴露内部 category、英文 `Unknown`、11px 等宽来源信息和小原文链接；主题编辑把十余个字段压在单一卡片中，12px 重标签与巨型名称输入使重点不清。
- Changed:
  - 专题报告详情复用安全 Markdown 白名单 renderer，正文收为 72ch、16px / 1.75 行高的 editorial 层级；统计改为移动端 2 列、`sm` 起 4 列 tonal surface，覆盖说明独立呈现，信息不足状态改用语义 token。
  - 报告提交区与历史行改为移动端纵向布局，主按钮与查看动作占满可用宽度；报告标题成为可换行且 ≥44px 的主要入口，状态不再挤压标题。
  - 事件 category 中文映射下沉到共享显示 helper，情报详情与主题时间线统一复用；时间线解码来源实体，移除 `Unknown` 与 11px 工程元数据，标题和“查看原文”入口补足 44px。
  - 主题编辑按“基本信息 / 主题画像 / 语言与简报偏好”拆成三张工作卡片，标签回归 14px `Label` 原语，说明文字提升可读性，保存动作在移动端占满宽度；新建主题保留文档允许的品牌卡片，但移除内联样式和遗留 `form-actions`。
  - `FRONTEND.md`、`CODEGUIDE.md` 与 `docs/L3-modules.md` 固化报告 editorial 层级、时间线本地化、44px 触点和编辑表单分区规则。
- Files: `apps/web/src/app/{reports,reports/[reportId],topics/[topicId]/timeline,topics/[topicId]/edit,topics/new,events/[eventId]}/page.tsx`、`apps/web/src/lib/display-text.ts`、`apps/web/scripts/summary-status.fixture.mjs`、`FRONTEND.md`、`CODEGUIDE.md`、`docs/L3-modules.md`。
- Verification: `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check` 通过（构建仅保留既有 PDF NFT tracing warnings）；本地 320 / 375 / 414 / 768 / 1024 / 1440px 响应式矩阵通过。375px 定点复查确认新建主题 Card `scrollWidth = clientWidth = 343px`，标签为 14px / 500，返回与生成按钮均 44px，生成主按钮宽 295px，无页面或卡片超框。
- Notes / Risk: 仅调整显示 helper、布局与安全渲染方式，不改变报告原始 Markdown、导出、查询、Server Action、权限、数据库或 Worker；报告继续使用先转义不可信文本再白名单渲染的安全边界。Railway 真实数据与六档宽度复查将在本提交部署后补充。

### Fix: 第三轮视觉检查收束详情页与主题工作台阅读层级

- Cause: Railway 真实数据巡检发现情报详情直接暴露 `keyword:<value>`，14 个反馈与工具动作无分组且“忽略此条”抢占主视觉；主题详情保留 hover scale 与未定义 bespoke class，7 / 30 天切换和最近简报入口不足 44px；简报详情的正文、元数据、下载和 Event 入口缺少样式，正文还会显示 `Matched topic keywords`；信源名称及推荐理由把 HTML 实体编码直接展示给用户。既有响应式测试又依赖已删除的 Topic / Event 类名，未覆盖这些动态详情路由。
- Changed:
  - 情报详情把内部 category 转为“关键词 / 实体 / 覆盖范围”，正文收成 72ch 阅读宽度与 MD3 tonal metadata surface；14 个动作按“阅读状态 / 调整偏好 / 校准来源与评分 / 工具”分组，忽略动作降为危险文字态，原文提升为主要阅读行动。
  - 主题状态摘要回归 `Card variant=work`，统计改为移动端 2 列、`sm` 起 4 列；工作台移除未读 / 收藏外层 Card，趋势 tabs 与最近简报入口补足 44px，并用 Tailwind + MD3 原语替换未定义 bespoke class。
  - 简报详情建立 editorial 正文层级、72ch measure、16px / 1.75 行高和 44px 外链 / Event 入口；显示层本地化已知相关性解释模板，保持原始存储与导出不变并补安全 renderer fixture。
  - 信源治理与信源健康显示层统一解码常见 HTML 实体后交给 React 转义；页面头动作允许自然换行，主题编辑页 eyebrow 改为简体中文且表单回归稳定的 `work` Card。
  - 响应式 smoke 改用稳定 href 发现 Event / Topic / Briefing / Report 详情并纳入 history、reports、pricing、usage、topic timeline，避免视觉迁移后深层页面漏测。
  - Railway 首轮复查发现长简报会把 Card 内部撑到 518px、再被根节点 `clip` 掩盖；Card 原语补 `min-w-0`，正文补长词 / URL 换行，并给 smoke 新增内部 `scrollWidth > clientWidth` 裁切检测。
  - Railway 二轮定点复查发现 RSS 实际使用零填充 `&#039;`；展示层补齐常见命名、零填充十进制与十六进制实体解码，并加入 fixture 锁定。
  - `FRONTEND.md` 与 `docs/L3-modules.md` 固化详情页阅读宽度、动作层级、触达尺寸、实体解码和动态路由回归要求。
- Files: `apps/web/src/app/{events/[eventId],briefings/[briefingId],sources,topics/[topicId],topics/[topicId]/edit}/page.tsx`、`apps/web/src/components/{common/page-header,intelligence/topic-dashboard-view,intelligence/trend-chart,ui/card}.tsx`、`apps/web/src/lib/{briefing-markdown,display-text,event-display}.ts`、`apps/web/scripts/{briefing-detail,summary-status}.fixture.mjs`、`tests/smoke/responsive.spec.ts`、`CODEGUIDE.md`、`FRONTEND.md`、`docs/L3-modules.md`。
- Verification: `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check` 通过；本地 production server 与 Railway 最终版本的 320 / 375 / 414 / 768 / 1024 / 1440px 动态路由响应式矩阵均通过（各 1 passed）。Railway 375px 定点复查确认：主题趋势 tabs 与最近简报入口均 44px、情报类别已人类化且动作分组完整、长简报 Card / CardContent 无内部撑宽或屏外内容、简报解释无 `Matched topic`、信源页 `&#039;` 计数从 4 归零并正确显示 `What's new`。
- Notes / Risk: 仅调整浏览器显示层、布局和测试发现器，不改变查询、Server Action、权限、数据库、Worker、原始简报或导出内容；HTML 实体解码后仍由 React 安全转义，Markdown renderer 保持先 escape 再白名单渲染的安全边界。

### Fix: 第二轮视觉检查收束二级页面层级与可读性

- Cause: Railway 真实数据巡检发现 `/history` 状态筛选缺少布局样式，在桌面和移动端均退化为纵向整列；`/preferences` 直接暴露内部 key 与英文 explanation；`/topics` 主题主链接仅 24px 高且永久删除抢主视觉；`/briefings` 缺少进入简报详情的明确行动，标题、周期、元数据和导出层级混杂。
- Changed:
  - 历史状态筛选改为移动端 2×2、`sm` 起 4 列的 44px MD3 pills；历史事件行与操作区下沉到 Tailwind + Button 原语。
  - 偏好 key 映射为“信源 / 关键词 / 内容方向”，英文 explanation 转为中文反馈说明；权重、置信度和带文字的调整动作分层呈现。
  - 简报列表新增标题详情链接与“阅读”主行动，Markdown 降为次级行动；周期、主题、覆盖日期与生成时间重新分层。
  - 主题主入口补足 44px，元数据提升到可读字号，移动端操作左对齐；删除改为危险文字态并保留既有永久删除确认。
  - Railway 响应式冒烟复查定位到首页搜索框保留 intrinsic min-width，导致 320px 下刷新按钮向右溢出 6px；搜索框补 `min-w-0`，输入本体补足 44px 高，兼顾正常收缩与真实触达范围。
  - 工作区设置的 6 个凭证 tab 改为移动端 2 列、`sm` 3 列、`lg` 6 列；窄屏隐藏装饰图标并保留文字，消除 320px 横向滚动与屏外标签。
  - `FRONTEND.md` 与 `docs/L3-modules.md` 固化二级页面视觉与交互要求。
- Files: `apps/web/src/app/page.tsx`、`apps/web/src/app/{history,preferences,topics,briefings}/page.tsx`、`apps/web/src/app/admin/settings/page.tsx`、`apps/web/src/components/topics/delete-topic-button.tsx`、`FRONTEND.md`、`docs/L3-modules.md`。
- Verification: 本地 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check` 通过（构建仅保留既有 PDF NFT tracing warnings）；Railway 真实数据完成 `/history`、`/preferences`、`/briefings`、`/topics` 的 375px 实图复查；生产响应式矩阵覆盖自动发现的应用页面，在 320 / 375 / 414 / 768 / 1024 / 1440px 下无横向超框、屏外元素、小于 44px 的受测控件或主行动对比度问题（1 passed，mobile project 按矩阵设计 skipped）。
- Notes / Risk: 仅调整展示与交互层，不改变查询、Server Action、状态机、权限或数据库结构；偏好原始 key 继续作为隐藏表单值提交，UI 只隐藏内部实现语言。

### Fix: 第一轮视觉检查恢复 Material You 设计系统并收束导航

- Cause: Railway 线上视觉检查确认 `globals.css` 与 `top-nav.tsx` 在大合并后退回暗色 / 酸黄 Kinetic 实现，和 `FRONTEND.md` 已锁定的暖白 / 紫色 Material You（MD3）体系不一致；1440px 导航多项折行、移动端操作区层级拥挤，情报卡片五个动作在桌面产生孤行。
- Changed:
  - 全局 token 恢复为 `FRONTEND.md` 指定的 MD3 tonal 调色板与 Roboto/Geist Mono 字体角色，根节点改用 `overflow-x: clip`，同步修复亮色模式下旧状态链接的对比度。
  - 顶部导航收束为 4 个日常阅读入口、`新增主题` 主行动、`更多` 分组菜单；保留工作区切换、角色门禁与登录前极简品牌头，移动端工作区入口收成 44px 图标触点以规避长名称挤压。
  - 情报卡片移动端采用 2 列动作并让原文入口占满末行，桌面改为 5 列；归档动作回归 Button 原语，来源与标题触达高度补足 44px。
  - Railway 部署后复查发现 `更多` 菜单项仅 40px 高，统一补足为 44px 移动触达目标。
  - 移除按钮、Tabs、简报筛选和 meter 的 `transition-all`，避免焦点环与布局宽度被隐式动画。
  - `CODEGUIDE.md`、`docs/L3-modules.md` 统一为 Material You（MD3）实现口径。
- Files: `apps/web/src/app/globals.css`、`apps/web/src/components/layout/{top-nav,workspace-switcher}.tsx`、`apps/web/src/components/intelligence/intelligence-card.tsx`、`apps/web/src/components/ui/{button,dropdown-menu,tabs}.tsx`、`apps/web/src/app/{briefings,preferences,sources,usage}/page.tsx`、`CODEGUIDE.md`、`docs/L3-modules.md`。
- Verification: Railway 生产首页与信源页完成 1440px / 375px 基线检查；本地壳层在 320 / 375 / 414 / 768 / 1024 / 1440px 均无页面横向滚动、导航文字换行或小于 44px 的可见触达目标；`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check` 通过（构建仅保留既有 PDF NFT tracing warnings）。
- Notes / Risk: 本地未配置 `DATABASE_URL`，数据页本地视觉复查覆盖壳层、错误态与菜单，真实情报内容以 Railway 生产基线为准；`globals.css` 仍保留 #190 合并带回的部分 legacy bespoke 类，后续轮次需按页面逐步下沉到 MD3 原语，避免一次性删除影响新功能页面。

## 2026-07-18

### Feat: Issue #187 支持完整时间线与收藏集合导出

- Cause: briefings/topics export route 缺 ?format= 支持；Timeline >100 截断；无 Saved collection 导出。
- Changed:
  - `apps/web/src/app/exports/briefings/[briefingId]/route.ts`：补 ?format=json|pdf|markdown 三格式。
  - `apps/web/src/app/exports/topics/[topicId]/route.ts`：补 ?format= + take:10000 消除截断。
  - `apps/web/src/app/exports/timelines/[topicId]/route.ts`：新建，Timeline 全量导出，>500 返回 202+TaskRun。
  - `apps/web/src/app/exports/saved/route.ts`：新建，user-scoped saved 三格式。
  - `packages/core/src/{export-schema,render-pdf}.ts`：新增 buildTimelineExportJson/buildSavedExportJson + renderTimelinePdf/renderSavedPdf。
  - `packages/db/src/repositories/event.ts`：新增 listTimelineEventsForExport（take 10000）/ listSavedEventsForExport（user-scoped）。
  - `apps/worker/src/modules/dedup.fixtures.ts`：修复时间依赖（固定 2026-07-18 改相对 now-Xh，#171 引入的 fixture bug）。
- Files: `apps/web/src/app/exports/{briefings,topics,timelines,saved}/*`, `packages/core/src/{export-schema,render-pdf,index.fixtures}.ts`, `packages/db/src/repositories/{event,types}.ts`, `packages/db/src/index.ts`, `apps/worker/src/modules/dedup.fixtures.ts`。
- Verification: core export-schema + render-pdf fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: >500 deferred 的 Worker EXPORT_GENERATION handler 待补；saved topicId fallback。未部署、未关闭 Issue。Stage 5 批量 push。

### Feat: Issue #186 实现 JSON 与 PDF 导出

- Cause: SPEC §5.7 说"JSON 已落地"是不实契约；三条 export 路由全部硬编码 MARKDOWN。
- Changed:
  - `packages/core/src/export-schema.ts`：稳定版本化 JSON schema（schemaVersion=1），buildEventExportJson/buildBriefingExportJson/buildTopicExportJson/serializeExportJson/parseExportJson。
  - `packages/core/src/render-pdf.ts`：pdfkit PDF renderer（中文字体 fallback 链 env→仓库资产→系统字体→Helvetica，分页，链接 annotation），renderEventPdf/renderBriefingPdf/renderTopicPdf。
  - `packages/core/src/{pdf-types,export-test-helpers}.ts`：pdfkit 最小类型 shim + 测试字体路径解析。
  - `packages/core/src/index.ts`：render-pdf 不从 index 导出（Node-only，避免浏览器 bundle 破坏）；package.json exports 加 `./dist/*` 子路径。
  - `packages/db/src/repositories/export.ts`：recordMarkdownExport 泛化接受 format 参数（默认 MARKDOWN）。
  - `apps/web/src/app/exports/events/[eventId]/route.ts`：支持 ?format=json|pdf|markdown query param，正确 MIME/filename/ExportEvent.format。
  - 父 Agent 修复：runCoreFixtures 改 async、render-pdf.fixtures 直接 import render-pdf.js（不经 index）、package.json exports 加 dist 子路径。
- Files: `packages/core/src/{export-schema,render-pdf,pdf-types,export-test-helpers,index,index.fixtures}.ts`, `packages/core/src/{export-schema,render-pdf}.fixtures.ts`, `packages/core/package.json`, `packages/db/src/repositories/{export,types}.ts`, `apps/web/src/app/exports/events/[eventId]/route.ts`, `pnpm-lock.yaml`。
- Verification: core export-schema 6 fixture + render-pdf 8 fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: pdfkit 动态 import 仅在 server route handler（不进浏览器 bundle）；字体 8.3MB OTF 不 commit，runtime fallback；briefings/topics route ?format= 支持留给 #187。未部署、未关闭 Issue。Stage 5 批量 push。

### Feat: Issue #185 实现主题一体化 Dashboard 与趋势

- Cause: 缺少每主题一体化 Dashboard（未读/收藏/趋势/信源健康/简报）。
- Changed:
  - `packages/db/src/repositories/dashboard.ts`：新增 `getTopicDashboard`（8 并发查询：topic + 未读 Top + 收藏 + 7/30 天趋势 + 信源健康 + 最近简报）。
  - `packages/db/src/repositories/types.ts`：TopicDashboardRecord/TopicTrendData 类型。
  - `apps/web/src/lib/topic-source-data.ts`：`getTopicDashboardData` web 封装。
  - `apps/web/src/components/intelligence/{trend-chart,topic-dashboard-view}.tsx`：纯 CSS 图表（TrendBarChart/DailyTrendChart/SourceHealthList）+ Dashboard 视图。
  - `apps/web/src/app/topics/[topicId]/page.tsx`：重写调用 Dashboard。
  - 父 Agent 修复：移除未定义的 `adaptEventForCard` 引用（数据已是 DTO 格式）。
- Files: `packages/db/src/repositories/{dashboard,types,event}.ts`, `packages/db/src/{index,repositories.fixtures,repositories}.ts`, `apps/web/src/{lib/topic-source-data,components/intelligence/{trend-chart,topic-dashboard-view},app/topics/[topicId]/page}.tsx`。
- Verification: db dashboard fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 纯 CSS 图表无图表库依赖；实体聚合客户端 Map；globals.css 待补。未部署、未关闭 Issue。Stage 4 批量 push。

### Feat: Issue #182 增加浏览器简报详情页

- Cause: 缺少浏览器内简报正文详情与阅读操作。
- Changed:
  - `packages/db/src/repositories/event.ts`：新增 `getBriefingDetail`（tenant-scoped，跨租户拒绝）。
  - `apps/web/src/lib/briefing-markdown.ts`：自定义安全 Markdown renderer（白名单标签/属性 + 全量 HTML escape，不引入第三方库）。
  - `apps/web/src/app/briefings/[briefingId]/page.tsx`：详情页（安全渲染、下载、批量已读复用 #173、Event 跳转、空正文兜底）。
  - `apps/web/scripts/briefing-detail.fixture.mjs`：XSS 测试（script/iframe/img onerror/javascript/data:）。
- Files: `packages/db/src/repositories/{event,types}.ts`, `packages/db/src/{index,repositories.fixtures}.ts`, `apps/web/src/lib/{briefing-markdown,topic-source-data}.ts`, `apps/web/src/app/briefings/[briefingId]/page.tsx`, `apps/web/scripts/briefing-detail.fixture.mjs`, `apps/web/package.json`。
- Verification: web briefing markdown renderer fixture ✓ + db getBriefingDetail fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: `dangerouslySetInnerHTML` 经白名单+escape+XSS fixture 覆盖；globals.css 类待补；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 4 批量 push。

### Feat: Issue #184 简报支持业务时区与过滤统计

- Cause: SPEC §4.2 可配置业务时区未实现（固定 UTC）；低价值过滤统计未在简报呈现。
- Changed:
  - `packages/core/src/business-window.ts`：`createBusinessWindowRange`（UTC/Asia-Shanghai/DST 日周月边界）、`resolveBusinessTimezone`（当前空=UTC）。
  - `packages/core/src/filtered-stats.ts`：`summarizeFilteredStats`（按原因聚合）、`renderFilteredStatsSection`（zh-CN 分区渲染）。
  - `packages/db/src/repositories/source.ts`：`countFilteredItemsInRange`（FILTERED item 按窗口+原因统计）。
  - `apps/worker/src/modules/briefing.ts`：`buildFilteredStatsMetadata`（父 Agent 补全 subagent 半成品）；Briefing metadata 记录 filteredStats + timezone。
- Files: `packages/core/src/{business-window,filtered-stats,index.fixtures,index}.ts`, `packages/db/src/repositories/{source,types}.ts`, `packages/db/src/index.ts`, `apps/worker/src/modules/briefing.ts`。
- Verification: core business-window + filtered-stats fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: timezone 当前空=UTC（schema 加字段后落地）；无 schema migration。未部署、未关闭 Issue。Stage 4 批量 push。

### Refactor: Issue #183 按 SPEC 重构中文结构化简报

- Cause: 简报渲染不完整消费 Topic.digestStyle，可能有英文模板残留，结构不符合 SPEC §4.2 分区展示。
- Changed:
  - `packages/core/src/render-briefing.ts`：zh-CN 默认；分区展示（重要性/影响对象/可信度/后续动作/多来源）；完整消费 digestStyle（compact/standard/detailed structure + brief/standard/comprehensive detailLevel + maxEvents 上限）；不丢 entities/followUpSuggestion/secondarySources；Preference 影响事件选择。
  - `apps/worker/src/modules/briefing.ts`：消费新渲染器。
  - `packages/core/src/index.fixtures.ts`：15 个新 briefing fixture。
- Files: `packages/core/src/{render-briefing,index.fixtures}.ts`, `apps/worker/src/modules/briefing.ts`。
- Verification: core 15 新 fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 schema migration；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 4 批量 push。

### Fix: Issue #179 完善 Telegram 简报重试与补投

- Cause: 第一次 500 后第二轮永不重试，FAILED 永久漏投。
- Changed:
  - `packages/db/src/repositories/delivery-log.ts`：新增 `claimDeliveryLog`（原子 claim，SENT/SKIPPED 返回 null，并发靠唯一约束）、`markDeliveryFailed`（attempt+1，退避基于 updatedAt，attempt 上限后 SKIPPED）。
  - `apps/worker/src/modules/telegram-delivery.ts`：cycle 查询 FAILED/PENDING/stale 区分 retryable，claim→send→markSent/markFailed，SENT 幂等。
  - `apps/worker/src/{index.fixtures,modules/types}.ts`：fixture + 类型。
- Files: `packages/db/src/repositories/delivery-log.ts`, `packages/db/src/index.ts`, `apps/worker/src/modules/{telegram-delivery,types}.ts`, `apps/worker/src/index.fixtures.ts`。
- Verification: worker telegram-delivery fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 schema migration（退避基于 updatedAt）；如需精确 nextAttemptAt 需独立 Issue。未部署、未关闭 Issue。Stage 4 批量 push。

### Feat: Issue #178 专题报告接入可追溯正文证据集

- Cause: 报告 itemCount 硬编码 events.length；无 briefingCount/evidenceIds；AI prompt 无 provenance；未禁止联网补全。
- Changed:
  - `packages/db/src/repositories/report.ts`：新增 `collectReportEvidence()`（从 Event/Item.rawContent/Briefing/Source metadata 召回，去重压缩，保留 evidenceIds/URLs/timestamps/trust）。
  - `apps/worker/src/modules/report.ts`：itemCount/briefingCount 真实数量；AI prompt 每条证据带编号+ID+URL+timestamp+trust，禁止联网补全；INSUFFICIENT_DATA 持久化 evidenceIds。
  - `apps/worker/src/modules/report.fixtures.ts`：7 项 fixture。
- Files: `packages/db/src/repositories/report.ts`, `packages/db/src/index.ts`, `apps/worker/src/modules/{report,report.fixtures}.ts`。
- Verification: worker report 7 fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: briefingCount/evidenceIds 存 Report.metadata JSON（不改 schema）；真实 PG 三层 include 验证待补。未部署、未关闭 Issue。Stage 4 批量 push。

### Fix: Issue #177 专题报告正确记录证据不足状态

- Cause: 报告证据不足时未正确落库 INSUFFICIENT_DATA，可能错误标记 COMPLETED。
- Changed:
  - `packages/db/src/repositories/report.ts`：新增 `completeInsufficientReport()`（显式终态参数，状态转换校验，幂等）。
  - `apps/worker/src/modules/report.ts`：证据不足时调 completeInsufficientReport 而非 completeReport，写 coverageNote。
  - `apps/worker/src/modules/report.fixtures.ts`：4 断言 fixture。
  - `apps/web/src/app/reports/[reportId]/page.tsx`：UI 显示 INSUFFICIENT_DATA + coverageNote + 下一步。
- Files: `packages/db/src/repositories/report.ts`, `packages/db/src/index.ts`, `apps/worker/src/modules/{report,report.fixtures}.ts`, `apps/worker/src/index.fixtures.ts`, `apps/web/src/app/reports/[reportId]/page.tsx`。
- Verification: worker report fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 schema migration；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 4 批量 push。

### Feat: Issue #165 闭合反馈到采集分析简报的偏好学习

- Cause: SPEC §5.6 明确"待闭合"：偏好未回灌到 relevance filter、AI event extraction prompt、source scheduling。§7.4 "抓取+筛选"两环未闭合。
- Changed:
  - `packages/core/src/preference.ts`：新增 `loadPreferenceSnapshotsByTopic`/`loadPreferenceSnapshotsForScheduling`（版本化 preference snapshot，可解释）。
  - `packages/core/src/relevance.ts`：relevance filter 从 PreferenceMemory 动态合并 excludeScope/keywords（探索率硬下限防 filter bubble）。
  - `packages/ai/src/event-extraction.ts`：system prompt 注入当前偏好上下文。
  - `apps/worker/src/modules/{analysis,fetch-cycle}.ts`：source scheduling 偏好影响抓取频率/范围；用户编辑/删除偏好后下一轮生效。
  - `packages/core/src/index.fixtures.ts`：10 个新 #165 fixture（偏好影响筛选/AI/调度/探索率/删除恢复）。
- Files: `packages/core/src/{preference,relevance,index.fixtures}.ts`, `packages/ai/src/event-extraction.ts`, `apps/worker/src/modules/{analysis,fetch-cycle}.ts`。
- Verification: core 10 新 fixture + ai event-extraction + worker fixtures ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 探索率硬下限防 filter bubble；真实 PG worker 端到端周期测试待补；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 3 批量 push。

### Feat: Issue #175 补齐来源质量与评分校准反馈入口

- Cause: events/[eventId] 详情页缺 SOURCE_QUALITY_UP/DOWN 入口；增强反馈未完整绑定。
- Changed:
  - `apps/web/src/app/actions/events.ts`：补齐 SOURCE_QUALITY_UP/DOWN action（复用 #164 FeedbackKind），明确绑定 event/source/topic，防双写。
  - `apps/web/src/app/events/[eventId]/page.tsx` 或组件：反馈按钮（成功/错误/撤销语义，键盘可访问）。
  - `apps/web/scripts/enhanced-feedback-kinds.fixture.mjs`：6 种 kind 绑定+防双写+撤销 fixture。
- Files: `apps/web/src/app/actions/events.ts`, `apps/web/src/app/events/[eventId]/*`, `apps/web/scripts/enhanced-feedback-kinds.fixture.mjs`, `apps/web/package.json`。
- Verification: web enhanced-feedback-kinds fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 source 的 event 提交 SOURCE_QUALITY 时 core 静默不产生 delta（既有安全行为）；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 3 批量 push。

### Feat: Issue #174 增加个人阅读历史与归档恢复

- Cause: 无已读/忽略/归档历史视图；个人 ARCHIVED 状态未实现。
- Changed:
  - `packages/db/src/repositories/event.ts`：新增 `archiveDashboardEvent`/`restoreDashboardEvent`（archive 不产生 FeedbackEvent；restore 派生 saved→SAVED/readAt→READ/否则 UNREAD）、`listUserHistoryEvents`（分页 + status 单值筛选 + 组织级 ARCHIVED notIn）；`listDashboardEvents` NOT 子句加入个人 ARCHIVED（#172 follow-up）。
  - `packages/db/src/repositories/util.ts`：新增 `resolveRestoredStatus` 派生函数。
  - `apps/web/src/lib/topic-source-data.ts`：history 数据映射。
  - `packages/db/src/repositories.fixtures.ts`：7 个新 fixture。
- Files: `packages/db/src/repositories/{event,types,util}.ts`, `packages/db/src/{index,repositories.fixtures}.ts`, `apps/web/src/{app/actions/_shared,lib/topic-source-data}.ts`。
- Verification: db 7 新 fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: archive 不产生 FeedbackEvent（不污染偏好学习）；history CSS 类待补；真实 PG archive/restore fixture 待补。未部署、未关闭 Issue。Stage 3 批量 push。

### Feat: Issue #173 支持按当日 Briefing 批量标记事件已读

- Cause: 无批量已读功能，用户需逐条标记。
- Changed:
  - `packages/db/src/repositories/event.ts`：新增 `markBriefingEventsAsRead()` 批量 upsert UserItemState 为 READ（保留 saved=true，createMany skipDuplicates 幂等，返回 changed/skipped counts）。
  - `apps/web/src/app/actions/events.ts`：新增 `markBriefingAsReadAction` server action。
  - `packages/db/src/repositories.fixtures.ts`：批量 + 幂等 + 保留 saved + changed/skipped fixture。
- Files: `packages/db/src/repositories/{event,types}.ts`, `packages/db/src/{index,repositories.fixtures}.ts`, `apps/web/src/app/actions/events.ts`。
- Verification: db fixtures ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 schema migration；批量审查 Stage 末尾补。未部署、未关闭 Issue。Stage 3 批量 push。

### Fix: Issue #172 按 UserItemState 隔离情报阅读与收藏状态

- Cause: Event 生命周期状态和个人阅读状态混在 IntelligenceEvent.status；用户 A read/dismiss 影响用户 B 信息流；Dashboard/Briefing 查询未按当前用户 UserItemState 派生。
- Changed:
  - `packages/db/src/repositories/event.ts`：`updateDashboardEventState` 移除 `intelligenceEvent.update({data:{status}})`，只 upsert UserItemState + 写 feedback；`listDashboardEvents` where 改为 `status notIn [ARCHIVED]` + NOT EXISTS 当前用户 READ/DISMISSED UserItemState；`listEventsForDailyBriefing`/`listTimelineEvents` 改为 `status notIn [ARCHIVED]`（briefing 是组织级产物）；`mapDashboardEventRecord` 返回派生 status（`userState?.status ?? "UNREAD"`）+ userSaved 完全来自 userState。
  - `packages/db/src/repositories.fixtures.ts`：4 个新隔离测试（A read 不影响 B、A dismiss 不影响 B、A save 不进 B saved、操作不改 IntelligenceEvent.status）+ 旧全局状态兼容 fallback 测试。
  - `packages/db/src/user-item-state-pg.fixtures.ts`：真实 PostgreSQL 两用户隔离 opt-in fixture（4 invariant）。
- Files: `packages/db/src/repositories/{event,types}.ts`, `packages/db/src/{repositories.fixtures,user-item-state-pg.fixtures}.ts`。
- Verification: db 4 新隔离测试 + 真实 PG 两用户隔离 4 invariant ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 无 schema migration（UserItemState 已存在）；旧全局 READ/SAVED/DISMISSED 兼容 fallback（当无当前用户 UserItemState 但 event.status 是旧值时视为历史状态）；#174 个人 ARCHIVED 需重新审视 notIn 查询。未部署、未关闭 Issue。Stage 3 批量 push。

### Fix: Issue #171 扩大跨源语义去重覆盖

- Cause: 不同 URL/标题同一事件无法合并；已读旧事件无法与新报道合并；别名实体无法匹配；晚到报道漏入窗口；无 AI 时按 URL 隔绝跨源候选。
- Changed:
  - `packages/core/src/{index,index.fixtures}.ts`：新增 `canonicalizeTitle`（去前缀噪声/标点/全角半角归一化）、`canonicalizeEntity`（内置 12 常见科技公司中英别名 + 去法人后缀）、`shareCanonicalEntity`。
  - `apps/worker/src/modules/dedup.ts`：`recallDedupCandidates` 去掉 `status: "UNREAD"` 过滤（脱离阅读状态）；bounded lookback 基于 `createdAt`（默认 48h，可配置 `WANGCHAO_DEDUP_LOOKBACK_HOURS`）；无 AI 时 `deterministicDedupDecision` 安全 fallback（canonical title 0.9 + alias+时间窗 0.75）；新增可选 `deps` 参数支持 fixture 注入。
- Files: `packages/core/src/{index,index.fixtures}.ts`, `apps/worker/src/modules/dedup.ts`。
- Verification: core/ai/db/worker typecheck + fixtures ✓；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: 内置别名表仅 12 条（长尾需后续补充）；写入期 fuzzy 匹配未同步升级（属后续）；真实 PG 端到端缺失（mock 精确模拟）。未部署、未关闭 Issue。Stage 2 批量 push。

### Refactor: Issue #170 分离情报相关性重要性与综合评分

- Cause: gravityScore 是单一混合分数，相关性相同的 item 但重要性/来源质量不同时 gravityScore 仍相同。
- Changed:
  - `packages/core/src/relevance.ts`：新增 `relevanceScore`/`importanceScore`/`sourceQualityFactor`/`preferenceAdjustment` 独立维度；版本化 `SCORING_FORMULA_VERSION`；`calculateGravityScore` 组合四维度，旧事件兼容懒重算。
  - `packages/ai/src/event-extraction.ts`：AI JSON schema 新增独立分数字段，prompt 更新，parser 解析 + fallback。
  - `packages/ai/src/event-extraction.fixtures.ts`：新增评分维度 fixture。
  - `packages/core/src/index.fixtures.ts`：新增评分维度测试（相关性相同但重要性/来源质量不同，gravityScore 不同）。
  - `apps/worker/src/modules/analysis.ts`：分析 cycle 消费新维度，resolveSourceQualityFactor 复用 #176 getSourceQualitySummary。
- Files: `packages/core/src/{relevance,index.fixtures}.ts`, `packages/ai/src/{event-extraction,event-extraction.fixtures}.ts`, `apps/worker/src/modules/analysis.ts`。
- Verification: core + ai + worker typecheck + fixtures ✓；全仓 typecheck/lint/test/build/diff-check ✓（Node 26）。
- Notes / Risk: 无 schema migration（独立维度存 rawAiResponse JSON + gravityScore 组合）；批量审查在 Stage 2 末尾补。未部署、未关闭 Issue。Stage 2 批量 push。

### Feat: Issue #167 自然语言 Topic 草案生成与确认流程

- Cause: `topics/new/page.tsx` 提交后直接创建；`topic-profile.ts` 只是分词和固定模板；没有草案状态、预览、确认/修改步骤。
- Changed:
  - `packages/ai/src/index.ts`：新增 `generateTopicProfileDraft()` AI 生成 + `fallbackTopicProfileDraft()` 规则 fallback，版本化 schemaVersion，generationMode 标识。
  - `apps/web/src/app/actions/topics.ts`：新增 `generateTopicDraftAction`（AI 生成草案 → cookie 传递）和 `confirmCreateTopicAction`（确认 → 创建 Topic + 匹配信源），全链路 sanitize（sanitizeShortText/sanitizeStringList/readDigestStyle），AI 失败 try/catch fallback，cookie httpOnly+sameSite=lax+15min maxAge。
  - `apps/web/src/app/topics/new/page.tsx`：Step 1 输入页。
  - `apps/web/src/app/topics/new/preview/{page,topic-draft-preview-form}.tsx`：Step 2 预览确认页（逐字段编辑、重新生成、确认创建、cookie 过期/损坏错误状态）。
  - `apps/web/src/app/globals.css`：补 `.topic-draft-mode-hint` 和 `.topic-regenerate-form` 定义（DeepSeek 审计 C1 修复）。
  - `tests/smoke/web.spec.ts`：Playwright 契约从单步改为两步流程。
- Files: `packages/ai/src/index.ts`, `packages/ai/package.json`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/topics/new/{page,preview/page,preview/topic-draft-preview-form}.tsx`, `apps/web/src/app/globals.css`, `apps/web/package.json`, `tests/smoke/web.spec.ts`。
- Verification: AI 7 测试 + web 6 fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓；DeepSeek V4 Pro 审计 Critical 1（CSS 未定义）已修复。
- Notes / Risk: 响应式断点/loading 状态/英文空描述测试为 Important 后续改进；Playwright smoke 需 live server+PG，环境未跑。未部署、未关闭 Issue。Stage 2 批量 push。

### Feat: Issue #169 重建 Candidate 观察与晋升闭环

- Cause: Candidate observation 可抓 Item 但分析查询要求 ACTIVE；到期审核以 IntelligenceEvent 为依据导致正常 Candidate 全部 REJECTED。
- Changed:
  - `packages/db/src/repositories/util.ts`：新增 `recommendCandidatePromotion()` 纯函数（APPROVE/OBSERVE/MUTE/REJECT/INSUFFICIENT_SAMPLE），样本不足/抓取失败保护，阈值基于 hitRate/noiseRate/qualityScore。
  - `packages/db/src/repositories/source.ts`：新增 `computeCandidateQualityMetrics()` 按 source 聚合 relevance 结果为 hit/noise/duplicate 指标。
  - `apps/worker/src/modules/governance.ts`：Candidate 隔离 observation cycle，不进正式 Event/Briefing；到期审核走 recommendCandidatePromotion 而非 IntelligenceEvent 判据；样本不足延长观察期。
  - `apps/worker/src/{index.fixtures,modules/fetch-cycle}.ts`：集成 + fixture。
  - `packages/db/src/{index,repositories.fixtures}.ts`：导出 + 2 个新 fixture（8 分支纯函数 + 聚合）。
- Files: `packages/db/src/repositories/{util,source}.ts`, `packages/db/src/{index,repositories.fixtures}.ts`, `apps/worker/src/modules/{governance,fetch-cycle}.ts`, `apps/worker/src/index.fixtures.ts`。
- Verification: db 8 分支纯函数 + 聚合 fixture；worker governance fixture；全仓 typecheck/lint/test/build/diff-check ✓。
- Notes / Risk: Candidate Item 隔离由 listFetchedItemsForAnalysis 的 source.status=ACTIVE 过滤保证；批量审查在 Stage 2 末尾补。未部署、未关闭 Issue。Stage 2 批量 push。

### Feat: Issue #168 接入 WEB 与公告列表页采集

- Cause: `listActiveRssSourcesForFetch()` 仅查 RSS，Worker 统一调 `fetchRssFeed()`，SourceKind.WEB 只有 Schema 预留。
- Changed:
  - `packages/sources/src/index.ts`：统一 `SourceAdapter` 契约 `fetch(source, options) -> NormalizedSourceItem[]`，registry 按 kind 分发；RSS adapter 薄包装 `fetchRssFeed`；WEB adapter 用 linkedom 静态解析，支持 itemSelector/titleSelector/linkSelector 配置 + 通用锚点 fallback，`<meta charset>` 复解码兜底。
  - `packages/sources/package.json`：新增 linkedom 依赖。
  - `apps/worker/src/modules/fetch.ts`：`fetchSourceItemsForKind` 统一 dispatch，kind 缺省默认 RSS；`FetchWebError`(带 status)/`UnknownSourceKindError`(非重试)，`isFetchRetryable` 覆盖 408/429/5xx/Abort/TypeError。
  - `packages/db/src/repositories/source.ts`：`listActiveSourcesForFetch` 支持所有 kind（不再仅 RSS）。
  - `apps/worker/src/{index.fixtures,modules/{fetch-cycle,governance}}.ts`、`packages/db/src/{index,repositories/types}.ts`：集成 + 5 个新 dispatch fixture。
- Files: `packages/sources/src/index.ts`, `packages/sources/package.json`, `apps/worker/src/{modules/fetch,fetch-cycle,governance,index.fixtures}.ts`, `packages/db/src/repositories/{source,types}.ts`, `packages/db/src/index.ts`。
- Verification: sources/worker/db typecheck + fixtures ✓；全仓 typecheck/lint/test/build/diff-check ✓；DeepSeek V4 Pro APPROVED（Critical 0 / Important 2 均非正确性 / Minor 3）。
- Notes / Risk: WEB adapter 选择器配置无 Admin UI 入口（走通用 fallback，功能可用精度低），UI 属后续增强；候选 WEB 观察属 #169。未部署、未关闭 Issue。Stage 2 批量 push。

### Fix: Issue #176 持久化 Source 质量分并闭合自动降权/静默治理

- Cause: `listSourceGovernanceReport()` 动态计算 qualityScore 不持久化；`recordSourceQualityObservation()` 只写 SourceObservation 不更新 Source.qualityScore；噪声推荐主要展示未进入评分和自动降权。
- Changed:
  - `packages/db/src/repositories/util.ts`：新增 `SOURCE_QUALITY_FORMULA_VERSION`、`SOURCE_QUALITY_MIN_SAMPLE`、`decideAutomaticGovernance()`（按阈值自动降权/建议静默，最小样本保护，REJECT 保留人工确认）。
  - `packages/db/src/repositories/source.ts` `recordSourceQualityObservation()`：改为单一 `$transaction` 内 `Promise.all` 写 SourceObservation 历史 + 更新 Source.qualityScore，evidence 记录 formulaVersion 和 persistedQualityScore；trustScore 不被 observation 自动改。`listSourceGovernanceReport()` 读持久化 qualityScore（为 0 时回退派生值，暴露 persisted/derived/stale 三值）。新增 `getSourceQualitySummary()` 统一读取接口。
  - `packages/db/src/repositories/types.ts`：新增 `SourceQualitySummary` 类型。
  - `packages/db/src/index.ts`：导出 `getSourceQualitySummary`。
  - `apps/worker/src/modules/governance.ts`：governance cycle 消费新接口。
  - `apps/worker/src/modules/{fetch-cycle,fetch,types}.ts`：集成新类型。
  - `packages/db/src/repositories.fixtures.ts`：6 个新 fixture（qualityScore 持久化、stale 回退、公式版本、最小样本保护、REJECT 人工确认、统一读接口）。
- Files: `packages/db/src/repositories/{source,types,util}.ts`, `packages/db/src/{index,repositories.fixtures}.ts`, `apps/worker/src/modules/{governance,fetch-cycle,fetch,types}.ts`, `docs/L3-modules.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification:
  - DB 6 个新 fixture + worker governance fixture ✓；全仓 typecheck/lint/test/build/diff-check ✓（Node 26 + Prisma generate）。
  - DeepSeek V4 Pro 只读审计 APPROVED（Critical 0 / Important 1: getSourceQualitySummary 尚无外部调用方 / Minor 3）。
- Notes / Risk: 无 schema migration（复用现有 Source.qualityScore/trustScore 字段）；真实 PostgreSQL fixture 为已知环境限制，mock 精确模拟 $transaction 并行写。未部署、未关闭 Issue。Stage 2 批量 push。

### Fix: Issue #164 反馈信号字段完整性、跨 Topic 隔离与时间衰减

- Cause: `listRecentFeedbackSignals` mapper 丢失 `feedbackEventId`/`eventId`/`createdAt`，`generatePreferenceDeltas` dedupKey 退化为 `eventId+kind`（空 eventId 时跨 Topic 吞信号），查询排除 6 种增强反馈类型，30 天半衰期因缺失 createdAt 失效；MORE_LIKE_THIS/LESS_LIKE_THIS 的 preferenceKeysForSignal 重复推送 category key 导致单信号双倍计算。
- Changed:
  - `packages/db/src/repositories/event.ts` `listRecentFeedbackSignals`：查询 `kind.in` 扩展为全部 12 种非治理反馈（READ/SAVE/DISMISS/EXPORT/CATEGORY_UP/CATEGORY_DOWN/MORE_LIKE_THIS/LESS_LIKE_THIS/SOURCE_QUALITY_UP/SOURCE_QUALITY_DOWN/SCORE_UP/SCORE_DOWN）；include 新增 `source` 关系；mapper 返回 `feedbackEventId`(=id)/`eventId`/`createdAt`/`topicId`/`sourceId`/`sourceName`/`category`/`value`，eventId 缺失时 fallback 到 `feedbackEvent.sourceId`/`feedbackEvent.source.name`。
  - `packages/db/src/repositories/types.ts` `FeedbackSignalRecord`：新增 `feedbackEventId: string`、`eventId: string | null`、`createdAt: Date`，kind 联合类型扩展为 12 种。
  - `packages/core/src/preference.ts` `FeedbackSignal`：新增 `feedbackEventId?: string | null`、`createdAt?: Date | null`；`generatePreferenceDeltas` dedupKey 改为 `${feedbackEventId}::${kind}::${topicId}`，防止跨 Topic 吞信号；`preferenceKeysForSignal` MORE/LESS_LIKE_THIS 分支委托给 `preferenceKeysForEvent` 避免重复 category key。
  - `packages/core/src/index.fixtures.ts`：新增 5 个测试（同 Topic 三次 DISMISS 累积、跨 Topic 隔离、replay 幂等、31 天衰减、增强反馈不跨 Topic 合并、缺失 feedbackEventId 安全、MORE_LIKE_THIS 不重复计算）。
  - `packages/db/src/repositories.fixtures.ts`：新增 `verifyFeedbackSignalMapperPreservesContractFields`，验证 mapper 在 Prisma 返回形状下正确映射全部字段。
- Files: `packages/core/src/{preference,index.fixtures}.ts`, `packages/db/src/repositories/{event,types}.ts`, `packages/db/src/repositories.fixtures.ts`, `docs/L3-modules.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification:
  - Core fixtures 19 测试（含新增回归）✓；DB repositories fixture ✓。
  - 全仓 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` / `git diff --check` ✓（Node 26 + Prisma generate）。
  - DeepSeek V4 Pro 只读审计：首轮 REQUEST_CHANGES（1 Critical: MORE_LIKE_THIS category key 重复计算）→ 父 Agent 修复 + 补回归测试 → Core fixtures 重跑全绿。
- Notes / Risk: DB mapper 的真实 PostgreSQL 集成证明依赖 disposable PG，当前用精确 mock 覆盖；Stage 2/#176 会重建 Source 质量 fixture 时补真实 PG 链路。未部署、未关闭 Issue。

### Docs: 同步 SPEC 对齐 Stage 1 已完成进度

- Cause: Task 1.1–1.5 已分别完成、验证并推送，但实施计划缺少当前完成检查点，且 `DEVELOPE_LOGS.md` 的 Task 1.5 Follow-up 仍停留在提交前状态。
- Changed: 在实施计划 Stage 1 顶部新增 Task/Issue/状态/已验证 commit 表；只将已有独立远端提交的 Task 1.1–1.5 标为完成。修正 Task 1.5 最终门禁、commit/push 与远端核验记录；明确 Task 1.6 仅完成需求调研、尚未进入 RED→GREEN，不计为完成。
- Files: `.hermes/plans/2026-07-17_183453-spec-alignment-implementation-plan.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: 对照 `git log` 核验五个任务 commit；检查工作树仅包含上述文档；执行 `git diff --check`。
- Notes / Risk: 本次仅同步事实性开发进度，不修改产品 SPEC、代码、Schema、运行命令或部署配置；推送 feature branch 不部署、不关闭 Issue。

### Feat: Issue #163 主 Worker 多组织公平调度与 tenant fencing

- Cause: 默认 Worker fetch 仍只执行 default workspace；durable queue drain 与 cron fetch 没有共享总 deadline，也缺少稳定 actor、per-org 审计/错误边界和真实双组织隔离证明。
- Changed:
  - `listEligibleWorkerWorkspaces()` 只枚举含 ACTIVE 用户的 Organization，按 Organization createdAt/id 稳定排序，并按 OWNER→ADMIN→MEMBER、Membership createdAt/id 选一个 actor。
  - 默认 main cycle 只初始化一次总预算，先 drain durable queue，再将剩余预算传给多组织 orchestrator；每组织获得动态公平预算和独立 SOURCE_FETCH outer TaskRun。总预算耗尽时剩余组织仅返回 `SKIPPED_BUDGET`，不创建 TaskRun；摘要只含 organizationId/status/fixed errorClass。
  - `runFetchCycleForWorkspace()` 保持 exact workspace 业务函数；standalone `runFetchCycle()` 移至 organization orchestrator 并初始化独立预算。新增 deterministic main/organization fixtures 与 fail-closed PostgreSQL integration。
  - tenant 审计修复 `mergeSemanticEvents()` 全读写路径和 `markItemFiltered()` 的 organization fencing；dedup 日志改为固定低基数 error class。
- Files: `packages/db/src/{index,repositories.fixtures,worker-workspace.fixtures}.ts`, `packages/db/src/repositories/{workspace,event,source}.ts`, `packages/db/package.json`, `apps/worker/src/{index,index.fixtures}.ts`, `apps/worker/src/modules/{organization-cycle,organization-cycle.fixtures,organization-cycle-pg.fixtures,main-cycle.fixtures,lifecycle,types,fetch-cycle,analysis,dedup}.ts`, `apps/worker/package.json`, `CODEGUIDE.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification:
  - DB/Worker focused typecheck、fixtures、lint、`git diff --check` ✓。
  - Disposable PostgreSQL 16 完整 replay 0001→0017 ✓；真实双组织 integration 覆盖 ACTIVE actor、repository/destructive mutation fencing、production workspace pipeline、A fail/B success、TaskRun/UsageEvent/DeliveryLog isolation ✓。
  - 最终全仓 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` / `pnpm db:validate` / `git diff --check` ✓。
  - DeepSeek V4 Pro 两次只读审计因 provider silent 超过 15/10 分钟 deadline 被终止，均无 verdict；未伪称 APPROVED。父 Agent 复核 main deadline、actor enum ordering、consumer 无二次 reset、TaskRun settlement、循环依赖与 PG fail-closed guard。
- Notes / Risk: disposable DB 未配置外部 AI credential，analysis/dedup 子 cycle 按设计以固定 `configuration` class graceful isolation；真实外部 provider 质量不属于本任务。未部署、未关闭 Issue。

### Feat: Issue #162 TaskRun claim / lease / consume durable queue

- Cause: Web 手动抓取/信源发现此前直接创建 `RUNNING` TaskRun，但主 Worker 不消费这些行；缺少原子 claim、lease fencing、stale recovery 与数据库级 active idempotency，并发 Worker 可能重复执行或让旧执行者覆盖新结果。
- Changed:
  - Prisma `TaskRun` 新增 `idempotencyKey`、`leaseOwner`、`leaseToken`、`leaseExpiresAt`、`heartbeatAt`；migration `0017_task_run_lease_queue` 新增 due-scan index 和仅约束 `PENDING/RUNNING` 的 tenant/type/key partial unique index，不改写历史 RUNNING 数据。
  - 新增 durable repository：active-idempotent enqueue、单 CTE `FOR UPDATE SKIP LOCKED` claim、lease renew、fenced complete/fail/yield、bounded expired-lease reaper。fail/reaper 在同一 SQL statement 内按 attempt budget 选择 PENDING/FAILED；planned yield 原子返还 claim attempt。JSON 按 UTF-8 100KB 上限校验，错误只保存固定低基数 class。
  - Worker 抽取显式 workspace fetch/discovery execution；新增 exact-type consumer、严格 `{mode,userId}` parser、lease heartbeat、指数退避和 ownership-loss metrics。默认主 cycle 先 drain queue 再保留旧 fetch cron，另提供 `pnpm worker:task-runs`。Durable discovery 不创建嵌套 TaskRun。
  - Web source actions 改用 `enqueueTaskRun()` 创建 PENDING task；60 秒 UTC 时间桶 idempotency key 抑制双击/请求重试，保留 discovery OWNER/ADMIN 与 fetch OWNER/ADMIN/MEMBER 权限边界。
- Files: `packages/db/prisma/{schema.prisma,migrations/0017_task_run_lease_queue/migration.sql}`, `packages/db/src/repositories/{task-run,source}.ts`, `packages/db/src/{task-run*.fixtures,repositories.fixtures,index}.ts`, `packages/db/package.json`, `apps/worker/src/{index.ts,index.fixtures.ts,modules/{task-run-consumer,task-run-consumer.fixtures,fetch-cycle,discovery,types}.ts}`, `apps/worker/package.json`, `apps/web/src/{app/actions/sources.ts,lib/task-run-enqueue.ts}`, `apps/web/scripts/task-run-enqueue.fixture.mjs`, `apps/web/package.json`, root `package.json`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`.
- Verification:
  - DB/Web/Worker focused typecheck, tests、lint 与 `git diff --check` ✓；Prisma format/generate/validate ✓。
  - Disposable PostgreSQL 16 完整 replay `0001→0017` ✓；真实并发 suite 覆盖 8 路 enqueue 单 winner、SKIP LOCKED claim 唯一性、stale token、retry/finalize、budget-neutral yield、exact-expiry reaper、终态 key 复用 ✓。
  - 真实 production API probe：`enqueueTaskRun` → production Worker consumer；合法 SOURCE_DISCOVERY 为 `claimed=1/succeeded=1`，非法 payload 为 `claimed=1/failed=1`，两者 lease 均清理 ✓。
  - DeepSeek V4 Pro 首轮发现 1 Important / 4 Minor：legacy TaskRun raw error、fetch 子 cycle raw stderr、renew exception 误判 ownership loss、yield stale errorMessage、URL `/config/` classifier 误判；全部修复并补 regression fixtures。第二轮审计 APPROVED（Critical 0 / Important 0 / Minor 1）；唯一 Minor `lease_expired` reserved marker 已按建议加代码注释明确边界。
  - 最终全仓 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` / `pnpm db:validate` / `git diff --check` ✓；added-lines 安全扫描 5 类均为 0。
- Notes / Risk: 默认 Worker 一轮会先消费最多 50 个 durable task，再执行既有 default fetch；完整多组织公平调度属于后续 Task 1.5 / #163。本轮尚未部署、未关闭 Issue。

### Fix: Issue #166 统一 Better Auth 受保护路由门与安全登录回跳

- Cause: 页面此前只在渲染期间通过 `getSessionWorkspace()` 间接发现无 Session，`proxy.ts` 仅设置 CSP/安全头；未登录访问工作台、受保护 API 和 Session 过期缺少统一边界。登录页还直接信任 `callbackUrl` 并 `router.push()`，存在开放重定向风险。
- Changed:
  - `apps/web/src/proxy.ts` 改为 async 真实 Session gate。认证启用时调用 Better Auth `getSession()` 查询数据库 Session；除 login/register/pricing、auth/health 与签名 webhook 的显式 allowlist 外，页面无 Session 返回 `307 /login?next=<path+query>`，受保护 API/Server Action 返回稳定 `401 UNAUTHENTICATED`，认证依赖异常返回 `503 AUTH_UNAVAILABLE`。认证关闭时完全跳过 gate。
  - 新增 `apps/web/src/lib/auth-access.ts`：集中公开路由、API path、安全站内 `next` 归一化与登录路径构造；拒绝绝对 URL、protocol-relative URL、反斜杠和控制字符。登录页消费安全 `next`，旧 `callbackUrl` 仅作受同一校验的兼容输入。
  - 所有 next/redirect/401/503 response 继续经统一 helper 设置 HSTS、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy 与 production nonce CSP；正常请求仍把同一 nonce 注入 request headers，未削弱既有 Next/Flight CSP。
  - `getSessionWorkspace()` 使用稳定 `UNAUTHENTICATED` 常量；Server Action `readSafeReturnPath()` 同步拒绝反斜杠/控制字符并以 URL parser 归一化站内路径。
  - 新增 `auth-access.fixture.mjs` 并接入 Web test；解除 auth Playwright 的 #166 `fixme`，增加三页面/query、受保护 API 401、站外 `next`、数据库 Session 删除、redirect/401 安全头与 desktop/mobile 覆盖。
- Files: `apps/web/src/proxy.ts`, `apps/web/src/lib/{auth-access,session}.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/actions/_shared.ts`, `apps/web/scripts/auth-access.fixture.mjs`, `apps/web/package.json`, `tests/smoke/auth.spec.ts`, `CODEGUIDE.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`
- Verification:
  - RED: 新策略 fixture 在 `auth-access.ts` 不存在时以 `ERR_MODULE_NOT_FOUND` 失败；GREEN: Web typecheck + 全部 Web fixtures 通过。
  - Next 16 production build ✓；真实 disposable PostgreSQL + production server 的 auth Playwright desktop/mobile 共 10/10 passed（无 skip）。
  - auth-disabled production smoke：`/`、`/sources`、`/pricing` 均 200 且不跳转登录。
  - 全量 `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` / `git diff --check` ✓。
  - DeepSeek V4 Pro 独立只读审计：APPROVED，Critical 0 / Important 0；仅记录共享 internal origin 常量与编码控制字符 fixture 两项非阻塞 Minor。
- Notes / Risk: GLM-5.2 编码子 Agent 运行约 14 分钟无输出且未留下 diff，按用户约定停止后由父 Agent 接管。首个 DeepSeek 审计进程误启动长期 server 后卡住且无报告，清理后以禁止测试/server 的窄只读审计成功完成。公开路由采用最小显式 allowlist，未来新增公开入口需单独评审；本轮未部署、未关闭 Issue。

### Feat: Issue #153 Lane 1 Better Auth Schema 对齐 + User lifecycle 数据层收口

- Cause: Issue #153 Lane 1 要求将 `packages/db` 的 schema、migration、repository 对齐 Better Auth 1.6.23 core 契约（User/Account/Session/Verification）并实现 User 生命周期状态机数据层。此前 Agent 已留下未提交 diff，本轮做最终收口与验证。
- Changed:
  - Schema（`packages/db/prisma/schema.prisma`）：新增 `enum UserAccountStatus { ACTIVE; SUSPENDED; DELETION_PENDING; DELETED }`；`User` 模型新增 `emailVerified Boolean @default(false)`、`image String?`、`accountStatus UserAccountStatus @default(ACTIVE)`、`suspendedAt`/`suspendedReason`/`suspendEndsAt`/`deletionRequestedAt`/`deletedAt`/`lastLoginAt`/`lastActivityAt` DateTime?，`name` 由 `String?` 改为 `String`（NOT NULL，匹配 Better Auth 1.6.23 core ZodString required），`@@index([accountStatus])`。`Account` 模型新增 `refreshTokenExpiresAt`/`idToken`/`scope`（`expiresAt` 保留并映射到 Better Auth `accessTokenExpiresAt`，映射由 `apps/web/src/lib/auth.ts` `account.fields.accessTokenExpiresAt: "expiresAt"` 完成）。新增 `Verification` 模型（id/value/identifier/expiresAt/createdAt/updatedAt + identifier/expiresAt 索引）。
  - Migration 0016（`packages/db/prisma/migrations/0016_better_auth_schema_alignment/migration.sql`）：`CREATE TABLE Verification`、`ALTER TABLE User ADD emailVerified/image`、`UPDATE User SET name=email WHERE name IS NULL` + `ALTER COLUMN name SET NOT NULL`、`ALTER TABLE Account ADD refreshTokenExpiresAt/idToken/scope`、`DO $$ CREATE TYPE UserAccountStatus AS ENUM (...)`、`ALTER TABLE User ADD` 7 个生命周期字段（`accountStatus` 带 `NOT NULL DEFAULT 'ACTIVE'`）、`CREATE INDEX User_accountStatus_idx`。全部使用 `IF NOT EXISTS`，对已部分应用的环境幂等。
  - Repository（`packages/db/src/repositories/user-lifecycle.ts`，320 行）：`getUserLifecycleStatus`/`suspendUser`/`reactivateUser`/`requestUserDeletion`/`markUserDeleted`/`recordUserLogin`/`recordUserActivity`。状态机：ACTIVE->SUSPENDED；SUSPENDED->ACTIVE；ACTIVE|SUSPENDED->DELETION_PENDING；DELETION_PENDING->DELETED（终态）。所有转换使用原子 `updateMany` + `where.accountStatus` 谓词（无 read-before-write 竞态）；`count=0` 时 `findUnique` 区分 `USER_NOT_FOUND` vs `INVALID_TRANSITION`。稳定错误码 `USER_NOT_FOUND`/`INVALID_TRANSITION`/`INVALID_REASON`，错误消息不含 "Prisma"/"prisma"。`suspendUser` reject 空/whitespace reason（`INVALID_REASON`），在 DB 调用前校验。`requestUserDeletion` 进入 `DELETION_PENDING` 时清空 suspension metadata。`markUserDeleted` 设置 `deletedAt` 但不动 suspension/deletion-request 审计字段。`recordUserLogin` 只更新 `lastLoginAt`，`recordUserActivity` 只更新 `lastActivityAt`，两者都拒绝 `DELETED` 用户。所有时间函数接受 `now` 参数注入便于测试。
  - Exports（`packages/db/src/index.ts`、`packages/db/src/repositories.ts`）：导出 user-lifecycle repository 的公共类型和函数。
  - Fixtures：状态机 fixture 拆为 `user-lifecycle.fixtures.ts`（782 行）与 `user-lifecycle-schema.fixtures.ts`（166 行），符合单文件 `<800` 行规则；新增 `workspace-auth.fixtures.ts` 覆盖 Membership 复用、hashed slug、OWNER 和多用户隔离；`migration-replay.fixtures.ts` 显式验证 0015→0016 旧用户回填、PG enum、Better Auth 字段和新用户默认值。
  - Runtime auth：`auth.ts` 改为 Promise-backed ESM 动态加载 DB，修复 Next 16 production bundle 中 `require("@wangchao/db")` 导致 `getPrismaClient is not a function`；初始化 Promise 拒绝时重置单例供后续请求重试；移除 Better Auth core 字段的重复 additionalFields。`auth-client.ts` 改为同源 client，避免非默认端口/反向代理下请求错误 origin 并被 CSP 拦截。`session.ts` 调用 `ensureUserWorkspace`；Membership 读取与 `SHA-256(userId)` 确定性 Organization/Membership upsert 位于同一事务，唯一键保证并发幂等。
  - Tests：普通 DB `test` 只运行 repositories/workspace-auth/user-lifecycle fixtures，即使设置普通 `DATABASE_URL` 也不误跑 replay；新增显式 `test:migration-replay`。Auth Playwright 直接断言 Membership/Organization，覆盖注册、自动登录、reload session 恢复、登出/重登录和两用户隔离并自动清理；#166 路由门用例暂标 `fixme`。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0016_better_auth_schema_alignment/migration.sql`, `packages/db/src/repositories/{user-lifecycle,workspace}.ts`, `packages/db/src/{user-lifecycle,user-lifecycle-schema,workspace-auth,migration-replay}.fixtures.ts`, `packages/db/src/index.ts`, `packages/db/package.json`, `apps/web/src/lib/{auth,auth-client,session}.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`, `tests/smoke/auth.spec.ts`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `AGENTS_CHANGELOGS.md`
- 官方依据：Better Auth 1.6.23 安装包 `node_modules/.pnpm/better-auth@1.6.23/...` 与 `@better-auth/core@1.6.23` 的 `dist/db/schema/{user,account,session,verification}.d.mts` 与 `dist/db/get-tables.mjs`。User: `name: z.ZodString`（required, NOT nullable）、`emailVerified: z.ZodDefault<z.ZodBoolean>`、`image: z.ZodOptional<z.ZodNullable<z.ZodString>>`。Account: `accessTokenExpiresAt`/`refreshTokenExpiresAt`/`idToken`/`scope` 均为 Optional Nullable；`auth.ts account.fields.accessTokenExpiresAt: "expiresAt"` 完成 accessTokenExpiresAt->expiresAt 列映射。Verification: `id`/`value`/`identifier`/`expiresAt`/`createdAt`/`updatedAt`。Session 字段未变。
- Verification:
  - `pnpm --filter @wangchao/db run db:format` ✓（prisma format）
  - `pnpm --filter @wangchao/db run db:generate` ✓（prisma generate，Prisma Client v7.8.0）
  - `pnpm --filter @wangchao/db run db:validate` ✓（schema valid）
  - `pnpm --filter @wangchao/db run typecheck` ✓（tsc --noEmit）
  - `pnpm --filter @wangchao/db run build` ✓（tsc emit dist/）
  - `pnpm --filter @wangchao/db test` ✓（repositories + workspace-auth + user-lifecycle/schema fixtures）
  - `pnpm --filter @wangchao/web typecheck` ✓；production `next build` ✓
  - Auth Playwright desktop/mobile：各 2 passed、1 skipped（#166 已知后续边界）
  - `git diff --check` ✓
  - 真实 PostgreSQL replay（disposable PG 16）：顺序应用 0001→0015，在 0015 状态插入 `preexisting-replay-user`（name=NULL），应用 0016，再执行 `pnpm --filter @wangchao/db test:migration-replay` ✓。
- Notes / Risk: #153 的 schema、migration、生命周期 repository、真实注册/session 和单用户自动 workspace 已完成；统一受保护路由门、开放重定向防护与 session 过期语义属于紧随其后的 #166。后续生命周期 runtime 仍包括 SUSPENDED/DELETION_PENDING/DELETED session gate、邮箱验证策略、删除保留期、MFA 与 OAuth lifecycle。未部署。

## 2026-07-17

### Fix: 修复 AES-256-GCM 随机 salt 未参与加密 KDF 导致凭证无法解密（含旧密文兼容与严格校验）

- Cause: `encryptCredential` 先用 `deriveKey(encryptionKey)` 以 STATIC_SALT 派生 key 加密，之后才生成随机 salt 存入密文；`decryptCredential` 却以存储的随机 salt 派生 key 解密。两次 KDF 使用不同 salt，key 不匹配导致 AES-GCM auth tag 验证失败，所有新加密的凭证无法解密。此外，修复前已有大量四段旧密文存在于 DB 中，这些记录的 ciphertext 实际用 STATIC_SALT 派生 key 加密，新逻辑按 stored random salt 解密必然失败。
- Changed:
  - `encryptCredential` 调整为先生成随机 salt，再用 `deriveKey(encryptionKey, salt)` 派生 key 加密，确保加密和解密使用同一 salt。四段格式 `salt:iv:ciphertext:tag` 不变。
  - `decryptCredential` 对四段格式先按 stored salt 解密；若 AES-GCM auth 失败，再仅为兼容旧 bug 尝试 STATIC_SALT 派生 key。fallback 仅适用于修复前四段旧密文；新格式密文 salt 被篡改时两条路径均失败，不得降级绕过认证。代码注释明确 fallback 只用于旧密文，旧记录在后续重新保存时升级格式，不声明自动迁移已发生。
  - I1 窄 authenticated-decrypt helper（`tryAuthenticatedDecrypt`）：在 component 长度、base64 和 encryptionKey 长度前置校验通过后，deriveKey/createDecipheriv/setAuthTag/update 在 catch 外执行，仅围绕 `decipher.final()` 捕获认证失败并返回 discriminated result `{ ok, plaintext? }`。此时 `final()` 失败代表 auth 不通过，配置/编程/KDF 错误不被 fallback 吞掉。
  - I2 稳定安全错误：stored salt 和 STATIC_SALT 两次认证均失败时抛固定 `new Error("Credential decryption failed")`，不泄露 `Unsupported state or unable to authenticate data` 等 Node/OpenSSL 内部字符串。格式/base64/长度错误仍保留明确 `Invalid...` 类错误，不全部吞成认证失败。三段路径同样使用窄 helper，认证失败也返回固定安全错误。
  - I3 payload 上限：`decryptCredential()` 入口在 split/base64 decode 之前检查 `encrypted` UTF-8 byte 长度。新增 `MAX_ENCRYPTED_CREDENTIAL_LENGTH = 16384`（注释说明依据：plaintext 最大 8192 bytes × base64 膨胀 4/3 + metadata segments ≈ 10990 bytes，16384 为保守上限）。超限立即抛 `Encrypted credential exceeds maximum allowed length`，不执行 base64/KDF。
  - 严格校验 decoded component：四段 salt === 16 bytes、iv === 12、tag === 16；三段 iv === 12、tag === 16；ciphertext 不得为空。新增 `decodeBase64Strict` helper，通过 round-trip re-encode 检测拒绝非 canonical base64（Node `Buffer.from(x, 'base64')` 宽松接受垃圾字符）。`STATIC_SALT` 不导出为公共 API。
  - `cryptoSmokeTest()` 纳入 `repositories.fixtures.ts` 测试套件执行。共 11 项 crypto fixture 覆盖：(1) 随机 salt round-trip + 四段格式；(2) 同明文多次加密密文不同；(3) 错误 key 失败；(4) ciphertext/tag/salt/IV 篡改失败（含 IV）；(5) legacy 三段格式兼容；(6) 旧 bug 四段密文兼容 fallback + 错误 key 失败；(7) malformed payload 拒绝（2/5 段、空串）；(8) 严格 component 校验（短 salt/IV/tag、非法 base64、空 ciphertext、空 salt，四段与三段各覆盖）；(9) 认证失败稳定错误（错误 key/篡改密文/旧 bug 错误 key/三段错误 key 均等于 `"Credential decryption failed"` 且不含 Node 内部字符串）；(10) 格式/长度/base64 错误不被 fallback 吞掉（短 salt/非法 base64/短 key 保留各自明确错误）；(11) 超大 payload 拒绝（超 16384 bytes 立即抛长度错误，不执行 base64/KDF）。
- Files: `packages/db/src/crypto.ts`, `packages/db/src/repositories.fixtures.ts`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`
- Verification: `pnpm --filter @wangchao/db test`（含 `tsc` 编译 + fixture 执行）✓；`pnpm --filter @wangchao/db typecheck` ✓；`git diff --check` ✓。未执行全量 `pnpm typecheck/lint/test/build`（父 Agent 负责）。
- Notes / Risk: 修复前已加密并存储在 DB 中的四段格式凭证可通过 STATIC_SALT fallback 正常解密，无需重新输入。新加密的凭证使用 stored random salt，fallback 路径不影响新密文安全性。legacy 三段格式凭证仍可正常解密。窄 helper 确保 deriveKey 等前置操作的异常不会被 fallback 吞掉。超大 payload 在入口被拦截，防止 DoS。测试中硬编码 legacy salt `wangchao-credential-salt-v1` 是刻意冻结兼容契约，若生产常量被误改则测试应失败。本次未执行 git commit/push/部署。

### Fix: 摘要语言固定跟随当前中文界面

- Cause: 事件抽取 prompt 允许 Topic Profile 的 `outputLanguage=en` 让摘要跟随主题偏好或原文语言，解析器也可借由 English context 跳过中文校验；这与摘要应跟随用户界面语言的产品规则不一致。
- Changed: event extraction prompt 不再读取 Topic Profile 决定输出语言，i18n 前强制摘要及其他用户可见字段使用简体中文；解析器移除 `outputLanguage` 绕过并始终拒绝无中文摘要；主题编辑页移除 English 选项，改为只读说明，保存端固定保留 `languagePreferences.outputLanguage='zh-CN'`，术语规则继续生效。
- Files: `packages/ai/src/event-extraction.ts`, `packages/ai/src/event-extraction.fixtures.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/topics/[topicId]/edit/page.tsx`, `SPEC.md`, `CODEGUIDE.md`, `FRONTEND.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`
- Verification: `pnpm --filter @wangchao/ai test`、`pnpm --filter @wangchao/web test`、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build`、`git diff --check` 全部通过；fixtures 覆盖 Topic Profile 即使保留 `outputLanguage=en`，prompt 仍要求简体中文，以及纯英文摘要无法通过解析质量校验。全仓测试的 sources DNS fixture 与 Next/Turbopack build 因沙箱网络/端口限制在授权环境重跑并通过。
- Notes / Risk: 既有 Topic Profile 中的 `outputLanguage=en` 不需要 migration；Worker 已忽略该值，用户下次保存主题时会归一化为 `zh-CN`。完成 i18n 后应从认证用户或界面 locale 注入摘要语言，再恢复多语言选择，不应改回按原文语言生成。

### Fix: 建立 Markdown 正文采集与摘要状态门禁

- Cause: RSS `content:encoded` 在 Worker upsert 时漏传，普通网页只保留纯文本且采集失败仍会让 LLM 使用 RSS/标题生成摘要，导致标题被复制成摘要并掩盖真实采集失败。
- Changed: RSS embedded HTML 与 Readability `article.content` 统一清洗为 Markdown；新增 Item 采集状态和 IntelligenceEvent 摘要状态、`CONTENT_FETCH` 审计任务及 migration；只有 READY Markdown 才调用 LLM，prompt 统一动态语言并增加事实依据、归因和确定性质量校验；失败占位事件保留原文链接但不进入简报、即时推送、报告证据或语义去重；详情页改为异步重新采集，首页和详情共用结构化失败提示。X/Twitter 暂不接 API，明确记录为 UNSUPPORTED。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0015_content_capture_status/migration.sql`, `packages/db/src/repositories/*`, `packages/sources/src/index.ts`, `packages/sources/src/parser.fixtures.ts`, `packages/ai/src/event-extraction.ts`, `packages/ai/src/event-extraction.fixtures.ts`, `packages/core/src/relevance.ts`, `apps/worker/src/modules/*`, `apps/web/src/app/actions/events.ts`, `apps/web/src/app/events/[eventId]/page.tsx`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/lib/summary-status.ts`, `SPEC.md`, `CODEGUIDE.md`, `FRONTEND.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `AGENTS_CHANGELOGS.md`
- Verification: 使用 pnpm 11.7.0 完成 Prisma format/generate/validate、`CI=true pnpm typecheck`、`CI=true pnpm lint`、`CI=true pnpm test`、`CI=true pnpm build` 和 `git diff --check`；新增 RSS/Readability Markdown、安全清理、X unsupported、LLM READY 门禁、prompt 语言/质量、正式简报 READY 过滤和 UI 状态 fixtures 全部通过。Next/Turbopack build 与 sources DNS fixture 因沙箱端口/网络限制改在授权环境运行并通过。
- Notes / Risk: migration 会把既有非空 `rawContent` 标为 `READY/LEGACY_TEXT`；已在一次性 Postgres 16 空库从 `0001` 完整重放 migration，生产仍需按部署流程执行。X/Twitter 专用 API adapter 留待独立 Issue。本轮未执行生产 migration、commit 或 push。

### Fix: 修复 production CSP 阻断 Next.js 流式渲染

- Cause: production `script-src 'self'` 拒绝 Next.js App Router 无 nonce 的 framework/React Flight 内联脚本；服务端已返回真实数据，但浏览器无法执行 `self.__next_f.push(...)`，首页永久停留在 `loading.tsx` 骨架屏并报 `Connection closed`。
- Changed: 将 Next.js 16 `middleware.ts` 迁移为 `proxy.ts`；production 为每个请求生成随机 nonce，把同一 CSP 注入 Next.js request headers 与最终 response，使框架脚本自动携带 nonce；根 layout 强制 request-time rendering，避免登录/注册等静态页面因无法获得请求 nonce 而被阻断；保留原安全响应头和开发环境 HMR 兼容；新增 CSP policy builder 与回归 fixture。
- Files: `apps/web/src/proxy.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/app/layout.tsx`, `apps/web/scripts/content-security-policy.fixture.mjs`, `apps/web/package.json`, `CODEGUIDE.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `AGENTS_CHANGELOGS.md`
- Verification: 使用 pnpm 11.7.0 完成 CSP unit fixture、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、HTTP build artifact smoke、`git diff --check`；启动 Next.js production server 后，额外验证 `/login` 连续请求 nonce 不重复，且所有 framework/React Flight script 均携带与 response CSP 一致的 nonce，全部通过。
- Notes / Risk: 未使用 `'unsafe-inline'` 放宽 production script policy；nonce CSP 要求根 layout 使用 request-time rendering，因此原静态登录/注册等页面不再享受静态缓存。后续 push 会触发 Railway Web 等已连接服务自动部署。

## 2026-07-16

### Fix: 修复 Instant Push 与凭证拆分 migration 的 schema 漂移

- Cause: `0013_credentials_split` 已将 `instantPushEnabled` / `instantPushEnabledAt` 迁移到 `OrganizationCredential(TELEGRAM)` 并从 `Subscription` 删除，但 Prisma schema 与 Instant Push repository 仍查询旧列，导致 Railway cron 在运行时以 `Subscription.instantPushEnabled does not exist` 退出。
- Changed: 从 Prisma `Subscription` model 删除已迁移字段；Instant Push 设置、开关与组织扫描统一改读写 `OrganizationCredential(TELEGRAM)`；新增 repository fixture 覆盖凭证归属、tenant scope、启用时间保留和扫描过滤。
- Files: `packages/db/prisma/schema.prisma`, `packages/db/src/repositories/instant-push.ts`, `packages/db/src/repositories.fixtures.ts`, `docs/L2-domain.md`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`
- Verification: 使用 pnpm 11.7.0 完成 Prisma generate/validate、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、HTTP build artifact smoke 与 `git diff --check`，全部通过。
- Notes / Risk: 这是让代码追上已经部署的 `0013_credentials_split`，不新增或执行生产 DDL；生产库无需重新添加已废弃的 Subscription 列。当前环境无可用 Docker daemon，未在全新本地 Postgres 重放 migration；已人工核对 schema 与 `0013` 最终结构一致。

### Fix: 修复 GitHub Actions pnpm 版本冲突

- Cause: CI 同时在 `pnpm/action-setup` 中指定 `version: 11`，并在 `package.json#packageManager` 中指定 `pnpm@11.7.0`，新版 action 将重复版本来源视为错误并在安装阶段退出。
- Changed: 删除 workflow 中的宽泛 `version: 11`，统一以 `packageManager: pnpm@11.7.0` 作为唯一 pnpm 版本来源。
- Changed: 同步语义事件合并 fixture 的 Prisma transaction mock，覆盖当前实现使用的 `findMany`、`createMany` 和 `updateMany`，避免 CI 在进入测试阶段后因旧 mock 崩溃。
- Changed: 恢复 RSS/Atom XML parser 的十进制与十六进制 numeric character reference 解码，修复工具函数整合时误删 `tagValueProcessor` 导致的 parser fixture 回归。
- Files: `.github/workflows/ci.yml`, `packages/db/src/repositories.fixtures.ts`, `packages/sources/src/index.ts`, `AGENTS_CHANGELOGS.md`
- Verification: 使用 pnpm 11.7.0 完成 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、Prisma schema validate、HTTP build artifact smoke 与 `git diff --check`，全部通过。
- Notes / Risk: Node 24 提示是 GitHub Actions runner 的迁移提示，不通过不安全环境变量降级到 Node 20；本次改动不改变应用运行时 Node.js 22 配置。

## 2026-07-15

### Refactor: 4 个超大文件按领域拆分 (#146)

- Cause: 4 个核心文件合计 6469 行（worker/index.ts 1082 / actions.ts 2798 / extended-repositories.ts 1524 / core/index.ts 1065），超出可维护范围
- Changed:
  - **core/index.ts** (1065->12 行 barrel)：拆分为 9 个领域模块 — env.ts / text.ts / date-range.ts / hashing.ts / topic-profile.ts / relevance.ts / preference.ts / render-event.ts / render-briefing.ts
  - **db/extended-repositories.ts** (1524->9 行 barrel)：拆分为 9 个领域模块 — instant-push.ts / telegram-credential.ts / delivery-log.ts / report.ts / preference-memory.ts / byok-credential.ts / subscription.ts / ccpayment-credential.ts / payment-invoice.ts
  - **worker/index.ts** (1082->114 行)：拆分为 5 个模块 — logging.ts / health.ts / fetch-cycle.ts / telegram-delivery.ts / report.ts；修复预存 EventExtractionAdapter 缺失 import
  - **web/actions.ts** (2798->7 行 barrel)：拆分为 7 个 action 文件 + 1 个共享 helper — topics.ts / sources.ts / events.ts / credentials.ts / billing.ts / reports.ts / preferences.ts + _shared.ts
- Files: 新建 30 个领域模块文件；修改 4 个原文件为 barrel re-export；修改 docs/L3-modules.md
- Verification: typecheck ✅ (6/6 全部通过，包括修复 worker 预存错误), build ✅ (web build 通过)
- Notes / Risk: 所有 barrel re-export 保持 `import { ... } from "@wangchao/core"` / `"@wangchao/db"` / `"@/app/actions"` 调用方零改动；web actions 使用 `"./_shared"` 无 `.js` 后缀（Bundler moduleResolution）

### Chore: 代码质量批量小修 + 文档合并关闭 (#121, #122, #135, #142, #143, #149, #112, #123, #136, #148, #34)

- Cause: 第 4-8 轮审计剩余低优先级问题，大部分已被前三轮修复解决，剩余为产品决策或低风险小修
- Changed:
  - **#122**: `api/auth/[...all]/route.ts` 增加 `BETTER_AUTH_SECRET` 缺失时返回 503（原返回神秘 500）
  - **#142**: `crypto.ts` maskKeyHint 短 key 阈值 `<= 8` 改为 `< 12`（防止短 key 过度暴露）
  - **#142**: `actions.ts` readSafeReturnPath 增加 `/\` 反斜杠路径拒绝
  - **#142**: `apps/worker/src/index.ts` extractReportKeywords 每关键词截断至 40 字符（防 ILIKE DoS）
  - **#135**: `apps/worker/src/index.ts` 移除未用 import `DEFAULT_DIGEST_STYLE`
  - **#121**: `topic-source-data.ts` + `report-data.ts` 所有 `requestedPage` 参数增加 clamp（`Math.max(1, Math.min(10_000, ...))`）
  - **#121**: `actions.ts` refreshPreferenceMemory 仅对 SAVE/DISMISS 触发（原 READ 也触发，可被 spam 压 DB）
- Documentation: 评估 #112/#123/#136/#143/#149 共 39 个开放问题，15 个已由前三轮修复解决，24 个为待产品决策（不阻塞当前开发）
- Files: `apps/web/src/app/api/auth/[...all]/route.ts`, `packages/db/src/crypto.ts`, `apps/web/src/app/actions.ts`, `apps/worker/src/index.ts`, `apps/web/src/lib/topic-source-data.ts`, `apps/web/src/lib/report-data.ts`
- Verification: typecheck ✅ (除 @wangchao/worker 预存 EventExtractionAdapter 错误外全部通过)
- Notes / Risk: #136 的 10 个商业化产品决策待 Stripe 集成 (#33) 后再逐项确认

### Fix: Webhook credential cache security + env helper dedup (#120, #145)

- Cause: CCPayment webhook credential cache had 60s TTL (too short), unbounded size (DoS risk), no invalidation path; db/client.ts duplicated readRequiredRuntimeEnv; worker/web duplicated env helpers
- Changed:
  - **#120**: `webhook/route.ts` — TTL 60s→300s, added `MAX_CREDENTIAL_CACHE_SIZE=128` with LRU eviction, exported `invalidateCcpaymentCredential(appId)` for admin credential rotation
  - **#145 env**: Removed duplicate `readRequiredRuntimeEnv` from `packages/db/src/client.ts` (now imports from `repositories/util.js`); moved `readPositiveIntegerEnv`/`readFloatEnv`/`readBoundedNumberEnv` from worker/web into `packages/core`; worker re-exports from core
- Files: `apps/web/src/app/api/billing/ccpayment/webhook/route.ts`, `packages/db/src/client.ts`, `packages/core/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/worker/src/modules/env.ts`
- Verification: typecheck ✅ (web, core, db, worker all pass)
- Notes / Risk: `resolveCredential` retained `findFirst` — schema has `@@unique([organizationId, credentialType])` but not on `(appId, credentialType)`

### Refactor: Consolidate duplicated utility functions (createContentHash, stripHtml, isHttpUrl, canonicalizeUrl, pLimit)

- Cause: Multiple divergent implementations of the same utility across packages — `createContentHash` produced different hashes (FNV-1a vs event-hash prefix), `stripHtml` replaced entities with spaces instead of decoding, `isHttpUrl` had 7 copies, `canonicalizeUrl` had 3, and `pLimit` used O(n) `queue.shift()`
- Changed:
  - `packages/core/src/index.ts`: Exported `isHttpUrl`, added exported `stripHtml` (decodes entities, removes script/style, normalizes tags, collapses whitespace)
  - `packages/sources/src/index.ts`: Removed local `createContentHash`, `stripHtml`, `canonicalizeItemUrl`; now imports `createContentHash`, `stripHtml`, `isHttpUrl` from `@wangchao/core` and `canonicalizeUrl` from `@wangchao/db`
  - `packages/sources/src/adapters.ts`: Removed local `createContentHash`; imports `createContentHash`, `stripHtml` from `@wangchao/core`; fixed broken inline HTML stripping
  - `packages/sources/src/discovery.ts`: Removed local `isHttpUrl`; imports from `@wangchao/core`
  - `packages/sources/package.json`: Added `@wangchao/core` and `@wangchao/db` dependencies
  - `apps/web/src/lib/event-display.ts`: Removed local `stripHtml` and `isHttpUrl`; imports from `@wangchao/core`; kept local `decodeHtmlEntities` (still used for URL decoding)
  - `apps/web/src/components/intelligence/intelligence-card.tsx`: Removed local `isHttpUrl`; imports from `@wangchao/core`
  - `apps/web/src/app/events/[eventId]/page.tsx`: Removed local `isHttpUrl`; imports from `@wangchao/core`
  - `apps/web/src/app/actions.ts`: Already imported `isHttpUrl` from `@wangchao/core` (no local duplicate)
  - `apps/worker/src/modules/env.ts`: Replaced `queue.shift()` with index-based dequeue + periodic splice to eliminate O(n²) behavior
- Files: `packages/core/src/index.ts`, `packages/sources/package.json`, `packages/sources/src/index.ts`, `packages/sources/src/adapters.ts`, `packages/sources/src/discovery.ts`, `apps/web/src/lib/event-display.ts`, `apps/web/src/components/intelligence/intelligence-card.tsx`, `apps/web/src/app/events/[eventId]/page.tsx`, `apps/worker/src/modules/env.ts`
- Verification: `pnpm typecheck` on core, db, sources, ai, web — all pass; worker has pre-existing unrelated `EventExtractionAdapter` error on line 969
- Notes / Risk: `createContentHash` now uses the correct `content:` prefix (derived from `createEventHash`) across all call sites — previously sources used `fnv1a:` prefix with broken `charCodeAt` (mismatched hashes meant dedup could miss duplicates or create false positives)

- Cause: Six `as never` casts in extended-repositories.ts bypass type safety; pricing page allowed Plus upgrade without BYOK prerequisite
- Changed:
  - **#141**: Replaced all 6 `as never` with proper Prisma types — `Prisma.InputJsonValue` for `metadata`/`value` JSON fields, `new Prisma.Decimal()` for PaymentInvoice.amount
  - **#133**: Pricing page now queries `getByokCredentialView` server-side; Plus plan with no BYOK shows "配置 BYOK 后升级" link instead of payment form; admin/settings page shows BYOK-required notice on `?byok_required=true`; API route returns 409 if Plus upgrade attempted without BYOK
- Files: `packages/db/src/extended-repositories.ts`, `apps/web/src/app/pricing/page.tsx`, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/app/api/billing/ccpayment/create-invoice/route.ts`
- Verification: `pnpm --filter @wangchao/db typecheck` ✅, `pnpm --filter @wangchao/web typecheck` ✅ (pre-existing missing deps unrelated)
- Notes / Risk: None

### Fix: 删除死代码 proxy.ts + 补充 self-hosted 审计日志 (#114, #128)

- Cause: proxy.ts 是死代码（无 import，非 middleware.ts），仅检查 cookie 存在性而非有效 session；toggleSelfHostedModeAction 缺少操作前后值审计
- Changed:
  - **#114**: 删除 `apps/web/src/proxy.ts`，auth 已由 BetterAuth `getSessionWorkspace()` 处理，安全响应头已在新 `middleware.ts` 中
  - **#128**: `setSelfHostedMode` 改为先 `findUnique` 读取当前 `isSelfHosted`，upsert 后返回 `{ previousValue, newValue }`；`toggleSelfHostedModeAction` 将 previousValue/newValue 写入 WEB_ACTION 审计日志 metadata
- Files: `apps/web/src/proxy.ts` (deleted), `apps/web/src/app/actions.ts`, `packages/db/src/extended-repositories.ts`
- Verification: typecheck ✅ (@wangchao/db + @wangchao/web 通过)
- Notes / Risk: 无

### Security: P0 安全漏洞批量修复 (#140, #139, #138, #137, #127, #102, #101, #132)

- Cause: 开源仓库安全审计发现 8 项 P0 安全问题：缺安全响应头、AI 内容 XSS 风险、敏感信息泄露日志、SSRF 无防护、加密模块弱 KDF、webhook 去重无约束
- Changed:
  - **#140**: 新建 `apps/web/src/middleware.ts`，添加 HSTS / X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy 安全响应头；CSP 仅在 production 启用
  - **#139**: 新建 `apps/web/src/lib/sanitize.ts`，`sanitizeForDisplay` HTML entity 逃逸 + `sanitizeMarkdownSource` 入库前剥离危险标签；report 页面使用 `sanitizeForDisplay` 做防御性渲染
  - **#138**: 新建 `apps/worker/src/lib/safe-log.ts`，`formatSafeError` 仅输出 `name/message/code`，`sanitizeErrorMessage` 剥离 URL 凭证和绝对路径；worker 错误 handler 改用安全日志
  - **#137 + #127**: `claimWebhookEvent` 增加 `P2002` 唯一约束 catch（provider + recordId 已存在唯一索引）；修复 `verifyCcpaymentWebhookSignature` 时间戳单位 bug（秒 vs 毫秒）；webhook route 增加 `isCcpaymentTimestampFresh` 前置校验
  - **#102 + #101**: 新建 `packages/sources/src/ssrf.ts`，`isPrivateIP` / `resolveAndCheckUrl` / `assertSafeUrl`；所有外部 URL fetch 前（validateRssFeedUrl、fetchText、fetchRssFeed、fetchArticleContent）强制经过 SSRF 防护，阻断私有 IP / loopback / cloud metadata
  - **#132**: `packages/db/src/crypto.ts` 升级为 per-credential 随机 salt + scrypt KDF；新增 `fingerprintKey`、`cryptoSmokeTest`、`MAX_CREDENTIAL_LENGTH` / `MIN_ENCRYPTION_KEY_LENGTH` 长度边界；旧格式密文保持向后兼容
- Files: `apps/web/src/middleware.ts` (new), `apps/web/src/lib/sanitize.ts` (new), `apps/web/src/app/reports/[reportId]/page.tsx`, `apps/web/src/lib/event-display.ts`, `apps/worker/src/lib/safe-log.ts` (new), `apps/worker/src/index.ts`, `packages/sources/src/ssrf.ts` (new), `packages/sources/src/index.ts`, `packages/sources/src/discovery.ts`, `packages/db/src/crypto.ts`, `packages/db/src/index.ts`, `packages/db/src/ccpayment.ts`, `packages/db/src/repositories/webhook-event.ts`, `apps/web/src/app/api/billing/ccpayment/webhook/route.ts`, `apps/web/next.config.ts`, `CODEGUIDE.md`, `docs/L3-modules.md`
- Verification: typecheck ✅ (除 @wangchao/sources 预存依赖缺失外全部通过), lint ✅ (同上)
- Notes / Risk: `@wangchao/sources` typecheck 失败为预存问题（@mozilla/readability / linkedom 未安装），与本轮无关；SSRF 防护使用 DNS 解析，存在 TOCTOU 窗口但已在最接近 fetch 的位置校验

### Fix: Worker 容错 + 反馈双倍 + N+1 查询 + 实体解码 (#124, #73, #61, #52, #39, #108, #133)

- Cause: fetch cycle 子阶段无 error boundary 导致全链终止；fallback extraction 总是 isRelevant=true；反馈偏好双倍计入；mergeSemanticEvents N+1；实体双重解码
- Changed:
  - **#124**: `runFetchCycle` 9 个子阶段（analysis/dedup/preference/briefing/weekly/monthly/governance/candidate/telegram）各自包裹 try-catch，失败推入 `result.failedSubCycles` 后继续
  - **#73**: `fallbackEventExtraction` 改为 `isRelevant: false`、`relevanceScore: 0`、`category: "noise"`，AI 故障时不污染 dashboard
  - **#61**: 修复 `MORE_LIKE_THIS`/`LESS_LIKE_THIS` 双倍计入问题 — 仅对 `SCORE_UP`/`SCORE_DOWN` 触发 category preference 路径，`MORE_LIKE_THIS`/`LESS_LIKE_THIS` 只走 enhanced feedback
  - **#52**: `isUniqueConstraintError` 改用 `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"` 类型安全判断
  - **#39**: `mergeSemanticEvents` 事务内 N+1 改为批量：`findMany({ where: { id: { in: [...] } } })` + `createMany({ skipDuplicates: true })` + `updateMany`，复杂度从 O(N×M) 降为 O(1)
  - **#108**: 移除 XMLParser 中冗余的 `tagValueProcessor: decodeNumericEntities`（`processEntities: true` 已处理实体解码），消除双重 decode
  - **#133**: SearXNG 改用 `creds.search.baseUrl`（原错误使用 apiKey 字段），无 baseUrl 时返回 null
- Files: `apps/worker/src/index.ts`, `apps/worker/src/modules/types.ts`, `apps/worker/src/modules/fetch.ts`, `packages/ai/src/event-extraction.ts`, `apps/web/src/app/actions.ts`, `packages/db/src/extended-repositories.ts`, `packages/db/src/repositories/event.ts`, `packages/sources/src/index.ts`, `apps/worker/src/modules/runtime.ts`, `packages/db/src/repositories/types.ts`, `packages/db/src/repositories/export.ts`
- Verification: typecheck ✅ (除 @wangchao/sources 预存依赖缺失外全部通过)
- Notes / Risk: 无

### Batch: Module D 数据层+架构 (#113, #115-116, #144)

- Cause: actions 绕过 repository、web 直接 import worker 执行长任务、packages/ui 空壳
- Changed:
  - **#115**: 审计 14 个 `prisma.organizationCredential` 引用全部有效（migration 0013 已建表），问题不存在
  - **#113**: `toggleSelfHostedModeAction` 改用 repository helper `setSelfHostedMode`，消除直接 `prisma.subscription.upsert`
  - **#116 + #144**: `runFetchCycleAction`/`runSourceDiscoveryAction` 改为 `createTaskRun(type=SOURCE_FETCH/SOURCE_DISCOVERY, PENDING)` 入队，由 worker cron 异步处理；移除 `@wangchao/worker` 从 apps/web/package.json
  - **#144**: 删除空壳包 `packages/ui`；更新 CODEGUIDE.md 仓库布局表和 L3-modules.md
- Files: 修改 apps/web/src/app/actions.ts, apps/web/package.json; 删除 packages/ui; 修改 CODEGUIDE.md, docs/L3-modules.md
- Verification: typecheck ✅ (6/6), lint ✅ (6/6), test ✅ (6/6)

### Docs: 规划 Free 计划广告策略（AdSense，provider-agnostic）

- Cause: 用户希望针对 Free 用户在使用过程中插入广告作为变现补充和付费转化杠杆，经过讨论确定：暂定 Google AdSense 但实现做 provider-agnostic 抽象；自用模式默认展示广告但可在后台深层折叠区关闭；只做规划不立即实施
- Changed:
  - `docs/business-model.md` §3.1 计划总览表新增「广告展示」行
  - `docs/business-model.md` §3.2 Free 计划补充广告说明
  - `docs/business-model.md` §3.5 自用模式补充广告默认展示行为
  - `docs/business-model.md` §5.2 Subscription 表新增 `showAdsInSelfHosted` 字段
  - `docs/business-model.md` §8 前端页面表补充自用模式广告开关 UI 说明
  - `docs/business-model.md` §11 待讨论事项新增广告位和 provider 迁移两项
  - `docs/business-model.md` §13 实施阶段新增 Step 7（广告策略落地）和 Step 8（含 AdSense 审核）
  - `docs/business-model.md` 新增 §14「Free 计划广告策略」完整章节（目标定位、Plan 映射、服务端判定、AdProvider 抽象、数据模型、广告位规划、前置依赖、自用模式开关 UI）
  - `SPEC.md` §6.0 补充广告策略引用说明
- Files: docs/business-model.md, SPEC.md
- Verification: 纯文档变更，无需 typecheck/lint/test/build
- Notes / Risk:
  - 本次为规划性文档变更，不涉及代码和数据库 migration
  - `showAdsInSelfHosted` 字段尚不在 Prisma schema 中，待 Phase 12 商业化基础落地时随 migration 一并加入
  - AdSense 对工具型/应用型站点审核风险较高，实施前需准备公开内容页作为审核入口
  - 广告收益预期偏低（个位数美元/月级别），主要价值是付费转化杠杆而非收入
  - 不触发 Railway 自动部署（无代码变更）

### Batch: Module C Sources 抓取可靠性 (#103, #105-107, #110-111)

- Cause: RSS 解析器纯正则不安全、无 BOM 处理、无 body size 上限、provider 无 throttle、arXiv HTTP
- Changed:
  - **#103**: 引入 fast-xml-parser 替代正则 RSS 解析；新增 processEntities + tagValueProcessor 解码数字实体引用；parseRssFeed 使用 XMLParser.parse()
  - **#105**: 新增 stripBom() 在 parseRssFeed/fetchRssFeed 入口统一剥离 BOM
  - **#104**: fetchRssFeed/validateRssFeedUrl/fetchArticleContent 加 Content-Length 预判和 maxBodyBytes 参数（默认 10MB）
  - **#106**: discovery.ts 新增 Throttle 类 + withThrottle + withBodyLimit；四个 provider 全部用 withThrottle+withBodyLimit 包装 fetchImpl；arXiv adapter 改用 HTTPS
  - **#107**: 新增 AdapterError (provider, status, cause)；arXiv/GitHub adapter 改用结构化错误；GitHub 加 X-RateLimit-Remaining 检查；arXiv 复用 parseRssFeed；消除 adapters.ts 与 index.ts 间 5 个重复工具函数
  - **#110/#111**: GitHub repo 参数 encodeURIComponent；fixture 更新为正确 Atom author/author 格式
- Files: 修改 packages/sources/src/{index.ts,adapters.ts,discovery.ts,parser.fixtures.ts,adapters.fixtures.ts,package.json}；新增 API AdapterError
- Verification: typecheck ✅ (7/7), lint ✅ (7/7), test ✅ (7/7)

### Batch: Module B 商业化+配额 (#33, #117-119, #125-126, #131, #134)

- Cause: PLAN_LIMITS 四处独立定义、所有 web actions 绕过 quota、CCPayment webhook 全表扫、Stripe stub 状态码错误、Subscription 缺 billingInterval
- Changed:
  - **#126**: 新建 `packages/core/src/pricing.ts`（PLAN_REGISTRY 合并 quota+pricing+features+displayName），components/quota.ts 从 pricing 导入
  - **#117/#125**: `packages/core/src/quota-guard.ts` 新增 QuotaExceededError + withQuotaGuard；actions.ts 中 createTopic/topicWithSource/candidateSource/regenerateEventSummary/createReport 均加 quota 检查；3 个 export route 加 export quota 检查
  - **#129**: create-invoice/route.ts 中 `Math.random()` → `crypto.randomBytes(8).toString("hex")`
  - **#119**: stripe/checkout/route.ts 不可用时返回 503 而非 200
  - **#131/#137**: schema 新增 WebhookEvent 模型（@@unique([provider, recordId])）+ repositories/webhook-event.ts；webhook 改用 `claimWebhookEvent` 原子操作；加进程内 LRU 凭据缓存 TTL 60s
  - **#118**: updatePreferenceWeight 加 weight 上下界 [-4,4]；batchUpdateSourceGovernance 加 sourceIds 上限 50
  - **#133**: instant push Telegram 缺失错误改为引导提示
  - **#134**: Subscription schema 加 billingInterval 枚举字段（MONTHLY/YEARLY）
- Files: `packages/core/src/pricing.ts`, `packages/core/src/quota-guard.ts`, `packages/core/src/quota.ts`, `packages/core/src/index.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0014_billing_webhookevent/migration.sql`, `packages/db/src/repositories/webhook-event.ts`, `packages/db/src/index.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/usage/page.tsx`, `apps/web/src/app/pricing/page.tsx`, `apps/web/src/app/api/billing/ccpayment/create-invoice/route.ts`, `apps/web/src/app/api/billing/ccpayment/webhook/route.ts`, `apps/web/src/app/api/billing/stripe/checkout/route.ts`, `apps/web/src/app/exports/*/route.ts`
- Verification: typecheck ✅ (7/7), lint ✅ (7/7), test ✅ (7/7)

### Batch: Module 8 文档/产品决策 + 收尾 (#58, #79, #80, #85, #99)

- Cause: 文档与 schema 不一致、fallbackSourceRecommendation 不确定区间、quota 引擎缺陷、开放问题决策。
- Changed:
  - **#58**: L2-domain.md 已反映所有 schema 变更（通过 Modules 1-6 各轮更新），无需额外修改
  - **#79**: fallbackSourceRecommendation 改用 topic-term 匹配浮动分数（0.4 + boost），替代固定 0.55
  - **#80**: quota 引擎修复 — 80% 阈值分支完善、preference score clamp（#68 in Module 6）、PAST_DUE 宽限期文档化
  - **#85**: 10 项产品/架构开放问题全部确认或已实现（evaluateRelevance fallback, dedup 阈值参数化, LRU 持久化, gravity half-life 衰减, dedup candidate 上限等）
  - **#99**: Worker modules 独立可测，无需额外 fixture 文件
- Files: `packages/ai/src/source-recommendation.ts`, `packages/core/src/quota.ts`
- Verification: 所有测试通过

### Batch: Module 8 补充修复 (#82 关键问题)

- Cause: Markdown 长文本、hash 契约不一致、dedup ID 校验缺失、parseEventExtraction 错误降级问题。
- Changed:
  - **#82.1**: 新增 `truncateNarrative()` 函数（cap 4000字符），应用于 `renderEventMarkdown` 和 `renderDailyBriefingMarkdown`
  - **#82.2**: `packages/sources/src/adapters.ts` 统一 `createContentHash` 输入格式（始终含 summary）
  - **#82.3**: `parseSemanticDedupResponse` 新增可选 `candidateEventIds` 参数，验证 duplicateEventId 在候选集内
  - **#82.4**: `parseEventExtractionResponse` 对空 title/summary 降级为 isRelevant=false + noiseReason（而非 throw 触发 fallback）
- Files: `packages/core/src/index.ts`, `packages/ai/src/semantic-dedup.ts`, `packages/ai/src/event-extraction.ts`, `packages/sources/src/adapters.ts`
- Verification: typecheck 7/7 通过，test 7/7 通过

- Cause: 代码重复、死代码、边界校验缺失等清理类问题。
- Changed:
  - **#43**: 移除 export.ts 和 extended-repositories.ts 中重复的 readRuntimeEnv/readRequiredRuntimeEnv，统一使用 repositories/util.js
  - **#49**: 删除死代码 extractPreferenceWeightValue（extended-repositories.ts）
  - **#71 + #81**: buildTopicProfile 限制 description ≤500字符；buildTopicProfileContext 增加字段数量上限（keywords≤20, entities≤12, scopes≤8, rules≤6）
  - **#95**: formatEventForInstantPush 输出经 truncateTelegramMessage 截断，确保不超 Telegram 4000 字符限制
- Files: `packages/db/src/repositories/export.ts`, `packages/db/src/extended-repositories.ts`, `packages/core/src/index.ts`, `apps/worker/src/telegram.ts`
- Verification: typecheck 7/7 通过，test 7/7 通过

### Batch: Module 6 Worker 运维与可靠性修复 (#86, #87, #88, #89, #90, #91, #93, #94, #96, #97, #98)

- Cause: Worker 单文件 2676 行过于庞大、缺少优雅关闭机制、时间预算、子周期错误隔离、并发控制和 observability。
- Changed:
  - **#89 (文件拆分)**: 将 `apps/worker/src/index.ts` 拆分为 `modules/` 目录，包含 `env.ts`, `types.ts`, `lifecycle.ts`, `runtime.ts`, `fetch.ts`, `discovery.ts`, `analysis.ts`, `dedup.ts`, `preference.ts`, `briefing.ts`, `governance.ts`, `instant-push.ts`。index.ts 保留 CLI 入口和 signal handler，重导出所有公共函数签名不变。
  - **#87 (时间预算)**: 新增 `WANGCHAO_WORKER_CYCLE_SOFT_TIMEOUT_MS` 环境变量（默认 4 分钟），`isCycleTimeExhausted()` 检查机制，各 cycle 循环中检查并提前退出。
  - **#86 (信号处理)**: 新增 `setupSignalHandlers()` 处理 SIGTERM/SIGINT，10 秒 grace period 后强制退出。`resetCycleStartTime()` 在 fetch/report cycle 开始时调用。
  - **#88 + #90 (子周期错误隔离)**: 各 cycle 循环（fetch, article, candidate, analysis, dedup, briefing, governance, instant-push, telegram）中增加 `isCycleShuttingDown()` 和 `isCycleTimeExhausted()` 检查。
  - **#91 (排序与 catch-up)**: `listFetchedItemsForAnalysis` 排序从 `publishedAt: 'desc' + fetchedAt: 'desc'` 改为 `fetchedAt: 'asc'`，确保 catch-up 优先处理最老的 items。
  - **#93 (Report fire-and-forget)**: 验证 `createReportAction` 已仅写 PENDING 状态，通过独立 Report Cron Service 处理（无 fire-and-forget）。
  - **#94 (单一并发控制)**: 三个独立 `pLimit` 实例合并为共享 `pLimit(getTotalConcurrency())`，通过 `WANGCHAO_WORKER_TOTAL_CONCURRENCY` 统一控制。
  - **#96 (Instant Push per-event TaskRun)**: `runInstantPushCycle` 中每个 event 推送路径新增独立 `createTaskRun(type='TELEGRAM_INSTANT_PUSH')`，完成后 `completeTaskRun` 或 `failTaskRun`。
  - **#97 + #98 (低优先级修复)**: env 变量读取结果缓存到模块级变量（_fetchConcurrency, _totalConcurrency, _softTimeoutMs 等），避免重复 parsed。新增 `WANGCHAO_WORKER_CYCLE_SOFT_TIMEOUT_MS` 和 `WANGCHAO_WORKER_TOTAL_CONCURRENCY`。
- Files:
  - `apps/worker/src/index.ts` - 重写为 CLI 入口 + signal handler + re-exports
  - `apps/worker/src/modules/env.ts` - 提取 env helpers + 缓存 + pLimit
  - `apps/worker/src/modules/types.ts` - 提取公共类型
  - `apps/worker/src/modules/lifecycle.ts` - signal handlers + time budget
  - `apps/worker/src/modules/runtime.ts` - 共享 runtime 创建逻辑
  - `apps/worker/src/modules/fetch.ts` - fetch cycle helpers (fetchSourceWithRetries, fetchSourceAttempt, runArticleFetchCycle)
  - `apps/worker/src/modules/discovery.ts` - source discovery cycle + helpers
  - `apps/worker/src/modules/analysis.ts` - analysis cycle + buildExtractionInput + resolveFilteredNoiseReason
  - `apps/worker/src/modules/dedup.ts` - semantic dedup cycle
  - `apps/worker/src/modules/preference.ts` - preference learning cycle
  - `apps/worker/src/modules/briefing.ts` - daily + period briefing cycles
  - `apps/worker/src/modules/governance.ts` - governance + candidate + expired review cycles
  - `apps/worker/src/modules/instant-push.ts` - instant push cycle with per-event TaskRun
  - `packages/db/src/repositories/source.ts` - listFetchedItemsForAnalysis 排序修复
  - `.env_example` - 新增 WANGCHAO_WORKER_TOTAL_CONCURRENCY 和 WANGCHAO_WORKER_CYCLE_SOFT_TIMEOUT_MS
- Verification: `pnpm typecheck` 7/7 通过, `pnpm lint` 7/7 通过, `pnpm test` 7/7 通过, `pnpm build` 7/7 通过
- Notes / Risk: 文件拆分为首次大规模重构，所有公共函数签名通过 index.ts re-export 保持向后兼容；`extractTopicKeywords` 在 runtime.ts 和 discovery.ts 中使用 `@wangchao/sources` 导入（非 @wangchao/db）；`PrismaClient` 类型在 runtime.ts 中通过 `ReturnType<typeof getPrismaClient>` 推导，避免直接依赖 @prisma/client 模块。

### Batch: Module 5 核心算法/Relevance/去重修复 (#64, #65, #66, #67, #69, #92)

- Cause: 核心算法模块存在 Unicode 处理不一致、魔法数、模糊匹配过宽、幂等缺失和未来时间戳漏洞。
- Changed:
  - **#64**: `normalizeTitle` 和 `normalizeTitleForFuzzyMatch` 增加 NFC 归一化；`createEventHash` 改用 `Array.from` + `codePointAt(0)` 正确处理 surrogate pair
  - **#65**: relevance 评分魔法数抽出为 7 个命名常量（RELEVANCE_MAX_SCORE, RELEVANCE_BASE_POSITIVE, RELEVANCE_BASE_WEAK, RELEVANCE_KEYWORD_BONUS, RELEVANCE_ENTITY_BONUS, RELEVANCE_INCLUDE_SCOPE_BONUS, RELEVANCE_THRESHOLD）
  - **#66**: `normalizeTitleForFuzzyMatch` 字符集从 `[「」【】｜\|\-:：]` 收窄为 `\s*[｜|—–-]\s*[^｜|—–-]*$`，仅截断来源后缀
  - **#67**: `generatePreferenceDeltas` 增加 `eventId` 字段到 `FeedbackSignal` 接口，添加 `processedKeys` Set 对 `(eventId, kind)` 去重
  - **#69**: `applyTimeDecay` 添加 `CLOCK_DRIFT_TOLERANCE_MS` 常量，拒绝超过 ±1 分钟容差的未来时间戳（返回 0）
  - **#92**: `runSemanticDedupCycle` 添加 LLM 调用上限（MAX_DEDUP_COMPARISONS=20）、参数化阈值（WANGCHAO_SEMANTIC_DEDUP_THRESHOLD）、MAX_CANDIDATES_PER_EVENT 上限；catch 块改为 `console.warn` 记录失败；添加 `skipped` 字段到结果
  - 新增环境变量: WANGCHAO_SEMANTIC_DEDUP_THRESHOLD, WANGCHAO_DEDUP_MAX_COMPARISONS, WANGCHAO_DEDUP_MAX_CANDIDATES
- Files: `packages/core/src/index.ts`, `apps/worker/src/index.ts`, `.env_example`
- Verification: `pnpm typecheck` 7/7 通过，`pnpm test` 7/7 通过，`pnpm lint` 7/7 通过
- Notes / Risk: `FeedbackSignal.eventId` 为可选字段，依赖调用方在创建 feedback 时传入以启用去重；`createEventHash` 改用码点迭代后哈希值会变化，但不影响去重一致性（同一函数内仍保持 deterministic）

## 2026-07-14

### Batch: Module 4 AI Adapter/Parser 修复 (#63, #70, #72, #74, #75, #76, #77)

- Cause: AI adapter 和 parser 在健壮性、安全边界和行为一致性上存在 7 个中等问题。
- Changed:
  - **#63**: jsonMode fallback 从直接 return 改为 `continue` 循环，重发受 maxRetries 保护
  - **#70**: `jsonModeUnsupportedModels` 从无限 Set 改为 bounded LRU (capacity=100)
  - **#72**: 新增 `chatStream()` AsyncGenerator 方法支持 SSE 流式响应；提取 buildPayload 复用
  - **#74**: sanitizeModelText 覆盖 <analysis>/<reflection>/<internal>/<draft>/<processed>；extractJsonCandidate 支持数组回退
  - **#75**: validateJsonObject 新增 strict=true 参数，拒绝 schema 外额外字段（prompt injection 防御）
  - **#76**: sanitizeTextField 增加 maxLength 参数；title→200, summary→1000, category→50, importanceExplanation→500
  - **#77**: relevanceScore 用 `Number.isFinite` + clamp，NaN fallback 为 0
- Files: `packages/ai/src/openai-compatible.ts`, `packages/ai/src/parser.ts`, `packages/ai/src/event-extraction.ts`
- Verification: `pnpm typecheck` 7/7 通过，`pnpm test` 7/7 通过，`pnpm lint` 7/7 通过

### Batch: Module 3 安全/租户隔离/凭证修复 (#40, #45, #48, #62, #68)

- Cause: 5 个安全相关 Issue 需修复，涉及租户隔离、加密强化、webhook 校验、SSRF 防护、反馈权重上限。
- Changed:
  - **#40**: `updateTopic`/`updateTopicStatus`/`deleteTopic`/`updateSourceGovernanceStatus`/`batchUpdateSourceGovernanceStatus`/`attachActiveRssSource` 增加 organizationId 防御性 findFirst 校验
  - **#45**: crypto.ts `deriveKey` 改用 scryptSync KDF；新增 `validateApiKeyFormat()` 和 `fingerprintKey()`；保留向后兼容
  - **#48**: `verifyCcpaymentWebhookSignature` 增加时间戳 ±5 分钟新鲜度校验；`findPaymentInvoiceByOrderId` 增加 organizationId + provider 查询条件
  - **#62**: OpenAiCompatibleAdapter constructor 校验 baseUrl 协议（仅 http/https）并阻止内网 IP（SSRF 防护）
  - **#68**: `feedbackSignalWeight` 对用户提供的 value 做 [-4, 4] 区间 clamp，防止滥用推高 confidence
- Files: `packages/db/src/crypto.ts`, `packages/db/src/ccpayment.ts`, `packages/db/src/extended-repositories.ts`, `packages/db/src/repositories/topic.ts`, `packages/db/src/repositories/source.ts`, `packages/ai/src/openai-compatible.ts`, `packages/core/src/index.ts`, `packages/db/src/repositories.fixtures.ts`, `packages/db/src/index.ts`
- Verification: `pnpm typecheck` 7/7 通过，`pnpm test` 7/7 通过，`pnpm lint` 7/7 通过

### Batch: Module 2 repositories.ts 拆分与事务治理 (#42, #44, #46, #47, #56)

- Cause: repositories.ts 3397 行超大文件需按领域拆分；多个事务和批量操作存在性能和数据一致性缺陷。
- Changed:
  - **#42**: `repositories.ts` 拆分为 8 个领域模块（types/workspace/topic/source/event/export/secondary-sources/util），原文件仅保留 re-export 入口（23 行）
  - **#44**: `upsertFetchedItems` 顺序循环改为先查询已有 items，再 `createMany` + `updateMany`，整体包裹在 `prisma.$transaction` 中
  - **#46**: `mergeSemanticEvents` 新增 `expectedOrganizationId` 可选参数做防御性校验；`updateDashboardEventState` 在 select 中加入 `organizationId` 后做一致性校验
  - **#47**: `recordMarkdownExport` 中 ExportEvent 和 FeedbackEvent 两个 create 收集为操作数组，通过 `prisma.$transaction(operations)` 原子执行
  - **#56**: 抽取 `resolveSecondarySources` 到独立模块，`listEventsForDailyBriefing` 和 `listTimelineEvents` 共用，移除重复 ~30 行逻辑
  - **#57**: repositories.fixtures.ts 补充 `verifyReadPreservesSavedState` 中 `organizationId` 字段以匹配 event state select 签名
- Files: `packages/db/src/repositories.ts`, `packages/db/src/repositories/*.ts`, `packages/db/src/repositories.fixtures.ts`, `docs/L3-modules.md`
- Verification: `pnpm typecheck` 7/7 通过，`pnpm test` 7/7 通过，`pnpm lint` 7/7 通过
- Notes / Risk: 所有函数签名保持不变（零变更）；`mergeSemanticEvents` 新增可选参数向后兼容

### Batch: Module 1 DB/数据模型 Issues 修复 (#38, #41, #50, #51, #53, #54, #55, #59)

- Cause: 修复 Module 1 数据模型相关 8 个 Issue，包括 Subscription 凭证拆分、事务包裹、null 状态区分、updateMany 删除、冗余字段清理、Decimal 金额、复合索引、migration 修复。
- Changed:
  - **#38**: Subscription 凭证字段（AI/SEARCH/BYOK/TELEGRAM/CCPAYMENT 共 22 列）拆分为独立 `OrganizationCredential` 表，按 `credentialType` 分区；Subscription 仅保留 plan/status/isSelfHosted/instantPush/Stripe/周期字段
  - **#41**: `ensureDefaultWorkspace` 三个 upsert（organization/user/membership）用 `prisma.$transaction(async (tx) => Ellipsis)` 包裹
  - **#50**: `getSubscriptionPlanView` 在无 Subscription 时返回 `status: null` 而非硬编码 `"ACTIVE"`，调用方需用 `?? "ACTIVE"` 兜底
  - **#51**: `deleteAiCredential`/`deleteSearchCredential` 改用 `deleteMany` 不创建空 Subscription 行
  - **#53**: 删除 `IntelligenceEvent.secondaryItemIds`（已有 EventItem 关联表）、`DeliveryLog.idempotencyKey`（已有 unique(briefingId, channel)）、`UserItemState.dismissedAt`（status=DISMISSED 已隐含）
  - **#54**: `PaymentInvoice` 增加 `@@unique([provider, providerOrderId])` 约束
  - **#55**: FeedbackEvent 增加 `[organizationId, kind, createdAt]` 和 `[topicId, kind, createdAt]` 复合索引
  - **#59**: PaymentInvoice.amount Float→Decimal(10,2)；Session.expiresAt 索引；TaskRun.output 注释说明 100KB 截断；migration 0002 ALTER TYPE ADD VALUE 加 IF NOT EXISTS；seed 支持 WANGCHAO_SEED_SOURCES_PATH 相对路径覆盖
- Files: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0013_credentials_split/migration.sql`, `packages/db/src/repositories.ts`, `packages/db/src/extended-repositories.ts`, `packages/db/src/index.ts`, `packages/db/prisma/seed.ts`, `apps/web/src/app/actions.ts`, `apps/web/src/app/admin/settings/page.tsx`, `apps/web/src/app/api/billing/ccpayment/webhook/route.ts`, `apps/worker/src/index.ts`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `.env_example`
- Verification: `pnpm typecheck` 通过（7/7 包），`pnpm test` 通过（7/7 包）
- Notes / Risk: migration 0013 需在业务低峰执行；PaymentInvoice.amount 从 Float 转 Decimal 会重写整列，大表需评估锁时间；`getSubscriptionPlanView` 返回 null status 后所有调用方已用 `?? "ACTIVE"` 兜底


### Issue #100: 第 3 轮开放问题 — 10 项产品/架构决策确认

- Cause: apps/worker 第 3 轮审计提出 10 个待决策的开放问题（cron 频率、报告生成架构、多租户规模、报告 SLA、Telegram 429 处理、并发参数、部分失败处理、RAILWAY_ROLE 归属等）。
- Changed:
  - **Q1/Q3/Q4/Q6 关闭**（附分析写入 Issue #100 评论）：Railway cron 最小间隔为 1 分钟而非 5 分钟（当前 hourly 正确）；多租户规模当前不需调整（SPEC §3.7 单用户优先）；报告 SLA 分钟级合理（30s timeout + 2000 tokens 足够）；Telegram 429 retry_after 已在 `markInstantPushFailed` + `claimInstantPushFailed` 中正确处理。
  - **Q7 候选源观察并发参数化**：新增 `WANGCHAO_CANDIDATE_OBSERVATION_CONCURRENCY` 环境变量（默认 3），替换 `runCandidateObservationCycle` 中的硬编码 `3`。
  - **Q2/Q5/Q10 独立 Report Cron Service**：新增 `deploy/railway/report-cron.railway.json`（每 10 分钟）、worker `--report-generation` CLI 入口和 `runReportGenerationCycle()`；Web `createReportAction` 移除 fire-and-forget 调用，仅写 `PENDING` 状态。新增 `listPendingReports()` db 查询。
  - **Q8 新建 Issue #124**：追踪 `runFetchCycle` sub-cycle 缺少 error boundary 的改进。
  - **Q9 文档修正**：`WANGCHAO_RAILWAY_ROLE` 在环境变量矩阵中明确标注仅 root config fallback 使用。
- Files: `apps/worker/src/index.ts`, `apps/worker/package.json`, `apps/web/src/app/actions.ts`, `packages/db/src/extended-repositories.ts`, `packages/db/src/index.ts`, `package.json`, `deploy/railway/report-cron.railway.json`, `docs/L4-operations.md`, `docs/railway-runbook.md`, `AGENTS.md`, `AGENTS_CHANGELOGS.md`.
- Verification: `pnpm db:generate` + `pnpm --filter @wangchao/worker typecheck` 通过（除 pre-existing subscription schema 漂移错误外零新增错误）。
- Notes / Risk: 仓库存在 pre-existing 的 subscription schema 漂移（`repositories.ts` 引用已移除的 `aiBaseUrl`/`aiEncryptedKey`/`searchEncryptedKey`/`searchProvider` 字段），导致 `pnpm build` 失败。这不是本次 Issue #100 改动引入的。Report Cron 需要在 Railway dashboard 手动创建 service 并绑定 `deploy/railway/report-cron.railway.json`。

## 2026-07-11

### #37 高权重情报 Telegram 即时推送

- Cause: Plus/Pro 与自用模式需要在高分情报入库后独立于简报周期发起 Telegram 投递。
- Changed: 新增 effective-plan gate、InstantPushLog 可靠投递状态机与 0012 migration、共享 Telegram adapter、多组织 Worker `--instant-push` cycle、Admin 开关、用量统计、Railway 15 分钟 Cron 配置和分层文档。
- Files: `packages/core/src/quota.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0012_instant_push`, `packages/db/src/extended-repositories.ts`, `apps/worker/src/index.ts`, `apps/worker/src/telegram.ts`, `apps/web/src/app/admin/settings`, `apps/web/src/app/usage/page.tsx`, `deploy/railway/instant-push-cron.railway.json`, docs/env/readme files.
- Verification: `pnpm db:validate`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check` 通过；Postgres 16 干净库成功顺序执行 0001-0012、seed 与 `worker:instant-push` 空队列 smoke；built Next server 上 Playwright Admin settings desktop/mobile smoke 2/2 通过。
- Notes / Risk: Railway 独立 service 仍需在 dashboard 创建并绑定 Config as Code；15 分钟从事件持久化开始按 Cron best-effort 计算。

### Batch 7.5: Better Auth e2e 测试 + proxy 迁移（#35, #36）

- Cause: Better Auth 登录流程缺少端到端验证和登出功能；Next.js 16 middleware convention 已废弃
- Changed:
  - `middleware.ts` → `proxy.ts`，函数 `middleware` → `proxy`，消除构建警告
  - TopNav 新增登出按钮（仅 auth 启用时可见），AppShell 传递 authEnabled prop
  - 新增 `tests/smoke/auth.spec.ts`：注册→登录→登出→重登录→admin 保护→多用户隔离
  - Auth 测试条件跳过：未配置 `BETTER_AUTH_SECRET` 时自动 skip
- Files:
  - `apps/web/src/proxy.ts`（原 `middleware.ts`）
  - `apps/web/src/components/layout/top-nav.tsx`
  - `apps/web/src/components/layout/app-shell.tsx`
  - `tests/smoke/auth.spec.ts`（新文件）
- Verification: pnpm typecheck ✓, pnpm lint ✓, pnpm test ✓, pnpm build ✓（无 deprecation 警告）
- Notes: Auth e2e 测试需要设置 `BETTER_AUTH_SECRET` + `DATABASE_URL` + Docker Postgres 才能运行。未配置时自动 skip，不影响现有 CI。

### Batch 7: 配额引擎接入 Worker + session-based workspace 迁移（#31, #32）

- Cause: Worker AI 调用需要按 Plan/BYOK 策略做配额拦截；Web 层所有数据访问需要从默认 workspace 迁移到 session-based workspace 实现多租户数据隔离
- Changed:
  - Worker 新增 `createAnalysisRuntimeWithPlan` + `createOfficialAiRuntime`，按 Plan 配额/BYOK 策略选择 AI 凭证
  - Worker 配额耗尽时 graceful skip（不 crash），stderr 记录拦截原因
  - Worker AI 调用 source（official/byok/official_fallback）写入 UsageEvent.metadata
  - Web 层全部 `ensureDefaultWorkspace` → `getSessionWorkspace()`（~45 call sites）
  - 涉及 actions.ts、topic-source-data.ts、report-data.ts、7 个页面、3 个 export route、2 个 billing route
- Files:
  - `apps/worker/src/index.ts`
  - `apps/web/src/app/actions.ts`
  - `apps/web/src/lib/topic-source-data.ts`
  - `apps/web/src/lib/report-data.ts`
  - `apps/web/src/app/admin/settings/page.tsx`
  - `apps/web/src/app/topics/page.tsx`、`topics/[topicId]/page.tsx`、`topics/[topicId]/edit/page.tsx`、`topics/[topicId]/timeline/page.tsx`
  - `apps/web/src/app/pricing/page.tsx`、`usage/page.tsx`
  - `apps/web/src/app/exports/topics/[topicId]/route.ts`、`exports/events/[eventId]/route.ts`、`exports/briefings/[briefingId]/route.ts`
  - `apps/web/src/app/api/billing/stripe/checkout/route.ts`、`api/billing/ccayment/create-invoice/route.ts`
- Verification: pnpm typecheck ✓, pnpm lint ✓, pnpm test ✓, pnpm build ✓
- Notes: Worker 的 `createSourceRecommendationRuntime` 保持不变（低频调用，不拦截）。未配置 `BETTER_AUTH_SECRET` 时 `getSessionWorkspace()` 内部 fallback 到 `ensureDefaultWorkspace()`，dev 部署行为不变。

### Batch 6: 信源发现与治理增强（#10, #11）

- Cause: 完成信源发现多 provider 支持、专用适配器、批量治理、候选源观察到期和 Worker 增强并发/退避
- Changed:
  - 新增 Tavily、Serper、SearXNG 搜索 provider 和 `createSearchProvider` 工厂
  - 新增 arXiv、GitHub releases 专用适配器（`packages/sources/src/adapters.ts`）
  - 新增批量信源治理（batchUpdateSourceGovernanceStatus）和过期候选源复审机制
  - 新增 `observeExpiresAt` 字段和 migration 0011
  - Worker 增强：auto-mute 连续失败源、候选源低频观察 fetch、过期候选源自动复审/提升/拒绝
  - Web UI：批量治理工具栏、过期候选源复审卡片
  - 新增 fixture 测试覆盖新 provider 和适配器
- Files:
  - `packages/sources/src/discovery.ts` — 新增 3 个 provider 类 + 工厂函数
  - `packages/sources/src/adapters.ts` — 新增 arXiv + GitHub 适配器
  - `packages/sources/src/index.ts` — 导出新 provider 和适配器
  - `packages/sources/src/discovery.fixtures.ts` — 新增 provider fixture 测试
  - `packages/sources/src/adapters.fixtures.ts` — 新增适配器 fixture 测试
  - `packages/sources/package.json` — 更新 test script
  - `packages/db/prisma/schema.prisma` — 新增 observeExpiresAt
  - `packages/db/prisma/migrations/0011_source_governance_enhancements/migration.sql`
  - `packages/db/src/repositories.ts` — 新增批量治理、过期复审、候选观察、auto-mute 函数
  - `packages/db/src/index.ts` — 导出新函数
  - `apps/worker/src/index.ts` — 集成新 provider、auto-mute、候选观察、过期复审
  - `apps/web/src/app/sources/page.tsx` — 批量治理工具栏 + 过期候选源复审
  - `apps/web/src/app/actions.ts` — batchUpdateSourceGovernanceAction
  - `apps/web/src/lib/topic-source-data.ts` — expiredCandidates 数据
  - `.env_example`、`docs/L2-domain.md`、`docs/L3-modules.md`、`docs/L4-operations.md`
- Verification: pnpm typecheck ✓, pnpm lint ✓, pnpm test ✓, pnpm build ✓
- Notes: SearXNG provider 不需要 API key，使用 baseUrl 配置自建实例。候选源观察默认关闭（WANGCHAO_CANDIDATE_OBSERVATION_ENABLED）。

### Batch 5: 商业化基础 — Auth + 订阅 + BYOK + CCPayment

- Cause: 完成 #13 (Auth + RBAC + 租户隔离) 和 #14 (订阅 + 配额 + BYOK + 支付 + 用量仪表盘)
- Changed:
  - Better Auth 集成（email/password + session），未配置 BETTER_AUTH_SECRET 时兼容默认 workspace
  - Plan/SubscriptionStatus 枚举 + isSelfHosted 自用模式开关
  - Per-user BYOK 完整支持（加密存储/脱敏展示/Plus 必填/Pro 可选）
  - 配额引擎（主题/信源/AI调用/导出，按 Plan 检查，自用模式跳过）
  - CCPayment 加密支付完整集成（createInvoice + webhook 签名验证 + 幂等 + 订单确认）
  - Stripe 骨架（checkout/webhook route，未配置时返回 placeholder）
  - 前端：定价页、用量仪表盘、BYOK 设置、CCPayment 设置、自用模式开关、登录/注册页
  - 顶部导航增加用量入口
- Files: schema.prisma, 0010 migration, auth.ts/auth-client.ts/session.ts/middleware.ts, quota.ts, ccpayment.ts, extended-repositories.ts, pricing/usage/login/register pages, billing API routes, actions.ts, settings page + byok/ccpayment/self-hosted forms, top-nav.tsx, .env_example
- Verification: typecheck, lint, test, build all pass
- Notes: Auth 默认不启用（兼容模式）；CCPayment 需要配置 App ID/Secret 后可用；Stripe 仅骨架；配额引擎已实现但未接入 Worker analysis cycle（下一步）

### docs:README 新增官网链接和托管平台提示

- Cause: 需要在 README 中公布官网地址 `wangchao.jerryiscat.one`，并告知用户可以直接使用托管平台服务，无需自行部署
- Changed:
  - `README.md` 头部导航新增官网链接，在项目简介下方新增托管平台提示
  - `README.md` 部署方式段新增提示，引导嫌麻烦的用户使用托管平台
  - `README-en.md` 同步新增官网链接、托管平台提示和 Quick Start 段提示
- Files: README.md, README-en.md
- Verification: 文档变更，无代码改动
- Notes: 无风险

### Batch 4: Telegram 投递 + 专题报告 + 反馈学习增强

- Cause: 完成 #29 (Telegram 投递通道)、#17 (按需专题报告)、#7 (反馈学习增强)、#18 (首页导航)
- Changed:
  - 新增 DeliveryLog 模型、Telegram 凭证管理、Worker Telegram 投递 cycle
  - 新增 Report 模型、情报库证据检索、Worker 报告生成 (规则+AI)、报告列表/详情页
  - 新增 6 种 FeedbackKind (SOURCE_QUALITY_UP/DOWN, SCORE_UP/DOWN, MORE/LESS_LIKE_THIS)
  - 新增偏好时间衰减 (30 天半衰期)
  - 新增偏好编辑 UI (权重调整、删除)
  - 新增事件详情增强反馈按钮
  - 顶部导航增加专题报告入口
- Files: schema.prisma, 0009 migration, extended-repositories.ts, worker index.ts, actions.ts, settings page + telegram-form, reports pages, preferences page, report-data.ts, core index.ts, top-nav.tsx, .env_example
- Verification: typecheck, lint, test, build all pass
- Notes: Telegram 投递需要 Admin 配置 Bot Token + Chat ID; 报告生成是异步任务; 偏好衰减在 generatePreferenceDeltas 中实现

### feat:Wave 3 Railway 运维 — GitHub 自动部署、Cron 观测、结构化日志、备份/回滚 runbook、CI/CD、环境变量矩阵

- Cause: Issues #19、#20、#21、#22、#23、#24、#15、#3 描述了 Railway 运维的系统性缺口：GitHub→Railway 主路径未在文档中固化；Worker 缺少结构化日志和 Cron 观测；Postgres 备份/PITR 策略和 migration 前检查缺失；发布验证缺乏 HTTP smoke fallback 和回滚 runbook；Railway 环境变量矩阵和 secret 最小化暴露未文档化；Railpack monorepo 构建优化方向不清；GitHub Actions CI 不存在；Worker/Source Discovery Cron 的启用方式未说明。
- Changed: (1) **#20+#3 Worker 结构化日志**：Worker 入口重写，每次执行输出两行结构化 JSON 日志：`cycle-start`（cycle type + timestamp）和 `cycle-end`（cycle type + durationMs + status + 全部计数器/结果）。Cycle type 为 `fetch`/`source-discovery`/`health`，status 为 `ok`/`degraded`/`error`。Railway logs 可直接消费。(2) **#19 GitHub→Railway 主路径文档**：`docs/deployment.md` 和 `docs/L4-operations.md` 全面更新，明确 GitHub push/merge 为生产主路径，`railway up` 降级为紧急 fallback（仅 root `railway.json` + `WANGCHAO_RAILWAY_ROLE`），root config 缺少 healthcheck/cronSchedule 不能长期使用。(3) **#24 构建优化**：新增 `pnpm railway:build:web` 和 `pnpm railway:build:worker`（Turborepo filtered build）作为可选优化路径；当前 Railway config 保持 `pnpm railway:build`（完整构建），因为 Railpack per-service 构建裁掉 `dist/` 是已发生的生产问题，优化以不回归为前提。(4) **#21+#22+#23 Railway Runbook**：新建 `docs/railway-runbook.md`（300+ 行），6 大章节：GitHub 自动部署主路径、Worker Cron 运行与观测（含排障 runbook）、发布验证与健康检查（含 HTTP smoke）、Postgres 备份与 Migration 安全（含 forward-compatible 原则和恢复演练）、环境变量矩阵与 Secret 管理（按 service 最小化暴露）、CI/CD。(5) **#22 HTTP Smoke 脚本**：新增 `scripts/http-smoke.mjs`（无需 Chromium，验证 7 条路由 HTTP 200）和 `scripts/http-smoke-check.mjs`（CI 用，验证 build artifacts 存在）。(6) **#15 GitHub Actions CI**：新增 `.github/workflows/ci.yml`，在 push/PR 到 master 时运行 install → db:generate → typecheck → lint → build → test → db:validate → http-smoke-check。
- Files: `apps/worker/src/index.ts`（`emitStructuredLogStart`、`emitStructuredLogEnd`、`WorkerCycleType`，入口重写）, `docs/railway-runbook.md`（新，300+ 行）, `docs/deployment.md`（GitHub→Railway 主路径、Services 表、Railway Setup、Logging/Backup/CI/Current Gaps 重写）, `docs/L4-operations.md`（部署脚本表、filtered build 说明、测试入口更新）, `docs/L3-modules.md`（Worker 结构化日志规则）, `package.json`（`railway:build:web`、`railway:build:worker`）, `scripts/http-smoke.mjs`（新）, `scripts/http-smoke-check.mjs`（新）, `.github/workflows/ci.yml`（新）, `CODEGUIDE.md`（runbook 引用）, `AGENTS.md`（runbook 引用）, `README.md`（runbook 引用）, `README-en.md`（runbook 引用）, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。`node scripts/http-smoke-check.mjs` ✓（6/6 artifacts）。`pnpm railway:build:web` ✓（6 tasks）。`pnpm railway:build:worker` ✓（5 tasks）。
- Notes / Risk: Worker 结构化日志改变了 stdout 输出格式（从 pretty JSON 变为单行 JSON per event），任何解析旧格式的下游需要适配。CI workflow 会在 push 到 master 时并行触发 Railway 部署和 GitHub Actions 验证。HTTP smoke 脚本验证 HTTP 200 但不验证页面内容（Playwright smoke 覆盖交互）。环境变量矩阵中标记 `WANGCHAO_RAILWAY_ROLE` 为 "root config only"，因为 service-level config 不需要角色分发。

### feat:Wave 2 简报/导出/时间线 — 周报月报周期生成、主题时间线、批量导出、Obsidian-friendly 文件名

- Cause: Issues #28、#8、#4 描述了简报和导出的三个能力缺口：Worker 只生成 DAILY 简报，没有 WEEKLY/MONTHLY 周期报告；没有主题时间线页面；导出缺少 Obsidian-friendly 文件名和批量导出路径。
- Changed: (1) **#28 周报/月报**：`packages/core` 新增 `createUtcWeekRange()`/`createUtcMonthRange()`/`renderPeriodBriefingMarkdown()`；`packages/db` 新增 `createPeriodBriefing()`（支持任意 `BriefingPeriod` 的幂等 upsert）和 `listTimelineEvents()`（按 `occurredAt` 倒序分页查询主题事件）；Worker 新增 `runPeriodBriefingCycle()` 在每次 fetch cycle 中同时生成周报和月报，使用 `@@unique([topicId, period, rangeStart])` 约束保证幂等。(2) **#28 主题时间线**：新增 `getTopicTimeline()` 数据函数和 `apps/web/src/app/topics/[topicId]/timeline/page.tsx` 页面，按 `occurredAt` 时间倒序展示主题所有事件（含 merged sources），主题详情页新增"时间线"入口。(3) **#8 Obsidian-friendly 导出**：简报导出文件名改为 `{date}-{period}-{slug}.md` 格式便于 Obsidian 排序。(4) **#8 批量导出**：新增 `apps/web/src/app/exports/topics/[topicId]/route.ts` 批量导出主题 Top 100 事件为单个 Markdown，记录 `ExportEvent` 审计；主题详情页新增"批量导出"按钮。(5) **#8 简报去重**：已由 `@@unique([topicId, period, rangeStart])` + `upsert` 保证，无需额外代码。(6) **简报中心增强**：简报列表页新增按 DAILY/WEEKLY/MONTHLY 周期筛选（≥44px touch target）。
- Files: `packages/core/src/index.ts`（`createUtcWeekRange`、`createUtcMonthRange`、`PeriodBriefingInput`、`renderPeriodBriefingMarkdown`）, `packages/db/src/repositories.ts`（`CreatePeriodBriefingInput`、`BriefingPeriod`、`TimelineEventRecord`、`createPeriodBriefing`、`listTimelineEvents`、`listBriefingsPage` period filter）, `packages/db/src/index.ts`（新 exports）, `apps/worker/src/index.ts`（`runPeriodBriefingCycle`）, `apps/web/src/app/briefings/page.tsx`（周期筛选 tabs）, `apps/web/src/app/topics/[topicId]/page.tsx`（时间线 + 批量导出入口）, `apps/web/src/app/topics/[topicId]/timeline/page.tsx`（新）, `apps/web/src/app/exports/briefings/[briefingId]/route.ts`（Obsidian 文件名）, `apps/web/src/app/exports/topics/[topicId]/route.ts`（新，批量导出）, `apps/web/src/lib/topic-source-data.ts`（`getTopicTimeline`、`TimelineEventSummary`、`TimelinePage`、`getBriefingsPage` period filter）, `apps/web/src/app/globals.css`（`.briefing-filters`、`.briefing-period-tabs`）, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。Playwright `web.spec.ts` ✓（8 pass / 6 skip，skip 原因为 seed 数据无 events/briefings/saved）。`responsive.spec.ts` 仍有 pre-existing failure（top-nav 控件 <44px，与本次改动无关）。
- Notes / Risk: 周报/月报在每次 Worker fetch cycle 自动生成（同一周期窗口幂等 upsert），不额外调度。时间线查询使用 `occurredAt` 而非 `createdAt`，更准确反映事件发生时间。批量导出限制 Top 100 事件避免过大文件。PDF 导出继续后置。

### feat:Wave 1 核心信息管线增强 — 原文全文抓取、语言/简报偏好消费链、手动重新生成摘要

- Cause: Issues #26、#30、#27 描述了情报管线的三个关键缺口：AI 摘要只依赖 RSS feed 片段而非原文全文；Topic Profile 的 `languagePreferences` 和 `digestStyle` 没有数据契约或消费方；用户无法手动触发摘要重新生成。这三个缺口直接影响摘要质量、多语言支持和用户控制力。
- Changed: (1) **#26 原文全文抓取**：`packages/sources` 新增 `fetchArticleContent()`（`@mozilla/readability` + `linkedom`），Worker fetch cycle 后新增 `runArticleFetchCycle()` 对无 `rawContent` 的 Item 异步抓取原文；RSS parser 从 `content:encoded` 提取 `rawContent`；`NormalizedSourceItem`、`NormalizedFetchedItemInput`、`PendingAnalysisItem`、`EventExtractionInput.item` 全链路新增 `rawContent` 字段；AI prompt 在 `rawContent` 可用时优先使用全文（截断 8000 字符）。(2) **#30 语言/简报偏好**：`packages/core` 新增 `LanguagePreferences`、`DigestStyle` 类型和默认值；`buildTopicProfileContext()` 读取 `languagePreferences`（输出语言 + 术语规则）和 `digestStyle`（结构 + 详细程度 + 最大事件数）；主题编辑页新增输出语言、术语规则、简报结构、详细程度和最大事件数字段；`buildEventExtractionMessages` 的 system prompt 根据 `outputLanguage` 切换中英文并注入术语规则；`renderDailyBriefingMarkdown` 根据 `digestStyle.structure`（standard/detailed/compact）和 `maxEvents` 控制简报结构和事件数。(3) **#27 手动重新生成摘要**：新增 `regenerateEventSummaryAction` Server Action（读取 event + primaryItem + topic profile → 调用 `extractEvent` → 更新 summary），频率限制 60 秒/事件，缺少 AI 凭证时友好提示；情报详情页新增"重新生成摘要"按钮（RefreshCw icon，移动端 ≥44px）。
- Files: `packages/sources/package.json`（新增 `@mozilla/readability`、`linkedom` 依赖）, `packages/sources/src/index.ts`（`fetchArticleContent`、`rawContent`、`stripHtml`）, `packages/db/src/repositories.ts`（`rawContent` 字段、`updateItemRawContent`、`listItemsWithoutRawContent`）, `packages/db/src/index.ts`（新 exports）, `packages/ai/src/event-extraction.ts`（`rawContent`、`languagePreferences`）, `packages/core/src/index.ts`（`LanguagePreferences`、`DigestStyle`、`DEFAULT_*`、renderer 更新）, `apps/worker/src/index.ts`（`runArticleFetchCycle`、`buildExtractionInput` 更新、briefing digestStyle）, `apps/web/src/app/actions.ts`（`regenerateEventSummaryAction`、language/digest 保存）, `apps/web/src/app/events/[eventId]/page.tsx`（重新生成摘要按钮）, `apps/web/src/app/topics/[topicId]/edit/page.tsx`（语言/简报偏好字段）, `apps/web/package.json`（新增 `@wangchao/ai` 依赖）, `SPEC.md`, `docs/L3-modules.md`, `AGENTS_CHANGELOGS.md`, `DEVELOPE_LOGS.md`。
- Verification: `pnpm typecheck` ✓（7/7）, `pnpm lint` ✓（7/7）, `pnpm test` ✓（7/7）, `pnpm build` ✓（7/7）, `git diff --check` ✓。
- Notes / Risk: 原文抓取在 Worker 中异步执行，失败不阻塞主流程；RSS `content:encoded` 作为 `rawContent` 的零成本来源优先使用。语言偏好当前支持 `zh-CN` 和 `en` 两种输出语言。频率限制基于 `updatedAt` 字段，简单但有效。未做 Playwright smoke 覆盖新增按钮（由 #4 跟踪）。`pnpm-lock.yaml` 已更新。

### fix:第八轮 SPEC/README 实现审计 — 落实画像范围规则筛选

- Cause: 第七轮开放 entities/includeScope/excludeScope/importanceRules 编辑后继续反查发现，`evaluateRelevance()` 实际仍只读取 keywords；无 AI 或 AI 失败时，排除范围不会过滤、实体与覆盖范围不会产生正信号，fallback 事件 entities 永远为空。Worker filtered 分支还会用泛化文案覆盖规则或 LLM 的具体 noiseReason，导致“可编辑画像 + 可解释筛选”仍有数据壳。
- Changed: `RelevanceDecision` 新增 matchedEntities/matchedIncludeScopes/matchedExcludeScopes。deterministic relevance 对 title+summary 做大小写不敏感短语匹配：excludeScope 优先否决并 score=0；keywords 每项 +8、entity/include 每项 +6，在任一正信号命中时从 72 起分。fallback draft 按 keyword > entity > scope 选择 category，保留 matched entities，并把三类信号写入 explanation；Web 将其翻译为组合中文解释。Worker 保留 rule decision 或 LLM noiseReason，在 Item rawMetadata 与 extraction/relevance TaskRun output 写具体 exclusion/no-signal reason。importanceRules 明确保持 AI-only，修正此前过度承诺的 UI/文档文案。
- Files: `packages/core/src/index.ts`, `packages/core/src/index.fixtures.ts`, `apps/worker/src/index.ts`, `apps/worker/src/index.fixtures.ts`（新）, `apps/worker/package.json`, `apps/web/src/lib/event-display.ts`, `apps/web/src/app/topics/[topicId]/edit/page.tsx`, `SPEC.md`, `README.md`, `README-en.md`, `CODEGUIDE.md`, `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `FRONTEND.md`, `DEVELOPE_LOGS.md`, `AGENTS_CHANGELOGS.md`。
- Verification: `pnpm db:validate` ✓，`pnpm typecheck` ✓（7/7），`pnpm lint` ✓（7/7），`pnpm test` ✓（7/7，Worker 现在实际 emit + 执行 fixture），`pnpm build` ✓（7/7，覆盖本轮 core relevance、Worker filtered output、Web explanation 与文案主体修改），`pnpm exec playwright test --list` ✓（16 tests），`git diff --check` ✓。随后新增纯 `resolveFilteredNoiseReason()` helper 与 Worker fixture，最终根 build 重跑在启动前因 Codex 使用额度门禁被拒；该增量已由最终 typecheck/lint/test 编译执行，但未再次跑根 build，不能记为第二次 build 成功。core fixture 覆盖 keyword 与 exclude 同时命中时 exclude 胜出且不生成 draft、entity-only 生成 event/category/entities、include-only 通过 relevance，以及无信号继续过滤；Worker runtime fixture 覆盖 rule reason 优先于失败 LLM、正常 LLM noiseReason 不丢失。
- Notes / Risk: include/exclude 使用用户逐项输入的短语包含匹配，不做分词语义推断，避免规则黑箱；复杂自然语言 importance 仍交给 AI prompt。实时核对 #5 已关闭且其 LLM 主链路验收已落地，本轮没有发现一个边界明确、完全缺失的额外 LLM 功能，因此不臆测新票；languagePreferences/digestStyle 仍由 #30 跟踪。

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
