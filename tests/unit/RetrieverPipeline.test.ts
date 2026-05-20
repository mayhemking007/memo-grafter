import { describe, expect, it } from "vitest";
import { buildFactRetrievalPrompt, formatFactBlock } from "../../src/prompts/factRetrievalPrompt.js";
import { RetrieverPipeline } from "../../src/pipeline/RetrieverPipeline.js";
import type { GraphStore } from "../../src/store/index.js";
import type { EmbedAdapter, MemoryNode, TopicNode } from "../../src/types.js";
import { countApproxTokens } from "../../src/utils/text/tokenCount.js";

type ScoredMemoryNode = MemoryNode & { similarity: number };

function makeMemoryNode(
  overrides: Partial<MemoryNode> &
    Pick<MemoryNode, "memoryType" | "subject" | "predicate" | "value" | "confidence">,
): MemoryNode {
  const base: MemoryNode = {
    id: "memory-1",
    segmentId: "segment-1",
    topicNodeId: "topic-1",
    agentId: null,
    sessionId: "session-1",
    memoryType: "fact",
    sourceType: "conversation",
    subject: "subject",
    predicate: "predicate",
    value: "value",
    confidence: 1,
    embedding: [0.1, 0.2],
    sourceUrl: null,
    sourceTitle: null,
    supersededBy: null,
    decayed: false,
    agentColor: null,
    fleetId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return { ...base, ...overrides };
}

function makeScoredMemoryNode(
  overrides: Partial<ScoredMemoryNode> &
    Pick<MemoryNode, "memoryType" | "subject" | "predicate" | "value" | "confidence">,
): ScoredMemoryNode {
  return {
    ...makeMemoryNode(overrides),
    similarity: overrides.similarity ?? 0.9,
  };
}

function makeTopicNode(
  overrides: Partial<TopicNode> & Pick<TopicNode, "label" | "summary" | "topicOrder">,
): TopicNode {
  const base: TopicNode = {
    id: "topic-1",
    sessionId: "session-1",
    segmentId: "segment-1",
    label: "Topic",
    summary: "Topic summary.",
    embedding: [0.1, 0.2],
    messageRange: [0, 1],
    topicOrder: 1,
    driftScore: 0,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return { ...base, ...overrides };
}

function makeEmbedder(vector = [0.1, 0.2, 0.3]): EmbedAdapter {
  return {
    embed: async () => vector,
  };
}

function makeStore(
  overrides: Partial<{
    searchMemories: GraphStore["searchMemories"];
    getTopicNode: GraphStore["getTopicNode"];
  }> = {},
): GraphStore {
  return {
    searchMemories: async () => [],
    getTopicNode: async () => null,
    ...overrides,
  } as unknown as GraphStore;
}

describe("RetrieverPipeline", () => {
  it("returns early on empty search results", async () => {
    const pipeline = new RetrieverPipeline(makeStore(), makeEmbedder(), {});

    const result = await pipeline.run("query", "session-1");

    expect(result.facts).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.systemPrompt).toBe(buildFactRetrievalPrompt([]));
  });

  it("filters decayed stale nodes", async () => {
    const stale = makeScoredMemoryNode({
      id: "decayed",
      memoryType: "fact",
      subject: "old",
      predicate: "uses",
      value: "stale value",
      confidence: 0.9,
      decayed: true,
      similarity: 0.95,
    });
    const active = makeScoredMemoryNode({
      id: "active",
      memoryType: "fact",
      subject: "current",
      predicate: "uses",
      value: "active value",
      confidence: 0.9,
      decayed: false,
      similarity: 0.9,
    });
    const topic = makeTopicNode({
      id: active.topicNodeId,
      label: "Active Topic",
      summary: "Active topic summary.",
      topicOrder: 1,
    });
    const topicCalls: Array<[string, string | undefined]> = [];
    const store = makeStore({
      searchMemories: async () => [stale, active],
      getTopicNode: async (topicNodeId, sessionId) => {
        topicCalls.push([topicNodeId, sessionId]);
        return topic;
      },
    });
    const pipeline = new RetrieverPipeline(store, makeEmbedder(), {});

    const result = await pipeline.run("query", "session-1");

    expect(result.facts.map((fact) => fact.id)).toEqual(["active"]);
    expect(topicCalls).toEqual([[active.topicNodeId, "session-1"]]);
  });

  it("filters superseded stale nodes", async () => {
    const superseded = makeScoredMemoryNode({
      id: "superseded",
      memoryType: "fact",
      subject: "old",
      predicate: "uses",
      value: "superseded value",
      confidence: 0.9,
      supersededBy: "11111111-1111-1111-1111-111111111111",
      similarity: 0.95,
    });
    const active = makeScoredMemoryNode({
      id: "active",
      memoryType: "fact",
      subject: "current",
      predicate: "uses",
      value: "active value",
      confidence: 0.9,
      supersededBy: null,
      similarity: 0.9,
    });
    const topic = makeTopicNode({
      id: active.topicNodeId,
      label: "Active Topic",
      summary: "Active topic summary.",
      topicOrder: 1,
    });
    const pipeline = new RetrieverPipeline(
      makeStore({
        searchMemories: async () => [superseded, active],
        getTopicNode: async () => topic,
      }),
      makeEmbedder(),
      {},
    );

    const result = await pipeline.run("query", "session-1");

    expect(result.facts.map((fact) => fact.id)).toEqual(["active"]);
  });

  it("returns early when all nodes are stale", async () => {
    const decayed = makeScoredMemoryNode({
      id: "decayed",
      memoryType: "fact",
      subject: "old",
      predicate: "uses",
      value: "stale value",
      confidence: 0.9,
      decayed: true,
      similarity: 0.95,
    });
    const superseded = makeScoredMemoryNode({
      id: "superseded",
      memoryType: "fact",
      subject: "older",
      predicate: "uses",
      value: "superseded value",
      confidence: 0.9,
      supersededBy: "11111111-1111-1111-1111-111111111111",
      similarity: 0.9,
    });
    const pipeline = new RetrieverPipeline(
      makeStore({ searchMemories: async () => [decayed, superseded] }),
      makeEmbedder(),
      {},
    );

    const result = await pipeline.run("query", "session-1");

    expect(result.facts).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.tokenCount).toBe(0);
  });

  it("skips orphan nodes silently", async () => {
    const orphan = makeScoredMemoryNode({
      id: "orphan",
      memoryType: "fact",
      subject: "orphan",
      predicate: "has",
      value: "no topic",
      confidence: 0.9,
      similarity: 0.95,
    });
    const pipeline = new RetrieverPipeline(
      makeStore({
        searchMemories: async () => [orphan],
        getTopicNode: async () => null,
      }),
      makeEmbedder(),
      {},
    );

    await expect(pipeline.run("query", "session-1")).resolves.toMatchObject({
      facts: [],
      nodes: [],
    });
  });

  it("ranks blocks by highest similarity", async () => {
    const topicA = makeTopicNode({
      id: "topic-a",
      label: "Topic A",
      summary: "Topic A summary.",
      topicOrder: 1,
    });
    const topicB = makeTopicNode({
      id: "topic-b",
      label: "Topic B",
      summary: "Topic B summary.",
      topicOrder: 2,
    });
    const facts = [
      makeScoredMemoryNode({
        id: "a-high",
        topicNodeId: "topic-a",
        memoryType: "fact",
        subject: "a",
        predicate: "has",
        value: "high",
        confidence: 0.9,
        similarity: 0.95,
      }),
      makeScoredMemoryNode({
        id: "b-only",
        topicNodeId: "topic-b",
        memoryType: "fact",
        subject: "b",
        predicate: "has",
        value: "only",
        confidence: 0.9,
        similarity: 0.88,
      }),
      makeScoredMemoryNode({
        id: "a-low",
        topicNodeId: "topic-a",
        memoryType: "fact",
        subject: "a",
        predicate: "has",
        value: "low",
        confidence: 0.9,
        similarity: 0.7,
      }),
    ];
    const pipeline = new RetrieverPipeline(
      makeStore({
        searchMemories: async () => facts,
        getTopicNode: async (topicNodeId) => topicNodeId === "topic-a" ? topicA : topicB,
      }),
      makeEmbedder(),
      {},
    );

    const result = await pipeline.run("query", "session-1");

    expect(result.nodes[0]?.id).toBe("topic-a");
  });

  it("drops whole blocks when the token budget is exhausted", async () => {
    const topicA = makeTopicNode({
      id: "topic-a",
      label: "Topic A",
      summary: "Topic A summary.",
      topicOrder: 1,
    });
    const topicB = makeTopicNode({
      id: "topic-b",
      label: "Topic B",
      summary: "Topic B summary.",
      topicOrder: 2,
    });
    const factA = makeScoredMemoryNode({
      id: "a",
      topicNodeId: "topic-a",
      memoryType: "fact",
      subject: "a",
      predicate: "has",
      value: "higher ranked value",
      confidence: 0.9,
      similarity: 0.95,
    });
    const factB = makeScoredMemoryNode({
      id: "b",
      topicNodeId: "topic-b",
      memoryType: "fact",
      subject: "b",
      predicate: "has",
      value: "lower ranked value",
      confidence: 0.9,
      similarity: 0.88,
    });
    const budget = countApproxTokens(formatFactBlock([factA], topicA));
    const pipeline = new RetrieverPipeline(
      makeStore({
        searchMemories: async () => [factA, factB],
        getTopicNode: async (topicNodeId) => topicNodeId === "topic-a" ? topicA : topicB,
      }),
      makeEmbedder(),
      { tokenBudget: budget },
    );

    const result = await pipeline.run("query", "session-1");

    expect(result.facts.map((fact) => fact.id)).toEqual(["a"]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.id).toBe("topic-a");
  });

  it("returns a flat facts array in ranked block order", async () => {
    const topicA = makeTopicNode({
      id: "topic-a",
      label: "Topic A",
      summary: "Topic A summary.",
      topicOrder: 1,
    });
    const topicB = makeTopicNode({
      id: "topic-b",
      label: "Topic B",
      summary: "Topic B summary.",
      topicOrder: 2,
    });
    const facts = [
      makeScoredMemoryNode({
        id: "a-1",
        topicNodeId: "topic-a",
        memoryType: "fact",
        subject: "a1",
        predicate: "has",
        value: "first",
        confidence: 0.9,
        similarity: 0.95,
      }),
      makeScoredMemoryNode({
        id: "b-1",
        topicNodeId: "topic-b",
        memoryType: "fact",
        subject: "b1",
        predicate: "has",
        value: "first",
        confidence: 0.9,
        similarity: 0.9,
      }),
      makeScoredMemoryNode({
        id: "a-2",
        topicNodeId: "topic-a",
        memoryType: "fact",
        subject: "a2",
        predicate: "has",
        value: "second",
        confidence: 0.9,
        similarity: 0.7,
      }),
      makeScoredMemoryNode({
        id: "b-2",
        topicNodeId: "topic-b",
        memoryType: "fact",
        subject: "b2",
        predicate: "has",
        value: "second",
        confidence: 0.9,
        similarity: 0.6,
      }),
    ];
    const pipeline = new RetrieverPipeline(
      makeStore({
        searchMemories: async () => facts,
        getTopicNode: async (topicNodeId) => topicNodeId === "topic-a" ? topicA : topicB,
      }),
      makeEmbedder(),
      { tokenBudget: 1200 },
    );

    const result = await pipeline.run("query", "session-1");

    expect(result.facts).toHaveLength(4);
    expect(result.facts.map((fact) => fact.id)).toEqual(["a-1", "a-2", "b-1", "b-2"]);
  });
});
