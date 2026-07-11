# Wangchao

[中文](README.md) | [MIT License](LICENSE)

`Wangchao` is a theme-driven AI intelligence system. Users create topics, the system manages sources around those topics, fetches public information, generates intelligence events, learns from feedback, and exports dashboard views and Markdown briefings.

The current product path is a TypeScript monorepo for a personal intelligence workspace.

> **This is an open-source project (MIT License).** Code, docs, data models, worker pipeline, and frontend are all public. Commercialization only covers server costs — buying the maintainer a coffee, not a product storyline.
>
> **You are especially welcome to customize this repo with your AI Agent.** Fork it, then have Claude Code, Cursor, Copilot, or any coding agent adapt it to your domain, sources, preferences, and deployment environment. `AGENTS.md` defines AI Agent collaboration rules and a document reading protocol, `CODEGUIDE.md` is the L0/L1 architecture overview, and `docs/` organizes domain models, module details, and operations by L2-L4 layers, helping agents understand the repo by abstraction level.

## Current Status

| Area | Status |
|---|---|
| Main stack | TypeScript, pnpm, Turborepo, Next.js App Router, Prisma, Postgres, Node.js worker |
| Web | Topic creation plus editable keywords/entities/include/exclude/importance profile, intelligence feed, event detail, read/save/dismiss plus category up/down feedback, user-scoped paginated saved collection, paginated briefing history/export with TaskRun audit, topic-isolated preference memory, source governance, OWNER/ADMIN workspace membership and 30-day usage audit, `/api/health` |
| Worker | RSS fetch, item writes, LLM-first analysis with deterministic fallback, durable TaskRun outcomes, preference learning, UTC-windowed idempotent daily briefing, source quality observation, `--health` |
| Database | Prisma schema, versioned migrations, seed, workspace models, TaskRun, UsageEvent |

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
  L2-domain.md         L2 domain model, state machines, glossary
  L3-modules.md        L3 module details, key files, call chains
  L4-operations.md     L4 commands, env vars, deployment, testing
  deployment.md        Deployment and operations guide
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

- `CODEGUIDE.md` (L0/L1) + `docs/L2-domain.md` + `docs/L3-modules.md` + `docs/L4-operations.md`: code structure, data flow, commands, and safety boundaries, updated by L0-L4 layer attribution.
- `DEVELOPE_LOGS.md`: phase audit, missing functionality, known risks, and follow-ups.
- `AGENTS_CHANGELOGS.md`: AI Agent work audit log.

`CHANGELOG.md` is deprecated and should not be maintained.

## Personal Edition Boundaries

- `pnpm db:generate`, `pnpm db:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm worker:health` now pass.
- Railway Web + Postgres production smoke tests have passed.
- The current edition is designed for a personal workspace, with the default workspace identity configured through environment variables.
- The worker handles fetching, analysis, and briefing generation; the deployment platform is responsible for scheduled execution.
- The intelligence pipeline currently favors explainable rules. `packages/ai` keeps the OpenAI-compatible boundary for deeper semantic extraction and briefing rewrites.
- Category up/down feedback changes only the matching category inside the current topic; preference signals with the same category name remain isolated across topics before they affect Dashboard ranking.
- Topic profile edits are persisted with an organization-scoped mutation and feed subsequent rule filtering, source discovery, and AI event extraction. Language preferences and briefing style remain tracked in Issue #30 until a stable consumed contract is implemented.

## Reference Docs

Wangchao's code structure docs are organized by L0-L4 layers to help AI and humans read by abstraction level:

- `SPEC.md`: product goals and boundaries.
- `REFACTOR_PLAN.md`: Node.js/TypeScript refactor plan.
- `AGENTS.md`: AI Agent collaboration rules, document layering rules, and reading protocol.
- `CODEGUIDE.md`: **L0 system architecture + L1 design principles**, abstract layer, high-frequency reading.
- `docs/L2-domain.md`: **L2 domain model**, core entities, state machines, glossary.
- `docs/L3-modules.md`: **L3 module details**, key files and call chains per package.
- `docs/L4-operations.md`: **L4 operations**, commands, env vars, deployment, testing.
- `docs/deployment.md`: deployment, health checks, logging, and rollback guidance.

## Contributing & Customization

This is an MIT-licensed open-source project. Contributions and forks are welcome.

- **Pull requests**: see `CONTRIBUTING.md`. Bug fixes, new source adapters, documentation improvements, and test coverage are welcome.
- **Customize with your AI Agent**: Fork this repo, feed `AGENTS.md` and `CODEGUIDE.md` to your coding agent (Claude Code, Cursor, Copilot, etc.), and have it adapt the project to your domain (semiconductors, policy, open-source ecosystems...), sources, preference scoring rules, and deployment environment. The project is designed for this kind of customization.
- **Report issues**: via GitHub Issues.

## Acknowledgements

Wangchao inherits its product idea from [t0saki/AI-News-Dashboard](https://github.com/t0saki/AI-News-Dashboard) — turning RSS news streams into structured intelligence via AI filtering. Although this repository has been almost entirely rebuilt on a TypeScript / Next.js / Postgres stack and the product shape has evolved from "news dashboard" to "theme-driven intelligence workspace", the original idea came from t0saki's prototype. Credit where credit is due.

## License

[MIT](LICENSE)
