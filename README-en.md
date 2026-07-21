# Wangchao

[中文](README.md) | [Website](https://wangchao.jerryiscat.one) | [MIT License](LICENSE)

`Wangchao` is a **theme-driven personal AI intelligence workspace**. You simply tell the system what topics you care about, and it fetches public information around those topics, filters out noise, generates structured intelligence events, and — through your reading and feedback — increasingly understands what you actually want to see.

It is not an RSS reader, nor a news aggregator. The core entry point is the **topic**, not the source.

> **Don't want to self-deploy?** You can use our hosted platform directly: **[wangchao.jerryiscat.one](https://wangchao.jerryiscat.one)** — up and running out of the box, no server, database, or worker configuration required. Of course, if you prefer full control over your data and environment, you can always self-deploy following the guide below.

> **This is an open-source project (MIT License).** Code, docs, data models, worker pipeline, and frontend are all public. Commercialization only covers server costs — buying the maintainer a coffee, not a product storyline.
>
> **You are especially welcome to customize this repo with your AI Agent.** Fork it, then have Claude Code, Cursor, Copilot, or any coding agent adapt it to your domain, sources, preferences, and deployment environment. `AGENTS.md` defines AI Agent collaboration rules and a document reading protocol, `CODEGUIDE.md` is the L0/L1 architecture overview, and `docs/` organizes domain models, module details, and operations by L2-L4 layers, helping agents understand the repo by abstraction level.
>
> ---
>
> ⚠️ **This repository is under active development and has not reached a stable, production-ready state.** APIs, schemas, UI, and worker pipelines may still undergo breaking changes. If you're interested in theme-driven AI intelligence systems, welcome to Star, Fork, open Issues and PRs to build together.

## What is this repo for

This repo may be useful if any of the following apply to you:

- You follow a specific domain long-term (commercial aviation, semiconductors, a particular policy, an open-source ecosystem) and need to sift through piles of RSS feeds, announcements, and news every day to find what's actually worth reading.
- You want the system to filter out marketing pieces, flight delays, hiring gossip, and other noise — leaving only "what happened and why it matters."
- You want your read / save / dismiss / not-interested actions to train the system in return, instead of seeing the same low-value content every day.
- You want to沉淀 important intelligence into Markdown / Obsidian, not just let it vanish in the daily feed.

The current version is a **personal / single-user** edition. The primary deployment path is **GitHub auto-sync to Railway**: Railway hosts the Web service, Worker Cron, Source Discovery Cron, and managed Postgres. Multi-tenancy, team permissions, and payment systems are later phases and don't block the current experience.

## How sources enter the system

Wangchao's sources are not a one-time fixed RSS list — they follow a **source governance lifecycle**. Each source is in one of these states:

| State | Meaning |
|------|------|
| `seed` | Initial seed source, created via `WANGCHAO_SEED_SOURCE_*` env vars or manually, high trust |
| `candidate` | Candidate source — observed first, not directly included in official briefings |
| `active` | Approved source — Worker fetches it, output enters the official intelligence stream |
| `muted` | Noisy source — paused or low-frequency fetching |
| `rejected` | Explicitly rejected — no longer recommended |

**Current implementation** entry paths:

1. **Seed sources**: At deploy time, the seed script reads a multi-topic source list (priority: `WANGCHAO_SEED_SOURCE_NAME`+`WANGCHAO_SEED_SOURCE_URL` legacy single-source mode > `WANGCHAO_SEED_SOURCES_URL` > in-repo `packages/db/seed-sources.json`), creating listed sources directly as `ACTIVE`. The default `WANGCHAO_SEED_SOURCES_URL` points to this repo's raw link; on fetch failure it falls back to the locally bundled file. Re-seeding does not reset source states or topic profiles you've modified in the UI.
2. **Auto-candidate on topic creation**: On the "New Topic" page, you only fill in a topic name and description. The Web app generates an initial topic profile and matches against `packages/db/seed-sources.json` for verifiable RSS/Atom feeds. Verified sources are written to the `candidate` observation pool with `SourceObservation.evidence`; even if no candidates are found, the topic is created successfully.
   After creation, you can maintain keywords, entities, include/exclude scope, importance rules, language preferences (output language + terminology rules), and briefing style (structure + detail level + max events) directly in the edit page. The rule fallback uses keywords/entities/include-scope as positive signals and lets exclude-scope veto first; importance rules are AI-only. Keywords also feed source discovery, while the full profile feeds AI event extraction; the topic's name/description are passed from the current Topic record — not from a potentially stale profile copy. Language preferences control the AI event extraction output language (zh/en); briefing style controls the Markdown briefing structure (standard/detailed/compact) and event count.
3. **Candidate sources**: Submit an RSS URL via the form on the "Source Management" page, or click "Discover New Sources" to trigger automatic discovery — both enter the `candidate` observation pool.
4. **Approve / Mute / Reject**: Perform governance actions on candidate sources from the "Source Management" page. State transitions write to `SourceObservation` and `FeedbackEvent` for traceability.
5. **Quality observation**: After each fetch cycle, the Worker computes hit rate / noise rate / duplicate rate for each source based on real Item ↔ EventItem relationships; primary/secondary both count as valid hits, secondary merged coverage counts toward duplicate rate, and archived old events are not double-counted. Snapshots are written to `SourceObservation` as the basis for governance decisions.
6. **Auto discovery**: `runSourceDiscoveryCycle()` supports three channels — keyword search for RSS, high-score intelligence full-text reverse lookup, and active source outlink networks. Candidate sources come with recommendation reasons, relevance scores, discovery channels, and `TaskRun` / `UsageEvent` audit records. Without `BRAVE_SEARCH_API_KEY`, keyword search is skipped but other channels proceed.

**Important boundary**: Content from `candidate` / `muted` / `rejected` sources **does not** enter official fetching and briefings — it must first be approved to `active`.

## How unread intelligence is filtered and recorded

From RSS raw text to the unread card on the Dashboard, intelligence passes through a deterministic Worker pipeline. Each `runFetchCycle()` executes the following steps:

```text
1. Fetch       Worker lists all ACTIVE sources, fetches RSS/Atom concurrently
               (exponential backoff retry), each source writes a TaskRun audit;
               failures tracked to Source.lastError
   ↓
2. Store       RSS items are normalized and upserted to the Item table (status=FETCHED)
               Deduplicated by contentHash, rawMetadata preserved
               content:encoded extracted as rawContent first (zero-cost full text)
   ↓
2b.Full text   runArticleFetchCycle() async-fetches full article text for Items
               without rawContent, using Readability + linkedom; failures don't
               block the main pipeline. AI prompt prefers full text when
               rawContent is available (truncated to 8000 chars)
   ↓
3. Relevance   Each FETCHED item gets an AI_RELEVANCE TaskRun
               When AI is configured, OpenAI-compatible event extraction is preferred
               Falls back to evaluateRelevance() explainable rules when not configured
               or on failure; irrelevant → markItemFiltered(), status=FILTERED
   ↓
4. Extract     AI path creates AI_EVENT_EXTRACTION TaskRun; success/failure persisted
               createIntelligenceEventDraft*() generates intelligence event drafts:
               - title / summary / category(keyword match) / entities / followUpSuggestion
               - eventHash(title+url normalized) as dedup key
               - gravityScore = baseScore × time decay factor (newer = higher)
               - Language preferences control output; topic name/description passed to AI
   ↓
5. Write       upsertIntelligenceEventFromItem() idempotent write by topicId+eventHash
               Title fuzzy match merges into existing event (maintains unique PRIMARY EventItem)
               IntelligenceEvent(status=UNREAD), Item status=ANALYZED
   ↓
6. Dedup       runSemanticDedupCycle() uses LLM semantic comparison to merge near-
               duplicate events (48h window, entity pre-filter, confidence ≥0.7)
   ↓
7. Preference  runPreferenceLearningCycle() aggregates recent FeedbackEvents
               (with time decay) into PreferenceMemory (explainable weight + confidence)
   ↓
8. Briefing    runDailyBriefingCycle() + runPeriodBriefingCycle()
               Generates daily/weekly/monthly Markdown briefings per topic
               (UTC window idempotent upsert); BRIEFING_GENERATION TaskRun per topic;
               no-events also records a skipped result; briefing style controls
               structure and event count
   ↓
9. Sources     runSourceGovernanceObservationCycle() snapshots source quality metrics
```

**Key design points**:

- The intelligence pipeline uses **explainable rules** as fallback (keyword/entity/include-scope positive signals + exclude-scope veto + time decay + feedback weight); when AI is configured, LLM takes priority. Rule decisions save matched signals/noiseReason; `packages/ai` provides the OpenAI-compatible boundary, with source recommendation and semantic dedup already integrated.
- TaskRun is not just a schema placeholder: fetch/discovery, relevance, AI event extraction, briefing, and Markdown export all record RUNNING → SUCCEEDED/FAILED; even when a rule fallback lets the cycle continue after an AI request failure, the failed extraction TaskRun and actual AI_CALL usage are retained.
- Full-text extraction: RSS `content:encoded` is extracted as `rawContent` first (zero-cost); when missing, the Worker async-fetches the full article text using Readability + linkedom. The AI prompt prefers full text when `rawContent` is available (truncated to 8000 chars).
- The Dashboard main list only shows `UNREAD` and `SAVED` events; `READ` and `DISMISSED` are hidden from the main feed by default.
- Dashboard ranking = `gravityScore` base × `PreferenceMemory` weight. Your feedback directly affects the next ranking — it's not just recorded.
- Daily/weekly/monthly briefings only use events created within the UTC window, from `ACTIVE` sources, with status `UNREAD` / `READ` / `SAVED`; read status doesn't exclude from briefings; `DISMISSED` / `ARCHIVED` are not included.

## How user feedback shapes the system

Each intelligence item supports: read / save / dismiss / export; the detail page also provides "more like this / less like this" and source quality feedback (SOURCE_QUALITY_UP/DOWN). State actions synchronously write `IntelligenceEvent`, `UserItemState`, and `FeedbackEvent`; category preference actions only write `CATEGORY_UP` / `CATEGORY_DOWN` feedback — they don't accidentally modify event status or source weights.

The "Saved" page queries the complete saved collection directly by the current user's `UserItemState.saved=true`, paginated — it doesn't depend on the homepage's 30-item limit. Marking as read does not unsave; only an explicit "unsave" removes from the collection, and it is not recorded as negative feedback.

```text
SAVE / EXPORT       →  Increase category / source weight (+2 signal)
READ                →  Slight increase (+0.5)
DISMISS             →  Decrease weight (-2)
CATEGORY_UP         →  Increase category weight in current topic only (+2)
CATEGORY_DOWN       →  Decrease category weight in current topic only (-2)
SOURCE_QUALITY_UP   →  Increase source quality rating
SOURCE_QUALITY_DOWN →  Decrease source quality rating
MORE_LIKE_THIS      →  Strengthen current event features (entities/category/source)
LESS_LIKE_THIS      →  Weaken current event features
```

The Worker's `runPreferenceLearningCycle()` aggregates these signals into `PreferenceMemory`, each with an explainable `explanation`, and applies a **30-day half-life time decay** — more recent feedback has more impact, old feedback gradually fades. Preference memory can be viewed and manually edited (adjust weights or delete) on the "Preferences" page.

The Dashboard reads `PreferenceMemory` at render time and applies a weight multiplier (0.4× ~ 1.6×) to `gravityScore`. Preferences are isolated by `topicId + key` — same-named categories don't cancel across topics; after you dismiss or explicitly downweight a type of content multiple times, it will be noticeably deprioritized.

## Topic reports and message delivery

Beyond daily/weekly/monthly briefings, Wangchao also supports:

- **Topic reports**: On the "Reports" page, ask a natural-language question (e.g., "C919 delivery progress in the last half year"). The system retrieves relevant events from the intelligence library as evidence and generates a structured Markdown report. Report generation is an async task executed by the Worker; the rule path summarizes via evidence retrieval, the AI path adds deeper analysis.
- **Telegram delivery**: Admins can configure briefing delivery; Plus, Pro, and self-hosted mode can also enable high-score instant push with durable delivery auditing.
- **Manual summary regeneration**: “Recapture” creates a durable single-event task; the next Worker run prioritizes it, recaptures the article, and regenerates the summary, while duplicate active requests reuse the same task.

## Current Status

> ⚠️ **This repository is under active development and has not reached a stable, production-ready state.** APIs, schemas, UI, and worker pipelines may still undergo breaking changes.

| Area | Status |
|---|---|
| Stability | Active iteration, API/Schema may change, no backward compatibility promise |
| Main stack | TypeScript, pnpm, Turborepo, Next.js App Router, Prisma, Postgres, Node.js worker |
| Web | Topic creation (with profile editing: keywords/entities/include-scope/exclude-scope/importance rules/language preferences/briefing style), candidate source discovery, intelligence feed, event detail (with manual summary regeneration, more/less like this, source quality feedback), read/save/dismiss, preference memory (editable weights + time decay), topic timeline, briefing center (daily/weekly/monthly filter), single/briefing/batch Markdown export (Obsidian-friendly filenames), source governance, topic reports (natural-language question → async generation), Telegram delivery settings, OWNER/ADMIN workspace membership and 30-day usage audit, `/api/health` |
| Worker | RSS fetch (concurrent + exponential backoff + error tracking), item writes, full-text article extraction (Readability), deterministic + AI intelligence pipeline, preference learning (6 FeedbackKinds + 30-day half-life time decay), daily/weekly/monthly briefing (UTC window idempotent), topic report generation (rule + AI evidence retrieval), Telegram delivery, source quality observation, structured logging (Railway-consumable), `--health` |
| Database | Prisma schema, versioned migrations, seed, workspace models, TaskRun (full-pipeline audit), UsageEvent, DeliveryLog, Report |

The personal edition has completed Railway Web + Postgres deployment verification. The deployment target is GitHub auto-sync triggering Railway Web, Worker Cron, and Source Discovery Cron. The Worker is still designed as "one cycle then exit," launched on schedule by Railway Cron.

## Deployment

> 💡 **Tip**: If self-deployment feels like too much hassle, you can use our hosted platform directly: **[wangchao.jerryiscat.one](https://wangchao.jerryiscat.one)** — just sign up and start using it, no infrastructure to manage. The instructions below are for users who want to self-deploy and customize.

The repo uses **GitHub → Railway** as the primary deployment path:

| Railway service | Config file | Purpose |
|---|---|---|
| Web | `deploy/railway/web.railway.json` | Next.js product UI, Server Actions, export routes, `/api/health` |
| Worker Cron | `deploy/railway/worker-cron.railway.json` | Scheduled RSS fetch, analysis, briefing, source observation |
| Source Discovery Cron | `deploy/railway/source-discovery-cron.railway.json` | Periodic candidate source discovery |
| Postgres | Railway managed Postgres | Prisma database, migrations, seed, and runtime data |

Ongoing development is designed around Railway capabilities: Config as Code for build/start/health/cron, Railway Cron for one-shot workers, managed Postgres for data, and Railway healthcheck, logs, rollback, backup/PITR for ops. Unless otherwise stated, README and ops docs do not treat other platforms as first-class deployment targets.

## Architecture

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

Repository layout:

```text
apps/
  web/                 Next.js App Router product UI
  worker/              Background fetch, analysis, briefing, health checks
packages/
  db/                  Prisma schema, migrations, seed, repository boundary
  core/                Domain logic, ranking, preferences, Markdown rendering
  ai/                  OpenAI-compatible adapter and parser
  sources/             RSS/source adapter
  ui/                  Shared UI package
docs/
  L2-domain.md         L2 domain model, state machines, glossary
  L3-modules.md        L3 module details, key files, call chains
  L4-operations.md     L4 commands, env vars, deployment, testing
  deployment.md        Railway deployment and operations guide
  railway-deployment.md  Complete Railway deployment guide
  railway-runbook.md   Railway ops runbook (Cron, backup, rollback, env var matrix, CI)
  business-model.md    Subscription business model (Free/Plus/Pro plans)
```

## Quick Start

You need Node.js, pnpm, and Postgres.

```bash
pnpm install
cp .env_example .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Common verification commands:

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm test
pnpm worker:health
```

Web health endpoint:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

## Environment Variables

`.env_example` provides placeholder templates. Do not commit real secrets or database credentials.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `WANGCHAO_DEFAULT_ORGANIZATION_SLUG` | Default workspace slug |
| `WANGCHAO_DEFAULT_ORGANIZATION_NAME` | Default workspace name |
| `WANGCHAO_DEFAULT_USER_EMAIL` | Default user email |
| `WANGCHAO_DEFAULT_USER_NAME` | Default user name |
| `WANGCHAO_SEED_SOURCES_URL` | URL for multi-topic source list JSON (Gist raw or any public JSON). When empty, defaults to this repo's raw link; on failure falls back to `packages/db/seed-sources.json` |
| `WANGCHAO_SEED_SOURCE_NAME` | Legacy single-source mode: seed source name. Takes effect when set together with `WANGCHAO_SEED_SOURCE_URL`, priority over list |
| `WANGCHAO_SEED_SOURCE_URL` | Legacy single-source mode: seed source RSS URL |
| `AI_BASE_URL` | OpenAI-compatible API endpoint |
| `AI_API_KEY` | AI provider API key |
| `AI_MODEL_L1` / `AI_MODEL_L2` | AI pipeline default model config; source recommendation uses `AI_MODEL_L1` |
| `BRAVE_SEARCH_API_KEY` | Brave Search API BYOK; when empty, source discovery skips keyword search |
| `WANGCHAO_SEARCH_PROVIDER` | Search provider, currently supports `brave` |
| `WANGCHAO_DISCOVERY_HIGHSCORE_THRESHOLD` | High-score intelligence full-text reverse lookup threshold |
| `WANGCHAO_DISCOVERY_LOOKBACK_DAYS` | High-score intelligence full-text reverse lookup time window |
| `WANGCHAO_DISCOVERY_WEEKLY_LIMIT` | Max candidate sources written per topic per cycle |
| `WANGCHAO_DISCOVERY_HIGHSCORE_PAGE_LIMIT` | Max high-score full-text pages probed per cycle |
| `WANGCHAO_DISCOVERY_ACTIVE_PAGE_LIMIT` | Max active source items probed per cycle |
| `WANGCHAO_DISCOVERY_OUTLINKS_PER_PAGE` | Max outlinks probed per active item |
| `WANGCHAO_DISCOVERY_FETCH_TIMEOUT_MS` | Discovery web/RSS probe timeout |
| `WANGCHAO_TOPIC_CREATE_SOURCE_LIMIT` | Max candidate sources from built-in source pack on new topic creation |
| `WANGCHAO_TOPIC_CREATE_FEED_TIMEOUT_MS` | RSS/Atom candidate source validation timeout on new topic creation |
| `ENCRYPTION_KEY` | **Required** — Admin backend API Key encryption key. Must be 32 bytes UTF-8 or 64 hex chars. Generate with: `openssl rand -hex 32`. Without it, the Admin backend cannot save any API Key credentials. |

## Development Audit

Development is organized by `AGENTS.md` and `REFACTOR_PLAN.md`. After each phase, keep these files synchronized:

- `CODEGUIDE.md` (L0/L1) + `docs/L2-domain.md` + `docs/L3-modules.md` + `docs/L4-operations.md`: code structure, data flow, commands, and safety boundaries, updated by L0-L4 layer attribution.
- `DEVELOPE_LOGS.md`: phase audit, missing functionality, known risks, and follow-ups.
- `AGENTS_CHANGELOGS.md`: AI Agent work audit log.

`CHANGELOG.md` is deprecated and no longer maintained.

## Personal Edition Boundaries

- Passes `pnpm db:generate`, `pnpm db:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm worker:health`.
- Railway Web + Postgres production smoke tests have passed; GitHub integration is connected. Deployment target is GitHub auto-sync to Railway (Web + Worker Cron + Source Discovery Cron).
- GitHub Actions CI is configured: push/PR to `master` triggers install → typecheck → lint → build → test → db:validate → http-smoke-check.
- Designed for personal workspace use; default workspace identity is configured via environment variables.
- Worker handles fetching, analysis, briefing generation, topic report generation, and Telegram delivery; Railway Cron handles scheduled execution. Worker outputs structured JSON logs consumable by Railway logs.
- The AI intelligence pipeline supports dual paths: LLM-first with rule fallback; `packages/ai` provides the OpenAI-compatible boundary, source recommendation has JSON parsing and fallback recommendations, semantic dedup uses an independent LLM prompt for event-pair semantic comparison.
- Auto source discovery supports high-score link reverse lookup, outlink networks, and keyword search for RSS; Railway Source Discovery Cron can be triggered periodically via `pnpm worker:source-discovery`.
- Full-text extraction uses Readability + linkedom; RSS `content:encoded` is used as a zero-cost full-text source when available.
- Language preferences (output language + terminology rules) and briefing style (structure + detail level + max events) flow from the topic edit page through to AI event extraction and Markdown briefing rendering.
- Preference memory supports 6 FeedbackKinds, 30-day half-life time decay, and can be manually edited (weights) on the preferences page.

## Reference Docs

Wangchao's code structure docs are organized by L0-L4 layers to help AI and humans read by abstraction level:

- `SPEC.md`: product goals, boundaries, data models, and feature direction — the source of truth.
- `REFACTOR_PLAN.md`: Node.js/TypeScript refactor plan.
- `AGENTS.md`: AI Agent collaboration rules, document layering rules, and reading protocol.
- `CODEGUIDE.md`: **L0 system architecture + L1 design principles**, abstract layer, high-frequency reading.
- `docs/L2-domain.md`: **L2 domain model**, core entities, state machines, glossary.
- `docs/L3-modules.md`: **L3 module details**, key files and call chains per package.
- `docs/L4-operations.md`: **L4 operations**, commands, env vars, deployment, testing.
- `FRONTEND.md`: frontend visual language, interaction rules, and page composition.
- `docs/deployment.md`: Railway deployment and operations (health checks, logging, backup, rollback).
- `docs/railway-deployment.md`: Complete Railway deployment guide.
- `docs/railway-runbook.md`: Railway ops runbook (GitHub auto-deploy, Cron observation, Postgres backup/PITR, release verification, rollback, env var matrix, CI/CD).
- `AGENTS_CHANGELOGS.md`: AI Agent work audit log.
- `DEVELOPE_LOGS.md`: phased development audit and deferred feature tracking.

## Contributing & Customization

Wangchao is under active development. Community contributions and fork customization are welcome.

- **Open an Issue**: Report bugs or suggest features via [GitHub Issues](https://github.com/sunrunchen/wangchao/issues). Bug report and feature request templates are provided.
- **Open a PR**: Bug fixes, new source adapters, documentation improvements, and test coverage are welcome. For larger changes, please open an Issue or Discussion first.
- **Customize with your AI Agent**: Fork this repo, feed `AGENTS.md` and `CODEGUIDE.md` to your coding agent (Claude Code, Cursor, Copilot, etc.), and have it adapt the project to your domain (semiconductors, policy, open-source ecosystems...), sources, preference scoring rules, and deployment environment. The project is designed for this kind of customization.
- **Discuss**: Product ideas, usage questions, and experience sharing go to [GitHub Discussions](https://github.com/sunrunchen/wangchao/discussions).

## Acknowledgements

Wangchao inherits its product idea from [t0saki/AI-News-Dashboard](https://github.com/t0saki/AI-News-Dashboard) — turning RSS news streams into structured intelligence via AI filtering. Although this repository has been almost entirely rebuilt on a TypeScript / Next.js / Postgres stack and the product shape has evolved from "news dashboard" to "theme-driven intelligence workspace", the original idea came from t0saki's prototype. Credit where credit is due.

The UI design uses prompts from [DesignPrompts](https://www.designprompts.dev). Credit here as well.

## License

[MIT](LICENSE)
