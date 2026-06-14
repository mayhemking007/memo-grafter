import { describe, expect, it, vi } from "vitest";
import { MemoGrafter } from "../../src/core/MemoGrafter.js";
import type { EmbedAdapter, GraphStore, LLMAdapter, TopicNode } from "../../src/index.js";

function makeTopicNode(id = "topic-1"): TopicNode {
  return {
    id,
    sessionId: "session-1",
    segmentId: `segment-${id}`,
    label: "Authentication",
    summary: "The user discussed authentication.",
    embedding: [0.1, 0.2],
    messageRange: [0, 1],
    topicOrder: 1,
    driftScore: 0,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function createMemo(options: {
  seeds?: TopicNode[];
  graph?: { topK?: number; hopDepth?: number };
} = {}) {
  const embedder: EmbedAdapter = {
    embed: vi.fn(async () => [0.1, 0.2]),
  };
  const llm: LLMAdapter = {
    complete: vi.fn(async () => "response"),
  };
  const memo = new MemoGrafter({
    db: { connectionString: "postgres://example" },
    llm,
    embedder,
    ...(options.graph ? { graph: options.graph } : {}),
  });
  const store = {
    getSimilarNodes: vi.fn(async () => options.seeds ?? [makeTopicNode()]),
  };
  const grafterPipeline = {
    run: vi.fn(async () => ({
      systemPrompt: "prompt",
      nodes: options.seeds ?? [makeTopicNode()],
      tokenCount: 12,
    })),
  };
  const internals = memo as unknown as {
    store: Pick<GraphStore, "getSimilarNodes">;
    grafterPipeline: typeof grafterPipeline;
  };
  internals.store = store as Pick<GraphStore, "getSimilarNodes">;
  internals.grafterPipeline = grafterPipeline;

  return {
    memo,
    embedder,
    store,
    grafterPipeline,
  };
}

describe("MemoGrafter.graftByRelevance", () => {
  it("selects semantic seed nodes and grafts from those seeds", async () => {
    const seed = makeTopicNode("seed-1");
    const { memo, embedder, store, grafterPipeline } = createMemo({
      seeds: [seed],
      graph: { topK: 7, hopDepth: 3 },
    });

    const result = await memo.graftByRelevance("session-1", "authentication discussion");

    expect(embedder.embed).toHaveBeenCalledWith("authentication discussion");
    expect(store.getSimilarNodes).toHaveBeenCalledWith([0.1, 0.2], "session-1", {
      k: 7,
      minSimilarity: 0.6,
    });
    expect(grafterPipeline.run).toHaveBeenCalledWith("session-1", ["seed-1"], {
      hopDepth: 3,
      expansionStrategy: "graph",
    });
    expect(result.systemPrompt).toBe("prompt");
  });

  it("uses per-call relevance and expansion options", async () => {
    const seed = makeTopicNode("seed-1");
    const { memo, store, grafterPipeline } = createMemo({ seeds: [seed] });

    await memo.graftByRelevance("session-1", "authentication discussion", {
      topK: 2,
      minSimilarity: 0.72,
      hopDepth: 0,
      expansionStrategy: "none",
    });

    expect(store.getSimilarNodes).toHaveBeenCalledWith([0.1, 0.2], "session-1", {
      k: 2,
      minSimilarity: 0.72,
    });
    expect(grafterPipeline.run).toHaveBeenCalledWith("session-1", ["seed-1"], {
      hopDepth: 0,
      expansionStrategy: "none",
    });
  });

  it("returns an empty graft when semantic search finds no seed nodes", async () => {
    const { memo, grafterPipeline } = createMemo({ seeds: [] });

    const result = await memo.graftByRelevance("session-1", "missing context");

    expect(result).toEqual({ systemPrompt: "", nodes: [], tokenCount: 0 });
    expect(grafterPipeline.run).not.toHaveBeenCalled();
  });
});
