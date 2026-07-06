# Legacy Python Prototype

本目录保存 `望潮（Wangchao）` fork 初始版本的 Python 原型代码，仅作为行为参考和迁移线索。

当前主开发路径已经切换到仓库根目录的 TypeScript monorepo：

- `apps/web`: Next.js App Router 产品界面和 route handlers。
- `apps/worker`: Node.js 后台 worker。
- `packages/db`: Prisma/Postgres schema、migration、seed 和 repository boundary。
- `packages/core`: 情报、偏好、Markdown 等领域逻辑。
- `packages/sources`: RSS/source adapter。
- `packages/ai`: OpenAI-compatible adapter/parser。

## Archived Contents

- Python runtime: `main.py`, `config.py`, `database.py`, `ai_service.py`, `ranking.py`, `response_utils.py`
- Python pipeline: `processors/`, `sources/`, `prompts/`
- Legacy static dashboard: `index.html`
- Python tests: `tests_*.py`
- Python project files: `.python-version`, `pyproject.toml`, `uv.lock`

## Rules

- Do not add new feature work here.
- Do not use this directory as the source of truth for architecture.
- If behavior is copied from the prototype, document the new TypeScript owner in `CODEGUIDE.md`.
- Once the TypeScript stack has completed real build/typecheck/DB/browser verification, this directory may be removed in a separate cleanup.
