import { describe, expect, it } from "vitest";
import { PostgresGraphStore } from "../../../src/store/index.js";
import type { MemoryEdge } from "../../../src/types.js";

type SqlCall = {
  text: string;
  values: unknown[];
};

type FakeSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  array(values: string[]): string[];
};

function createStoreWithSql(results: unknown[][]): {
  store: PostgresGraphStore;
  calls: SqlCall[];
} {
  const calls: SqlCall[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return results.shift() ?? [];
  }) as FakeSql;
  sql.array = (values) => values;

  const store = new PostgresGraphStore("postgres://user:pass@localhost:5432/memografter_test");
  (store as unknown as { sql: FakeSql }).sql = sql;

  return { store, calls };
}

describe("PostgresGraphStore maintenance methods", () => {
  it("does not execute SQL when marking an empty conflict set", async () => {
    const { store, calls } = createStoreWithSql([]);

    await expect(store.markMemoryNodesConflicting([])).resolves.toBe(0);

    expect(calls).toHaveLength(0);
  });

  it("returns the number of memories marked conflicting", async () => {
    const { store, calls } = createStoreWithSql([[{ id: "memory-a" }, { id: "memory-b" }]]);

    await expect(store.markMemoryNodesConflicting(["memory-a", "memory-b"])).resolves.toBe(2);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("SET has_conflict = TRUE");
    expect(calls[0]?.values).toContainEqual(["memory-a", "memory-b"]);
  });

  it("reports whether a memory was superseded", async () => {
    const changed = createStoreWithSql([[{ id: "old-memory" }]]);
    const unchanged = createStoreWithSql([[]]);

    await expect(changed.store.markMemoryNodeSuperseded("old-memory", "new-memory")).resolves.toBe(true);
    await expect(unchanged.store.markMemoryNodeSuperseded("old-memory", "new-memory")).resolves.toBe(false);

    expect(changed.calls[0]?.text).toContain("SET superseded_by");
    expect(changed.calls[0]?.text).toContain("AND superseded_by IS NULL");
  });

  it("reports whether a memory was marked decayed", async () => {
    const changed = createStoreWithSql([[{ id: "stale-memory" }]]);
    const unchanged = createStoreWithSql([[]]);

    await expect(changed.store.markMemoryNodeDecayed("stale-memory")).resolves.toBe(true);
    await expect(unchanged.store.markMemoryNodeDecayed("stale-memory")).resolves.toBe(false);

    expect(changed.calls[0]?.text).toContain("SET decayed = TRUE");
    expect(changed.calls[0]?.text).toContain("AND decayed = FALSE");
    expect(changed.calls[0]?.text).toContain("AND superseded_by IS NULL");
  });

  it("reports whether memory confidence was updated", async () => {
    const changed = createStoreWithSql([[{ id: "memory-1" }]]);
    const unchanged = createStoreWithSql([[]]);

    await expect(changed.store.updateMemoryNodeConfidence("memory-1", 0.45)).resolves.toBe(true);
    await expect(unchanged.store.updateMemoryNodeConfidence("memory-1", 0.45)).resolves.toBe(false);

    expect(changed.calls[0]?.text).toContain("SET confidence =");
    expect(changed.calls[0]?.values).toContain(0.45);
  });

  it("does not insert a duplicate memory edge", async () => {
    const { store, calls } = createStoreWithSql([[{ id: "edge-1" }]]);

    await expect(store.upsertMemoryEdge({
      sourceId: "memory-a",
      targetId: "memory-b",
      edgeType: "conflicts",
    })).resolves.toBe(false);

    expect(calls).toHaveLength(1);
  });

  it("inserts a memory edge when none exists", async () => {
    const { store, calls } = createStoreWithSql([[], []]);

    await expect(store.upsertMemoryEdge({
      sourceId: "memory-a",
      targetId: "memory-b",
      edgeType: "related",
      weight: 0.7,
    })).resolves.toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.text).toContain("INSERT INTO mg_memory_edges");
    expect(calls[1]?.values).toEqual(["memory-a", "memory-b", "related", 0.7]);
  });

  it("uses directional lookup for update edges", async () => {
    const { store, calls } = createStoreWithSql([[], []]);

    await store.upsertMemoryEdge({
      sourceId: "new-memory",
      targetId: "old-memory",
      edgeType: "updates",
    });

    expect(calls[0]?.text).not.toContain(" OR ");
    expect(calls[1]?.values).toEqual(["new-memory", "old-memory", "updates", 1]);
  });

  it("uses symmetric lookup for non-update maintenance edges", async () => {
    const { store, calls } = createStoreWithSql([[], []]);
    const edge: Pick<MemoryEdge, "sourceId" | "targetId" | "edgeType"> = {
      sourceId: "memory-a",
      targetId: "memory-b",
      edgeType: "conflicts",
    };

    await store.upsertMemoryEdge(edge);

    expect(calls[0]?.text).toContain(" OR ");
    expect(calls[0]?.values).toEqual(["conflicts", "memory-a", "memory-b", "memory-b", "memory-a"]);
  });
});
