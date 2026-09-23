/** npm run manual:agent-runs -- [--keep-data]. Real PostgreSQL; no model/provider calls. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { AgentRunError, PostgresGraphStore, type AgentEventInput, type AgentRunErrorCode } from "../../src/store/index.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run manual:agent-runs -- [--keep-data]\nRequires DATABASE_URL and an already migrated database. No LLM keys needed.\nRemoves only this test's randomly named tenants unless --keep-data is supplied.");
    return;
  }
  assert.ok(args.every(arg => arg === "--keep-data"), "Unknown argument. Use --help.");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  assert.ok(databaseUrl, "Set DATABASE_URL in the root .env and run npx memo-grafter migrate first.");
  const keepData = args.includes("--keep-data");
  const tenantId = `manual-agent-${randomUUID()}`;
  const otherTenantId = `${tenantId}-other`;
  const projectId = "synthetic-project";
  const access = { tenantId, agentId: "builder", projectIds: [projectId] };
  const runId = "build-attempt-1";
  const occurredAt = new Date().toISOString();
  const stores: PostgresGraphStore[] = [];
  const openStore = () => {
    const store = new PostgresGraphStore(databaseUrl);
    stores.push(store);
    return store;
  };
  const cleanup = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  let schemaReady = false;
  let passed = 0;
  let failure: unknown;
  const check = async (name: string, test: () => Promise<void>) => {
    await test();
    passed++;
    console.log(`PASS ${passed}: ${name}`);
  };
  const rejects = (operation: () => Promise<unknown>, code: AgentRunErrorCode) =>
    assert.rejects(operation, error => error instanceof AgentRunError && error.code === code, `Expected ${code}`);
  const observation = (sequence: number): AgentEventInput => ({
    eventId: `observation-${sequence}`, sequence, occurredAt,
    data: { type: "observation", text: "Synthetic fixture: test command exited successfully." },
  });
  const completion = (sequence: number) => ({ eventId: "finish", sequence, occurredAt, outcome: "succeeded" as const, summary: "Synthetic task complete." });

  console.log(`Agent runs manual test\nTenant: ${tenantId}\nOther tenant: ${otherTenantId}`);
  try {
    const store = openStore();
    // Read-only preflight; migrations are never applied by this test.
    await store.initialize();
    schemaReady = true;
    const owner = store.agentRuns(access);
    const peer = store.agentRuns({ tenantId, agentId: "reviewer", projectIds: [projectId] });
    const stranger = store.agentRuns({ tenantId, agentId: "stranger" });
    const otherTenant = store.agentRuns({ ...access, tenantId: otherTenantId });
    const start = { runId, taskId: "synthetic-task", objective: "Record a synthetic test execution", sessionId: `${tenantId}-conversation` };

    await check("concurrent start retries create one run and one start event", async () => {
      const [first, retry] = await Promise.all([owner.startRun(start), owner.startRun(start)]);
      assert.deepEqual(first, retry);
      assert.equal(first.agentId, access.agentId);
      assert.equal(first.sessionId, start.sessionId);
      const events = await owner.listEvents(runId);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.data.type, "task.started");
      assert.equal(events[0]?.sequence, 0);
      await rejects(() => owner.startRun({ ...start, objective: "Changed objective" }), "CONFLICT");
    });

    const call: AgentEventInput = { eventId: "tool-call", sequence: 1, occurredAt,
      data: { type: "tool.call", toolCallId: "tool-attempt-1", toolName: "test_runner", input: { fixture: true } } };
    const result: AgentEventInput = { eventId: "tool-result", sequence: 2, occurredAt,
      data: { type: "tool.result", toolCallId: "tool-attempt-1", outcome: "success", output: { exitCode: 0, tests: 3 } },
      source: { uri: "fixture://agent-manual/test-output", externalId: "synthetic-trace" } };

    await check("out-of-order delivery is durable; completion rejects missing events", async () => {
      const saved = await owner.recordEvent(runId, result);
      assert.deepEqual(saved.data, result.data);
      assert.deepEqual(saved.source, result.source);
      assert.ok(saved.receivedAt instanceof Date);
      await rejects(() => owner.completeRun(runId, completion(3)), "INCOMPLETE_HISTORY");
      assert.equal((await owner.getRun(runId)).status, "running");
      const [first, retry] = await Promise.all([owner.recordEvent(runId, call), owner.recordEvent(runId, call)]);
      assert.deepEqual(first, retry);
      assert.deepEqual((await owner.listEvents(runId)).map(e => e.sequence), [0, 1, 2]);
    });

    await check("conflicting event IDs, sequence numbers, and tool attempts are rejected", async () => {
      await rejects(() => owner.recordEvent(runId, { ...call, data: { ...call.data, type: "observation", text: "different" } }), "CONFLICT");
      await rejects(() => owner.recordEvent(runId, { ...call, eventId: "another-id" }), "CONFLICT");
      await rejects(() => owner.recordEvent(runId, { ...result, eventId: "another-result", sequence: 3 }), "CONFLICT");
      assert.equal((await owner.listEvents(runId)).length, 3);
    });

    await check("observations and artifacts preserve evidence and paginate in sequence order", async () => {
      await owner.recordEvent(runId, observation(3));
      await owner.recordEvent(runId, { eventId: "artifact", sequence: 4, occurredAt,
        data: { type: "artifact", uri: "fixture://agent-manual/report", description: "Synthetic report; no file is fetched." } });
      const page = await owner.listEvents(runId, { afterSequence: 2, limit: 2 });
      assert.deepEqual(page.map(e => e.data.type), ["observation", "artifact"]);
      assert.deepEqual(page.map(e => e.sequence), [3, 4]);
    });

    await check("private runs and project writes enforce access boundaries", async () => {
      await rejects(() => peer.getRun(runId), "NOT_FOUND");
      await rejects(() => peer.listEvents(runId), "NOT_FOUND");
      await rejects(() => otherTenant.getRun(runId), "NOT_FOUND");
      await owner.startRun({ ...start, runId: "shared", scope: { kind: "project", projectId } });
      assert.equal((await peer.getRun("shared")).runId, "shared");
      assert.equal((await peer.listEvents("shared")).length, 1);
      await rejects(() => peer.recordEvent("shared", observation(1)), "ACCESS_DENIED");
      await rejects(() => peer.completeRun("shared", completion(1)), "ACCESS_DENIED");
      await rejects(() => stranger.getRun("shared"), "NOT_FOUND");
      await rejects(() => stranger.startRun({ ...start, runId: "denied", scope: { kind: "project", projectId } }), "ACCESS_DENIED");
      await rejects(() => otherTenant.listEvents("shared"), "NOT_FOUND");
      await otherTenant.startRun(start); // Identical run/agent IDs are independent in another tenant.
      assert.equal((await otherTenant.listEvents(runId)).length, 1);
    });

    await check("interruption survives closing the connection; explicit resume preserves history", async () => {
      const before = await owner.listEvents(runId);
      await owner.interruptRun(runId);
      await rejects(() => owner.recordEvent(runId, observation(5)), "INVALID_STATE");
      await store.close();
      const reopened = openStore();
      await reopened.initialize();
      const restored = reopened.agentRuns(access);
      assert.equal((await restored.getRun(runId)).status, "interrupted");
      assert.deepEqual(await restored.listEvents(runId), before);
      await restored.resumeRun(runId);
      const finished = await restored.completeRun(runId, completion(5));
      assert.equal(finished.status, "succeeded");
      assert.deepEqual(await restored.completeRun(runId, completion(5)), finished);
      assert.deepEqual((await restored.recordEvent(runId, result)).data, result.data);
      await rejects(() => restored.recordEvent(runId, observation(6)), "INVALID_STATE");
      await rejects(() => restored.resumeRun(runId), "INVALID_STATE");
      console.table((await restored.listEvents(runId)).map(e => ({ sequence: e.sequence, event: e.data.type, id: e.eventId })));
    });

    const resumed = stores[stores.length - 1]!.agentRuns(access);
    await check("orphan tool results cannot complete; failed/cancelled runs may retain pending calls", async () => {
      await resumed.startRun({ ...start, runId: "orphan" });
      await resumed.recordEvent("orphan", { ...result, sequence: 1 });
      await rejects(() => resumed.completeRun("orphan", completion(2)), "INCOMPLETE_HISTORY");
      for (const outcome of ["failed", "cancelled"] as const) {
        await resumed.startRun({ ...start, runId: outcome });
        await resumed.recordEvent(outcome, call);
        await rejects(() => resumed.completeRun(outcome, completion(2)), "INCOMPLETE_HISTORY");
        assert.equal((await resumed.completeRun(outcome, { ...completion(2), outcome })).status, outcome);
      }
    });

    await check("invalid and oversized events leave no rows behind", async () => {
      await resumed.startRun({ ...start, runId: "validation" });
      await rejects(() => resumed.recordEvent("validation", { ...observation(1), sequence: 0 }), "INVALID_INPUT");
      await rejects(() => resumed.recordEvent("validation", { ...observation(1), occurredAt: "invalid" }), "INVALID_INPUT");
      await rejects(() => resumed.recordEvent("validation", { ...result, sequence: 1,
        data: { type: "tool.result", toolCallId: "oversized", outcome: "success", output: "x".repeat(262144) } }), "INVALID_INPUT");
      await rejects(() => resumed.recordEvent("validation", { ...observation(1), data: { type: "task.completed", summary: "bypass" } }), "INVALID_INPUT");
      assert.equal((await resumed.listEvents("validation")).length, 1);
    });
  } catch (error) {
    failure = error;
  } finally {
    // Close every pool even if a test/cleanup fails. Never delete by a broad prefix.
    for (const store of stores) {
      try { await store.close(); } catch (error) { failure ??= error; }
    }
    try {
      if (schemaReady && !keepData) {
        const tenants = [tenantId, otherTenantId];
        await cleanup.begin(async tx => {
          await tx`DELETE FROM mg_agent_events WHERE tenant_id = ANY(${tenants}::text[])`;
          await tx`DELETE FROM mg_agent_runs WHERE tenant_id = ANY(${tenants}::text[])`;
          await tx`DELETE FROM mg_agent_identities WHERE tenant_id = ANY(${tenants}::text[])`;
        });
        const remaining = await cleanup`SELECT 1 FROM mg_agent_identities WHERE tenant_id = ANY(${tenants}::text[])`;
        assert.equal(remaining.length, 0, "Test identities should be removed");
        console.log("Cleaned up both test tenants.");
      } else if (schemaReady) {
        console.log(`Kept test data for inspection: ${tenantId}, ${otherTenantId}`);
      }
    } catch (error) {
      console.error(`Cleanup failed; inspect test tenants ${tenantId} and ${otherTenantId}.`);
      failure ??= error;
    } finally {
      try { await cleanup.end({ timeout: 5 }); } catch (error) { failure ??= error; }
    }
  }
  if (failure) throw failure;
  console.log(`\nAll ${passed} manual checks passed. No LLM or tool execution was performed.`);
}

main().catch(error => {
  // Avoid printing a database error object, which can contain connection/query details.
  const message = error instanceof AgentRunError || error instanceof assert.AssertionError
    ? error.message : "Database/setup operation failed. Check DATABASE_URL, PostgreSQL availability, and npx memo-grafter migrate.";
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});
