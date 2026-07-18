# Wangchao SPEC Alignment Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan issue-by-issue. Each issue requires an implementation subagent, a SPEC-compliance review, a code-quality review, and parent-agent verification before a local commit.

**Goal:** 将 `wangchao` 的真实实现严格对齐 `SPEC.md`，关闭审计确认的功能缺口、回归、安全错误和文档假完成，并最终达到可验证的多租户持续情报产品契约。

**Architecture:** 先修复凭证、认证、任务队列、租户执行和反馈信号等 P0 基础，再依次闭合采集与治理、评分与去重、个人阅读与偏好、简报与报告、导出、配额支付、平台运营后台。所有长任务统一由可持久化 TaskRun/Worker 执行；所有用户状态按 user scope，业务对象按 organization scope；每项能力均以真实运行证据而非枚举、Schema 或文档存在作为完成标准。

**Tech Stack:** TypeScript, pnpm, Turborepo, Next.js App Router, Prisma/PostgreSQL, Node Worker, Better Auth, OpenAI-compatible AI adapter, Railway Cron, Telegram Bot API.

**GitHub control issue:** [#160](https://github.com/jerryisacat/wangchao/issues/160)

---

## 1. 不可违反的实施规则

1. `SPEC.md` 是产品与开发 source of truth；如实现方案与 SPEC 冲突，先修正方案，不得用现有代码反向削弱 SPEC。
2. 每个 Issue 独立实施、独立验收、独立本地 commit；未经橘猫老师逐次授权不得 push 或部署。
3. 每个 Issue 采用 RED → GREEN → REFACTOR：
   - 先写会失败的 fixture/integration/smoke test；
   - 运行并保存失败证据；
   - 实现最小正确改动；
   - 运行 focused tests；
   - 运行全量门禁；
   - 小咕做 SPEC 审计与代码质量审计；
   - 验收后本地 commit。
4. 子 Agent 只编码，不 commit、不 push、不部署；小咕负责审计整个共享工作树、修复遗漏并创建本地 commit。
5. DB/Worker/Auth/并发功能不能只用 mock 证明：必须增加 disposable PostgreSQL 或真实浏览器集成测试。
6. 新增/修改状态机必须同步：
   - `packages/db/prisma/schema.prisma`
   - `packages/db/prisma/migrations/*`
   - `docs/L2-domain.md`
   - `docs/L3-modules.md`
7. 新增/修改 Worker、命令、环境变量、Railway 调度必须同步：
   - `docs/L3-modules.md`
   - `docs/L4-operations.md`
   - `.env_example`
   - 对应 `deploy/railway/*.railway.json`
8. 前端变化同步 `FRONTEND.md`，并在 320/375/414px 做真实 viewport QA。
9. 每轮固定门禁：

```bash
set -euo pipefail
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
git status --short
```

10. GitHub Issue 只在改动 push/merge 且远程 CI 验证后关闭；本地完成阶段保持 Open，并在最终获准 push 后更新。

---

## 2. 总体依赖顺序

```text
S1 安全/认证/任务底座
  #161 凭证加密 ─────────────→ #179 Telegram 重试
  #153 Auth Schema ─→ #166 路由认证门 ─→ #155 多工作区
  #162 TaskRun 消费 ─────────→ #163 多组织 Worker
  #164 反馈信号契约 ─────────→ #175 反馈 UI ─→ #165 偏好闭环

S2 情报领域正确性
  #176 Source 质量 ─→ #169 Candidate 观察
                    └→ #170 综合评分 ─→ #171 去重
  #168 WEB 采集 ─────────────→ #169 Candidate 观察
  #167 Topic 草案 ───────────→ #170 评分画像契约

S3 用户状态与偏好
  #172 UserItemState ─→ #173 批量已读
                     ├→ #174 历史归档
                     └→ #187 收藏导出
  #164 ─→ #175 ─→ #165

S4 输出与研究
  #170/#176/#165 ─→ #183 结构化简报
  #177 报告状态 + #178 正文证据
  #161 ─→ #179 Telegram 恢复
  #183 ─→ #182 浏览器详情 / #184 时区统计 / #186 导出格式
  #172/#176/#182 ─→ #185 Topic Dashboard

S5 配额、商业化与运营
  #180 effective plan ─→ #181 Source 配额 / #188 广告策略
  #153/#154/#155 ─→ #156 ─→ #157/#158 ─→ #159
  #33 Stripe ───────────────→ #158 完整支付诊断
```

---

## 3. Stage 1 — P0 安全、认证、任务与租户底座

### 实施进度检查点（2026-07-18）

| Task | Issue | 状态 | 已验证提交 |
|---|---:|---|---|
| 1.1 凭证加密 round-trip | #161 | ✅ 已完成并推送 | `5b8f160` |
| 1.2 Better Auth Schema | #153 | ✅ 已完成并推送 | `206088e` |
| 1.3 统一受保护路由门 | #166 | ✅ 已完成并推送 | `7a31100` |
| 1.4 TaskRun claim/lease/consume | #162 | ✅ 已完成并推送 | `8532934` |
| 1.5 主 Worker 多组织化 | #163 | ✅ 已完成并推送 | `4ca9467` |
| 1.6 反馈信号契约 | #164 | ⏳ 待实现 | — |

> 状态只记录已经完成实现、验证并推送的独立任务。Task 1.6 已完成 Issue/SPEC/现有调用链调研，但尚未进入 RED→GREEN 编码，因此不计为完成；Stage 1 exit gate 仍未通过。

### Task 1.1 — #161 修复凭证加密 round-trip

**Objective:** 消除加解密 KDF salt 不一致，恢复所有组织凭证可用性。

**Files:**
- Modify: `packages/db/src/crypto.ts`
- Modify: `packages/db/src/repositories.fixtures.ts`
- Inspect/modify: `packages/db/src/repositories/export.ts`
- Inspect/modify: `packages/db/src/repositories/byok-credential.ts`
- Modify docs: `docs/L2-domain.md`, `docs/L3-modules.md`, `docs/L4-operations.md`, `AGENTS_CHANGELOGS.md`

**Steps:**
1. 在 fixture 中直接调用 `cryptoSmokeTest()`，先验证当前代码失败。
2. 增加 random-salt round-trip、错误 key、tampered ciphertext/tag、旧三段格式测试。
3. 修改 `encryptCredential()`：先生成 salt，再 `deriveKey(encryptionKey, salt)`。
4. 定义四段密文版本兼容/迁移策略；禁止静默吞掉解密错误。
5. 为 AI/Search/BYOK/Telegram/CCPayment repository 增加最少一条真实解密 fixture。
6. 运行 `pnpm --filter @wangchao/db test`，预期全部通过。
7. 运行全量门禁并本地提交：`security:修复组织凭证加解密派生一致性`。

### Task 1.2 — #153 对齐 Better Auth Schema

**Objective:** 使 Better Auth 当前版本、Prisma Schema、migration 和用户生命周期字段完全一致。

**Files:**
- Modify: `apps/web/src/lib/auth.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_align_better_auth_schema/migration.sql`
- Modify: `packages/db/src/repositories/*auth*` 或新增明确 auth repository
- Modify tests: `tests/smoke/auth.spec.ts`, DB fixtures
- Modify docs: L2/L3/L4/CODEGUIDE

**Steps:**
1. 以当前安装的 Better Auth 官方 schema 契约列出必需 User/Account/Session/Verification 字段。
2. 写 migration/schema drift 失败测试。
3. 补齐 `emailVerified`、`image` 及确认需要的 Verification/生命周期字段。
4. 对已有用户定义安全默认值与回填。
5. 使用 disposable PostgreSQL 执行 migration 并验证注册、登录、Session 恢复。
6. 验证不同用户自动创建独立 Organization/Membership。
7. 全量门禁；本地提交：`fix:对齐 Better Auth 与用户生命周期模型`。

### Task 1.3 — #166 建立统一受保护路由门

**Objective:** 所有受保护页面/API/Action 在未登录或 Session 过期时表现一致。

**Files:**
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/src/lib/session.ts`
- Modify: `apps/web/src/app/actions/_shared.ts`
- Modify/create: auth route/layout helpers
- Test: `tests/smoke/auth.spec.ts`

**Steps:**
1. 写 Playwright RED：未登录访问 `/`、`/sources`、`/admin/settings` 应重定向 `/login?next=...`。
2. 写开放重定向攻击测试，拒绝站外 `next`。
3. 实现 Better Auth 官方推荐的 Session 验证门，不能只检查 cookie 是否存在。
4. 统一 Server Component、Route Handler、Server Action 的错误语义。
5. 验证 auth-disabled self-hosted 模式不回归。
6. 全量门禁；本地提交：`fix:统一工作台认证门与登录重定向`。

### Task 1.4 — #162 建立 TaskRun claim/lease/consume

**Objective:** 让 Web 提交的 SOURCE_FETCH/SOURCE_DISCOVERY 长任务真正执行并进入终态。

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create migration for lease/idempotency fields if required
- Modify/create: `packages/db/src/repositories/task-run.ts`
- Modify: `apps/worker/src/index.ts`, `apps/worker/src/modules/fetch-cycle.ts`, `apps/worker/src/modules/discovery.ts`
- Modify: `apps/web/src/app/actions/sources.ts`
- Test: DB concurrency fixtures + worker fixtures

**Steps:**
1. 写真实 PostgreSQL RED：两个消费者并发 claim 同一任务，只能一个成功。
2. 定义 TaskRun 合法状态转换、lease owner、lease expiry、attempt、maxAttempts、idempotency key。
3. 实现原子 claim 与 fenced complete/fail/yield。
4. 让 Worker 消费手动 SOURCE_FETCH/SOURCE_DISCOVERY，并使用任务的 organizationId。
5. 定义 cron 与 manual producer 的去重语义。
6. Web 显示 queued/running/succeeded/failed，而不是只提示“已提交”。
7. 验证崩溃后 stale lease 恢复。
8. 全量门禁；本地提交：`feat:建立 TaskRun 可持久化消费闭环`。

### Task 1.5 — #163 主 Worker 多组织化

**Objective:** 每个有效 Organization 独立完成持续情报闭环。

**Files:**
- Modify: `apps/worker/src/modules/fetch-cycle.ts`
- Modify: `apps/worker/src/modules/discovery.ts`
- Modify: `apps/worker/src/modules/briefing.ts`
- Modify: `apps/worker/src/modules/preference.ts`
- Modify/create: organization scheduling repository
- Test: worker integration fixtures with two organizations

**Steps:**
1. 写两个 Organization 的 RED fixture：当前只有 default org 产生 Event/Briefing。
2. 建立 eligible organization 查询和 per-org cycle orchestration。
3. 为每个组织建立独立错误边界、时间预算、TaskRun 和 UsageEvent。
4. 禁止 dedup/preference/briefing/delivery 读取其他组织数据。
5. 保持默认工作区兼容模式。
6. 验证一个组织失败不阻断另一个。
7. 全量门禁；本地提交：`fix:主 Worker 支持多组织隔离执行`。

### Task 1.6 — #164 修复反馈信号契约

**Objective:** 恢复反馈累积、幂等、增强反馈与真实时间衰减。

**Files:**
- Modify: `packages/db/src/repositories/types.ts`
- Modify: `packages/db/src/repositories/event.ts`
- Modify: `packages/core/src/preference.ts`
- Modify: `apps/worker/src/modules/preference.ts`
- Test: core/db/worker fixtures

**Steps:**
1. 写 RED：同 Topic 三次 DISMISS、跨 Topic DISMISS、同 event replay、旧时间信号。
2. FeedbackSignalRecord 返回 feedbackEventId、eventId、createdAt、topic/source/category/value。
3. 查询纳入所有 SPEC 增强反馈。
4. 按 FeedbackEvent 主键幂等，禁止按空 eventId 跨 Topic 去重。
5. 恢复 30 天半衰期并验证解释中的 signalCount。
6. 全量门禁；本地提交：`fix:修复偏好信号累积与时间衰减`。

**Stage 1 exit gate:** #161/#153/#166/#162/#163/#164 focused tests + 全量门禁全部绿色；真实 crypto、PostgreSQL 并发、登录、多组织 Worker 证据齐全。

---

## 4. Stage 2 — 情报采集、治理、评分与去重

### Task 2.1 — #176 Source 质量持久化与治理

**Files:** `packages/db/src/repositories/source.ts`, `schema.prisma`（如需公式版本/时间字段）, `apps/worker/src/modules/governance.ts`, source fixtures.

**RED/GREEN checklist:**
- [ ] 写 qualityScore 与最新 observation 不一致的失败测试。
- [ ] 定义 hit/noise/duplicate/trust 公式、最小样本和版本。
- [ ] 同事务持久化 Source 当前质量视图与 Observation 历史。
- [ ] 自动建议/降权/静默不得在小样本下误杀。
- [ ] 提供评分、Candidate、调度统一读取 API。
- [ ] focused + full gates；commit `fix:闭合信源质量持久化与治理`。

### Task 2.2 — #168 WEB/公告列表页采集

**Files:** `packages/sources/src/adapters.ts`, 新增 `packages/sources/src/web-source.ts`, `packages/db/src/repositories/source.ts`, `apps/worker/src/modules/fetch.ts`, `fetch-cycle.ts`, fixtures, L3/L4.

**Checklist:**
- [ ] 先写 WEB Source 周期抓取失败测试。
- [ ] 定义统一 SourceAdapter `fetch(source) -> canonical items`。
- [ ] 实现公开网页变更检测和公告列表页 adapter。
- [ ] 接入 registry，RSS/WEB/专用 adapter 走同一调度入口。
- [ ] 复用 SSRF、body size、redirect、encoding、rate limit 防护。
- [ ] 验证重复抓取幂等、新公告进入 Item→content→analysis。
- [ ] commit `feat:接入 WEB 与公告列表页采集`。

### Task 2.3 — #169 Candidate 观察与晋升

**Files:** `apps/worker/src/modules/governance.ts`, `analysis.ts`, `packages/db/src/repositories/source.ts`, candidate fixtures.

**Checklist:**
- [ ] RED：优质 Candidate 观察期结束仍被拒绝。
- [ ] Candidate 内容走隔离的 relevance/quality observation，不进入正式 Event/Briefing。
- [ ] 记录最小样本、命中率、噪声率、重复率和失败率。
- [ ] 实现 APPROVE/OBSERVE/MUTE/REJECT 建议与人工覆盖。
- [ ] 样本不足继续观察，不自动拒绝。
- [ ] commit `fix:重建候选信源观察与晋升闭环`。

### Task 2.4 — #167 自然语言 Topic 草案

**Files:** `packages/core/src/topic-profile.ts`, AI topic-profile generator（新增到 `packages/ai`）, `apps/web/src/app/topics/new/page.tsx`, topic actions/components, fixtures/smoke.

**Checklist:**
- [ ] RED：输入自然语言后直接创建，无法确认草案。
- [ ] 定义版本化 TopicProfileDraft schema 与 parser/sanitizer。
- [ ] 实现 AI 生成 + 明确规则 fallback。
- [ ] 实现生成、预览、逐字段修改、重新生成、确认创建。
- [ ] 未确认不写 Topic/Source。
- [ ] commit `feat:实现自然语言主题草案确认流程`。

### Task 2.5 — #170 分离综合评分维度

**Files:** `packages/ai/src/event-extraction.ts`, `packages/core/src/relevance.ts`, DB event schema/repository, analysis worker, UI explanation, fixtures.

**Checklist:**
- [ ] RED：相关性相同但重要性/来源质量不同，gravityScore 仍相同。
- [ ] 定义 relevanceScore、importanceScore、sourceQualityFactor、preferenceAdjustment。
- [ ] 定义版本化公式和旧事件重算策略。
- [ ] 更新 AI JSON schema、prompt、parser 与 fallback。
- [ ] UI 展示可解释组成，不暴露内部敏感 prompt。
- [ ] commit `refactor:分离情报相关性重要性与综合评分`。

### Task 2.6 — #171 扩大语义去重覆盖

**Files:** `apps/worker/src/modules/dedup.ts`, `packages/core/src/hashing.ts`, `packages/ai/src/semantic-dedup.ts`, event repository, fixtures.

**Checklist:**
- [ ] RED：不同 URL/标题、已读旧事件、别名实体、晚到报道无法合并。
- [ ] 候选召回脱离用户阅读状态。
- [ ] canonical title/entity alias + bounded lookback + budgeted LLM compare。
- [ ] 无 AI 时使用安全 deterministic fallback，不按 URL 隔绝跨源候选。
- [ ] 验证不同 Topic 不误合并、来源完整保留。
- [ ] commit `fix:完善跨源语义去重覆盖与审计`。

**Stage 2 exit gate:** RSS/WEB/Candidate、Source quality、独立评分、跨源去重均有端到端 fixture；candidate 内容无法污染正式简报。

---

## 5. Stage 3 — 用户状态与偏好闭环

### Task 3.1 — #172 UserItemState 用户隔离

**Files:** `packages/db/src/repositories/event.ts`, `schema.prisma`/migration（如需状态调整）, Web data helpers/actions, multi-user DB tests.

**Checklist:**
- [ ] RED：用户 A read/dismiss 后用户 B 信息流变化。
- [ ] 分离 Event 生命周期状态和个人阅读状态。
- [ ] Dashboard/Briefing/history 查询按当前用户状态派生。
- [ ] 迁移兼容旧全局 READ/SAVED/DISMISSED。
- [ ] 两用户真实 DB 测试通过。
- [ ] commit `fix:按用户隔离情报阅读与收藏状态`。

### Task 3.2 — #173 Briefing 批量已读

**Files:** event/briefing repositories, `apps/web/src/app/actions/events.ts`, briefing detail/list components, fixtures.

**Checklist:**
- [ ] 按 briefing snapshot 批量 upsert 当前用户状态。
- [ ] 保留 saved，不产生 N+1。
- [ ] 重复操作幂等，返回 changed/skipped counts。
- [ ] commit `feat:支持简报批量标记已读`。

### Task 3.3 — #174 历史与归档

**Files:** 新增 `apps/web/src/app/history/page.tsx` 或 SPEC 一致路由、event repository pagination、actions/components、FRONTEND/smoke.

**Checklist:**
- [ ] 已读/忽略/收藏/归档分页筛选。
- [ ] 恢复个人状态，不影响他人。
- [ ] 组织级 Event ARCHIVED 与个人状态明确区分。
- [ ] commit `feat:增加个人阅读历史与归档恢复`。

### Task 3.4 — #175 增强反馈 UI

**Files:** `apps/web/src/app/events/[eventId]/page.tsx`, intelligence card/actions/components, preference fixtures/smoke.

**Checklist:**
- [ ] SOURCE_QUALITY_UP/DOWN 与 SCORE_UP/DOWN 可提交。
- [ ] 明确绑定 event/source/topic，防双写。
- [ ] 提交反馈有成功/错误/撤销语义。
- [ ] 320/375/414px 与键盘可访问。
- [ ] commit `feat:补齐来源质量与评分反馈入口`。

### Task 3.5 — #165 PreferenceMemory 全链路消费

**Files:** `packages/core/src/preference.ts`, analysis/briefing/fetch workers, AI prompt context, source repositories, preference UI/tests.

**Checklist:**
- [ ] RED：偏好变化只出现在 Learned Preferences 文本。
- [ ] 定义可解释、版本化 preference snapshot。
- [ ] 应用到 relevance、AI prompt、ranking、briefing selection、source scheduling。
- [ ] 用户编辑/删除后下一轮生效。
- [ ] 保留探索率，避免不可逆 filter bubble。
- [ ] 端到端验证连续反馈后内容明显降权。
- [ ] commit `feat:闭合反馈到采集分析简报的偏好学习`。

**Stage 3 exit gate:** 两用户状态互不影响；增强反馈正确累计；偏好在抓取、分析、排序、简报产生可观察变化。

---

## 6. Stage 4 — 专题报告、简报、Telegram 与 Dashboard

### Task 4.1 — #177 ReportStatus

**Files:** `apps/worker/src/modules/report.ts`, `packages/db/src/repositories/report.ts`, report UI/fixtures.

- [ ] 写不足 3 条证据却 COMPLETED 的 RED。
- [ ] 实现显式 `completeInsufficientReport()` 或终态参数。
- [ ] 校验状态转换与重复执行幂等。
- [ ] UI 显示 coverageNote 与下一步。
- [ ] commit `fix:专题报告正确记录证据不足状态`。

### Task 4.2 — #178 报告正文证据集

**Files:** report repository/worker, Item/Briefing retrieval helpers, report renderer/UI, fixtures.

- [ ] 从 Event、Item.rawContent、Briefing、Source metadata 召回。
- [ ] 去重压缩并保留 evidence IDs/URLs/timestamps/trust。
- [ ] itemCount/briefingCount 使用真实数量。
- [ ] 关键判断关联证据，禁止默认联网补全。
- [ ] commit `feat:专题报告接入可追溯正文证据集`。

### Task 4.3 — #179 Telegram 重试补投

**Files:** `packages/db/src/repositories/delivery-log.ts`, `apps/worker/src/modules/telegram-delivery.ts`, schema/migration（nextAttemptAt/lock 如需）, fixtures/L4.

- [ ] RED：第一次 500 后第二轮永不重试。
- [ ] 查询 FAILED/PENDING/stale SENDING，区分 retryable。
- [ ] attempt 上限、退避、nextAttemptAt、手动补投。
- [ ] SENT 幂等不重复。
- [ ] commit `fix:完善 Telegram 简报重试与补投`。

### Task 4.4 — #183 中文结构化简报

**Files:** `packages/core/src/render-briefing.ts`, `apps/worker/src/modules/briefing.ts`, briefing types/fixtures.

- [ ] 默认 zh-CN，无英文模板残留。
- [ ] 分区展示事件、重要性、影响对象、可信度、后续动作、多来源。
- [ ] Worker 不丢 entities/followUpSuggestion/secondarySources。
- [ ] compact/standard/detailed、detailLevel、maxEvents 都有可观察效果。
- [ ] Preference 真正影响选择。
- [ ] commit `refactor:按 SPEC 重构中文结构化简报`。

### Task 4.5 — #184 业务时区与过滤统计

**Files:** schema/migration for timezone, briefing range helpers/worker/renderer, settings UI, fixtures/docs.

- [ ] Organization timezone + optional User override。
- [ ] UTC/Asia-Shanghai/DST 日周月边界测试。
- [ ] Briefing snapshot 记录 filtered count/reasons。
- [ ] 幂等键基于业务窗口。
- [ ] commit `feat:简报支持业务时区与过滤统计`。

### Task 4.6 — #182 浏览器 Briefing 详情

**Files:** create `apps/web/src/app/briefings/[briefingId]/page.tsx`, repository query, Markdown renderer/components, loading/error/not-found, smoke.

- [ ] 安全阅读完整正文。
- [ ] 提供下载、批量已读、Event 跳转。
- [ ] 跨租户拒绝和 XSS 测试。
- [ ] 移动端截图/DOM QA。
- [ ] commit `feat:增加浏览器简报详情页`。

### Task 4.7 — #185 每主题 Dashboard

**Files:** `apps/web/src/app/topics/[topicId]/page.tsx`, dashboard repositories/components, chart/trend helpers, FRONTEND/smoke.

- [ ] 整合未读 Top、已读/收藏、趋势、信源健康、最近简报。
- [ ] 7/30 天事件/类别/实体/来源质量趋势。
- [ ] 服务端分页与 DB 聚合。
- [ ] mobile viewport QA。
- [ ] commit `feat:实现主题一体化 Dashboard 与趋势`。

**Stage 4 exit gate:** 真实 corpus 报告可追溯；简报中文结构符合 SPEC；Telegram 可恢复；主题 Dashboard 完整可用。

---

## 7. Stage 5 — 导出与知识沉淀

### Task 5.1 — #186 JSON/PDF

**Files:** export routes, `packages/db/src/repositories/export.ts`, 新增 export schema/renderers, PDF assets/fonts, tests/docs.

- [ ] 定义稳定版本化 JSON schema。
- [ ] Event/Briefing/Topic 支持 Markdown/JSON/PDF format。
- [ ] PDF 中文字体、分页、链接、长内容验证。
- [ ] 正确 MIME、filename、ExportEvent.format、UsageEvent/FeedbackEvent。
- [ ] commit `feat:实现 JSON 与 PDF 导出`。

### Task 5.2 — #187 Timeline/Saved collection export

**Files:** export repositories/routes/worker jobs, TaskRun integration, saved state query, tests.

- [ ] 超过 100 条 Timeline 不静默截断。
- [ ] 当前用户 saved 集合严格 user scoped。
- [ ] 大集合进入 Worker，支持状态与失败恢复。
- [ ] 三种格式复用同一 snapshot。
- [ ] commit `feat:支持完整时间线与收藏集合导出`。

**Stage 5 exit gate:** SPEC 中当前目标 Markdown/JSON/PDF 和导出对象均有浏览器/DB 证据；Obsidian URI/Local REST 继续按 SPEC 标注后续增强。

---

## 8. Stage 6 — 权益、配额与支付

### Task 6.1 — #180 effective plan

**Files:** `packages/core/src/quota.ts`, subscription repository, all topic/source/report/export actions, workers, table-driven tests.

- [ ] 建立唯一 entitlement context。
- [ ] 全入口移除直接 stored plan 判定。
- [ ] 明确 ACTIVE/CANCELED/EXPIRED/PAST_DUE/self-hosted。
- [ ] commit `fix:统一全链路有效套餐判定`。

### Task 6.2 — #181 Source quota

**Files:** subscription/source repositories, source/topic actions, discovery worker, DB concurrency tests.

- [ ] 定义 ACTIVE/CANDIDATE 等占用规则。
- [ ] 原子 reserve，避免并发超卖。
- [ ] 自动 discovery 与手工创建同口径。
- [ ] commit `fix:统一信源配额并阻止候选绕过`。

### Task 6.3 — #188 showAdsInSelfHosted

**Files:** SPEC decision, schema/migration, subscription repository, server policy, settings/ads integration tests/docs.

- [ ] 先确认字段仍属于最终契约；若否，修订 SPEC。
- [ ] 若保留，migration + server-derived showAds。
- [ ] 所有 plan/status/self-hosted 组合测试。
- [ ] commit `feat:补齐自用模式广告权益策略`。

### Task 6.4 — #33 Stripe

严格按 #33 完成 SDK checkout、签名 webhook、invoice、订阅状态、幂等、取消与集成测试；不得以 stub 作为完成。

### Task 6.5 — #34 CCPayment 运维文档

按当前真实代码和 CCPayment 官方文档核对后补齐 `docs/L4-operations.md`；不得写入真实凭证/IP 内部信息。

**Stage 6 exit gate:** stored/status/effective plan 一致；并发配额不超卖；Stripe/CCPayment 契约和运维路径可验证。

---

## 9. Stage 7 — 多工作区与平台运营后台

依赖顺序严格复用现有 Issues：

1. #155：工作区设置/平台后台分离与 active workspace。
2. #154：独立 PlatformAdmin RBAC 与不可变 AuditLog。
3. #156：只读用户/Organization 运营后台。
4. #157：账户暂停、Session 吊销与统一授权门。
5. #158：订阅、用量、支付、TaskRun、DeliveryLog、InstantPushLog 诊断。
6. #159：客服备注、临时权益和受控运营操作。
7. #152：完成全部子 Issue 后做总体验收。

**Stage 7 special gates:**
- 平台管理员不能复用 MembershipRole。
- 工作区 OWNER/ADMIN 不能访问跨租户平台数据。
- 所有平台写操作必须有原因、前后值、request ID 和不可变审计。
- 完整凭证、密码、支付 secret 永不展示或写日志。
- 真实 PostgreSQL 权限矩阵、跨租户拒绝、Session 吊销和并发状态测试。

---

## 10. Stage 8 — 专用来源与最终收口

### Task 8.1 — #150 X Post 原文适配器

按现有 Issue 使用官方 X API、最小字段、typed 401/403/404/429、Markdown snapshot 和凭证治理；不使用登录自动化或第三方镜像绕过权限。

### Task 8.2 — #160 全量 SPEC traceability audit

1. 把 SPEC 每个“应/必须/支持/成功标准”映射到：Issue、实现文件、测试、运行证据。
2. 对历史 CLOSED Issues 做反向抽查，防止再次以枚举/Schema/文档代替实现。
3. 运行完整门禁、真实数据库集成、Worker 多租户、Better Auth、Telegram mock、Playwright desktop/mobile。
4. 更新：
   - `SPEC.md`（仅修正现状描述，不削弱目标）
   - `CODEGUIDE.md`
   - `docs/L2-domain.md`
   - `docs/L3-modules.md`
   - `docs/L4-operations.md`
   - `FRONTEND.md`
   - `AGENTS_CHANGELOGS.md`
   - `DEVELOPE_LOGS.md`
5. 生成最终差异报告：所有 SPEC 条款状态必须是 Implemented + Verified，或明确标注 Future/Non-goal 并与 SPEC 一致。
6. 橘猫老师批准后才执行最终 push/部署；部署后验证 Railway Web/Worker/Discovery/Report/Instant Push 服务。

---

## 11. 每个 Issue 的标准执行模板

```text
1. 小咕读取 Issue + SPEC 对应章节 + AGENTS/L2/L3/L4
2. 派发一个窄范围编码 subagent（禁止 commit/push）
3. subagent 写 RED test，返回真实失败输出
4. subagent 实现并跑 focused test
5. 小咕读取完整 diff 和所有改动文件
6. SPEC reviewer 检查是否严格满足条款、是否少做/多做
7. Code-quality reviewer 检查安全、租户、并发、错误处理、测试真实性
8. 修复全部有效问题
9. 小咕复跑 focused test + typecheck/lint/test/build/diff-check
10. 输出验收简报：Issue、改动、测试、风险、工作树
11. 创建本地 commit；不 push
12. 自动进入下一 Issue（用户已授权连续执行时）
```

---

## 12. 风险与控制

| 风险 | 控制 |
|---|---|
| 加密修复使旧密文不可读 | 密文格式版本化、旧格式 fixture、迁移/重新录入策略 |
| 多组织 Worker 超出 Cron 时间 | 每组织预算、公平调度、TaskRun queue、可恢复 lease |
| 偏好过度过滤形成信息茧房 | 最低探索率、硬重要事件下限、解释与用户可编辑 |
| 综合评分变更导致历史排序突变 | 公式版本、影子计算、回填/懒重算、对比报告 |
| UserItemState 迁移破坏旧收藏 | 迁移前快照、双读校验、真实 DB migration test |
| PDF renderer 引入依赖/字体问题 | 固定字体资产、无网络构建、长文/中文 snapshot test |
| Auth/ops 越权 | 独立平台 RBAC、服务端双重授权、真实跨租户拒绝测试 |
| 配额并发超卖 | PostgreSQL 原子 reserve/transaction，不使用 count-then-create |
| Issue “代码存在即关闭”重演 | #160 traceability matrix + 每项运行证据 + 远程 CI 后才关闭 |

---

## 13. 最终完成定义

- [ ] #160 的所有新建和复用子 Issues 完成并远程验证。
- [ ] `SPEC.md` 每个当前目标条款都有源码、测试和真实运行证据。
- [ ] AES 凭证 round-trip、Better Auth、多组织 Worker、TaskRun 并发、用户状态隔离、偏好闭环通过真实集成测试。
- [ ] RSS/WEB/Candidate 采集治理闭环成立，Candidate 不污染正式输出。
- [ ] 评分、去重、简报、报告、Telegram 和导出符合 SPEC。
- [ ] Markdown/JSON/PDF 与 Topic Timeline/Saved Collection 导出可用。
- [ ] effective plan 与所有配额入口口径一致。
- [ ] 平台运营后台具备独立 RBAC、审计和安全处置。
- [ ] 全量门禁、Railway 部署后 smoke、桌面与移动端 QA 通过。
- [ ] 未经授权没有提前 push 或部署。
