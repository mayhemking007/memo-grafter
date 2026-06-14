import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoGrafterAgent } from "../../../src/agents/MemoGrafterAgent.js";
import type {
  EmbedAdapter,
  LLMAdapter,
  MemoGrafterConfig,
  MemoryNode,
  Message,
  RetrievalResult,
  RetrieverConfig,
} from "../../../src/core/types.js";

type AgentInternals = {
  core: {
    llm: LLMAdapter;
    store: {
      getSessionNodeCount(sessionId: string): Promise<number>;
    };
    enqueueIngest(messages: Message[], sessionId: string): Promise<void>;
  };
  recall(query: string, options?: RetrieverConfig): Promise<RetrievalResult>;
};

class CapturingLLMAdapter implements LLMAdapter {
  calls: Array<{ messages: Message[]; system?: string }> = [];

  async complete(messages: Message[], system?: string): Promise<string> {
    this.calls.push({ messages: [...messages], system });
    return `Response to: ${messages.at(-1)?.content ?? ""}`;
  }
}

class FakeEmbedAdapter implements EmbedAdapter {
  async embed(): Promise<number[]> {
    return [0.1, 0.2, 0.3];
  }
}

function createAgent(overrides: Partial<MemoGrafterConfig> = {}): MemoGrafterAgent {
  return new MemoGrafterAgent({
    db: { connectionString: "postgres://user:pass@localhost:5432/memografter_test" },
    llm: new CapturingLLMAdapter(),
    embedder: new FakeEmbedAdapter(),
    ...overrides,
  });
}

function internals(agent: MemoGrafterAgent): AgentInternals {
  return agent as unknown as AgentInternals;
}

function memory(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: "memory-1",
    segmentId: "segment-1",
    topicNodeId: "topic-1",
    agentId: null,
    sessionId: "session-1",
    memoryType: "fact",
    sourceType: "conversation",
    subject: "traveler",
    predicate: "prefers",
    value: "quiet towns in Japan",
    confidence: 1,
    embedding: [0.1, 0.2, 0.3],
    sourceUrl: null,
    sourceTitle: null,
    supersededBy: null,
    decayed: false,
    agentColor: null,
    fleetId: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function retrievalResult(systemPrompt: string): RetrievalResult {
  return {
    facts: [{ ...memory(), similarity: 0.9 }],
    nodes: [],
    systemPrompt,
    tokenCount: Math.ceil(systemPrompt.length / 4),
  };
}

describe("MemoGrafterAgent.invoke memory context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips recall when the session has no topic nodes", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent({ llm });
    const privateAgent = internals(agent);
    privateAgent.core.enqueueIngest = vi.fn<AgentInternals["core"]["enqueueIngest"]>().mockResolvedValue(undefined);
    privateAgent.core.store.getSessionNodeCount = vi.fn<AgentInternals["core"]["store"]["getSessionNodeCount"]>()
      .mockResolvedValue(0);
    privateAgent.recall = vi.fn<AgentInternals["recall"]>().mockResolvedValue(retrievalResult("should not inject"));

    await agent.invoke("Suggest a reflective blog intro for my Japan trip.");

    expect(privateAgent.core.store.getSessionNodeCount).toHaveBeenCalledTimes(1);
    expect(privateAgent.recall).not.toHaveBeenCalled();
    expect(llm.calls[0]?.messages).toEqual([
      { role: "user", content: "Suggest a reflective blog intro for my Japan trip." },
    ]);
  });

  it("injects recalled memories before raw history and the current user message", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent({
      llm,
      inject: {
        recentWindowSize: 1,
        recallLimit: 3,
        recallMinSimilarity: 0.7,
      },
    });
    const privateAgent = internals(agent);
    privateAgent.core.enqueueIngest = vi.fn<AgentInternals["core"]["enqueueIngest"]>().mockResolvedValue(undefined);
    privateAgent.core.store.getSessionNodeCount = vi.fn<AgentInternals["core"]["store"]["getSessionNodeCount"]>()
      .mockResolvedValue(2);
    privateAgent.recall = vi.fn<AgentInternals["recall"]>().mockResolvedValue(retrievalResult("Relevant memory"));

    await agent.invoke("Earlier turn.");
    llm.calls.length = 0;
    await agent.invoke("Suggest a reflective blog intro for my Japan trip.");

    expect(privateAgent.recall).toHaveBeenLastCalledWith(
      "Suggest a reflective blog intro for my Japan trip.",
      { limit: 3, minSimilarity: 0.7 },
    );
    expect(llm.calls[0]?.messages).toEqual([
      { role: "system", content: "Relevant memory" },
      { role: "assistant", content: "Response to: Earlier turn." },
      { role: "user", content: "Suggest a reflective blog intro for my Japan trip." },
    ]);
  });

  it("continues with raw history when recall fails", async () => {
    const llm = new CapturingLLMAdapter();
    const agent = createAgent({ llm, inject: { recentWindowSize: 2 } });
    const privateAgent = internals(agent);
    privateAgent.core.enqueueIngest = vi.fn<AgentInternals["core"]["enqueueIngest"]>().mockResolvedValue(undefined);
    privateAgent.core.store.getSessionNodeCount = vi.fn<AgentInternals["core"]["store"]["getSessionNodeCount"]>()
      .mockResolvedValue(1);
    privateAgent.recall = vi.fn<AgentInternals["recall"]>().mockRejectedValue(new Error("embed failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await agent.invoke("Hello.");

    expect(warn).toHaveBeenCalledWith("MemoGrafter recall warning:", expect.any(Error));
    expect(llm.calls[0]?.messages).toEqual([{ role: "user", content: "Hello." }]);
  });
});
