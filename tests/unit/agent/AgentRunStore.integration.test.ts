import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAgentRunStore } from "../../../src/store/postgres-pgvector/AgentRunStore.js";
import { agentRunMigrationSql } from "../../../src/schema/agentRunMigration.js";
import type { AgentEventInput, AgentRunAPI } from "../../../src/agents/runs/types.js";

// Opt-in; creates and drops only a randomly named schema on this test database.
const url = process.env.MEMOGRAFTER_AGENT_TEST_DB;
describe.skipIf(!url)("agent runs on PostgreSQL", () => {
  const schema = `mg_agent_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Sql;
  let sql: Sql;
  let owner: AgentRunAPI;
  let peer: AgentRunAPI;
  let outsider: AgentRunAPI;
  let otherTenant: AgentRunAPI;
  const occurredAt = "2026-09-19T00:00:00.000Z";
  const observation = (sequence: number, text = "observed"): AgentEventInput => ({
    eventId: `event-${sequence}`, sequence, occurredAt, data: { type: "observation", text },
  });
  const start = (api = owner, runId = randomUUID(), shared = false) => api.startRun({
    runId, taskId: "task-a", objective: "Investigate a test failure", sessionId: "optional-conversation",
    ...(shared ? { scope: { kind: "project" as const, projectId: "project-a" } } : {}),
  });
  const finish = (sequence: number) => ({ eventId: "finish", sequence, occurredAt, outcome: "succeeded" as const, summary: "Verified" });

  beforeAll(async () => {
    admin = postgres(url!, { onnotice: () => undefined, max: 1 });
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = postgres(url!, { onnotice: () => undefined, max: 5, connection: { search_path: schema } });
    await sql.unsafe(agentRunMigrationSql);
    await sql.unsafe(agentRunMigrationSql); // Repeat migrations must preserve records and constraints.
    owner = new PostgresAgentRunStore(sql, { tenantId: "tenant-a", agentId: "agent-a", projectIds: ["project-a"] });
    peer = new PostgresAgentRunStore(sql, { tenantId: "tenant-a", agentId: "agent-b", projectIds: ["project-a"] });
    outsider = new PostgresAgentRunStore(sql, { tenantId: "tenant-a", agentId: "agent-c" });
    otherTenant = new PostgresAgentRunStore(sql, { tenantId: "tenant-b", agentId: "agent-a", projectIds: ["project-a"] });
  }, 30000);

  afterAll(async () => {
    await sql?.end();
    // schema is locally generated above, not provided by an environment variable or user input.
    if (admin) {
      await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("retries concurrent starts and keeps one persistent identity across tasks/runs", async () => {
    const id = randomUUID();
    const [a, b] = await Promise.all([start(owner, id), start(owner, id)]);
    expect(a).toEqual(b);
    expect(await owner.listEvents(id)).toHaveLength(1);
    await start();
    const identities = await sql`SELECT * FROM mg_agent_identities WHERE tenant_id='tenant-a' AND agent_id='agent-a'`;
    expect(identities).toHaveLength(1);
    await expect(owner.startRun({ runId: id, taskId: "different-task", objective: a.objective })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("persists across clients and migrations without altering event evidence", async () => {
    const run = await start();
    const event = { ...observation(1), source: { uri: "file:///project/test.log", externalId: "trace-7" } };
    const saved = await owner.recordEvent(run.runId, event);
    expect(saved).toMatchObject(event);
    expect(saved.receivedAt).toBeInstanceOf(Date);
    await sql.unsafe(agentRunMigrationSql);
    const restored = new PostgresAgentRunStore(sql, { tenantId: "tenant-a", agentId: "agent-a" });
    expect(await restored.getRun(run.runId)).toMatchObject({ taskId: run.taskId, sessionId: run.sessionId });
    expect((await restored.listEvents(run.runId))[1]).toEqual(saved);
  });

  it("supports out-of-order delivery but rejects gaps at completion and paginates in sequence order", async () => {
    const { runId } = await start();
    await owner.recordEvent(runId, observation(2));
    await expect(owner.completeRun(runId, finish(3))).rejects.toMatchObject({ code: "INCOMPLETE_HISTORY" });
    expect((await owner.getRun(runId)).status).toBe("running");
    expect(await owner.listEvents(runId)).toHaveLength(2);
    await owner.recordEvent(runId, observation(1));
    expect((await owner.listEvents(runId, { afterSequence: 0, limit: 1 }))[0]?.sequence).toBe(1);
    expect((await owner.listEvents(runId)).map(e => e.sequence)).toEqual([0, 1, 2]);
    expect((await owner.completeRun(runId, finish(3))).status).toBe("succeeded");
  });

  it("deduplicates concurrent event retries and rejects changed IDs, sequences, and payloads", async () => {
    const { runId } = await start();
    const event = observation(1);
    const [a, b] = await Promise.all([owner.recordEvent(runId, event), owner.recordEvent(runId, event)]);
    expect(a).toEqual(b);
    for (const changed of [observation(1, "changed"), { ...event, eventId: "different" }, { ...event, sequence: 2 }]) {
      await expect(owner.recordEvent(runId, changed)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await owner.listEvents(runId)).toHaveLength(2);
  });

  it("serializes racing writes to the same sequence", async () => {
    const { runId } = await start();
    const results = await Promise.allSettled([owner.recordEvent(runId, observation(1, "A")), owner.recordEvent(runId, observation(1, "B"))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await owner.listEvents(runId)).toHaveLength(2);
  });

  it("requires explicit resume after interruption; terminal runs remain immutable while retries succeed", async () => {
    const { runId } = await start();
    const saved = await owner.recordEvent(runId, observation(1));
    await owner.interruptRun(runId);
    await owner.interruptRun(runId);
    await expect(owner.recordEvent(runId, observation(2))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(owner.completeRun(runId, finish(2))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await owner.resumeRun(runId);
    const done = await owner.completeRun(runId, finish(2));
    expect(await owner.completeRun(runId, finish(2))).toEqual(done);
    expect(await owner.recordEvent(runId, observation(1))).toEqual(saved);
    await expect(owner.recordEvent(runId, observation(3))).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(owner.resumeRun(runId)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(owner.completeRun(runId, { ...finish(2), outcome: "failed" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("enforces tenant isolation, private ownership, and explicit project read grants", async () => {
    const privateRun = await start();
    const sharedRun = await start(owner, randomUUID(), true);
    await expect(peer.getRun(privateRun.runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(peer.listEvents(privateRun.runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await peer.getRun(sharedRun.runId)).scope).toEqual({ kind: "project", projectId: "project-a" });
    expect(await peer.listEvents(sharedRun.runId)).toHaveLength(1);
    for (const api of [outsider, otherTenant]) {
      await expect(api.getRun(sharedRun.runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.recordEvent(sharedRun.runId, observation(1))).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(start(outsider, randomUUID(), true)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(peer.recordEvent(sharedRun.runId, observation(1))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(peer.completeRun(sharedRun.runId, finish(1))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(peer.interruptRun(sharedRun.runId)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(start(peer, sharedRun.runId, true)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const revoked = new PostgresAgentRunStore(sql, { tenantId: "tenant-a", agentId: "agent-a" });
    await expect(revoked.getRun(sharedRun.runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The same caller IDs in another tenant are independent records.
    expect((await start(otherTenant, privateRun.runId)).runId).toBe(privateRun.runId);
  });

  it("links out-of-order tool events and rejects orphan results and duplicate attempts", async () => {
    const { runId } = await start();
    const result: AgentEventInput = { eventId: "result", sequence: 2, occurredAt, data: { type: "tool.result", toolCallId: "call-1", outcome: "success", output: { exitCode: 0 } } };
    await owner.recordEvent(runId, result);
    await owner.recordEvent(runId, observation(1));
    await expect(owner.completeRun(runId, finish(3))).rejects.toMatchObject({ code: "INCOMPLETE_HISTORY" });
    await expect(owner.recordEvent(runId, { ...result, eventId: "result-again", sequence: 3 })).rejects.toMatchObject({ code: "CONFLICT" });
    const good = await start();
    await owner.recordEvent(good.runId, result);
    await owner.recordEvent(good.runId, { eventId: "call", sequence: 1, occurredAt, data: { type: "tool.call", toolCallId: "call-1", toolName: "test", input: {} } });
    expect((await owner.completeRun(good.runId, finish(3))).status).toBe("succeeded");
  });

  it("allows failed/cancelled runs to retain pending calls, but does not label them successful", async () => {
    for (const outcome of ["failed", "cancelled"] as const) {
      const { runId } = await start();
      await owner.recordEvent(runId, { eventId: "call", sequence: 1, occurredAt, data: { type: "tool.call", toolCallId: "call-1", toolName: "test", input: null } });
      await expect(owner.completeRun(runId, finish(2))).rejects.toMatchObject({ code: "INCOMPLETE_HISTORY" });
      expect((await owner.completeRun(runId, { ...finish(2), outcome })).status).toBe(outcome);
    }
  });

  it("rejects direct task lifecycle events and invalid inputs without adding rows", async () => {
    const { runId } = await start();
    await expect(owner.recordEvent(runId, { ...observation(1), data: { type: "task.completed", summary: "bypass" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(owner.listEvents(runId, { limit: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await owner.listEvents(runId)).toHaveLength(1);
  });
});
