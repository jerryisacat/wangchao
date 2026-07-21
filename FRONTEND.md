# 望潮（Wangchao）前端设计规范

> 本文档定义 `apps/web` 的视觉语言、交互规则和页面组合方式。
>
> 产品目标、数据模型和功能边界仍以 `SPEC.md` 为准；技术架构仍以 `REFACTOR_PLAN.md` 和 `CODEGUIDE.md` 为准。本文只约束前端表现层。

## 1. 设计方向

望潮的前端风格采用 **Material You (Material Design 3)**：暖白 tonal 表面、紫种子色、药丸按钮、filled 输入框、状态层、柔和动效。早期版本的 "Kinetic Intelligence"（暗色 / 硬边 / 酸黄）已被替换。

望潮不是新闻门户，也不是营销落地页。它是一个高频使用的主题情报工作台，因此前端必须同时满足两件事：

- 第一眼友好、有温度：暖白底、紫强调、圆角、tonal 表面，缓解长时间阅读的疲劳。
- 长时间可读：列表、详情、反馈和治理界面必须稳定、密集、低干扰。

```text
品牌层：TRACK 水印、巨型标题、紫强调、少量动效
工作层：tonal 表面分层、密集信息、稳定阅读、状态层反馈
反馈层：用状态层 + cubic-bezier 动效表达“系统学到了什么”
```

MD3 的落地页装饰技法（有机模糊球、玻璃拟态、大留白 hero、asymmetric 抬升）只在定价 featured 档、空状态、新建主题首屏等少数品牌点使用，**不照搬到密集列表 / 详情 / 表单**。

## 2. 适用边界

| 场景 | 风格强度 | 规则 |
|---|---:|---|
| 登录前品牌页 / 空状态 / 新建主题首屏 | 中 | 巨型标题、TRACK 水印、featured 抬升等品牌点缀。 |
| 首页未读情报流顶部 | 低 | 只服务阅读入口、主题筛选和关键操作，不做指标墙。 |
| 情报流列表 | 低 | tonal 行分层、稳定行高、少动效，禁止持续 marquee。 |
| 情报详情 | 低 | 以阅读为主，强调来源、解释、反馈动作。 |
| 信源治理 | 中 | 卡片、质量分大数字、Badge 状态色、meter 条。 |
| 偏好记忆 | 中 | 用权重、置信度 meter 表达学习过程。 |
| 简报导出 | 中 | editorial 风格，可复制可读。 |
| 定价 | 中 | 卡片、featured 档异步抬升。 |
| 任务状态 / 用量审计 | 低 | 放在二级设置或系统页面，首页不直接展示。 |

## 3. 视觉原则

1. **Tonal surface first**：背景用 `#FFFBFE`（非纯白），靠 surface-container / surface-container-low 分层，少用边框。
2. **Pill & organic**：按钮、chip、badge 全 `rounded-full`；卡片 24px、块 16px、菜单 28px。
3. **State layers**：hover / active 用半透明叠加（`bg-primary/90`、`bg-primary/10`），不改底色。
4. **Motion as signal**：动效只用于状态变化、反馈确认、品牌节奏，`cubic-bezier(0.2,0,0,1)`，尊重 `prefers-reduced-motion`。
5. **Density over decoration**：工作台优先可行动信息，不堆模糊球 / 玻璃拟态 / 过度阴影。
6. **Explainability visible**：每条情报可看为什么推荐、来源可信度、评分和反馈入口；偏好记忆让用户知道系统学到了什么。

## 4. Design Tokens

定义在 `apps/web/src/app/globals.css` 的 `@theme`，并通过 `:root` 暴露为 CSS 变量。组件用 Tailwind 颜色类（`bg-primary`、`text-muted-foreground` …）引用，**不在组件里散落 hex**。

### 4.1 色彩（亮色，种子 `#6750A4`）

| Token | 值 | 用途 |
|---|---|---|
| `--color-background` | `#FFFBFE` | 全局背景（md surface，非纯白） |
| `--color-foreground` | `#1C1B1F` | 主文字（md on-surface） |
| `--color-card` / `--color-surface` | `#F3EDF7` | 卡片 / 面板（md surface-container） |
| `--color-surface-strong` / `--color-muted` | `#E7E0EC` | 次级块面 / filled 输入框底（md surface-container-low） |
| `--color-muted-foreground` | `#49454F` | 次级说明文字（md on-surface-variant） |
| `--color-border` | `#CAC4D0` | 分隔边框（md outline-variant） |
| `--color-outline` | `#79747E` | 强调边框 / filled 输入框底边（md outline） |
| `--color-primary` / `--color-accent` / `--color-ring` | `#6750A4` | 主 CTA / 焦点环 / 关键状态（md primary） |
| `--color-primary-foreground` / `--color-accent-foreground` | `#FFFFFF` | primary 上的文字 |
| `--color-secondary` | `#E8DEF8` | tonal 容器 / 次按钮 / 激活态（md secondary-container） |
| `--color-secondary-foreground` | `#1D192B` | secondary 上的文字 |
| `--color-tertiary` | `#7D5260` | 辅助强调（md tertiary） |
| `--color-success` / `--color-warning` / `--color-danger` | `#386A20` / `#7D5260` / `#B3261E` | 状态色（MD3 tonal） |

规则：

- 背景用 `#FFFBFE`（tonal surface），不用纯白。
- `primary` / `accent` 只用于主行动、焦点环、关键数字与重要状态，不铺满。
- 状态色只表达状态（success / warning / danger），用 tonal 容器（`bg-x/15` + `text-x`），不作装饰。
- 正文禁止低对比灰；说明文字用 `text-muted-foreground`。

### 4.2 字体

| 层级 | 字体 | 规则 |
|---|---|---|
| 默认 UI | Roboto（next/font/google，400 / 500 / 700） | 500 为标题默认。 |
| 数字 / 技术状态 | Geist Mono | 用于分数、任务 ID、用量、时间戳。 |

字号建议（Tailwind）：

| 用途 | 建议 |
|---|---|
| 品牌 / 空状态大标题 | `clamp(3rem, 10vw, 9rem)` |
| 首页页面标题 | `clamp(1.75rem, 4vw, 3rem)` |
| 区块标题 | `text-base` / `text-lg font-medium` |
| 情报标题 | `text-lg font-medium` |
| 情报摘要 | `text-base leading-relaxed` |
| 辅助说明 | `text-sm text-muted-foreground` |
| KPI 数字 | `text-2xl` / `text-3xl font-medium tabular-nums` |

大小写规则：品牌层标题、标签可 uppercase；中文标题不强制转换；英文 acronym 保留原写法（RSS、AI、API、COMAC）；情报标题、摘要、来源名称、解释文案不得全大写。

### 4.3 形状和边框

| 元素 | 规则 |
|---|---|
| 卡片 / 面板 | `rounded-[24px]`，tonal 背景，默认无边框，`shadow-sm hover:shadow-md`。 |
| 次级块面 | `rounded-[16px] bg-muted`。 |
| 按钮 / chip / badge | `rounded-full`（药丸）。 |
| 菜单 / 弹层 | `rounded-[28px]`。 |
| 输入框 | MD3 filled field：`rounded-t-[12px]` 圆顶、`border-b-2 border-outline`、`bg-muted`、`h-14`、focus 底边变 `border-primary`。 |
| 分隔 | `border-t border-border` 或 `divide-y divide-border`，优先 tonal 分层而非边框。 |

### 4.4 间距和密度

- 工作台外边距：`px-6`（移动端 safe-area：`pl-[max(16px,env(safe-area-inset-left))]`）。
- 卡片内边距：普通 `p-4`，重点 `p-6`。
- 表单间距：`gap-3` / `gap-4`，不用落地页式超大垂直间距。
- 主阅读区：`max-width: 920px`，居中单列。
- 移动端：单列阅读、顶部导航可触摸滚动、safe-area padding、无横向滚动、所有高频动作 ≥44px 触达。

### 4.5 动效与状态层

- 缓动：`ease-[cubic-bezier(0.2,0,0,1)]`；标准 `duration-300`，快速 `duration-200`。
- 触感：可点元素 `active:scale-95`。
- 状态层：实色 hover `bg-primary/90`、active `bg-primary/80`；透明元素 hover `bg-primary/10`、active `bg-primary/5`。
- 焦点：`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`。
- 全局 `prefers-reduced-motion` 降级（见 `globals.css`）。

## 5. 页面组合

### 5.1 首页：未读情报流

首页的唯一核心任务是让用户处理未读情报。

```text
顶部导航
  左侧：望潮
  中间：未读情报 / 简报 / 报告 / 已保存
  右侧：新增主题（药丸 CTA） + 更多（下拉）

中间限宽阅读区
  页面标题：未读情报
  轻量状态：未读数量、当前主题筛选、最近更新时间
  情报流：按重要度、时间和个人偏好排序
  收尾状态：全部处理完或暂无新情报
```

首页保留：未读情报流、主题筛选（全部 / 单主题，pill toggle）、情报卡片、快速动作（已读 / 收藏 / 减少这类 / 原文）、`新增主题` 入口。

首页移出：组织与权限、用量审计、处理管线、信源治理详情、偏好记忆详情、新建主题大表单、大面积 KPI 指标卡。

### 5.2 App Shell 与导航

App Shell 使用顶部导航（`components/layout/app-shell.tsx` + `top-nav.tsx`），亮色 sticky + `backdrop-blur` + 底边。

- 主导航（日常阅读 4 项）：未读情报 `/`、简报 `/briefings`、报告 `/reports`、已保存 `/saved`。激活态 `bg-secondary text-secondary-foreground`。
- 右侧：新增主题 `/topics/new`（primary 药丸 CTA）+ 「更多」`DropdownMenu`。
- 「更多」分组并按角色 / 登录态条件渲染：
  - 管理：主题列表 `/topics`、信源管理 `/sources`。
  - 账户：偏好记忆 `/preferences`、我的用量 `/usage`、方案与定价 `/pricing`。
  - 工作区（仅 `OWNER | ADMIN`）：工作区设置 `/admin/settings`、用量审计 `/admin/usage`。
  - 登出（仅 `authEnabled`）。
- 登录前路由（`/login`、`/register`）渲染极简品牌头，不显示应用导航。
- 角色由 `AppShell`（async server）经 `getSessionWorkspace` 解析（`UNAUTHENTICATED` -> `null`；self-hosted -> `OWNER`）传入。

规则：

- 顶部菜单必须是实际入口，不做无行为的伪导航。
- `新增主题` 是按钮 / 链接，不在首页展开复杂管理表单。
- 二级入口保留文字标签和当前页状态，不只依赖图标。
- 搜索作为轻入口存在，但不能让首页变成命令面板。
- 系统状态、任务、组织、审计不进入首页顶层导航。

### 5.3 情报流

情报流是核心页面，目标是快速判断：这条情报讲什么？为什么重要？来自哪里？系统为什么排上来？我要读、存、忽略还是纠偏？

首页情报卡片（`components/intelligence/intelligence-card.tsx`，用 `Card`）应包含：

| 信息 | 要求 |
|---|---|
| 主题 | 显示主题名称或短标签（`Badge`），帮助判断上下文。 |
| 来源和时间 | source name、原文链接、发布 / 抓取时间（`Badge variant=muted` 或 meta 文本）。 |
| 标题 | 两行以内，超出进入详情。 |
| 摘要 | 2-4 行，说明发生了什么（`text-base leading-relaxed`，读 `data-summary-status`）。 |
| 为什么重要 | 用用户语言解释影响、对象和后续跟踪价值（`rounded-[16px] bg-muted` 块）。 |
| 排序解释 | 轻量展示，不用工程化 `matched keywords` 原文。 |
| 动作 | 已读、收藏、减少这类、原文（`Button variant=ghost`，移动端两列）。 |

弱化或隐藏：`gravityScore`、`score` 等工程分数不在卡片抢主视觉；`read / saved / dismissed` 等状态转成中文动作和状态，不暴露枚举名；`Item`、`TaskRun`、`UsageEvent`、`PreferenceMemory` 等内部对象不出现在首页文案。

交互规则：hover 用状态层（`hover:bg-primary/5`），不做整卡反色；saved 用 accent / success 点亮；dismissed 用低对比或移出默认列表；键盘焦点明显；已读后卡片移出或进入轻量撤销状态。

### 5.4 情报详情

详情面板（`app/events/[eventId]/page.tsx`）采用稳定阅读布局，用 `Card` 分节：标题 / 摘要 / 为什么重要 / 影响对象 / 来源与原文链接 / 系统解释 / 反馈动作 / 导出入口。

反馈动作区分“忽略此条”和类别偏好：“忽略此条”改变事件状态并退出默认信息流；“多关注这类 / 少关注这类”只调整当前 Topic 下的 category 偏好，提交后留在详情页并显示明确反馈。移动端动作区换行，每个按钮仍 ≥44px。

摘要区域必须读取结构化状态：采集等待、采集失败、内容不足、平台暂不支持、AI 失败均显示明确提示，不得用标题或 RSS 摘要伪装成 AI 摘要；这些状态仍保留“原文”和“重新采集”动作。首页情报卡片使用同一状态文案。

摘要语言跟随用户当前界面语言；完成 i18n 适配前固定简体中文，主题编辑页只读展示该状态。术语规则仍可编辑，用于保留产品名、缩写和指定译法。

### 5.5 新建主题

新建主题（`app/topics/new/page.tsx`）是最适合强化品牌点的页面：`TRACK` 水印（`.topic-lab::before`，紫 8% 透明）、巨型标题、自然语言输入。

推荐结构：巨型标题（TRACK WHAT MATTERS）/ 自然语言输入 / AI 生成主题草案 / include / exclude / entities / keywords / 确认创建。

设计规则：输入框可以更大；草案编辑区回到清晰表单（`Input` / `Textarea` / `Label`）；创建后展示“系统开始观察”反馈动效（需 reduced-motion 版本）；首页只保留 `新增主题` 入口。

### 5.6 信源管理

信源管理（`app/sources/page.tsx`）比情报流更偏操作面板。首页只显示情报来源，不展示信源治理指标。

每个信源卡片（`Card` 或行）显示：状态（candidate / active / muted / rejected，`Badge`）、命中率 / 噪音率 / 重复率 / 质量分（`Badge` + meter 条）、最近抓取时间、推荐动作（approve / observe / mute / reject，`Button` 对应变体）、证据（为什么推荐这个操作）。大数字用 `font-medium tabular-nums`；hover 状态层只用于可点击动作。

### 5.7 偏好记忆

偏好记忆（`app/preferences/page.tsx`）必须可解释，不做神秘 AI 黑盒。

展示规则：权重增加用正向色和上升标记，权重降低用警示 / 低对比标记；置信度用 meter 条（track `bg-muted`、fill `bg-primary`，`role=progressbar` + aria）或数字；解释明确来自哪些反馈信号。权重 +/- 用 `Button icon`，数值 `font-medium tabular-nums`。

### 5.8 简报和导出

简报页面（`app/briefings/page.tsx`）更接近 editorial / intelligence report：标题清楚、生成时间明确、来源链接保留、Markdown 导出入口显著、正文不全大写、不巨型 typography。

- 周期筛选：顶部 DAILY / WEEKLY / MONTHLY 周期 pill tabs（≥44px，`data-active` 标识当前项，URL 参数服务端筛选）。
- Obsidian-friendly 文件名：简报导出 `{date}-{period}-{slug}.md`（如 `2026-07-11-weekly-ai-infrastructure.md`）。
- 主题批量导出：主题详情页“批量导出”下载 Top 100 事件为单个 Markdown（`{date}-batch-{slug}.md`）。
- 主题时间线：主题详情页“时间线”入口，按 `occurredAt` 倒序展示全部正式事件，含 merged sources。

### 5.9 管理后台设置

`app/admin/settings/page.tsx`（OWNER / ADMIN）用 `Tabs`（pill）分 6 个凭证 tab，每个 tab 内容用 `Card` 包裹表单。

- 模型嗅探：AI 凭证表单“刷新模型列表”调 `listAiModelsAction`，嗅探 OpenAI-compatible 端点可用模型，`<select>` 展示模型 ID 及 `ownedBy`，支持“自定义…”回退到自由 `<Input>`。嗅探结果不持久化。
- 自定义 Provider 手动确认：选“自定义”且自动测试失败时显示“我已确认此 Key 有效” checkbox，勾选跳过自动测试门控；取消勾选清空测试状态。
- 计费提示：测试按钮下显示“测试将发送一次最小 API 请求，可能产生极少量费用”。
- 独立性说明：页面顶部显示“AI 凭证与搜索凭证相互独立，可分别保存与清除。”
- Telegram 即时推送：Telegram tab 分开展示凭证和即时推送开关；Free 显示升级提示，未配置凭证不可开启，服务端重复执行权限与计划校验。

## 6. 组件规范

原语在 `components/ui/*`，全部已是 MD3：

| 原语 | 要点 |
|---|---|
| `Button` | 药丸 `rounded-full`；变体 `primary`(filled) / `secondary`(tonal) / `outline` / `ghost` / `danger` / `link`；尺寸 `default` / `sm` / `lg` / `icon` / `icon-xs`；状态层 + `active:scale-95` + 焦点环。 |
| `Card` | `bg-card rounded-[24px] shadow-sm hover:shadow-md`；`CardHeader` / `Title` / `Description` / `Content` / `Footer`；变体 `default` / `work` / `kinetic`。 |
| `Input` / `Textarea` | MD3 filled field：`rounded-t-[12px]` 圆顶、`border-b-2 border-outline`、`bg-muted`、`h-14`、focus 底边变 `border-primary`。 |
| `Badge` | `rounded-full` chip；变体 `default` / `secondary` / `accent` / `success` / `warning` / `danger` / `outline` / `muted`。 |
| `Tabs` | `TabsList` `rounded-full bg-muted p-1`，激活 `bg-background shadow-sm`；`line` 变体保留下划线。 |
| `Label` | `text-sm font-medium`。 |
| `DropdownMenu` | `rounded-[28px] bg-popover shadow-lg`；item `rounded-[16px]` + `focus:bg-primary/10`。 |

共享组件在 `components/common/*`：

| 组件 | 要点 | props |
|---|---|---|
| `PageHeader` | `border-b border-border`，移动端 `flex-col` -> `md:flex-row`，h1 clamp，eyebrow `text-xs font-medium text-muted-foreground`。 | `title` / `eyebrow` / `meta` / `children` / `className` |
| `StatusBanner` | tonal 状态层（info->secondary、notice->accent、warning->warning、error->destructive），`rounded-[16px] p-3`，`role` 按 tone。 | `icon` / `message` / `tone` / `className` |
| `EmptyState` | `rounded-[16px] bg-muted p-4`，icon + title + description。 | `icon` / `title` / `description` / `className` |

用法：优先用原语 / 共享组件，而非手写 Tailwind 卡片。常见替换：

- 卡片 / 面板 -> `Card` 或 `rounded-[24px] bg-card p-6 shadow-sm`。
- 次级块 -> `rounded-[16px] bg-muted p-4`。
- chip / score / 标签 -> `Badge`；数字 -> `font-medium tabular-nums`。
- 列表行 -> `divide-y divide-border` + `transition-colors hover:bg-primary/5`。
- meter / 进度 -> track `bg-muted rounded-full`、fill `bg-primary`（超额 `bg-destructive`），`role=progressbar` + aria。
- 响应式网格 -> `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`。

## 7. 反模式

- ❌ 用纯白 `#FFFFFF` 做背景。
- ❌ 矩形 / 小圆角按钮（必须药丸）。
- ❌ hover 改底色而非状态层（opacity overlay）。
- ❌ 在密集列表 / 详情页堆有机模糊球、玻璃拟态、大留白 hero（落地页技法，工作台不用）。
- ❌ 在 `globals.css` 散落 bespoke 类；样式走 Tailwind 工具类 + token，或下沉为 `components/` 原语。
- ❌ 暗色硬编码 hex；颜色一律走 token。
- ❌ 低于 44×44 的触控目标；无可见焦点环。
- ❌ 情报列表持续运动、阅读正文跟随滚动缩放、动效作为唯一状态提示。

## 8. 响应式规则

必须验证宽度：320 / 375 / 414 / 768 / 1024 / 1440px。

移动端规则：

- 主布局单列；顶部导航可触摸滚动且隐藏滚动条不影响可达性。
- 情报卡片先显示标题、摘要、来源、动作；动作在移动端显示文字标签或同等可理解提示，不只给图标。
- 右侧详情面板下移为详情区或独立页面。
- 所有按钮可触达，最小 44px，考虑 iOS / Android safe area。
- 不出现横向滚动。
- 巨型标题用 `clamp()`，允许换行。
- 响应式网格 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`；移动端缩圆角与 padding。

## 9. 可访问性

- 所有交互元素可键盘访问；`focus-visible` 不被移除。
- 图标按钮必须有 `aria-label`；状态不只靠颜色，需文字或图标辅助。
- 情报来源链接用真实 `<a>`，外链标注清楚（`target=_blank rel=noreferrer`）。
- 表单字段必须有 `Label`（`htmlFor` 关联）。
- meter 用 `role=progressbar` + `aria-valuemin/max/now`。
- 动效尊重 `prefers-reduced-motion`（globals.css 全局降级）。
- 主内容区有明确 landmark：`main`、`nav`、`aside`、`section`。

## 10. 完成标准

一次前端风格改造完成前，至少满足：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm --filter @wangchao/web test`（CSP / summary / error-mapping fixture）
- `pnpm --filter @wangchao/web build`
- `git diff --check`
- 桌面和移动端视觉检查
- 情报流无横向滚动
- 所有按钮可键盘聚焦
- reduced-motion 模式下无持续动效
- `pnpm smoke:web`（需运行时 DB）

## 11. 实施记录

MD3 迁移已完成（从 Kinetic Intelligence 切换）：

1. **Token 重映射**：`globals.css` `@theme` / `:root` 改为 MD3 调色板（暖白 / 紫 / tonal 表面 / outline / 状态 tonal），新增 `--ease-md` 等。保留 `--font-mono`（Geist Mono）。
2. **字体**：`layout.tsx` Geist -> Roboto（next/font/google，400 / 500 / 700），去 `dark` 类。
3. **原语 MD3 化**：`Button`（药丸 + 状态层 + `active:scale-95` + cubic-bezier）、`Card`（tonal 表面 + `rounded-[24px]` + 阴影过渡）、`Input` / `Textarea`（filled field）、`Badge`（chip）、`Tabs`（pill 分段）、`Label`。
4. **新增 `DropdownMenu`**：基于 `radix-ui` `DropdownMenu`，`rounded-[28px]` 菜单 + 状态层。
5. **壳层 + 导航 IA**：`app-shell` async 取 role；`top-nav` MD3 顶栏 + 4 阅读链接 + 新增主题 CTA + 「更多」下拉（管理 / 账户 / 工作区角色门禁 / 登出），登录前路由极简品牌头。
6. **页面迁移**：6 路并行把全站 bespoke 类改写为 Tailwind + MD3 原语（首页 / intelligence、topics、events / briefings / reports / saved、sources / admin-settings、usage / pricing / preferences、共享组件 / loading / error）。
7. **`globals.css` 瘦身**：删除 161 个 orphaned bespoke 类 + 遗留侧边栏 CSS + 废弃 media query + shimmer keyframes；仅保留 `@theme` / `:root` / base / `.sr-only` / `.topic-lab`(+`::before`) / `prefers-reduced-motion`。
