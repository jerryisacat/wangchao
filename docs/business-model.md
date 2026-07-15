# 望潮（Wangchao）订阅制商业模型

> 创建于 2026-07-07 | 状态：已规划，待开发
>
> 本文档定义望潮的订阅制商业模型，是后续 Phase 12 商业化基础重构的核心依据。

## 1. 核心价值主张

望潮不是 RSS 阅读器，是**情报节流阀**。用户付费买的是：

- **省时间**：每天几百条信息里，AI 筛出真正相关的 5-10 条，附带"为什么重要"和"要不要继续跟踪"的判断。
- **省认知**：不需要自己判断信息是否重复、来源是否可信、事件是否值得关注。
- **可沉淀**：重要情报不是看完就消失，而是导出到 Obsidian/Notion，形成长期知识资产。

## 2. 计费对象

计费对象为 **Organization**。当前阶段 Organization 与 User 为 1:1 关系，未来多租户时 Organization 可容纳多个 User。

## 3. 三层订阅计划

### 3.1 计划总览

| 维度 | Free | Plus ($9.99/年) | Pro ($19.99/月) |
|------|------|-----------------|-----------------|
| 主题数 | 1 | 5 | 不限 |
| 信源数 | 3 | 25 | 不限 |
| AI 来源 | 官方 | BYOK only | 官方 + BYOK 备援 |
| AI 配额 | 100/天（官方） | 不限（自费） | 20,000/月（官方） |
| BYOK | ❌ | ✅（必填） | ✅（可选） |
| 导出 | 10/月 | 50/月 | 不限 |
| 高分情报即时推送 | ❌ | ✅ | ✅ |
| 广告展示 | ✅ | ❌ | ❌ |

> 广告展示策略详见 §14。

### 3.2 Free 计划

- **定位**：体验产品核心价值，形成使用习惯。
- **限制**：1 个主题、3 个信源、每天 100 次官方 AI 调用、每月 10 次导出。
- **广告**：展示广告（详见 §14），作为变现补充和付费转化杠杆。
- **超额行为**：硬截断，提示升级 Plus 或 Pro。

### 3.3 Plus 计划（$9.99/年）

- **定位**：BYOK（自带 API Key），用户自己承担 AI 成本，解锁更多功能。
- **核心差异**：使用用户自己的 OpenAI-compatible API Key，AI 调用无官方配额限制。
- **限制**：5 个主题、25 个信源、每月 50 次导出。
- **要求**：必须配置有效的 BYOK（API Key + Base URL）。
- **超额行为**：主题/信源/导出硬截断，提示升级 Pro。

### 3.4 Pro 计划（$19.99/月）

- **定位**：全功能，官方 AI + BYOK 备援。
- **AI 策略**：
  - 用量 < 80%（即 < 16,000 次/月）：优先使用官方 AI。
  - 用量 ≥ 80%：切换 BYOK。
    - BYOK 成功 → 使用 BYOK 结果，不消耗官方配额。
    - BYOK 失败 → fallback 官方 AI，消耗官方配额。
    - 未配置 BYOK → 继续官方 AI，配额耗尽后硬截断 + 提示配置 BYOK。
- **限制**：主题、信源、导出均不限。

### 3.5 自用模式

- **定位**：管理员在后台开启自用模式后，系统进入无限制状态，跳过所有订阅计划、配额检查和支付流程。
- **适用场景**：自建部署、内部使用、开发测试。
- **开启方式**：管理员在后台设置页开启 `isSelfHosted` 开关。
- **行为变化**：
  - 所有配额检查跳过（主题数、信源数、AI 调用数、导出数均不限）。
  - BYOK 为可选配置（不配 BYOK 则使用官方 AI，不限量；配了 BYOK 则优先使用 BYOK，失败 fallback 官方 AI）。
  - 前端不再展示计划标签、升级提示、定价页入口。
  - Stripe/ccayment 支付入口隐藏。
  - 广告默认展示（`showAdsInSelfHosted` 默认 `true`），让管理员能亲身感受 Free 用户体验；OWNER/ADMIN 可在后台设置页深层折叠区关闭（详见 §14.3）。
- **安全约束**：
  - 仅 `OWNER` 或 `ADMIN` 角色可开启/关闭自用模式。
  - 开启和关闭操作记录审计日志。
  - 自用模式仅影响当前 Organization，不影响其他组织。

## 4. AI 调用策略详解

```text
Worker AI 分析开始
  ↓
自用模式?
  └── Yes → 跳过配额检查
       ├── BYOK 已配置? → 优先 BYOK，失败 fallback 官方 AI
       └── BYOK 未配置 → 官方 AI，不限量

Free?
  ├── 用量 < 100/天 → 官方 AI
  └── 用量 ≥ 100/天 → 硬截断，提示升级

Plus?
  └── 始终 BYOK（必填，无官方 AI fallback）

Pro?
  ├── 用量 < 80%（16,000/月）→ 官方 AI
  └── 用量 ≥ 80%
       ├── BYOK 已配置?
       │   ├── Yes → 调用 BYOK
       │   │   ├── 成功 → 记录 AI_CALL(source=byok)
       │   │   └── 失败 → fallback 官方 AI，记录 AI_CALL(source=official_fallback)
       │   └── No → 继续官方 AI
       │       ├── 用量 < 100% → 使用官方 AI
       │       └── 用量 ≥ 100% → 硬截断，提示配置 BYOK 或等待下月重置
```

### 4.1 UsageEvent 记录

```json
// 官方调用
{ "source": "official", "model": "gpt-4o-mini", "tokens": 1200 }

// BYOK 调用
{ "source": "byok", "provider": "openai", "tokens": 1200 }

// BYOK fallback
{ "source": "official_fallback", "reason": "byok_timeout", "tokens": 1200 }
```

## 5. 数据模型

### 5.1 新增枚举

```prisma
enum Plan {
  FREE
  PLUS
  PRO
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
}
```

### 5.2 Subscription 表

```prisma
model Subscription {
  id                   String             @id @default(cuid())
  organizationId       String             @unique
  plan                 Plan               @default(FREE)
  status               SubscriptionStatus @default(ACTIVE)

  // 自用模式（跳过所有配额检查和支付流程）
  isSelfHosted         Boolean            @default(false)

  // 自用模式广告展示开关（默认展示，OWNER/ADMIN 可在后台深层折叠区关闭）
  showAdsInSelfHosted  Boolean            @default(true)

  // BYOK（Plus 必填，Pro 可选）
  byokEncryptedKey     String?            // AES-256-GCM 加密的 API Key
  byokBaseUrl          String?            // 用户自定义 endpoint
  byokProvider         String?            // openai / anthropic / custom
  byokKeyHint          String?            // 脱敏显示，如 "sk-...xyz"

  // Stripe
  stripeCustomerId     String?
  stripeSubscriptionId String?

  // ccpayment
  ccpaymentInvoiceId   String?

  currentPeriodStart   DateTime?
  currentPeriodEnd     DateTime?
  canceledAt           DateTime?
  metadata             Json?

  organization         Organization       @relation(fields: [organizationId], references: [id])
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}
```

> **当前实现状态（截至 2026-07-11）：** migration `0010_subscription_plan_auth` 已实现 Plan/SubscriptionStatus、BYOK、CCPayment/Stripe 骨架和自用模式；`0012_instant_push` 新增 Plus/Pro 高分情报即时推送开关与可靠投递审计。系统级 AI/Search 凭证与 per-user BYOK 使用独立字段。

## 6. 配额检查点

所有配额检查采用**硬截断**策略，返回明确提示。

| 操作 | 检查维度 | 位置 | 截断提示示例 |
|------|---------|------|-------------|
| 创建主题 | 主题数 ≤ 计划上限 | Server Action | `"Free 计划最多 1 个主题。升级 Plus 解锁 5 个主题 ($9.99/年)，或 Pro 不限主题 ($19.99/月)"` |
| 添加信源 | 信源数 ≤ 计划上限 | Server Action | 同上 |
| Worker AI 分析 | 本月/日 AI 调用数 ≤ 计划上限 | Worker runAnalysisCycle | 同上 |
| 导出 Markdown | 本月导出数 ≤ 计划上限 | Export route handler | 同上 |

## 7. 支付集成

### 7.1 Stripe

```
前端升级按钮
  ↓
POST /api/billing/checkout        ← 创建 Stripe Checkout Session
  ↓
Stripe 托管支付页
  ↓
Stripe Webhook → POST /api/billing/webhook
  ├── checkout.session.completed    → 升级 Plan
  ├── customer.subscription.updated → 更新周期/状态
  └── customer.subscription.deleted → 降级为 FREE
```

新增环境变量：
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PLUS_PRICE_ID`（年度）
- `STRIPE_PRO_PRICE_ID`（月度）

### 7.2 ccpayment

```
前端选择加密货币支付
  ↓
POST /api/billing/ccpayment/create-invoice
  ↓
ccpayment API 生成支付地址
  ↓
用户钱包转账
  ↓
ccpayment Webhook → POST /api/billing/webhook/ccpayment
  ↓
确认到账 → 升级 Plan
```

具体 API 文档和集成细节待后续确认。

## 8. 前端页面

| 页面 | 路由 | 内容 |
|------|------|------|
| 定价页 | `/pricing` | 三列对比（Free/Plus/Pro），当前计划高亮，升级按钮。自用模式下隐藏 |
| 用量仪表板 | `/usage` | 当前计划、已用量/配额进度条、AI 调用趋势。自用模式下隐藏配额限制 |
| BYOK 设置 | `/settings` | Plus/Pro 用户配置 API Key + Base URL + Provider，脱敏显示 |
| 自用模式设置 | `/settings` | OWNER/ADMIN 可见，开关控制 `isSelfHosted`，开启后确认弹窗。深层折叠区含「广告展示」开关控制 `showAdsInSelfHosted`（详见 §14.3） |
| 升级提示 | 全站 Banner | 超额操作后显示，带跳转 `/pricing` 链接。自用模式下隐藏 |
| TopNav | 全局 | 显示当前计划标签（Free / Plus / Pro）。自用模式下改为"自用"标签

## 9. 安全要求

- BYOK API Key 使用 AES-256-GCM 加密存储，加密密钥来自 `ENCRYPTION_KEY` 环境变量。
- Worker 运行时解密 Key → 注入 adapter → 调用完成后丢弃明文。
- 日志不得输出 Key、Base URL 或任何脱敏片段。
- 前端仅显示 `byokKeyHint`（如 `sk-...xyz`），不返回完整 Key。

## 10. 客户分层

```
个人用户（Free / Plus）
  ├── 关注 1-3 个垂直领域
  ├── 日常阅读 + 少量导出
  ├── 不需要团队协作
  └── 价格敏感

小团队 / 独立研究者（Pro）
  ├── 关注 5-10 个主题
  ├── 需要多人共享情报（未来多租户）
  ├── 导出到知识库是核心需求
  └── 月付 $19.99，愿意为效率付费

企业 / 机构（未来 Enterprise）
  ├── 关注 20+ 个主题
  ├── 需要 SSO、审计日志、专属部署
  ├── 信源治理是核心需求
  └── 年付，议价
```

## 11. 待讨论事项

以下问题已识别但留待后续讨论：

1. Free/Plus/Pro 的最终配额数字（当前为草案）。
2. Pro 无 BYOK 时用量达到 100% 的行为（硬截断 vs 弹性）。
3. BYOK 支持的 Provider 范围（OpenAI-compatible / Anthropic / Gemini）。
4. ccpayment 的具体 API endpoint、认证方式和 webhook 格式。
5. 广告位最终选择和展示频率（详见 §14.6，需结合 AdSense 审核结果和 A/B 数据决定）。
6. 广告 provider 是否从 AdSense 迁移到其他平台（已做抽象，但迁移时机待定）。

## 12. 与 SPEC.md 的关系

本文档是对 `SPEC.md` §6.0（商业化与租户边界预留）和 §9 Phase 7（商业化与多租户基础）的具体化。当本文档与 `SPEC.md` 冲突时，以本文档为准。

## 13. 实施阶段

| 步骤 | 内容 |
|------|------|
| Step 1 | Schema + Migration：Plan/SubscriptionStatus 枚举、Subscription 表、AES 加密工具 **（部分完成，详见下方说明）** |
| Step 2 | 配额引擎：配额常量、检查函数、接入 Server Actions / Worker / Export Routes |
| Step 3 | AI Adapter BYOK 改造：支持 overrideApiKey/overrideBaseUrl、Key 验证端点 |
| Step 4 | Stripe 集成：checkout route、webhook route、环境变量 |
| Step 5 | ccpayment 集成：create-invoice route、webhook route |
| Step 6 | 前端页面：/pricing、/usage、/settings、TopNav 计划标签、超额提示 Banner |
| Step 7 | 广告策略落地：AdProvider 抽象层、GoogleAdSenseProvider 实现、服务端 `shouldShowAds` 判定、广告位组件、自用模式广告开关 UI（详见 §14） |
| Step 8 | 验证：typecheck/lint/test/build + Stripe test mode + ccpayment sandbox + AdSense 审核与 smoke |

### 13.1 Step 1 实现状态

| 子项 | 状态 | 说明 |
|------|------|------|
| Schema + Migration | 完成 | `0010_subscription_plan_auth` 已包含 Plan/SubscriptionStatus/BYOK/支付字段；`0012_instant_push` 增加即时推送权益 |
| AES 加密工具 | 完成 | `packages/db/src/crypto.ts`，提供 `encryptCredential` / `decryptCredential` / `maskKeyHint` |

> **字段边界说明：** `aiEncryptedKey` / `searchEncryptedKey` 是组织级 Admin provider 配置；`byokEncryptedKey` 是订阅用户自己的 AI 凭证，二者互不覆盖。

## 14. Free 计划广告策略

> 创建于 2026-07-15 | 状态：已规划，待实施（Phase 12 商业化基础完成后落地）
>
> 本节定义 Free 用户的广告展示策略。当前规划以 Google AdSense 为首个广告 provider，但实现采用 provider-agnostic 抽象层，未来可替换为其他广告平台。

### 14.1 目标与定位

Free 计划展示广告有两层目的：

1. **变现补充**：Free 用户不付费，广告作为最低门槛的变现方式覆盖部分服务器成本。
2. **付费转化杠杆**：广告打断情报阅读体验，作为「去广告升级 Plus/Pro」的动机之一，与现有的配额限制（主题数/信源数/AI 调用/导出）并列。

**收益预期（诚实声明）**：望潮是垂直情报工具，Free 用户量级小、Dashboard 页面交互多、内容动态，AdSense CPM 大概率偏低（预估个位数美元/月级别）。广告的主要价值不是收入，而是作为 Free→付费的转化杠杆。不应为广告投入过多工程成本，也不应让广告显著破坏核心情报闭环体验。

### 14.2 广告与 Plan 映射

| Plan | 广告默认 | 可关闭 | 关闭入口 |
|------|---------|--------|---------|
| Free | ✅ 展示 | ❌（需升级 Plus/Pro） | — |
| Plus | ❌ 不展示 | — | — |
| Pro | ❌ 不展示 | — | — |
| 自用模式 | ✅ 展示 | ✅（OWNER/ADMIN 可关） | 后台 `/settings` 深层折叠区 |

自用模式默认展示广告是一个刻意的产品决策：管理员（通常是自建部署者）默认能看到 Free 用户的真实体验，不会因为「自用模式无广告」而忽视广告对产品的破坏性影响。如果管理员确定要关闭，需要在后台设置页的深层折叠区手动操作，不作为默认权益。

### 14.3 服务端判定逻辑

广告展示必须由服务端判定，不能只靠前端（前端判定会被绕过，且 SSR 时会向所有访问者渲染广告 DOM，影响 AdSense 合规性和 SEO）。

```
shouldShowAds(orgId):
  1. 读取 org 的 Subscription
  2. 如果 isSelfHosted == true:
     ├── 返回 showAdsInSelfHosted 字段值（默认 true）
     └── 不检查 plan
  3. 否则按 plan 判定:
     ├── FREE 或无有效订阅 → 展示
     └── PLUS / PRO → 不展示
```

判定结果通过 Server Action 或 layout 注入到前端，前端只负责根据标记渲染广告位组件，不做独立判定。

### 14.4 AdProvider 抽象层

实现采用 provider-agnostic 抽象，不把 AdSense 写死在代码里。当前规划以 Google AdSense 为首个实现，未来可替换为其他平台（如碳广告、自售广告、其他 ad network）。

```text
AdProvider 接口
├── injectScript(session)     → 注入广告 SDK 脚本（如 AdSense <script> 标签）
├── renderSlot(slotId, opts)  → 渲染指定广告位
├── shouldShow(orgId)         → 服务端判定是否展示（封装 §14.3 逻辑）
└── 配置：provider 类型、publisher ID、slot 映射

当前实现：GoogleAdSenseProvider
  - publisher ID 通过环境变量 + Admin 后台配置（和 §5.2 API Key 管理一致）
  - slot ID 与广告位映射在代码中维护
```

配置通过环境变量（fallback）+ Admin 后台 `/admin/settings`（主配置）管理，与现有 API Key 凭证管理（§5.2）模式一致：环境变量仅作为 DB 未配置时的 fallback，Admin 后台为主配置方式。

### 14.5 数据模型增量

在 `Subscription` 表新增字段（与 `isSelfHosted` 并列，同属订阅权益聚合根）：

```prisma
// 自用模式广告展示开关（默认展示，OWNER/ADMIN 可在后台深层折叠区关闭）
showAdsInSelfHosted  Boolean  @default(true)
```

此字段仅在 `isSelfHosted == true` 时生效。Free/Plus/Pro 用户的广告展示由 `plan` 字段决定，不需要额外开关。

### 14.6 广告位规划

具体广告位和展示频率在实施时根据 AdSense 审核结果和 A/B 数据决定，当前只列候选位：

| 候选广告位 | 页面 | 形态 | 备注 |
|-----------|------|------|------|
| Dashboard 顶部横幅 | `/topics/[id]` | 横幅 | 收益预期低，AdSense 对登录后动态页面审核可能不通过 |
| 情报列表间插卡 | 信息流 | 原生卡 | 打断阅读，需控制频率（建议每 8-10 条插 1 个） |
| 简报页底部 | `/briefings` | 横幅 | 相对友好，不打断核心阅读 |
| 公开页 | 落地页/博客/帮助页 | 横幅 | AdSense 审核友好，但当前流量小 |

**重要约束**：
- 广告不进入导出内容（Markdown/PDF 导出不得包含广告）。
- 广告不进入简报正文（只在外围页面位置）。
- 移动端广告不得导致横向滚动或遮挡主要操作区域（遵循 `AGENTS.md` §5 移动端规则）。

### 14.7 前置依赖

广告策略落地的技术前置条件：

1. **用户认证 + Organization + Subscription.plan 判定能力**（Phase 12 交付物）——当前还没有真实的多租户认证，无法可靠区分 Free 用户。
2. **服务端 `shouldShowAds(orgId)` 判定**——不能只靠前端。
3. **AdSense 账号审核通过**——AdSense 对工具型/应用型站点审核较严，Dashboard 页面可能不通过，需准备公开内容页作为审核入口。

在以上依赖就绪前，不实施广告策略。

### 14.8 自用模式广告开关 UI

自用模式下的「广告展示」开关放在 `/settings` 页面的深层折叠区：

- 仅 `OWNER` / `ADMIN` 角色可见。
- 位于 `isSelfHosted` 开关下方，默认折叠，需手动展开。
- 标签文案：「广告展示（默认开启，关闭后自用模式不再展示广告）」。
- 开关操作记录审计日志。
- 仅在 `isSelfHosted == true` 时此开关生效；非自用模式下此开关不出现。
