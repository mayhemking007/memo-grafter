# Phase-one agent runs: manual test

Run from the repository root:

```bash
npm run manual:agent-runs
```

Requires dependencies installed, a reachable PostgreSQL database configured as `DATABASE_URL`
in the root `.env`, and the current MemoGrafter schema (`npx memo-grafter migrate`).
The runner verifies the schema but never applies migrations itself. No API keys, Redis,
embedding provider, or LLM are needed. Tool outputs are synthetic fixtures; no tools execute.

Expected output: eight numbered `PASS` lines, an ordered six-event timeline, confirmation
that both test tenants were removed, and `All 8 manual checks passed` with exit code zero.
A failed assertion, setup error, or cleanup failure exits nonzero.

The checks exercise the public `PostgresGraphStore.agentRuns()` API against real storage:

1. Concurrent start retries and conflicting run IDs.
2. Out-of-order tool events, evidence persistence, missing-event rejection, and concurrent retries.
3. Conflicting event IDs/sequences and duplicate tool results.
4. Observations, artifact references, and pagination.
5. Private ownership, project read grants, denied writes, and cross-tenant isolation.
6. Interruption, closing/reopening the connection, explicit resume, completion retries, and sealed runs.
7. Orphan results, pending tool calls, and failure/cancellation outcomes.
8. Invalid timestamps/sequences, oversized payloads, and lifecycle bypass attempts.

Every invocation uses two randomly generated tenant IDs. By default, it deletes only rows
belonging to those exact tenants, in a transaction, including after an assertion fails.
Existing conversation/fleet data is untouched. A forced process termination can leave
fixtures behind; the tenant IDs are printed before the first database operation.

To leave fixtures available for inspection in the three `mg_agent_*` tables:

```bash
npm run manual:agent-runs -- --keep-data
```

Filter by the exact printed tenant IDs. Inspect the completed `build-attempt-1` run:
sequences 0–5 should be task start, tool call, tool result, observation, artifact, and task
completion. Its task/session IDs should be separate from the run and agent IDs. The other
tenant's identically named run should contain only its own start event. The `failed` and
`cancelled` runs retain a pending call and their corresponding terminal event.

Retained rows can be removed by deleting from `mg_agent_events`, then `mg_agent_runs`, then
`mg_agent_identities`, constrained to the exact two printed tenant IDs. Never truncate the
shared tables. Use `npm run manual:agent-runs -- --help` for command options.
