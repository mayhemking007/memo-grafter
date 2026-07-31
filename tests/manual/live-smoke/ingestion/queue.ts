import assert from "node:assert/strict";
import { MemoGrafterAgent } from "../../../../src/index.js";
import {
  createOpenAITelemetry,
  cleanupSessions,
  OPENAI_RUNTIME,
  openAIConfig,
  optionalEnv,
  uniqueId,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const queueSmoke: SmokeTestDefinition = {
  suite: "ingestion",
  name: "queue",
  runtime: OPENAI_RUNTIME,
  async run(context) {
    const redisUrl = optionalEnv("REDIS_URL");
    if (!redisUrl) throw new Error("SKIP: REDIS_URL is not configured.");
    const telemetry = createOpenAITelemetry();
    const agent = new MemoGrafterAgent(openAIConfig(telemetry, {
      queue: {
        redisUrl,
        queueName: uniqueId("mg-live-smoke"),
        removeOnComplete: true,
        removeOnFail: true,
      },
    }));
    const started = Date.now();
    const sessionId = agent.getSessionId();
    let polls = 0;
    try {
      await agent.initialize();
      const enqueueStarted = Date.now();
      await agent.ingestText("The user is planning Japan travel and prefers quiet Kyoto cafes.");
      const enqueueDurationMs = Date.now() - enqueueStarted;

      let nodes = await agent.getActiveNodes();
      let snapshot = await agent.getGraphSnapshot();
      while ((nodes.length === 0 || snapshot.memories.length === 0) && Date.now() - started < context.timeoutMs - 1_000) {
        polls += 1;
        await delay(200);
        nodes = await agent.getActiveNodes();
        snapshot = await agent.getGraphSnapshot();
      }
      assert.ok(nodes.length > 0, "queued ingestion should eventually persist a topic");
      assert.ok(snapshot.memories.length > 0, "queued ingestion should eventually persist a memory");
      assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length, "queued nodes should not be duplicated");
      assert.ok(nodes.every((node) => node.label.trim() && node.summary.trim()), "OpenAI should create topic labels and summaries");
      assert.ok(nodes.every((node) => node.embedding.length === 1536), "queued topics should have OpenAI embeddings");
      assert.ok(snapshot.memories.every((memory) => memory.embedding.length === 1536), "queued memories should have OpenAI embeddings");

      return {
        assertions: [
          "Queued ingestion was accepted",
          "The worker eventually persisted a topic and memory",
          "OpenAI created non-empty topic content and embeddings",
          "No duplicate topic IDs were produced",
        ],
        metrics: {
          sessionId,
          enqueueDurationMs,
          persistenceDurationMs: Date.now() - started,
          pollCount: polls,
          topicNodes: nodes.length,
          memoryNodes: snapshot.memories.length,
          topicLabels: nodes.map((node) => node.label),
          extractedMemories: snapshot.memories.map((memory) => memory.value),
          embeddingDimensions: [...new Set([
            ...nodes.map((node) => node.embedding.length),
            ...snapshot.memories.map((memory) => memory.embedding.length),
          ])],
        },
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      await agent.close().catch(() => undefined);
      await cleanupSessions([sessionId]).catch(() => undefined);
    }
  },
};
