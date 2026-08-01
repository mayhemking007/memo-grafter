import assert from "node:assert/strict";
import { MemoGrafterFleet } from "../../../../src/index.js";
import {
  cleanupFleet,
  createOpenAITelemetry,
  OPENAI_RUNTIME,
  openAIConfig,
  uniqueId,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const fleetSharedMemorySmoke: SmokeTestDefinition = {
  suite: "fleet",
  name: "shared-memory",
  runtime: OPENAI_RUNTIME,
  async run(context) {
    const telemetry = createOpenAITelemetry(context.telemetry);
    const fleetId = uniqueId("live-smoke-fleet");
    const fleet = new MemoGrafterFleet(openAIConfig(telemetry, {}, context.telemetry), {
      id: fleetId,
      name: "Live smoke fleet",
    });
    const sessionIds: string[] = [];
    try {
      await fleet.initialize();
      context.telemetry.start();
      const support = await fleet.createWorker({ color: "support" });
      const billing = await fleet.createWorker({ color: "billing", memory: "fleet" });
      sessionIds.push(fleet.getSharedSessionId(), support.getSessionId(), billing.getSessionId());

      await fleet.ingestToFleet("Company refund policy: customers can request a refund within 30 days.");
      const shared = await fleet.getSharedMemory();
      const localOnly = await billing.recall("refund policy", { memory: "local" });
      const fleetOnly = await billing.recall("refund policy", { memory: "fleet", minSimilarity: 0.2 });
      const graft = await billing.graftByRelevance("refund policy", {
        memory: "fleet",
        minSimilarity: 0.2,
        expansionStrategy: "none",
      });
      const billingPrompt = "According to the shared company policy, how long does a customer have to request a refund? Reply in one short sentence.";
      const billingAnswer = await billing.invoke(billingPrompt);
      const graph = await fleet.getGraph();

      assert.equal(graph.agents.length, 2, "the fleet should contain two workers");
      assert.ok(shared.nodes.length > 0, "shared ingestion should create a shared topic");
      assert.ok(shared.memories.some((memory) => memory.value.includes("30 days")), "shared memory should contain the refund window");
      assert.equal(localOnly.facts.length, 0, "shared memory should not leak into local-only recall");
      assert.ok(fleetOnly.facts.some((fact) => fact.value.includes("30 days")), "fleet recall should return the shared policy");
      assert.ok(graft.nodes.some((node) => node.sessionId === fleet.getSharedSessionId()), "fleet graft should include a shared node");
      assert.match(billingAnswer, /30\s+days/i, "the OpenAI worker answer should use the shared refund policy");

      return {
        assertions: [
          "Fleet initialized two isolated workers",
          "Shared policy persisted in fleet memory",
          "Local-only recall excluded shared memory",
          "Fleet recall and graft returned shared memory",
          "OpenAI answered from the shared Fleet fact",
        ],
        metrics: {
          fleetId,
          agents: graph.agents.length,
          sharedTopicNodes: shared.nodes.length,
          sharedMemoryNodes: shared.memories.length,
          localRecallFacts: localOnly.facts.length,
          fleetRecallFacts: fleetOnly.facts.length,
          graftNodes: graft.nodes.length,
          graftTokenCount: graft.tokenCount,
        },
        conversation: [
          { role: "user", content: billingPrompt },
          { role: "assistant", content: billingAnswer },
        ],
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      context.telemetry.stop();
      await fleet.close().catch(() => undefined);
      await cleanupFleet(fleetId, sessionIds).catch(() => undefined);
    }
  },
};
