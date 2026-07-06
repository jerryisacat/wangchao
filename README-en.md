# Wangchao

[中文](README.md) | [MIT License](LICENSE)

`Wangchao` is a theme-driven AI intelligence system. Users create topics, the system manages sources around those topics, fetches public information, generates intelligence events, learns from feedback, and exports dashboard views and Markdown briefings.

The current product path is a TypeScript monorepo for a personal intelligence workspace.

> **This is an open-source project (MIT License).** Code, docs, data models, worker pipeline, and frontend are all public. Commercialization only covers server costs — buying the maintainer a coffee, not a product storyline.
>
> **You are especially welcome to customize this repo with your AI Agent.** Fork it, then have Claude Code, Cursor, Copilot, or any coding agent adapt it to your domain, sources, preferences, and deployment environment. `AGENTS.md` and `CODEGUIDE.md` are the collaboration spec and code-structure map for AI agents.

## Current Status

| Area | Status |
|---|---|
| Main stack | TypeScript, pnpm, Turborepo, Next.js App Router, Prisma, Postgres, Node.js worker |
| Web | Topic/RSS form, intelligence feed, event detail, read/save/dismiss actions, preference memory, briefing export, source governance, workspace member/usage audit, `/api/health` |
| Worker | RSS fetch, item writes, deterministic intelligence pipeline, preference learning, daily briefing, source quality observation, `--health` |
| Database | Prisma schema, initial migration, seed, workspace models, UsageEvent |

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

## Reference Docs

- `SPEC.md`: product goals and boundaries.
- `REFACTOR_PLAN.md`: Node.js/TypeScript refactor plan.
- `CODEGUIDE.md`: current code structure and maintenance rules.
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
