import { expect, it } from "vitest";
import { PostgresGraphStore } from "../../../src/store/index.js";
import type { MemoryNodeInsert } from "../../../src/core/types.js";

it("counts only rows returned by successful inserts, including conflict no-ops", async () => {
  const sql = Object.assign(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("INSERT INTO mg_memory_nodes")) {
      expect(query).toContain("ON CONFLICT (id) DO NOTHING RETURNING id");
      return inserted ? [] : (inserted = true, [{ id: "memory" }]);
    }
    return [];
  }, { json: (value: unknown) => value, array: (values: unknown[]) => values, begin: async <T>(work: (transaction: unknown) => Promise<T>) => work(sql) });
  let inserted = false;
  const store = new PostgresGraphStore("postgres://user:pass@localhost:5432/test");
  Object.assign(store, { sql });
  const memory: MemoryNodeInsert = {
    id: "memory", segmentId: "segment", topicNodeId: "topic", agentId: null, sessionId: "session",
    memoryType: "fact", sourceType: "document", subject: "Project", predicate: "uses", value: "TypeScript",
    quality: { explicitness: 1, sourceReliability: 1, stability: 1, salience: 1 }, embedding: [1, 0],
    sourceUrl: null, sourceTitle: null, supersededBy: null, decayed: false, agentColor: null, fleetId: null,
  };
  await expect(store.insertMemories([memory])).resolves.toEqual({ inserted: 1 });
  await expect(store.insertMemories([memory])).resolves.toEqual({ inserted: 0 });
  await expect(store.insertMemories([])).resolves.toEqual({ inserted: 0 });
});
