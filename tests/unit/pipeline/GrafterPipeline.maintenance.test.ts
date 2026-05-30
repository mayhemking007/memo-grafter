import { describe, expect, it } from "vitest";
import { GrafterPipeline } from "../../../src/pipeline/GrafterPipeline.js";
import type { MemoryEdge, MemoryNode, Message, TopicNode } from "../../../src/types.js";

function makeTopicNode(overrides: Partial<TopicNode> = {}): TopicNode {
  return {
    id: "topic-1",
    sessionId: "session-1",
    segmentId: "segment-1",
    label: "Residence",
    summary: "The user lives in Delhi.",
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

function makeMemory(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: "memory-1",
    segmentId: "segment-1",
    topicNodeId: "topic-1",
    agentId: null,
    sessionId: "session-1",
    memoryType: "fact",
    sourceType: "conversation",
    subject: "user",
    predicate: "location",
    value: "Delhi",
    confidence: 1,
    embedding: [0.1, 0.2],
    sourceUrl: null,
    sourceTitle: null,
    supersededBy: null,
    decayed: false,
    hasConflict: false,
    agentColor: null,
    fleetId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GrafterPipeline maintenance-aware prompts", () => {
  it("adds contradiction notes and active facts without rewriting the historical summary", async () => {
    const topic = makeTopicNode();
    const oldMemory = makeMemory({
      id: "old-location",
      value: "Delhi",
      supersededBy: "new-location",
      hasConflict: true,
    });
    const newMemory = makeMemory({
      id: "new-location",
      topicNodeId: "topic-2",
      value: "Bangalore",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const memoryEdge: MemoryEdge = {
      id: "edge-1",
      sourceId: "new-location",
      targetId: "old-location",
      edgeType: "updates",
      weight: 1,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const store = {
      getNeighbours: async () => [topic],
      getBufferMessages: async (): Promise<Message[]> => [
        { role: "user", content: "I live in Delhi." },
      ],
      getMemoriesBySession: async () => [oldMemory, newMemory],
      getMemoryEdgesBySession: async () => [memoryEdge],
    };
    const pipeline = new GrafterPipeline(store as never, {
      hopDepth: 1,
      bufferSize: 0,
      tokenBudget: 4000,
    });

    const result = await pipeline.run("session-1", [topic.id]);

    expect(result.systemPrompt).toContain("Summary: The user lives in Delhi.");
    expect(result.systemPrompt).toContain("Memory maintenance notes:");
    expect(result.systemPrompt).toContain(
      'The fact "user location: Delhi" was superseded by "Bangalore".',
    );
    expect(result.systemPrompt).toContain("Prefer active memory facts over contradictory historical summary details.");
    expect(result.systemPrompt).toContain("Active memory facts:");
    expect(result.systemPrompt).toContain("- user location: Bangalore");
  });
});
