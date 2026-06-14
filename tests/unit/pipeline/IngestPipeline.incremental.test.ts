import { describe, expect, it } from "vitest";
import { IngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";
import type { GraphStore } from "../../../src/store/index.js";
import type {
  DriftSensitivity,
  EmbedAdapter,
  LLMAdapter,
  MemoryNode,
  MemoryNodeInsert,
  Message,
  SessionIngestState,
  TopicEdge,
  TopicNode,
  TopicSegment,
} from "../../../src/core/types.js";

class FakeLLMAdapter implements LLMAdapter {
  async complete(): Promise<string> {
    return JSON.stringify({
      label: "Japan Travel",
      user_intent: "The user is discussing Japan travel preferences.",
      outcome: "The assistant captured useful travel context.",
      open: null,
      memories: [{
        memory_type: "fact",
        subject: "user",
        predicate: "discussed",
        value: "Japan travel preferences.",
        confidence: 0.9,
      }],
    });
  }
}

class FakeEmbedAdapter implements EmbedAdapter {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(1536).fill(0);
    vector[text.toLowerCase().includes("budget") ? 1 : 0] = 1;
    return vector;
  }
}

class IncrementalStore {
  messages: Message[] = [];
  segments: TopicSegment[] = [];
  nodes: TopicNode[] = [];
  edges: TopicEdge[] = [];
  memories: MemoryNodeInsert[] = [];
  ingestState: SessionIngestState | null = null;

  async saveMessages(_sessionId: string, messages: Message[]): Promise<void> {
    this.messages = [...messages];
  }

  async getMessagesBySession(): Promise<Message[]> {
    return [...this.messages];
  }

  async clearSession(): Promise<void> {
    this.messages = [];
    this.segments = [];
    this.nodes = [];
    this.edges = [];
    this.memories = [];
    this.ingestState = null;
  }

  async getSessionIngestState(): Promise<SessionIngestState | null> {
    return this.ingestState;
  }

  async updateSessionIngestState(sessionId: string, lastIngestedMessageIndex: number): Promise<void> {
    this.ingestState = {
      sessionId,
      lastIngestedMessageIndex,
      updatedAt: new Date(0),
    };
  }

  async getNodesBySession(): Promise<TopicNode[]> {
    return [...this.nodes];
  }

  async saveSegment(segment: TopicSegment): Promise<TopicSegment> {
    const existing = this.segments.find((candidate) =>
      candidate.sessionId === segment.sessionId
      && candidate.startIndex === segment.startIndex
      && candidate.endIndex === segment.endIndex
    );
    if (existing) return existing;

    this.segments.push(segment);
    return segment;
  }

  async saveNode(node: TopicNode): Promise<void> {
    const index = this.nodes.findIndex((candidate) => candidate.segmentId === node.segmentId);
    if (index >= 0) {
      this.nodes[index] = node;
      return;
    }

    this.nodes.push(node);
  }

  async insertMemories(nodes: MemoryNodeInsert[]): Promise<void> {
    this.memories.push(...nodes);
  }

  async buildMemoryEdges(): Promise<void> {
    return;
  }

  async saveEdge(edge: TopicEdge): Promise<void> {
    const index = this.edges.findIndex((candidate) =>
      candidate.srcId === edge.srcId && candidate.dstId === edge.dstId
    );
    if (index >= 0) {
      this.edges[index] = edge;
      return;
    }

    this.edges.push(edge);
  }

  async getSimilarNodes(_embedding: number[], _sessionId: string, options: { excludeNodeId?: string } = {}): Promise<TopicNode[]> {
    return this.nodes.filter((node) => node.id !== options.excludeNodeId);
  }

  async searchMemories(): Promise<(MemoryNode & { similarity: number })[]> {
    return [];
  }
}

function createPipeline(store: IncrementalStore): IngestPipeline {
  return new IngestPipeline(
    store as unknown as GraphStore,
    new FakeLLMAdapter(),
    new FakeEmbedAdapter(),
    {
      windowSize: 5,
      topK: 3,
      mode: "intent",
      minSegmentMessages: 1,
      driftSensitivity: "medium" satisfies DriftSensitivity,
    },
  );
}

describe("IngestPipeline incremental ingest", () => {
  it("skips already ingested messages and appends nodes for new messages only", async () => {
    const store = new IncrementalStore();
    const pipeline = createPipeline(store);
    const firstHistory: Message[] = [
      { role: "user", content: "I am planning a Japan trip." },
      { role: "assistant", content: "Response to Japan trip." },
    ];

    const firstNodes = await pipeline.run(firstHistory, "session-1");
    const replayNodes = await pipeline.run(firstHistory, "session-1");
    const secondNodes = await pipeline.run([
      ...firstHistory,
      { role: "user", content: "My Japan budget is around 2500 dollars." },
      { role: "assistant", content: "Response to budget." },
    ], "session-1");

    expect(firstNodes).toHaveLength(1);
    expect(replayNodes).toHaveLength(0);
    expect(secondNodes).toHaveLength(1);
    expect(store.nodes).toHaveLength(2);
    expect(store.segments.map((segment) => [segment.startIndex, segment.endIndex])).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(store.ingestState?.lastIngestedMessageIndex).toBe(3);
    expect(store.edges.length).toBeGreaterThan(0);
  });

  it("ingests raw text with label and source metadata, then replaces it", async () => {
    const store = new IncrementalStore();
    const pipeline = createPipeline(store);

    const firstNodes = await pipeline.runText("I prefer quiet cafes for planning.", "session-1", {
      label: "Morning entry",
      source: "classic-editor",
    });

    expect(firstNodes).toHaveLength(1);
    expect(store.messages).toEqual([
      { role: "user", content: "I prefer quiet cafes for planning." },
    ]);
    expect(store.nodes[0]?.source).toBe("classic-editor");
    expect(store.memories[0]?.source).toBe("classic-editor");
    expect(store.memories[0]?.sourceType).toBe("document");

    const replacementNodes = await pipeline.runText("The roadmap now focuses on imports.", "session-1", {
      replace: true,
      source: "import",
    });

    expect(replacementNodes).toHaveLength(1);
    expect(store.messages).toEqual([
      { role: "user", content: "The roadmap now focuses on imports." },
    ]);
    expect(store.nodes).toHaveLength(1);
    expect(store.nodes[0]?.source).toBe("import");
  });

  it("detects multiple topics inside one raw text string", async () => {
    const store = new IncrementalStore();
    const pipeline = createPipeline(store);

    const nodes = await pipeline.runText([
      "I am planning a quiet Japan trip.",
      "I want to visit local cafes.",
      "The project budget is now 2500 dollars.",
      "Budget approval is required before booking.",
    ].join("\n"), "session-1");

    expect(store.messages).toEqual([
      { role: "user", content: "I am planning a quiet Japan trip." },
      { role: "user", content: "I want to visit local cafes." },
      { role: "user", content: "The project budget is now 2500 dollars." },
      { role: "user", content: "Budget approval is required before booking." },
    ]);
    expect(nodes).toHaveLength(2);
    expect(store.segments.map((segment) => [segment.startIndex, segment.endIndex])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
