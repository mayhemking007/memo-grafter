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

      let nodes = await agent.getActiveNodes();
      let snapshot = await agent.getGraphSnapshot();
      while (
        (nodes.length === 0
          || snapshot.memories.length === 0
          || (context.telemetry.queueSnapshot()?.completedJobs ?? 0) < 2)
        && Date.now() - started < context.timeoutMs - 1_000
      ) {
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
      const queueUsage = context.telemetry.queueSnapshot();
      assert.ok(queueUsage, "queue telemetry should be enabled");
      assert.equal(queueUsage?.completedJobs, 2, "both queued conversation jobs should complete");
      assert.equal(queueUsage.failedJobs, 0, "queued conversation jobs should not fail");
      assert.equal(queueUsage.firstJobMessageCount, 2, "the first job should contain one conversation turn");
      assert.equal(queueUsage.lastJobMessageCount, 4, "the last job should contain two conversation turns");

      return {
        assertions: [
          "Queued ingestion was accepted",
          "The worker eventually persisted a topic and memory",
          "OpenAI created non-empty topic content and embeddings",
          "Two queue jobs completed with first/last payloads of 2 and 4 messages",
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
