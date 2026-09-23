import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { validateEvent } from "../../../src/agents/runs/validation.js";
import type { AgentEventInput, AgentRunAccess } from "../../../src/agents/runs/types.js";
import { PostgresAgentRunStore } from "../../../src/store/postgres-pgvector/AgentRunStore.js";
import { agentRunMigrationSql } from "../../../src/schema/agentRunMigration.js";
import { memoGrafterTables } from "../../../src/schema/mg-tables.js";
import { MemoGrafter } from "../../../src/core/MemoGrafter.js";

const event: AgentEventInput = { eventId: "result-1", sequence: 2, occurredAt: "2026-09-19T05:30:00+05:30",
  data: { type: "tool.result", toolCallId: "call-1", outcome: "success", output: { code: 0 } } };

describe("agent event contract", () => {
  it("normalizes timestamps without mutating caller evidence", () => {
    const normalized = validateEvent(event);
    expect(normalized.occurredAt).toBe("2026-09-19T00:00:00.000Z");
    expect(event.occurredAt).toBe("2026-09-19T05:30:00+05:30");
    expect(normalized.data).toEqual(event.data);
    expect(normalized.data).not.toBe(event.data);
  });

  it.each([
    { eventId: " " }, { eventId: "x".repeat(257) }, { sequence: 0 }, { sequence: 1.5 }, { sequence: -1 }, { sequence: 2147483648 },
    { occurredAt: "yesterday" }, { occurredAt: "2026-09-19T12:00:00" },
    { data: { type: "unknown" } }, { data: { type: "task.started", objective: "bypass" } },
    { data: { type: "tool.call", toolCallId: "a", toolName: "shell" } },
    { data: { type: "tool.result", toolCallId: "a", outcome: "maybe", output: null } },
    { data: { type: "observation", text: "" } }, { data: { type: "artifact", uri: "" } },
    { source: { uri: "" } }, { source: null },
  ])("rejects malformed event %j", change => {
    expect(() => validateEvent({ ...event, ...change } as AgentEventInput)).toThrow();
  });

  it("rejects non-JSON values, cycles, and oversized tool outputs", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const output of [NaN, Infinity, undefined, BigInt(1), () => 1, cyclic, new Date(), new Map(), "\0", "x".repeat(262144)]) {
      expect(() => validateEvent({ ...event, data: { type: "tool.result", toolCallId: "a", outcome: "success", output } } as AgentEventInput)).toThrow();
    }
  });

  it("requires trusted identity and denies ungranted project creation before any database call", async () => {
    const sql = vi.fn() as unknown as Sql;
    for (const access of [{ tenantId: "", agentId: "a" }, { tenantId: "t", agentId: "" }, { tenantId: "t", agentId: "a", projectIds: "p" }]) {
      expect(() => new PostgresAgentRunStore(sql, access as AgentRunAccess)).toThrow();
    }
    const store = new PostgresAgentRunStore(sql, { tenantId: "t", agentId: "a" });
    await expect(store.startRun({ runId: "run", taskId: "task", objective: "work", scope: { kind: "project", projectId: "secret" } })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(sql).not.toHaveBeenCalled();
  });

  it("exposes the scoped API through MemoGrafter without calling providers", async () => {
    const llm = { complete: vi.fn() };
    const embedder = { embed: vi.fn() };
    const memo = new MemoGrafter({ db: { connectionString: "postgres://unused" }, llm, embedder });
    expect(memo.agentRuns({ tenantId: "t", agentId: "a" })).toBeInstanceOf(PostgresAgentRunStore);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(embedder.embed).not.toHaveBeenCalled();
    await memo.close();
  });

  it("keeps packaged and standalone migrations in sync and registers tables for schema tooling", () => {
    expect(agentRunMigrationSql.replaceAll("\r\n", "\n")).toBe(readFileSync(new URL("../../../migrations/012_agent_runs.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
    expect(memoGrafterTables.map(table => table.name)).toEqual(expect.arrayContaining(["mg_agent_identities", "mg_agent_runs", "mg_agent_events"]));
  });
});
