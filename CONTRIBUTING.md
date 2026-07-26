# Contributing to MemoGrafter

Thank you for considering a contribution to MemoGrafter. Suggestions, bug
reports, documentation improvements, and code contributions are all welcome.
Please be polite and constructive when discussing issues and reviewing work.

## Set up the repository locally

### 1. Fork and clone the repository

Fork `mayhemking007/memo-grafter` on GitHub, then clone your fork:

```bash
git clone https://github.com/<your-github-username>/memo-grafter.git
cd memo-grafter
```

Add the main repository as the `upstream` remote:

```bash
git remote add upstream https://github.com/mayhemking007/memo-grafter.git
git remote -v
```

Install the dependencies:

```bash
npm install
```

MemoGrafter requires Node.js 18 or newer.

### 2. Provide PostgreSQL and optional Redis

MemoGrafter's built-in store requires PostgreSQL with the `pgvector`
extension. Redis is required only when working on queue mode or the optional
recall cache.

If you already have compatible PostgreSQL and Redis services, you do not need
Docker Compose. Configure `.env` with their connection URLs and continue to
the initialization step.

If you do not already have these services, the root-level `compose.yml`
provides a convenient local development setup. Docker and Docker Compose are
required only for this option.

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Start only PostgreSQL:

```bash
docker compose up -d postgres
```

Inspect service status and health:

```bash
docker compose ps
```

View PostgreSQL logs:

```bash
docker compose logs -f postgres
```

Stop the containers while preserving local data:

```bash
docker compose down
```

> **Warning:** `docker compose down -v` permanently deletes the local
> PostgreSQL database and Redis data stored in the Compose volumes.

To intentionally delete the containers and their development data:

```bash
docker compose down -v
```

### 3. Configure the environment

Copy the example environment file:

```bash
cp .env.example .env
```

On PowerShell, use:

```powershell
Copy-Item .env.example .env
```

The default `DATABASE_URL` matches the PostgreSQL service in `compose.yml`.
When using an existing PostgreSQL installation, replace it with that
installation's connection URL.

Redis is optional. If you start only PostgreSQL, leave `REDIS_URL` empty or
omit it. Set it to `redis://localhost:6379`, or your existing Redis URL, only
when enabling queue mode or the recall cache.

MemoGrafter does not enable Redis from the environment variable alone. A Redis
client is created only when an application explicitly supplies `queue` or
`cache` configuration.

### 4. Build, initialize, and migrate

```bash
npm run build
npx memo-grafter init
npx memo-grafter migrate
```

The migration enables `vector` and `pgcrypto` and creates or updates
MemoGrafter's `mg_*` tables. It is safe to run the migration again.

If you use the Compose services, you can inspect them with:

```bash
docker compose exec postgres pg_isready -U memografter -d memografter
docker compose exec postgres psql -U memografter -d memografter -c "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto') ORDER BY extname;"
docker compose exec redis redis-cli ping
```

The Redis check applies only when Redis is running and should return `PONG`.
When using existing services, use their normal database and Redis clients for
the equivalent checks.

### 5. Manually verify the setup

The provider-specific setup smoke tests each create a basic chatbot, send it a
short conversation, and confirm that MemoGrafter stored graph data. All three
require a working `DATABASE_URL`. They do not require Redis.

After building and migrating, run one test with the corresponding API key set
in `.env`:

```bash
# Requires OPENAI_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/openai-smoke.ts

# Requires ANTHROPIC_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/anthropic-smoke.ts

# Requires GEMINI_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/gemini-smoke.ts
```

The Anthropic setup test uses a deterministic local embedder because
MemoGrafter does not provide an Anthropic embedding adapter. The OpenAI and
Gemini setup tests use their provider's embedding API.

A successful run prints chatbot responses, stored topic and memory counts, and
a provider-specific `contributor setup smoke passed` message. These tests call
external model APIs and may incur normal API usage charges.

## Start Contributing

### Create an issue

For bugs, proposals, or larger changes, open an issue before implementation so
the intended behavior and scope can be discussed. We follow this general
template:

```markdown
## What

Describe the change.

## Why

Why is this needed?

## Expected outcome

What should the expected outcome?

## Notes

Additional context or constraints.
```

Search existing issues first to avoid duplicates. Clear reproduction steps,
examples, and relevant constraints help us understand suggestions quickly.

### Create a PR

**Create a branch**

Update your local `main` from the upstream repository:

```bash
git checkout main
git fetch upstream
git merge --ff-only upstream/main
git push origin main
```

Create a focused branch for the change:

```bash
git checkout -b feat/short-description
```

Use a prefix that describes the change:

- `feat`: a new user-facing capability
- `fix`: a bug fix
- `chore`: maintenance, tooling, dependency, or repository housekeeping
- `refactor`: an internal code change that preserves behavior
- `test`: test additions or improvements

Use the same keywords in concise commit and pull request titles where
appropriate, for example `fix: avoid duplicate memory ingestion`.

**Implement and test**

Keep changes focused and update documentation when behavior or public usage
changes. MemoGrafter uses Vitest for automated tests. Add or update a unit test
when applicable.

Every change should pass:

```bash
npm run build
npm run lint
npm run typecheck
npm run test:run
```

If the change affects an algorithm or behavior that benefits from realistic
end-to-end verification, add a focused manual test under `tests/manual/` and
document how to run it.

If the change affects the CLI, packaging, exports, or generated project
workflow, also run:

```bash
npm run test:package
```

Database-backed changes should also run the relevant suites with
`DATABASE_URL` configured:

```bash
npm run test:core
npm run test:fleet
```

Redis is not required for the default unit tests or PostgreSQL-only
development.

**Open the pull request**

Commit and push the branch to your fork:

```bash
git add <changed-files>
git commit -m "feat: short description"
git push -u origin feat/short-description
```

Open a pull request from your branch on your fork into
`mayhemking007/memo-grafter`'s `main` branch.

In the pull request:

- explain what changed and why;
- link the related issue;
- describe how you tested the change;
- mention any compatibility considerations or follow-up work;
- keep the pull request focused on one logical change.

Please respond politely to review feedback. Review is collaborative, and
follow-up suggestions are intended to help make the contribution safe and
maintainable.
