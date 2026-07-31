import assert from "node:assert/strict";
import { MemoGrafterAgent } from "../../../../src/index.js";
import {
  createDeterministicTelemetry,
  NOT_USED_RUNTIME,
  deterministicConfig,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const memoryLifecycleSmoke: SmokeTestDefinition = {
  suite: "maintenance",
  name: "memory-lifecycle",
  runtime: NOT_USED_RUNTIME,
  async run() {
    const telemetry = createDeterministicTelemetry();
    const agent = new MemoGrafterAgent(deterministicConfig(telemetry));
    try {
      await agent.initialize();
      await agent.ingestText("The user prefers blue notebooks for lifecycle smoke testing.");
      const before = await agent.recall("blue notebook preference", { minSimilarity: 0.2 });
      const memoryId = before.facts[0]?.id;
      assert.ok(memoryId, "the lifecycle fixture should be recallable");
      assert.equal(await agent.forget(memoryId), true, "forget should change the memory state");
      const afterForget = await agent.recall("blue notebook preference", { minSimilarity: 0.2 });
      assert.equal(afterForget.facts.some((fact) => fact.id === memoryId), false, "forgotten memory should be excluded");

      const active = await agent.getActiveNodes();
      const topicId = active[0]?.id;
      assert.ok(topicId, "the lifecycle fixture should create a topic");
      assert.equal(await agent.suppressTopic(topicId), true, "suppress should change the topic state");
      assert.equal((await agent.getActiveNodes()).some((node) => node.id === topicId), false, "suppressed topic should be inactive");
      assert.equal(await agent.restoreTopic(topicId), true, "restore should change the topic state");
      assert.equal((await agent.getActiveNodes()).some((node) => node.id === topicId), true, "restored topic should be active");

      return {
        assertions: [
          "A persisted memory was initially recallable",
          "Forgotten memory was excluded from active recall",
          "Suppressed topic disappeared from active topics",
          "Restored topic returned to active topics",
        ],
        metrics: {
          sessionId: agent.getSessionId(),
          recalledBeforeForget: before.facts.length,
          recalledAfterForget: afterForget.facts.length,
          activeTopicsBeforeSuppress: active.length,
          activeTopicsAfterRestore: (await agent.getActiveNodes()).length,
        },
      };
    } finally {
      await agent.clearSession().catch(() => undefined);
      await agent.close().catch(() => undefined);
    }
  },
};
