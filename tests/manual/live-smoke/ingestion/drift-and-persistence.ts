import assert from "node:assert/strict";
import { MemoGrafter, type Message } from "../../../../src/index.js";
import {
  createDeterministicTelemetry,
  NOT_USED_RUNTIME,
  deterministicConfig,
  uniqueId,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const driftAndPersistenceSmoke: SmokeTestDefinition = {
  suite: "ingestion",
  name: "drift-and-persistence",
  runtime: NOT_USED_RUNTIME,
  async run(context) {
    const telemetry = createDeterministicTelemetry();
    const memo = new MemoGrafter(deterministicConfig(telemetry, {}, context.telemetry));
    const sessionId = uniqueId("live-smoke-drift");
    const transcript: Message[] = [
      { role: "user", content: "I am planning a quiet trip to Kyoto." },
      { role: "assistant", content: "Let us focus on a calm Kyoto itinerary." },
      { role: "user", content: "For Kyoto I prefer small cafes and bookstores." },
      { role: "assistant", content: "I will prioritize cafes and bookstores." },
      { role: "user", content: "Now I need help with a software cover letter." },
      { role: "assistant", content: "Let us switch to your software application." },
      { role: "user", content: "The cover letter should emphasize TypeScript experience." },
      { role: "assistant", content: "I will emphasize your TypeScript experience." },
    ];
    try {
      await memo.initialize();
      context.telemetry.start();
      const nodes = await memo.ingestNow(transcript, sessionId);
      const { segments } = await memo.getTopics(sessionId);
      const memories = await memo.store.getMemoriesBySession(sessionId);
      assert.ok(segments.length >= 2, "the deliberate topic transition should create at least two segments");
      assert.ok(nodes.length >= 2, "segments should persist as topic nodes");
      assert.ok(memories.length >= 2, "both topics should persist memories");
      assert.ok(segments.some((segment) => segment.driftScore > 0), "at least one segment should record drift");

      const ranges = nodes.map((node) => node.messageRange);
      for (let index = 1; index < ranges.length; index += 1) {
        assert.ok((ranges[index - 1]?.[1] ?? -1) < (ranges[index]?.[0] ?? 0), "topic ranges must not overlap");
      }

      return {
        assertions: [
          "A deliberate subject change created multiple segments",
          "Segments and extracted memories persisted",
          "At least one non-zero drift score was recorded",
          "Persisted message ranges did not overlap",
        ],
        metrics: {
          sessionId,
          segments: segments.length,
          topicNodes: nodes.length,
          memoryNodes: memories.length,
          driftScores: segments.map((segment) => segment.driftScore),
          topicRanges: nodes.map((node) => ({
            label: node.label,
            start: node.messageRange[0],
            end: node.messageRange[1],
            driftScore: node.driftScore,
          })),
        },
      };
    } finally {
      context.telemetry.stop();
      await memo.store.clearSession(sessionId).catch(() => undefined);
      await memo.close().catch(() => undefined);
    }
  },
};
