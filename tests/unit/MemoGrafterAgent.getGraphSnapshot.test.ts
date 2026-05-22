import { describe, expect, it } from "vitest";
import { MemoGrafterAgent } from "../../src/MemoGrafterAgent.js";
import type {
  EmbedAdapter,
  LLMAdapter,
  MemoryNode,
  MemoGrafterConfig,
  Message,
  TopicEdge,
  TopicNode,
  TopicSegment,
} from "../../src/types.js";

type SnapshotCore = {
  getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }>;
  store: {
    getEdgesBySession(sessionId: string): Promise<TopicEdge[]>;
    getMemoriesBySession(sessionId: string): Promise<MemoryNode[]>;
  };
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

function internals(agent: MemoGrafterAgent): {
  core: SnapshotCore;
  pendingIngest: Promise<void>;
} {
  return agent as unknown as {
    core: SnapshotCore;
    pendingIngest: Promise<void>;
  };
}

function makeTopicNode(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
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
    ...overrides,
  };
}

function makeMemoryNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: "memory-1",
    segmentId: "segment-1",
    topicNodeId: "topic-1",
    agentId: null,
    sessionId: "session-1",
    memoryType: "fact",
    sourceType: "conversation",
    subject: "deployment",
    predicate: "uses",
    value: "blue-green rollout",
    confidence: 0.9,
    embedding: [0.1, 0.2],
    sourceUrl: null,
    sourceTitle: null,
    supersededBy: null,
    decayed: false,
    agentColor: null,
    fleetId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSegment(overrides: Partial<TopicSegment> = {}): TopicSegment {
  return {
    id: "segment-1",
    sessionId: "session-1",
    startIndex: 0,
    endIndex: 1,
    topicOrder: 1,
    driftScore: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("MemoGrafterAgent.getGraphSnapshot", () => {
  it("waits for pending ingest and returns nodes, edges, memories, and capture metadata", async () => {
    const agent = createAgent();
    const privateAgent = internals(agent);
    const sessionId = agent.getSessionId();
    const node = makeTopicNode({ sessionId });
    const edge: TopicEdge = {
      srcId: "external-topic",
      dstId: node.id,
      weight: 0.87,
      type: "reentry",
    };
    const memories = [
      makeMemoryNode({ sessionId, topicNodeId: node.id }),
      makeMemoryNode({
        id: "memory-decayed",
        sessionId,
        topicNodeId: node.id,
        decayed: true,
      }),
      makeMemoryNode({
        id: "memory-superseded",
        sessionId,
        topicNodeId: node.id,
        supersededBy: "memory-1",
      }),
    ];
    const calls: string[] = [];
    let releaseIngest: (() => void) | undefined;

    privateAgent.pendingIngest = new Promise<void>((resolve) => {
      releaseIngest = resolve;
    });
    privateAgent.core.getTopics = async (observedSessionId) => {
      calls.push(`topics:${observedSessionId}`);
      return { nodes: [node], segments: [makeSegment({ sessionId })] };
    };
    privateAgent.core.store.getEdgesBySession = async (observedSessionId) => {
      calls.push(`edges:${observedSessionId}`);
      return [edge];
    };
    privateAgent.core.store.getMemoriesBySession = async (observedSessionId) => {
      calls.push(`memories:${observedSessionId}`);
      return memories;
    };

    const snapshotPromise = agent.getGraphSnapshot();
    await Promise.resolve();
    expect(calls).toEqual([]);

    releaseIngest?.();
    const snapshot = await snapshotPromise;

    expect(calls).toEqual([
      `topics:${sessionId}`,
      `edges:${sessionId}`,
      `memories:${sessionId}`,
    ]);
    expect(snapshot).toMatchObject({
      sessionId,
      nodes: [node],
      edges: [edge],
      memories,
    });
    expect(new Date(snapshot.capturedAt).toISOString()).toBe(snapshot.capturedAt);
    expect(snapshot.memories.some((memory) => memory.decayed)).toBe(true);
    expect(snapshot.memories.some((memory) => memory.supersededBy !== null)).toBe(true);
  });
});
