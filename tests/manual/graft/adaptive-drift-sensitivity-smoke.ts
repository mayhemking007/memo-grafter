import assert from "node:assert/strict";
import {
  IngestPipeline,
  type EmbedAdapter,
  type GraphStore,
  type LLMAdapter,
  type MemoryNodeInsert,
  type Message,
  type SessionIngestState,
  type TopicEdge,
  type TopicNode,
  type TopicSegment,
} from "../../../src/index.js";

const sessionId = "adaptive-smoke-session";
const fixedDate = new Date("2026-01-01T00:00:00.000Z");

function longText(prefix: string, words = 24): string {
  return Array.from({ length: words }, (_, index) => `${prefix}${index}`).join(" ");
}

function vectorWithCosine(cosine: number): number[] {
  return [cosine, Math.sqrt(1 - cosine * cosine), 0, 0];
}

function makePriorSegment(index: number, length: number): TopicSegment {
  const startIndex = index * 10;

  return {
    id: `prior-segment-${index}`,
    sessionId,
    startIndex,
    endIndex: startIndex + length - 1,
    topicOrder: index + 1,
    driftScore: index === 0 ? 0 : 0.4,
    createdAt: fixedDate,
  };
}

function makeStore(priorSegments: TopicSegment[]): GraphStore & {
  segments: TopicSegment[];
} {
  const store = {
    messages: [] as Message[],
    nodes: [] as TopicNode[],
    segments: [] as TopicSegment[],
    edges: [] as TopicEdge[],
    memories: [] as MemoryNodeInsert[],
    ingestState: null as SessionIngestState | null,

    async saveMessages(_sessionId: string, messages: Message[]): Promise<void> {
      store.messages = [...messages];
    },
    async getSessionIngestState(): Promise<SessionIngestState | null> {
      return store.ingestState;
    },
    async updateSessionIngestState(nextSessionId: string, lastIngestedMessageIndex: number): Promise<void> {
      store.ingestState = {
        sessionId: nextSessionId,
        lastIngestedMessageIndex,
        updatedAt: fixedDate,
      };
    },
    async getNodesBySession(): Promise<TopicNode[]> {
      return [...store.nodes];
    },
    async getSegmentsBySession(): Promise<TopicSegment[]> {
      return [...priorSegments, ...store.segments];
    },
    async saveSegment(segment: TopicSegment): Promise<TopicSegment> {
      store.segments.push(segment);
      return segment;
    },
    async saveNode(node: TopicNode): Promise<void> {
      store.nodes.push(node);
    },
    async insertMemories(nodes: MemoryNodeInsert[]): Promise<void> {
      store.memories.push(...nodes);
    },
    async buildMemoryEdges(): Promise<void> {
      return;
    },
    async saveEdge(edge: TopicEdge): Promise<void> {
      store.edges.push(edge);
    },
    async getSimilarNodes(): Promise<TopicNode[]> {
      return [];
    },
  };

  return store as unknown as GraphStore & { segments: TopicSegment[] };
}

function createPipeline(store: GraphStore, adaptive: boolean): IngestPipeline {
  const llm: LLMAdapter = {
    complete: async () => JSON.stringify({
      label: "Adaptive Drift Smoke",
      user_intent: "The user is discussing adaptive drift sensitivity.",
      outcome: "The conversation was segmented for smoke testing.",
      open: null,
      memories: [],
    }),
  };
  const embedder: EmbedAdapter = {
    embed: async (text) => {
      const normalized = text.toLowerCase();
      if (normalized.includes("shift")) return vectorWithCosine(0.63);
      return [1, 0, 0, 0];
    },
  };

  return new IngestPipeline(store, llm, embedder, {
    windowSize: 5,
    driftSensitivity: "medium",
    topK: 3,
    mode: "intent",
    minSegmentMessages: 1,
    adaptiveSensitivity: {
      enabled: adaptive,
    },
  });
}

const messages: Message[] = [
  { role: "user", content: longText("topic") },
  { role: "user", content: longText("shift") },
];
const fragmentedHistory = [
  makePriorSegment(0, 2),
  makePriorSegment(1, 2),
  makePriorSegment(2, 2),
  makePriorSegment(3, 2),
];

const staticStore = makeStore(fragmentedHistory);
const adaptiveStore = makeStore(fragmentedHistory);

const staticNodes = await createPipeline(staticStore, false).run(messages, sessionId);
const adaptiveNodes = await createPipeline(adaptiveStore, true).run(messages, sessionId);

assert.equal(staticNodes.length, 2);
assert.equal(adaptiveNodes.length, 1);
assert.equal(adaptiveStore.segments[0]?.startIndex, 0);
assert.equal(adaptiveStore.segments[0]?.endIndex, 1);

const formatSegments = (segments: TopicSegment[]): Array<{ start: number; end: number; driftScore: number }> =>
  segments.map((segment) => ({
    start: segment.startIndex,
    end: segment.endIndex,
    driftScore: Number(segment.driftScore.toFixed(3)),
  }));

console.log("adaptive drift sensitivity smoke passed");
console.log("static medium segments:", formatSegments(staticStore.segments));
console.log("adaptive segments:", formatSegments(adaptiveStore.segments));
