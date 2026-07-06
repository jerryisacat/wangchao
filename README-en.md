# Wangchao

[中文](README.md)

`Wangchao` is a theme-driven AI intelligence system. Users create topics, the system manages sources around those topics, fetches public information, generates intelligence events, learns from feedback, and exports dashboard views and Markdown briefings.

The current product path is a TypeScript monorepo for a personal intelligence workspace. The old Python RSS prototype is archived under `legacy/python-prototype/` for historical reference only.

## Current Status

| Area | Status |
|---|---|
| Main stack | TypeScript, pnpm, Turborepo, Next.js App Router, Prisma, Postgres, Node.js worker |
| Web | Topic/RSS form, intelligence feed, event detail, read/save/dismiss actions, preference memory, briefing export, source governance, workspace member/usage audit, `/api/health` |
| Worker | RSS fetch, item writes, deterministic intelligence pipeline, preference learning, daily briefing, source quality observation, `--health` |
| Database | Prisma schema, initial migration, seed, workspace models, UsageEvent |
| Legacy prototype | Archived under `legacy/python-prototype/` |

The personal edition has been verified on Railway with Web + Postgres. The worker can run one processing cycle; platform scheduling still needs to be enabled.

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
  deployment.md        Deployment and operations guide
legacy/
  python-prototype/    Archived Python prototype
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

`.env_example` contains placeholder values. Do not commit real secrets or database credentials.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `WANGCHAO_DEFAULT_ORGANIZATION_SLUG` | Default workspace slug |
| `WANGCHAO_DEFAULT_ORGANIZATION_NAME` | Default workspace name |
| `WANGCHAO_DEFAULT_USER_EMAIL` | Default user email |
| `WANGCHAO_DEFAULT_USER_NAME` | Default user name |
| `AI_BASE_URL` | OpenAI-compatible API endpoint |
| `AI_API_KEY` | AI provider API key |
| `AI_MODEL_L1` / `AI_MODEL_L2` | Future AI pipeline model defaults |

## Development Audit

Development is organized by `AGENTS.md` and `REFACTOR_PLAN.md`. After each phase, keep these files synchronized:

- `CODEGUIDE.md`: current structure, data flow, commands, and safety boundaries.
- `DEVELOPE_LOGS.md`: phase audit, missing functionality, known risks, and follow-ups.
- `AGENTS_CHANGELOGS.md`: AI Agent work audit log.

`CHANGELOG.md` is deprecated and should not be maintained.

## Personal Edition Boundaries

- `pnpm db:generate`, `pnpm db:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm worker:health` now pass.
- Railway Web + Postgres production smoke tests have passed.
- The current edition is designed for a personal workspace, with the default workspace identity configured through environment variables.
- The worker handles fetching, analysis, and briefing generation; the deployment platform is responsible for scheduled execution.
- The intelligence pipeline currently favors explainable rules. `packages/ai` keeps the OpenAI-compatible boundary for deeper semantic extraction and briefing rewrites.
- `legacy/python-prototype/` is retained only as historical reference and is not part of the active runtime path.

## Reference Docs

- `SPEC.md`: product goals and boundaries.
- `REFACTOR_PLAN.md`: Node.js/TypeScript refactor plan.
- `CODEGUIDE.md`: current code structure and maintenance rules.
- `docs/deployment.md`: deployment, health checks, logging, and rollback guidance.
