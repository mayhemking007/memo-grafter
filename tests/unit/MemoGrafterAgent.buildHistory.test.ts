import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoGrafterAgent } from "../../src/MemoGrafterAgent.js";
import type {
  EmbedAdapter,
  LLMAdapter,
  MemoGrafterConfig,
  Message,
  RetrievalResult,
  RetrieverConfig,
  TopicNode,
  TopicSegment,
} from "../../src/types.js";

type AgentInternals = {
  buildHistory(): Promise<Message[]>;
  history: Message[];
  core: {
    getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }>;
  };
  recall(query: string, options?: RetrieverConfig): Promise<RetrievalResult>;
};

class FakeLLMAdapter implements LLMAdapter {
  async complete(messages: Message[]): Promise<string> {
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
    llm: new FakeLLMAdapter(),
    embedder: new FakeEmbedAdapter(),
    ...overrides,
  });
}

function internals(agent: MemoGrafterAgent): AgentInternals {
  return agent as unknown as AgentInternals;
}

function pushHistory(agent: MemoGrafterAgent, messages: Message[]): Message[] {
  const history = internals(agent).history;
  history.push(...messages);
  return history;
}

function retrievalResult(systemPrompt: string): RetrievalResult {
  return {
    facts: [],
    nodes: [],
    systemPrompt,
    tokenCount: Math.ceil(systemPrompt.length / 4),
  };
}

describe("MemoGrafterAgent.buildHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns raw history under the overflow threshold without recall or topic lookup", async () => {
    const agent = createAgent({ inject: { tokenBudget: 1200 } });
    const privateAgent = internals(agent);
    const history = pushHistory(agent, [
      { role: "user", content: "Short question." },
      { role: "assistant", content: "Short answer." },
    ]);
    const recall = vi.fn<AgentInternals["recall"]>();
    const getTopics = vi.fn<AgentInternals["core"]["getTopics"]>();
    privateAgent.recall = recall;
    privateAgent.core.getTopics = getTopics;

    const messages = await privateAgent.buildHistory();

    expect(messages).toBe(history);
    expect(recall).not.toHaveBeenCalled();
    expect(getTopics).not.toHaveBeenCalled();
  });

  it("injects recalled memory as a pinned system message and keeps the recent window on overflow", async () => {
    const agent = createAgent({ inject: { tokenBudget: 20, recentWindowSize: 3 } });
    const privateAgent = internals(agent);
    const history = pushHistory(agent, [
      { role: "user", content: "Message 1 " + "a".repeat(80) },
      { role: "assistant", content: "Message 2 " + "b".repeat(80) },
      { role: "user", content: "Message 3 " + "c".repeat(80) },
      { role: "assistant", content: "Message 4 " + "d".repeat(80) },
      { role: "user", content: "Message 5 " + "e".repeat(80) },
      { role: "assistant", content: "Message 6 " + "f".repeat(80) },
      { role: "user", content: "Message 7 " + "g".repeat(80) },
    ]);
    const recall = vi.fn<AgentInternals["recall"]>().mockResolvedValue(retrievalResult("retrieved memory"));
    const getTopics = vi.fn<AgentInternals["core"]["getTopics"]>().mockRejectedValue(new Error("should not be called"));
    privateAgent.recall = recall;
    privateAgent.core.getTopics = getTopics;

    const messages = await privateAgent.buildHistory();

    expect(recall).toHaveBeenCalledTimes(1);
    expect(recall).toHaveBeenCalledWith(
      history
        .slice(-6)
        .map((message) => message.content)
        .join("\n"),
      { limit: 5, minSimilarity: 0.65 },
    );
    expect(getTopics).not.toHaveBeenCalled();
    expect(messages).toEqual([{ role: "system", content: "retrieved memory" }, ...history.slice(-3)]);
  });

  it("falls back to the recent window when recall fails", async () => {
    const agent = createAgent({ inject: { tokenBudget: 20, recentWindowSize: 2 } });
    const privateAgent = internals(agent);
    const history = pushHistory(agent, [
      { role: "user", content: "Message 1 " + "a".repeat(80) },
      { role: "assistant", content: "Message 2 " + "b".repeat(80) },
      { role: "user", content: "Message 3 " + "c".repeat(80) },
    ]);
    privateAgent.recall = vi.fn<AgentInternals["recall"]>().mockRejectedValue(new Error("embed failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const messages = await privateAgent.buildHistory();

    expect(messages).toEqual(history.slice(-2));
    expect(warn).toHaveBeenCalledWith("MemoGrafter recall warning:", expect.any(Error));
  });
});
