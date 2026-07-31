import assert from "node:assert/strict";
import { Redis } from "ioredis";
import { MemoGrafterAgent } from "../../../../src/index.js";
import {
  createDeterministicTelemetry,
  NOT_USED_RUNTIME,
  deterministicConfig,
  optionalEnv,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

function statValue(info: string, name: string): number {
  const match = info.match(new RegExp(`^${name}:(\\d+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

async function cacheKeysForSession(redis: Redis, sessionId: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, page] = await redis.scan(
      cursor,
      "MATCH",
      `mg:recall:${sessionId}:*`,
      "COUNT",
      50,
    );
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return keys;
}

export const recallCacheSmoke: SmokeTestDefinition = {
  suite: "cache",
  name: "recall-cache",
  runtime: NOT_USED_RUNTIME,
  async run() {
    const redisUrl = optionalEnv("REDIS_URL");
    if (!redisUrl) throw new Error("SKIP: REDIS_URL is not configured.");

    const telemetry = createDeterministicTelemetry();
    const agent = new MemoGrafterAgent(deterministicConfig(telemetry, {
      cache: {
        connectionString: redisUrl,
        ttlSeconds: 60,
      },
    }));
    const observer = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    observer.on("error", () => undefined);
    let createdKeys: string[] = [];

    try {
      await observer.connect();
      await observer.ping();
      await agent.initialize();
      await agent.ingestText("The user prefers blue notebooks for recall cache testing.");
      const sessionId = agent.getSessionId();
      assert.equal((await cacheKeysForSession(observer, sessionId)).length, 0, "the unique session should start without cache keys");

      const beforeStats = await observer.info("stats");
      const firstStarted = performance.now();
      const first = await agent.recall("blue notebook cache preference", {
        limit: 3,
        minSimilarity: 0.2,
      });
      const firstRecallDurationMs = performance.now() - firstStarted;
      const afterFirstStats = await observer.info("stats");
      createdKeys = await cacheKeysForSession(observer, sessionId);

      const secondStarted = performance.now();
      const second = await agent.recall("blue notebook cache preference", {
        limit: 3,
        minSimilarity: 0.2,
      });
      const secondRecallDurationMs = performance.now() - secondStarted;
      const afterSecondStats = await observer.info("stats");

      const missDelta = statValue(afterFirstStats, "keyspace_misses")
        - statValue(beforeStats, "keyspace_misses");
      const hitDelta = statValue(afterSecondStats, "keyspace_hits")
        - statValue(afterFirstStats, "keyspace_hits");
      const cacheTtlSeconds = createdKeys[0] ? await observer.ttl(createdKeys[0]) : -2;
      const firstIds = first.facts.map((fact) => fact.id);
      const secondIds = second.facts.map((fact) => fact.id);

      assert.ok(first.facts.length > 0, "the first recall should return a persisted fact");
      assert.equal(createdKeys.length, 1, "the first recall should create one session-specific cache key");
      assert.ok(missDelta >= 1, "the first recall should record a Redis cache miss");
      assert.ok(hitDelta >= 1, "the second recall should record a Redis cache hit");
      assert.deepEqual(secondIds, firstIds, "cached recall should return the same fact IDs");
      assert.ok(cacheTtlSeconds > 0 && cacheTtlSeconds <= 60, "the cache key should have the configured TTL");

      return {
        assertions: [
          "First recall returned persisted memory and populated Redis",
          "First recall recorded a cache miss",
          "Second identical recall recorded a cache hit",
          "Cached and uncached recalls returned the same fact IDs",
          "Cache entry had a positive bounded TTL",
        ],
        metrics: {
          sessionId,
          firstRecallDurationMs: Number(firstRecallDurationMs.toFixed(2)),
          secondRecallDurationMs: Number(secondRecallDurationMs.toFixed(2)),
          factsReturned: first.facts.length,
          cacheKeysCreated: createdKeys.length,
          cacheMissDelta: missDelta,
          cacheHitDelta: hitDelta,
          cacheTtlSeconds,
          sameResult: JSON.stringify(firstIds) === JSON.stringify(secondIds),
        },
      };
    } finally {
      if (createdKeys.length > 0) await observer.del(...createdKeys).catch(() => undefined);
      await agent.clearSession().catch(() => undefined);
      await agent.close().catch(() => undefined);
      observer.disconnect();
    }
  },
};
