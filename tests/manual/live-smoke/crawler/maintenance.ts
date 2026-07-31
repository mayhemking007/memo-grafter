import assert from "node:assert/strict";
import {
  ConflictDetectionPass,
  MemoGrafter,
  MemoGrafterCrawler,
  VersioningPass,
} from "../../../../src/index.js";
import {
  createDeterministicTelemetry,
  NOT_USED_RUNTIME,
  deterministicConfig,
  uniqueId,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const crawlerMaintenanceSmoke: SmokeTestDefinition = {
  suite: "crawler",
  name: "maintenance",
  runtime: NOT_USED_RUNTIME,
  async run() {
    const telemetry = createDeterministicTelemetry();
    const memo = new MemoGrafter(deterministicConfig(telemetry, {
      drift: { mode: "intent", driftSensitivity: "low", minSegmentMessages: 1 },
    }));
    const sessionId = uniqueId("live-smoke-crawler");
    try {
      await memo.initialize();
      await memo.ingestNow([
        { role: "user", content: "I live in Delhi." },
        { role: "assistant", content: "I will remember Delhi." },
      ], sessionId);
      await memo.ingestNow([
        { role: "user", content: "I live in Delhi." },
        { role: "assistant", content: "I will remember Delhi." },
        { role: "user", content: "Correction: I live in Bangalore now." },
        { role: "assistant", content: "I will remember Bangalore." },
      ], sessionId);

      const crawler = new MemoGrafterCrawler({
        store: memo.store,
        passes: [new ConflictDetectionPass(), new VersioningPass()],
      });
      const first = await crawler.runOnce();
      const second = await crawler.runOnce();
      const memories = await memo.store.getMemoriesBySession(sessionId);
      const edges = await memo.store.getMemoryEdgesBySession(sessionId);
      const delhi = memories.find((memory) => memory.value === "Delhi");
      const bangalore = memories.find((memory) => memory.value === "Actually Bangalore now");

      assert.ok(first.ok, "all crawler passes should succeed");
      assert.ok(delhi && bangalore, "both memory versions should remain stored");
      assert.equal(delhi.supersededBy, bangalore.id, "the older location should point to its replacement");
      assert.ok(edges.some((edge) => edge.edgeType === "updates"), "the crawler should create an update edge");
      assert.equal(second.passes[1]?.result?.updateEdgesCreated, 0, "the second run should be idempotent");

      return {
        assertions: [
          "Crawler passes completed successfully",
          "Historical and current memories remained stored",
          "The older fact was superseded by the new fact",
          "A second run created no duplicate update edge",
        ],
        metrics: {
          sessionId,
          memories: memories.length,
          memoryEdges: edges.length,
          firstRunDurationMs: first.durationMs,
          secondRunDurationMs: second.durationMs,
          firstPassResults: first.passes.map((pass) => ({ name: pass.name, ...pass.result })),
          secondPassResults: second.passes.map((pass) => ({ name: pass.name, ...pass.result })),
        },
      };
    } finally {
      await memo.store.clearSession(sessionId).catch(() => undefined);
      await memo.close().catch(() => undefined);
    }
  },
};
