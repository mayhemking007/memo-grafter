# MemoGrafter CLI Schema Workflow

This example shows the explicit setup flow for MemoGrafter-managed database tables.

```bash
cd examples/cli-schema-workflow
npm install
npx memo-grafter init
npx memo-grafter migrate
npm run seed
npx memo-grafter studio
```

`init` creates local project files:

- `src/memo-grafter/mg-schema.ts`: generated MemoGrafter `mg_*` schema reference.
- `src/memo-grafter/mg.config.ts`: CLI config that reads `DATABASE_URL`.

MemoGrafter does not create an application schema entrypoint. Keep application tables in the schema or migration files already used by your application.

`migrate` is the preferred database setup step. It creates or updates only MemoGrafter-owned `mg_*` tables and should run after `init`. Application tables remain managed by your app migration tool.

Set a database URL before running `migrate`:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memo_grafter
```

Or pass it directly:

```bash
npx memo-grafter migrate --db postgres://postgres:postgres@localhost:5432/memo_grafter
```

## Test The Example

From the repository root, build MemoGrafter first:

```bash
npm install
npm run build
```

Then run the example:

```bash
cd examples/cli-schema-workflow
npm install
cp .env.example .env
```

Edit `.env` so `DATABASE_URL` points to your PostgreSQL database and `OPENAI_API_KEY` contains your OpenAI key, then run:

```bash
npx memo-grafter init
npx memo-grafter migrate
npm run seed
npx memo-grafter studio
```

`npx memo-grafter migrate` reads `DATABASE_URL` from `.env`, the shell environment, or `src/memo-grafter/mg.config.ts`.

The seed script uses `OpenAILLMAdapter` and `OpenAIEmbedAdapter` to create two sessions. Each session contains several turns, tags, a topic change, topic nodes, and extracted memory nodes. It prints both session IDs and a graph summary when ingestion finishes.

`npx memo-grafter studio` opens the Studio session browser. Select either generated session to inspect its graph and node details.

Expected final output from the seed script:

```text
Studio data is ready.
Run: npx memo-grafter studio
```

The existing `npm run verify` command remains as an alias for `npm run seed`.
