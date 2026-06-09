import { describe, expect, it, vi } from "vitest";
import { MemoGrafter } from "../../src/MemoGrafter.js";
import type { EmbedAdapter, GraphStore, LLMAdapter } from "../../src/index.js";

function createMemo(changes: {
  forgetMemory?: boolean;
  forgetMemories?: number;
  suppressTopic?: boolean;
  restoreTopic?: boolean;
} = {}) {
  const llm: LLMAdapter = {
    complete: vi.fn(async () => "response"),
  };
  const embedder: EmbedAdapter = {
    embed: vi.fn(async () => [0.1, 0.2]),
  };
  const memo = new MemoGrafter({
    db: { connectionString: "postgres://example" },
    llm,
    embedder,
  });
  const store = {
    forgetMemory: vi.fn(async () => changes.forgetMemory ?? true),
    forgetMemories: vi.fn(async () => changes.forgetMemories ?? 2),
    suppressTopic: vi.fn(async () => changes.suppressTopic ?? true),
    restoreTopic: vi.fn(async () => changes.restoreTopic ?? true),
    getMemoryHistoryById: vi.fn(async () => ({ entries: [], edges: [], currentMemory: null })),
    getMemoryHistoryByFact: vi.fn(async () => ({ entries: [], edges: [], currentMemory: null })),
    getMemoryDiff: vi.fn(async () => ({
      from: {},
      to: {},
      fields: [],
      changedFields: [],
      relationship: {
        supersedes: false,
        supersededBy: false,
        conflicts: false,
        updateEdges: [],
        conflictEdges: [],
      },
    })),
  };
  const cache = {
    keys: vi.fn(async () => ["mg:recall:session-1:key"]),
    del: vi.fn(async () => 1),
  };
  const internals = memo as unknown as {
    store: Pick<GraphStore,
      | "forgetMemory"
      | "forgetMemories"
      | "suppressTopic"
      | "restoreTopic"
      | "getMemoryHistoryById"
      | "getMemoryHistoryByFact"
      | "getMemoryDiff"
    >;
    recallCache: typeof cache;
  };
  internals.store = store;
  internals.recallCache = cache;

  return { memo, store, cache };
}

describe("MemoGrafter lifecycle APIs", () => {
  it("forgets a single memory and clears recall cache", async () => {
    const { memo, store, cache } = createMemo();

    await expect(memo.forget("memory-1")).resolves.toBe(true);

    expect(store.forgetMemory).toHaveBeenCalledWith("memory-1");
    expect(cache.keys).toHaveBeenCalledWith("mg:recall:*");
    expect(cache.del).toHaveBeenCalledWith("mg:recall:session-1:key");
  });

  it("forgets memories in bulk and returns the changed count", async () => {
    const { memo, store, cache } = createMemo({ forgetMemories: 3 });

    await expect(memo.forgetMany(["memory-a", "memory-b", "memory-c"])).resolves.toBe(3);

    expect(store.forgetMemories).toHaveBeenCalledWith(["memory-a", "memory-b", "memory-c"]);
    expect(cache.keys).toHaveBeenCalledWith("mg:recall:*");
  });

  it("suppresses and restores topics", async () => {
    const { memo, store, cache } = createMemo();

    await expect(memo.suppressTopic("topic-1")).resolves.toBe(true);
    await expect(memo.restoreTopic("topic-1")).resolves.toBe(true);

    expect(store.suppressTopic).toHaveBeenCalledWith("topic-1");
    expect(store.restoreTopic).toHaveBeenCalledWith("topic-1");
    expect(cache.keys).toHaveBeenCalledTimes(2);
  });

  it("does not clear cache when no lifecycle state changed", async () => {
    const { memo, cache } = createMemo({
      forgetMemory: false,
      forgetMemories: 0,
      suppressTopic: false,
      restoreTopic: false,
    });

    await expect(memo.forget("memory-1")).resolves.toBe(false);
    await expect(memo.forgetMany(["memory-2"])).resolves.toBe(0);
    await expect(memo.suppressTopic("topic-1")).resolves.toBe(false);
    await expect(memo.restoreTopic("topic-1")).resolves.toBe(false);

    expect(cache.keys).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it("routes memory history and diff APIs to the store", async () => {
    const { memo, store } = createMemo();

    await memo.getMemoryHistory("memory-1", { sessionId: "session-1" });
    await memo.getMemoryHistory("user", "location", { sessionId: "session-1" });
    await memo.getMemoryDiff("memory-a", "memory-b");

    expect(store.getMemoryHistoryById).toHaveBeenCalledWith("memory-1", { sessionId: "session-1" });
    expect(store.getMemoryHistoryByFact).toHaveBeenCalledWith("user", "location", { sessionId: "session-1" });
    expect(store.getMemoryDiff).toHaveBeenCalledWith("memory-a", "memory-b");
  });
});
