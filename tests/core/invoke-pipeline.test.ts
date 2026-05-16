import assert from "node:assert/strict";
import { MemoGrafterAgent, type EmbedAdapter, type LLMAdapter, type Message, type MemoGrafterConfig, type TopicNode, type TopicSegment } from "../../src/index.js";
import { formatCompressedTopic } from "../../src/prompts/historyCompressionPrompt.js";

console.log("invoke() pipeline - no mid-session graph injection");

type TestCore = {
  getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }>;
  inject(sessionId: string, topicIds: string[]): Promise<{ systemPrompt: string; nodes: TopicNode[]; tokenCount: number }>;
  enqueueIngest(messages: Message[], sessionId: string): Promise<void>;
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
    return new Array<number>(1536).fill(0);
  }
}

function createAgent(overrides: Partial<MemoGrafterConfig> = {}): MemoGrafterAgent {
  const llm = overrides.llm ?? new CapturingLLMAdapter();
  const embedder = overrides.embedder ?? new FakeEmbedAdapter();

  return new MemoGrafterAgent({
    db: { connectionString: "postgres://user:pass@localhost:5432/memografter_test" },
    llm,
    embedder,
    inject: {
      bufferSize: 1,
      tokenBudget: 1200,
    },
    ...overrides,
  });
}

function patchCore(agent: MemoGrafterAgent): TestCore {
  const core = (agent as unknown as { core: TestCore }).core;
  core.enqueueIngest = async () => undefined;
  return core;
}

function historyOf(agent: MemoGrafterAgent): Message[] {
  return (agent as unknown as { history: Message[] }).history;
}

function buildHistory(agent: MemoGrafterAgent): Promise<Message[]> {
  return (agent as unknown as { buildHistory: () => Promise<Message[]> }).buildHistory();
}

function createNode(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: "node-1",
    sessionId: "session-1",
    segmentId: "segment-1",
    label: "Japan Travel",
    summary: "Outcome: The assistant helped plan Japan travel. Still open: choose hotels.",
    embedding: [],
    messageRange: [0, 1],
    topicOrder: 0,
    driftScore: 0,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function createSegment(overrides: Partial<TopicSegment> = {}): TopicSegment {
  return {
    id: "segment-1",
    sessionId: "session-1",
    startIndex: 0,
    endIndex: 1,
    topicOrder: 0,
    driftScore: 0,
    createdAt: new Date(0),
    ...overrides,
  };
}

{
  const agent = createAgent();
  const core = patchCore(agent);
  let getTopicsCallCount = 0;
  core.getTopics = async () => {
    getTopicsCallCount += 1;
    return { nodes: [], segments: [] };
  };

  await agent.invoke("Plan a Japan trip.");
  await agent.invoke("Focus on Kyoto food.");
  await agent.invoke("Now discuss the budget.");

  assert.equal(getTopicsCallCount, 0);
  assert.equal(agent.getHistory().length, 6);
}

{
  const agent = createAgent();
  const core = patchCore(agent);
  let getTopicsCallCount = 0;
  core.getTopics = async () => {
    getTopicsCallCount += 1;
    return { nodes: [], segments: [] };
  };
  const history = historyOf(agent);
  history.push({ role: "user", content: "Short question." });
  history.push({ role: "assistant", content: "Short answer." });

  const messages = await buildHistory(agent);

  assert.equal(messages, history);
  assert.equal(getTopicsCallCount, 0);
}

{
  const agent = createAgent({
    inject: {
      bufferSize: 1,
      tokenBudget: 20,
    },
  });
  const core = patchCore(agent);
  const node = createNode();
  core.getTopics = async () => ({
    nodes: [node],
    segments: [createSegment({ endIndex: 1 })],
  });
  const history = historyOf(agent);
  history.push({ role: "user", content: "a".repeat(80) });
  history.push({ role: "assistant", content: "b".repeat(80) });
  history.push({ role: "user", content: "Recent user question." });

  const messages = await buildHistory(agent);

  assert.deepEqual(messages, [
    { role: "system", content: formatCompressedTopic(node) },
    { role: "user", content: "Recent user question." },
  ]);
}

{
  const agent = createAgent();
  const core = patchCore(agent);
  let getTopicsCallCount = 0;
  let injectCallCount = 0;
  const node = createNode({ id: "node-allowed" });
  core.getTopics = async () => {
    getTopicsCallCount += 1;
    return { nodes: [node], segments: [createSegment()] };
  };
  core.inject = async (_sessionId: string, topicIds: string[]) => {
    injectCallCount += 1;
    assert.deepEqual(topicIds, ["node-allowed"]);
    return { systemPrompt: "memory", nodes: [node], tokenCount: 1 };
  };

  await agent.graft();

  assert.equal(getTopicsCallCount, 1);
  assert.equal(injectCallCount, 1);
}

{
  const llm = new CapturingLLMAdapter();
  const agent = createAgent({
    llm,
    systemPrompt: "You are a test bot.",
  });
  patchCore(agent);

  await agent.invoke("Hello.");

  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0]?.system, "You are a test bot.");
}
