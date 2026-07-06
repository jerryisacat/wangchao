# Wangchao Node.js Refactor Plan

> Created: 2026-07-06
>
> Scope: This document plans a greenfield refactor from the current Python RSS + AI dashboard prototype into a Node.js/TypeScript product architecture aligned with `SPEC.md`.
>
> Important: `SPEC.md` now defines Wangchao as a personal/single-user MVP that should preserve a path toward future commercialization, multi-tenancy, team permissions, and paid plans. The refactor should keep that runway without letting commercial infrastructure block the first usable topic-intelligence loop.

## 1. Decision Summary

Wangchao should move toward a TypeScript-first product architecture:

```text
Next.js web app
  + API and server actions for product workflows
  + polished interactive dashboard

Background worker
  + source fetching
  + AI analysis pipeline
  + briefing and export generation

Postgres database
  + tenant-ready schema
  + durable intelligence, feedback, and source governance records
```

Recommended stack:

| Layer | Choice | Notes |
|------|--------|-------|
| Language | TypeScript | One language for product UI, API, shared business logic, and workers. |
| Package manager | pnpm | Better monorepo ergonomics and deterministic installs. |
| Repository layout | Turborepo monorepo | Keep web, worker, db, AI, and core logic separated but share types. |
| Web app | Next.js App Router | Primary product surface, interactive dashboard, topic management, exports. |
| UI | Tailwind CSS + shadcn/ui + lucide-react | Product-grade interface with reusable components. |
| Database | Postgres | Target database for commercial and multi-tenant readiness. |
| ORM | Prisma | Fast schema iteration, migrations, generated types, good product velocity. |
| Worker | Node.js worker process | Do not run fetching or long AI jobs in request handlers. |
| Queue | BullMQ + Redis initially optional | Introduce when retry/concurrency/delay requirements exceed a simple DB-backed task table. |
| AI integration | OpenAI-compatible adapter | Preserve current provider flexibility instead of hard-coding one vendor. |
| Fetching | RSS parser + undici + cheerio/readability | RSS first, static pages next, Playwright only when truly required. |
| Export | Markdown first, PDF later | Matches the knowledge-base goal and keeps the MVP small. |

## 2. Product And Architecture Principles

1. Theme-first, not source-first.
   - The product entrypoint is creating a topic.
   - Sources are managed by the system as part of source governance.

2. Commercial readiness must be an explicit product decision.
   - The specification now treats commercialization and multi-tenancy as future-stage capabilities, not MVP blockers.
   - Add user, organization, membership, and ownership boundaries early enough to avoid painful migrations.
   - The first usable release can still behave as a single-user product while the schema avoids painful future migrations.

3. Workers own long-running work.
   - Fetching, page extraction, AI filtering, event extraction, deduplication, briefing generation, and source reports must run outside the request lifecycle.
   - The web app reads durable status from the database.

4. Treat the Python prototype as reference material, not a migration constraint.
   - The repository has no active users or production data, so the refactor does not need compatibility bridges or incremental cutover.
   - L1/L2 staged analysis, JSON parsing hardening, gravity ranking, prompt discipline, and safety tests are useful ideas to reimplement where they still fit the new product model.
   - If the old implementation slows the rebuild down, prefer a clean TypeScript implementation over preserving Python behavior exactly.

5. Keep candidate sources clearly separated from trusted sources.
   - Candidate-source content must not silently enter official briefings.
   - Source state and trust metrics are first-class product data.

6. Feedback must change future output.
   - Reading, dismissing, saving, source feedback, category feedback, and export events should all create durable signals.
   - Preference updates must be explainable.

## 3. Target Repository Layout

```text
wangchao/
├── apps/
│   ├── web/                         # Next.js App Router product app
│   └── worker/                      # Background fetch/analyze/briefing worker
├── packages/
│   ├── db/                          # Prisma schema, migrations, database client
│   ├── core/                        # Domain logic: ranking, states, scoring helpers
│   ├── ai/                          # LLM adapter, prompts, response parsing
│   ├── sources/                     # RSS/web source adapters
│   └── ui/                          # Shared UI components if needed
├── legacy-python/                   # Optional archive for old prototype after TypeScript scaffold lands
├── SPEC.md
├── CODEGUIDE.md
├── REFACTOR_PLAN.md
└── CHANGELOG.md
```

Because there are no active users or production data, the implementation may either keep the Python files temporarily for reference or move them into `legacy-python/` early. The new TypeScript app does not need to consume Python output.

## 4. Target Runtime Architecture

```text
User
  ↓
Next.js App Router
  ↓
Server components / server actions / route handlers
  ↓
Prisma
  ↓
Postgres

Worker scheduler
  ↓
Task table or queue
  ↓
Source adapters
  ↓
Item normalization
  ↓
AI pipeline
  ↓
Intelligence events / briefings / preference memory
  ↓
Postgres
```

Use Next.js route handlers for external API surfaces, webhooks, export downloads, and long-poll/status endpoints. Use server actions for normal in-app mutations such as creating topics, editing source status, marking items read, saving events, and submitting feedback.

Database, Redis, and provider SDK clients should be initialized lazily through getter functions so build-time evaluation does not crash when runtime environment variables are unavailable.

## 5. Target Data Model

The new schema should start from the `SPEC.md` entities and include the commercial-readiness boundaries that the updated specification now allows. The first MVP can still behave as a single-user product.

| Model | Purpose |
|------|---------|
| `User` | Human account. |
| `Organization` | Billing and tenant boundary. |
| `Membership` | User-to-organization role mapping. |
| `Topic` | User-created intelligence topic and topic profile. |
| `Source` | RSS/web/source registry entry with source status and quality metrics. |
| `Item` | Raw fetched content normalized from sources. |
| `IntelligenceEvent` | Deduplicated, scored, explainable intelligence unit. |
| `UserItemState` | Read/saved/archived/dismissed state per user and event. |
| `FeedbackEvent` | Raw behavior and explicit feedback. |
| `PreferenceMemory` | Explainable learned topic preferences. |
| `Briefing` | Daily/weekly/monthly generated topic summary. |
| `ExportEvent` | Markdown/PDF/JSON export record and positive-value signal. |
| `SourceObservation` | Candidate-source observation metrics and review evidence. |
| `TaskRun` | Durable worker task status, retries, errors, and timing. |

Important schema rules:

- Tenant-owned models should include `organizationId`.
- User-specific state should include `userId`.
- Topic-scoped intelligence data should include `topicId`.
- Raw LLM responses and source metadata should be stored as JSON for auditability, but core status and score fields must remain queryable columns.
- URLs should be canonicalized before uniqueness checks.

## 6. Greenfield Rebuild Strategy

Because this is a forked application with no current users, no production data, and no compatibility obligations, the refactor can be a clean rebuild instead of a careful migration.

Use the current Python implementation as a reference for useful behavior:

1. Product shape: theme-first intelligence workflow from `SPEC.md`.
2. AI shape: staged filtering, scoring, deduplication, and briefing.
3. Safety shape: parse LLM output defensively, keep long jobs out of request handlers, and make worker tasks bounded.

Do not build a Python bridge unless a specific future need appears. The new Next.js app should read from the new Postgres/Prisma data model directly.

The first real milestone should be a single-topic closed loop:

```text
Create topic
  → attach RSS source
  → worker fetches items
  → AI creates intelligence events
  → dashboard shows unread events
  → user marks read/saved/dismissed
  → user exports Markdown
```

Reference behaviors worth reimplementing:

- L1/L2 staged processing.
- OpenAI-compatible provider configuration.
- JSON response sanitization and fallback parsing.
- Event deduplication where merged/dropped items do not enter ranking.
- Gravity ranking semantics.
- Per-cycle or per-job limits to prevent AI/API failure loops.
- Frontend escaping or equivalent trusted rendering guarantees.

## 7. Phase Plan

| Phase | Goal | Main Work | Exit Criteria |
|------|------|-----------|---------------|
| 0 | Planning and specification alignment | Confirm Node.js direction, keep `SPEC.md`, `CODEGUIDE.md`, this plan, and architecture decisions aligned as commercial-readiness scope evolves. | `SPEC.md`, `CODEGUIDE.md`, and this plan agree on target architecture and commercial-readiness scope. |
| 1 | Monorepo foundation | Add pnpm workspace, Turborepo, TypeScript config, lint/format/typecheck/build scripts, empty `apps/web`, empty `apps/worker`, and core packages. | `pnpm build` and `pnpm typecheck` pass on empty scaffold. |
| 2 | Database foundation | Add Prisma/Postgres schema for SPEC models plus approved ownership boundaries, migrations, seed data, lazy database client, and query helpers. | Local Postgres migration and seed succeed; test topic/source/event queries pass. |
| 3 | Product shell and design system | Build the first Next.js app shell, navigation, theme tokens, shadcn/ui setup, dense dashboard layout primitives, and empty/loading/error states. | The app has a polished product frame before feature screens expand. |
| 4 | Topic and source MVP | Implement topic CRUD, topic profile fields, manual RSS source attachment, source status basics. | A user can create a topic and attach an active RSS source in the web UI. |
| 5 | Worker fetch pipeline | Implement worker scheduler, RSS fetching, item normalization, URL canonicalization, deduplication, source fetch status, task errors, retries, attempt limits, and idempotency. | TypeScript worker can fetch items into Postgres for one topic/source. |
| 6 | AI adapter and parser | Implement OpenAI-compatible adapter, retry behavior, JSON mode fallback, response sanitization, schema validation, and malformed-output recovery. | TypeScript tests cover LLM adapter/parser failure modes. |
| 7 | AI intelligence pipeline | Implement relevance/noise filter, event extraction/scoring/summary/deduplication, and gravity ranking. | Worker creates ranked `IntelligenceEvent` records from fetched `Item` records. |
| 8 | Dashboard MVP | Build topic dashboard, unread list, event detail, source display, loading/empty/error states, read/save/dismiss actions. | Static `index.html` is no longer needed for primary reading workflows. |
| 9 | Feedback and preference memory | Add feedback controls, raw feedback records, preference delta generation, ranking/prompt integration, explanation strings. | Repeated feedback changes ranking/filter behavior and is visible in topic preference history. |
| 10 | Briefing and Markdown export | Generate daily topic briefing, single-event Markdown export, daily briefing Markdown export, export records. | User can export an event or daily briefing in Obsidian-friendly Markdown. |
| 11 | Source governance | Add candidate/active/muted/rejected flows, source observations, hit-rate/noise/duplicate metrics, source quality report. | User can review candidate sources and approve/reject/mute them. |
| 12 | Commercial readiness layer | Add auth provider, organization switching, roles, usage logs, billing placeholders, rate/usage boundaries. | Data access is tenant-scoped and test-covered even if billing is not live. |
| 13 | Deployment and operations | Add deployment docs, environment templates, worker process docs, health checks, logs, error reporting, backup guidance. | Web and worker can be deployed with documented env vars and health checks. |
| 14 | Legacy cleanup | Archive or remove old Python prototype files once they stop being useful as reference material. | The repository's primary product path is TypeScript-only. |

## 8. Phase Dependencies

```text
Phase 0
  ↓
Phase 1
  ↓
Phase 2
  ↓
Phase 3
  ↓
Phase 4
  ↓
Phase 5
  ↓
Phase 6
  ↓
Phase 7
  ↓
Phase 8
  ↓
Phase 9
  ↓
Phase 10
  ↓
Phase 11
  ↓
Phase 12 / Phase 13
  ↓
Phase 14
```

Commercial readiness should influence the schema from Phase 2, but full auth, billing, and tenant administration do not need to block the single-topic MVP.

## 9. Current Python Reference Value

The existing Python files are reference material for product behavior and edge cases. They should not constrain the new architecture.

| Current module | Reference value | New-stack direction |
|---------------|-----------------|---------------------|
| `sources/rss.py` | RSS item normalization shape. | Reimplement in `packages/sources`. |
| `sources/manager.py` | Basic source iteration concept. | Replace with worker task execution over `Source` rows. |
| `database.py` | Current single-table constraints and status fields. | Replace with Prisma models, migrations, and query helpers. |
| `config.py` | Required env variable categories. | Replace with typed TypeScript env validation split by web/worker. |
| `ai_service.py` | OpenAI-compatible provider flexibility, retry, timeout, JSON mode fallback. | Reimplement in `packages/ai`. |
| `response_utils.py` | Defensive LLM output cleanup and recovery ideas. | Reimplement with typed schema validation and fixtures. |
| `processors/l1_filter.py` | Staged relevance/noise filter idea. | Rebuild as topic-aware intelligence stage. |
| `processors/l2_scorer.py` | Event summary/scoring/deduplication idea. | Rebuild as event extraction and briefing stage. |
| `ranking.py` | Gravity ranking formula. | Reimplement in `packages/core`. |
| `main.py` | Bounded long-running loop risk. | Replace with worker scheduler, retry limits, and task status. |
| `index.html` | Minimal dashboard content expectations. | Replace with Next.js product UI. |
| `prompts/*.md` | Prompt baseline and output schema examples. | Convert into versioned topic-aware prompt templates. |
| `tests_*` | Important edge cases and safety checks. | Recreate as TypeScript tests where still relevant. |

## 10. Testing And Validation Plan

| Area | Tests |
|------|-------|
| Database | Prisma migration tests, seed tests, tenant-scope query tests. |
| Source fetching | RSS parser fixtures, URL canonicalization, duplicate handling, failed-source retries. |
| AI parsing | JSON fence cleanup, malformed JSON recovery, schema selection, empty response handling. |
| AI pipeline | L1/L2 fixture tests with mocked model responses. |
| Ranking | Gravity ranking formula and edge-case tests. |
| Feedback | Feedback-to-preference delta tests and ranking impact tests. |
| UI | Component tests for dense dashboard states; Playwright checks for topic creation and feedback flow. |
| Worker | Task retry, idempotency, per-cycle limits, error logging, and stuck-task recovery. |

Minimum gate for the first TypeScript MVP:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
worker fixture run
Playwright single-topic smoke test
```

## 11. Major Risks

| Priority | Risk | Mitigation |
|----------|------|------------|
| P0 | Commercial infrastructure bloats the MVP and delays the core topic-intelligence loop. | Keep commercial readiness in schema and boundaries, but defer full auth, billing, and team administration to Phase 12. |
| P0 | Greenfield rebuild drifts away from the product goal and becomes a generic news dashboard. | Keep `SPEC.md` as the source of truth and build around topics, intelligence events, feedback, and source governance from day one. |
| P0 | Multi-tenant boundaries are forgotten after the direction is approved. | Add organization/user ownership in Phase 2 even if full auth arrives later. |
| P0 | Long-running fetch/AI jobs run inside Next.js requests. | Worker owns all long tasks; web only enqueues and reads status. |
| P1 | Worker implementation repeats the old infinite-loop failure mode. | Model attempt limits, dead-letter state, idempotency locks, and retry caps in `TaskRun` or BullMQ. |
| P1 | Source governance is delayed too long and RSS remains the real product model. | Introduce `Source.status` and source registry in Phase 3, before auto-discovery. |
| P1 | UI polish absorbs effort before the data loop is real. | Build a polished but narrow single-topic dashboard first. |
| P1 | AI output contracts drift during rebuild. | Version prompt templates and add fixture-based parser tests. |
| P1 | Postgres migration increases local setup friction. | Provide one-command local setup with Docker Compose or a documented managed Postgres option. |
| P2 | PDF export distracts from knowledge-base value. | Ship Markdown first; postpone PDF until briefing quality is stable. |
| P2 | Queue infrastructure is introduced too early. | Start with a `TaskRun` table; add Redis/BullMQ when retry and scheduling requirements justify it. |

## 12. Documentation Updates Required

When implementation starts, update docs in the same change:

- `SPEC.md`: commercial-readiness and target runtime changes when product scope evolves.
- `CODEGUIDE.md`: new monorepo layout, commands, data flow, worker flow, test commands.
- `README.md` / `README-en.md`: new setup and product positioning.
- `.env_example`: split web/worker/database/AI variables.
- `CHANGELOG.md`: every meaningful phase delivery.

## 13. Open Decisions

| Decision | Default | Alternatives |
|----------|---------|--------------|
| Auth provider | Auth.js or Clerk | Custom auth later, Supabase Auth, Better Auth. |
| Initial queue | DB-backed `TaskRun` table | BullMQ + Redis from day one, Inngest. |
| Deployment | Vercel for web, separate worker host | Fly.io/Railway/VPS full-stack, self-hosted Docker Compose. |
| UI package | Keep components in `apps/web` first | Promote to `packages/ui` when reuse appears. |
| ORM | Prisma | Drizzle if SQL control becomes more important than migration speed. |
| Legacy placement | Move old Python into `legacy-python/` after scaffold | Delete it outright if it stops being useful. |

## 14. Sub-Agent Feasibility Review

An independent read-only sub-agent reviewed this plan direction against the current codebase and documents.

The review was performed under a more conservative migration assumption. After the product decision that there are no active users or production data, the accepted conclusion is adjusted as follows:

- The Node.js/Next.js technical direction is compatible with `SPEC.md` because the current Python implementation is explicitly described as a prototype engine.
- The original review found a SPEC conflict because commercialization and multi-tenancy were listed as non-goals. That conflict has been resolved by updating `SPEC.md` to treat them as future-stage capabilities rather than MVP blockers.
- Python does not need a bridge or gradual cutover. It remains useful only as reference material for RSS, L1/L2 AI, deduplication, gravity ranking, JSON output, response parsing, and runtime-safety behavior.
- The highest-risk rebuild areas are the `news` single-table replacement, topic-aware prompt/profile model, feedback-to-preference model, and worker retry/idempotency semantics.

Accepted optimizations after the greenfield decision:

1. Keep Phase 0 for ongoing specification and architecture alignment.
2. Do not add a Python bridge unless a concrete need appears.
3. Split AI work into adapter/parser implementation and pipeline implementation.
4. Treat current parser, ranking, L1/L2, and runtime-safety behavior as useful references, not exact parity requirements.
5. Delay full commercial/auth/billing work until after the single-topic product loop is stable.
