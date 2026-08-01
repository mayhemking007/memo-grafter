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
    const telemetry = createOpenAITelemetry(context.telemetry);
    const agent = new MemoGrafterAgent(openAIConfig(telemetry, {
      queue: {
        redisUrl,
        queueName: uniqueId("mg-live-smoke"),
        removeOnComplete: true,
        removeOnFail: true,
      },
    }, context.telemetry));
    const started = Date.now();
    const sessionId = agent.getSessionId();
    let polls = 0;
    try {
      await agent.initialize();
      context.telemetry.start();
      const enqueueStarted = Date.now();
      const firstPrompt = "Remember that I prefer quiet Kyoto cafes.";
      const firstAnswer = await agent.invoke(firstPrompt);
      const secondPrompt = "I also prefer small independent bookstores there.";
      const secondAnswer = await agent.invoke(secondPrompt);
      const enqueueDurationMs = Date.now() - enqueueStarted;

      while (
        (context.telemetry.queueSnapshot()?.completedJobs ?? 0) < 2
        && Date.now() - started < context.timeoutMs - 1_000
      ) {
        polls += 1;
        await delay(200);
      }
      const queueUsage = context.telemetry.queueSnapshot();
      assert.ok(queueUsage, "queue telemetry should be enabled");
      assert.equal(queueUsage.completedJobs, 2, "both queued conversation jobs should complete");
      assert.equal(queueUsage.failedJobs, 0, "queued conversation jobs should not fail");
      assert.equal(queueUsage.firstJobMessageCount, 2, "the first job should contain one user-assistant pair");
      assert.equal(queueUsage.lastJobMessageCount, 2, "the last job should contain only the second user-assistant pair");
      assert.equal(queueUsage.totalMessages, 4, "two queue jobs should contain four messages in total");
      assert.ok(queueUsage.totalPayloadBytes > 0, "queue payload bytes should be recorded");
      assert.ok(queueUsage.maximumJobPayloadBytes > 0, "maximum queue payload bytes should be recorded");

      const snapshot = await agent.getGraphSnapshot();
      const nodes = snapshot.nodes;
      assert.ok(nodes.length > 0, "queued ingestion should eventually persist a topic");
      assert.ok(snapshot.memories.length > 0, "queued ingestion should eventually persist a memory");
      assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length, "queued nodes should not be duplicated");
      assert.ok(nodes.every((node) => node.label.trim() && node.summary.trim()), "OpenAI should create topic labels and summaries");
      assert.ok(nodes.every((node) => node.embedding.length === 1536), "queued topics should have OpenAI embeddings");
      assert.ok(snapshot.memories.every((memory) => memory.embedding.length === 1536), "queued memories should have OpenAI embeddings");
      const databaseUsage = context.telemetry.databaseSnapshot();
      assert.ok(
        databaseUsage.reads < 80,
        `queue ingestion should avoid database polling amplification; observed ${databaseUsage.reads} reads`,
      );

      return {
        assertions: [
          "Queued ingestion was accepted",
          "The worker eventually persisted a topic and memory",
          "OpenAI created non-empty topic content and embeddings",
          "Two queue jobs completed with exactly one user-assistant pair each",
          "Queue completion was observed without polling the graph tables",
          "No duplicate topic IDs were produced",
        ],
        metrics: {
          sessionId,
          enqueueDurationMs,
          persistenceDurationMs: Date.now() - started,
          pollCount: polls,
          databaseReads: databaseUsage.reads,
          totalQueuePayloadBytes: queueUsage.totalPayloadBytes,
          maximumQueueJobPayloadBytes: queueUsage.maximumJobPayloadBytes,
          topicNodes: nodes.length,
          memoryNodes: snapshot.memories.length,
          topicLabels: nodes.map((node) => node.label),
          extractedMemories: snapshot.memories.map((memory) => memory.value),
          embeddingDimensions: [...new Set([
            ...nodes.map((node) => node.embedding.length),
            ...snapshot.memories.map((memory) => memory.embedding.length),
          ])],
        },
        conversation: [
          { role: "user", content: firstPrompt },
          { role: "assistant", content: firstAnswer },
          { role: "user", content: secondPrompt },
          { role: "assistant", content: secondAnswer },
        ],
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      await agent.close().catch(() => undefined);
      context.telemetry.stop();
      await cleanupSessions([sessionId]).catch(() => undefined);
    }
  },
};
