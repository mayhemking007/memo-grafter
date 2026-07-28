# Contributing to MemoGrafter

Suggestions, bug reports, documentation improvements, and code contributions
are welcome. Please be polite and constructive. This guide is also available
in the [MemoGrafter website documentation](https://memografter.com/docs/contributing).

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

MemoGrafter requires Node.js 18 or newer. Install dependencies:

```bash
npm install
```

### 2. Provide PostgreSQL and optional Redis

MemoGrafter's built-in store requires PostgreSQL with the `pgvector`
extension. Redis is needed only for queue mode or the optional recall cache.
If you already run compatible services, configure their URLs in `.env` and
skip Docker. Otherwise, use the root-level `compose.yml`.

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Start only PostgreSQL:

```bash
docker compose up -d postgres
```

Inspect services or PostgreSQL logs:

```bash
docker compose ps
docker compose logs -f postgres
```

Stop the containers while preserving local data:

```bash
docker compose down
```

> **Warning:** `docker compose down -v` permanently deletes the local
> PostgreSQL database and Redis data stored in the Compose volumes.

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

The default `DATABASE_URL` matches `compose.yml`; replace it when using an
existing PostgreSQL installation. Leave `REDIS_URL` empty or omit it for
PostgreSQL-only development. Redis is enabled only when the application
explicitly supplies `queue` or `cache` configuration.

### 4. Build, initialize, and migrate

```bash
npm run build
npx memo-grafter init
npx memo-grafter migrate
```

The idempotent migration enables `vector` and `pgcrypto` and creates or updates
MemoGrafter's `mg_*` tables.

If you use the Compose services, you can inspect them with:

```bash
docker compose exec postgres pg_isready -U memografter -d memografter
docker compose exec postgres psql -U memografter -d memografter -c "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto') ORDER BY extname;"
docker compose exec redis redis-cli ping
```

Run the Redis check only when Redis is running; it should return `PONG`.

### 5. Manually verify the setup

Each setup smoke test creates a basic chatbot and confirms that MemoGrafter
stored graph data. After building and migrating, run one with a working
`DATABASE_URL` and the corresponding API key in `.env`:

```bash
# Requires OPENAI_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/openai-smoke.ts

# Requires ANTHROPIC_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/anthropic-smoke.ts

# Requires GEMINI_API_KEY
npx tsx --env-file=.env tests/manual/setup-test/gemini-smoke.ts
```

Redis is not required. Anthropic uses a deterministic local embedder; OpenAI
and Gemini use their provider embedding APIs. These tests call external APIs
and may incur usage charges.

## Start Contributing

### Create an issue

Search existing issues first. For bugs, proposals, or larger changes, open an
issue using this general template:

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

Include reproduction steps, examples, and constraints where relevant.

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

Use a matching branch, commit, and PR title prefix:

- `feat`: a new user-facing capability
- `fix`: a bug fix
- `chore`: maintenance, tooling, dependency, or repository housekeeping
- `refactor`: an internal code change that preserves behavior
- `test`: test additions or improvements

For example: `fix: avoid duplicate memory ingestion`.

**Implement and test**

Keep changes focused and update affected documentation. MemoGrafter uses
Vitest; add or update a unit test when applicable.

Every change should pass:

```bash
npm run build
npm run lint
npm run typecheck
npm run test:run
```

For algorithm or behavior changes, add a focused manual test under
`tests/manual/` when useful and document its command.

For CLI, packaging, export, or generated-workflow changes, also run:

```bash
npm run test:package
```

For database-backed changes, configure `DATABASE_URL` and run:

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

Open a pull request from your fork into `mayhemking007/memo-grafter`'s `main`
branch. In the description:

- explain what changed and why;
- link the related issue;
- describe how you tested the change;
- mention any compatibility considerations or follow-up work;
- keep the pull request focused on one logical change.

Please respond politely to review feedback; suggestions help keep
contributions safe and maintainable.
