import { describe, expect, it, vi } from "vitest";
import { GrafterPipeline } from "../../../src/retrieval/GrafterPipeline.js";
import type { Message, TopicNode } from "../../../src/core/types.js";

function makeTopicNode(id = "topic-1"): TopicNode {
  return {
    id,
    sessionId: "session-1",
    segmentId: `segment-${id}`,
    label: "Authentication",
    summary: "The user discussed authentication.",
    embedding: [0.1, 0.2],
    messageRange: [0, 1],
    topicOrder: 1,
    driftScore: 0,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeStore() {
  const topic = makeTopicNode();

  return {
    getNeighbours: vi.fn(async () => [topic]),
    getBufferMessages: vi.fn(async (): Promise<Message[]> => [
      { role: "user", content: "Let's talk about authentication." },
    ]),
    getMemoriesBySession: vi.fn(async () => []),
    getMemoryEdgesBySession: vi.fn(async () => []),
  };
}

describe("GrafterPipeline expansion options", () => {
  it("uses the configured graph hop depth by default", async () => {
    const store = makeStore();
    const pipeline = new GrafterPipeline(store as never, {
      hopDepth: 2,
      bufferSize: 0,
      tokenBudget: 4000,
    });

    await pipeline.run("session-1", ["topic-1"]);

    expect(store.getNeighbours).toHaveBeenCalledWith(["topic-1"], 2, "session-1");
  });

  it("can override graph hop depth per run", async () => {
    const store = makeStore();
    const pipeline = new GrafterPipeline(store as never, {
      hopDepth: 2,
      bufferSize: 0,
      tokenBudget: 4000,
    });

    await pipeline.run("session-1", ["topic-1"], { hopDepth: 1 });

    expect(store.getNeighbours).toHaveBeenCalledWith(["topic-1"], 1, "session-1");
  });

  it("uses seed nodes only when graph expansion is disabled", async () => {
    const store = makeStore();
    const pipeline = new GrafterPipeline(store as never, {
      hopDepth: 2,
      bufferSize: 0,
      tokenBudget: 4000,
    });

    await pipeline.run("session-1", ["topic-1"], { expansionStrategy: "none" });

    expect(store.getNeighbours).toHaveBeenCalledWith(["topic-1"], 0, "session-1");
  });
});
