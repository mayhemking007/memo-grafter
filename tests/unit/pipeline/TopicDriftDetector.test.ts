import { describe, expect, it, vi } from "vitest";
import { IngestPipeline } from "../../../src/pipeline/IngestPipeline.js";
import { TopicDriftDetector } from "../../../src/pipeline/TopicDriftDetector.js";
import type { GraphStore } from "../../../src/store/index.js";
import type { EmbedAdapter, LLMAdapter, Message, TopicEdge, TopicNode, TopicSegment } from "../../../src/types.js";
import {
  resetDriftThresholdWarningForTests,
  resolveDriftThreshold,
} from "../../../src/utils/drift/driftThreshold.js";

function makeEmbedding(primary: number, secondary = 0): number[] {
  const raw = [0, 0, 0, 0];
  raw[primary % 4] = 1;
  raw[(primary + 1) % 4] = secondary;
  const magnitude = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0));
  return raw.map((value) => value / magnitude);
}

function makeMessage(role: "user" | "assistant", content: string): Message {
  return { role, content };
}

function makeVectorWithCosine(cosine: number): number[] {
  return [cosine, Math.sqrt(1 - cosine * cosine), 0, 0];
}

function longText(prefix: string, words = 24): string {
  return Array.from({ length: words }, (_, index) => `${prefix}${index}`).join(" ");
}

function makeDetector(overrides: Partial<ConstructorParameters<typeof TopicDriftDetector>[0]> = {}): TopicDriftDetector {
  return new TopicDriftDetector({
    threshold: 0.35,
    mode: "intent",
    windowSize: 5,
    minSegmentMessages: 1,
    llmAmbiguityDetection: false,
    reentryDetection: true,
    reentryThreshold: 0.85,
    ...overrides,
  });
}

function makeNode(id: string, topicOrder: number, embedding: number[]): TopicNode {
  return {
    id,
    sessionId: "session",
    segmentId: `segment-${id}`,
    label: `Node ${id}`,
    summary: `Summary ${id}`,
    embedding,
    messageRange: [0, 0],
    topicOrder,
    driftScore: 0,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date(),
  };
}

describe("TopicDriftDetector — multi-signal scoring", () => {
  it("computeDriftScore — short message contributes less", async () => {
    const detector = makeDetector();
    const topic = makeEmbedding(0);
    const moderateDrift = makeVectorWithCosine(0.3);

    const shortResult = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", "okay thanks")],
      [topic, moderateDrift],
    );
    const longResult = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [topic, moderateDrift],
    );

    expect(shortResult.segments).toHaveLength(1);
    expect(longResult.segments).toHaveLength(2);
  });

  it("computeDriftScore — sharp single-message shift detected", async () => {
    const detector = makeDetector({ minSegmentMessages: 5 });
    const messages = [
      makeMessage("user", longText("topic")),
      makeMessage("user", longText("topic")),
      makeMessage("user", longText("topic")),
      makeMessage("user", longText("topic")),
      makeMessage("user", longText("topic")),
      makeMessage("user", longText("shift")),
    ];
    const embeddings = [
      makeEmbedding(0),
      makeEmbedding(0, 0.05),
      makeEmbedding(0, 0.04),
      makeEmbedding(0, 0.03),
      makeEmbedding(0, 0.02),
      makeEmbedding(2),
    ];

    const { segments } = await detector.detectSegments(messages, embeddings);

    expect(segments).toHaveLength(2);
    expect(segments[1]?.start).toBe(5);
  });

  it("computeDriftScore — SHIFT_MARKER boosts score", async () => {
    const detector = makeDetector();
    const topic = makeEmbedding(0);
    const justBelowThreshold = makeVectorWithCosine(0.7);

    const noMarker = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [topic, justBelowThreshold],
    );
    const withMarker = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", `by the way ${longText("shift")}`)],
      [topic, justBelowThreshold],
    );

    expect(noMarker.segments).toHaveLength(1);
    expect(withMarker.segments).toHaveLength(2);
  });

  it("computeDriftScore — CONTINUATION_MARKER suppresses score", async () => {
    const detector = makeDetector();
    const topic = makeEmbedding(0);
    const justAboveThreshold = makeVectorWithCosine(0.6);

    const noMarker = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [topic, justAboveThreshold],
    );
    const withMarker = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", `additionally ${longText("shift")}`)],
      [topic, justAboveThreshold],
    );

    expect(noMarker.segments).toHaveLength(2);
    expect(withMarker.segments).toHaveLength(1);
  });

  it("driftSensitivity mapping", () => {
    expect(resolveDriftThreshold({ driftSensitivity: "low" })).toBe(0.25);
    expect(resolveDriftThreshold({ driftSensitivity: "medium" })).toBe(0.35);
    expect(resolveDriftThreshold({ driftSensitivity: "high" })).toBe(0.5);
  });

  it("reentry detection skipped when store not provided", async () => {
    const detector = makeDetector({ reentryDetection: true });

    const result = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [makeEmbedding(0), makeEmbedding(1)],
    );

    expect(result.segments).toHaveLength(2);
    expect(result.reentryMap.size).toBe(0);
  });

  it("reentry detection returns reentryNodeId when match found", async () => {
    const detector = makeDetector({ reentryDetection: true, reentryThreshold: 0.85 });
    const existing = [makeNode("node-a", 1, makeEmbedding(1))];

    const result = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [makeEmbedding(0), makeEmbedding(1, 0.05)],
      existing,
    );

    expect(result.reentryMap.get(2)).toBe("node-a");
  });

  it("reentry detection returns no reentryNodeId when no match", async () => {
    const detector = makeDetector({ reentryDetection: true, reentryThreshold: 0.85 });
    const existing = [makeNode("node-a", 1, makeEmbedding(2))];

    const result = await detector.detectSegments(
      [makeMessage("user", longText("topic")), makeMessage("user", longText("shift"))],
      [makeEmbedding(0), makeEmbedding(1)],
      existing,
    );

    expect(result.reentryMap.size).toBe(0);
  });

  it("deprecated threshold warning logged once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resetDriftThresholdWarningForTests();

    const store = {} as GraphStore;
    const llm: LLMAdapter = { complete: vi.fn(async () => "CONTINUATION") };
    const embedder: EmbedAdapter = { embed: vi.fn(async () => makeEmbedding(0)) };

    new IngestPipeline(store, llm, embedder, {
      windowSize: 5,
      threshold: 0.3,
      topK: 5,
      mode: "intent",
      minSegmentMessages: 1,
    });
    new IngestPipeline(store, llm, embedder, {
      windowSize: 5,
      threshold: 0.3,
      topK: 5,
      mode: "intent",
      minSegmentMessages: 1,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[MemoGrafter] drift.threshold is deprecated, use drift.driftSensitivity instead");
    warn.mockRestore();
  });

  it("IngestPipeline creates current-run reentry edge between rebuilt nodes", async () => {
    const savedNodes: TopicNode[] = [];
    const savedEdges: TopicEdge[] = [];
    let nextSegmentId = 0;

    const store = {
      saveMessages: vi.fn(async () => undefined),
      getSessionIngestState: vi.fn(async () => null),
      updateSessionIngestState: vi.fn(async () => undefined),
      getNodesBySession: vi.fn(async () => []),
      saveSegment: vi.fn(async (segment: TopicSegment) => segment),
      saveNode: vi.fn(async (node: TopicNode) => {
        savedNodes.push(node);
      }),
      saveEdge: vi.fn(async (edge: TopicEdge) => {
        savedEdges.push(edge);
      }),
      insertMemories: vi.fn(async () => undefined),
      buildMemoryEdges: vi.fn(async () => undefined),
      getSimilarNodes: vi.fn(async (_embedding: number[], _sessionId: string, options: { excludeNodeId?: string } = {}) =>
        savedNodes.filter((node) => node.id !== options.excludeNodeId)
      ),
    } as unknown as GraphStore;

    const llm: LLMAdapter = {
      complete: vi.fn(async () =>
        JSON.stringify({
          label: `Segment ${nextSegmentId += 1}`,
          user_intent: "Track a topic.",
          outcome: "Topic tracked.",
          open: null,
          memories: [],
        }),
      ),
    };
    const embedder: EmbedAdapter = {
      embed: vi.fn(async (text: string) => {
        const normalized = text.toLowerCase();
        if (normalized.includes("auth")) return makeEmbedding(1);
        return makeEmbedding(0);
      }),
    };

    const pipeline = new IngestPipeline(store, llm, embedder, {
      windowSize: 5,
      driftSensitivity: "medium",
      topK: 5,
      mode: "intent",
      minSegmentMessages: 1,
      reentryDetection: true,
      reentryThreshold: 0.85,
    });

    await pipeline.run(
      [
        makeMessage("user", longText("database")),
        makeMessage("user", `by the way auth ${longText("auth")}`),
        makeMessage("user", `actually going back to database ${longText("database")}`),
      ],
      "session",
    );

    const reentryEdges = savedEdges.filter((edge) => edge.type === "reentry");
    expect(savedNodes).toHaveLength(3);
    expect(reentryEdges).toHaveLength(1);
    expect(reentryEdges[0]?.srcId).toBe(savedNodes[2]?.id);
    expect(reentryEdges[0]?.dstId).toBe(savedNodes[0]?.id);
  });
});
