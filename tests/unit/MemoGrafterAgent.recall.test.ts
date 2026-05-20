import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoGrafterAgent } from "../../src/MemoGrafterAgent.js";
import { RetrieverPipeline } from "../../src/pipeline/RetrieverPipeline.js";
import type { GraphStore } from "../../src/store/index.js";
import type {
  EmbedAdapter,
  LLMAdapter,
  MemoryNode,
  MemoGrafterConfig,
  Message,
  RetrievalResult,
  TopicNode,
} from "../../src/types.js";

type ScoredMemoryNode = MemoryNode & { similarity: number };
type SearchMemoriesCall = {
  embedding: number[];
  sessionId: string;
  limit: number;
  minSimilarity: number;
};

class FakeLLMAdapter implements LLMAdapter {
  async complete(messages: Message[]): Promise<string> {
    return `Response to: ${messages.at(-1)?.content ?? ""}`;
  }
}

class FakeEmbedAdapter implements EmbedAdapter {
  constructor(private readonly vector = [0.1, 0.2, 0.3]) {}

  async embed(): Promise<number[]> {
    return this.vector;
  }
}

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

function createAgent(overrides: Partial<MemoGrafterConfig> = {}): MemoGrafterAgent {
  return new MemoGrafterAgent({
    db: { connectionString: "postgres://user:pass@localhost:5432/memografter_test" },
    llm: new FakeLLMAdapter(),
    embedder: new FakeEmbedAdapter(),
    ...overrides,
  });
}

function patchStore(
  agent: MemoGrafterAgent,
  store: Partial<{
    searchMemories: GraphStore["searchMemories"];
    getTopicNode: GraphStore["getTopicNode"];
  }>,
): void {
  const core = (agent as unknown as { core: { store: GraphStore } }).core;
  Object.assign(core.store, store);
}

let originalRun: typeof RetrieverPipeline.prototype.run;

beforeEach(() => {
  originalRun = RetrieverPipeline.prototype.run;
});

afterEach(() => {
  RetrieverPipeline.prototype.run = originalRun;
});

describe("MemoGrafterAgent.recall", () => {
  it("returns pipeline result directly", async () => {
    const agent = createAgent();
    const result: RetrievalResult = {
      facts: [
        makeScoredMemoryNode({
          memoryType: "fact",
          subject: "deployment",
          predicate: "uses",
          value: "blue-green rollout",
          confidence: 0.9,
        }),
      ],
      nodes: [
        makeTopicNode({
          label: "Deployment",
          summary: "Deployment summary.",
          topicOrder: 1,
        }),
      ],
      systemPrompt: "retrieved memory",
      tokenCount: 12,
    };
    RetrieverPipeline.prototype.run = async () => result;

    await expect(agent.recall("deployment")).resolves.toBe(result);
    expect(Object.keys(await agent.recall("deployment"))).toEqual(Object.keys(result));
  });

  it("forwards options to RetrieverPipeline", async () => {
    const agent = createAgent();
    const calls: SearchMemoriesCall[] = [];
    patchStore(agent, {
      searchMemories: async (embedding, sessionId, limit, minSimilarity) => {
        calls.push({ embedding, sessionId, limit, minSimilarity });
        return [];
      },
    });

    await agent.recall("deployment", {
      limit: 5,
      minSimilarity: 0.7,
      tokenBudget: 800,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      embedding: [0.1, 0.2, 0.3],
      sessionId: agent.getSessionId(),
      limit: 5,
      minSimilarity: 0.7,
    });
  });

  it("applies default options when none are provided", async () => {
    const agent = createAgent();
    const calls: SearchMemoriesCall[] = [];
    patchStore(agent, {
      searchMemories: async (embedding, sessionId, limit, minSimilarity) => {
        calls.push({ embedding, sessionId, limit, minSimilarity });
        return [];
      },
    });

    await agent.recall("deployment");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      limit: 10,
      minSimilarity: 0.6,
    });
  });

  it("returns an empty result when the pipeline returns no facts", async () => {
    const agent = createAgent();
    const result: RetrievalResult = {
      facts: [],
      nodes: [],
      systemPrompt: "empty retrieval",
      tokenCount: 0,
    };
    RetrieverPipeline.prototype.run = async () => result;

    await expect(agent.recall("nothing")).resolves.toMatchObject({
      facts: [],
      nodes: [],
      tokenCount: 0,
    });
  });

  it("propagates pipeline errors without changing the message", async () => {
    const agent = createAgent();
    RetrieverPipeline.prototype.run = async () => {
      throw new Error("embed failed");
    };

    await expect(agent.recall("deployment")).rejects.toThrow("embed failed");
  });
});
