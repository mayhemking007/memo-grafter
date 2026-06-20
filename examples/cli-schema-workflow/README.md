# MemoGrafter CLI Schema Workflow

This example shows the explicit setup flow for MemoGrafter-managed database tables.

```bash
cd examples/cli-schema-workflow
npm install
npx memo-grafter init
npx memo-grafter migrate
npm run verify
```

`init` creates local project files:

- `src/memo-grafter/mg-schema.ts`: generated MemoGrafter `mg_*` schema reference.
- `src/memo-grafter/mg.config.ts`: CLI config that reads `DATABASE_URL`.

MemoGrafter does not create an application schema entrypoint. Keep application tables in the schema or migration files already used by your application.

`migrate` creates or updates only MemoGrafter-owned `mg_*` tables. Application tables remain managed by your app migration tool.

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

Edit `.env` so `DATABASE_URL` points to your PostgreSQL database, then run:

```bash
npx memo-grafter init
npx memo-grafter migrate
npm run verify
```

`npx memo-grafter migrate` reads `DATABASE_URL` from `.env`, the shell environment, or `src/memo-grafter/mg.config.ts`.

Expected result:

```text
MemoGrafter schema verified. CLI migration is ready to use.
```

To confirm the new runtime behavior, try `npm run verify` before `npx memo-grafter migrate` against a fresh database. It should fail with a helpful message telling you to run `npx memo-grafter migrate`.
