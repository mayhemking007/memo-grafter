import assert from "node:assert/strict";
import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "../../../../src/index.js";
import { requireEnv } from "../helpers/fixtures.js";
import { TelemetryLLMAdapter } from "../helpers/telemetry.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const basicChatSmoke: SmokeTestDefinition = {
  suite: "grafter",
  name: "basic-chat",
  runtime: {
    llm: { provider: "OpenAI", model: "gpt-4o-mini" },
    embedder: { provider: "OpenAI", model: "text-embedding-3-small" },
  },
  async run(context) {
    const databaseUrl = requireEnv("DATABASE_URL");
    requireEnv("OPENAI_API_KEY");
    const telemetry = new TelemetryLLMAdapter(
      new OpenAILLMAdapter("gpt-4o-mini"),
      (usage) => context.telemetry.recordLlmCall(usage),
    );
    const agent = new MemoGrafterAgent({
      db: { connectionString: databaseUrl, telemetry: context.telemetry.databaseTelemetry },
      llm: telemetry,
      embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
      systemPrompt: "You are a concise assistant. Keep smoke-test answers to one sentence.",
      drift: { mode: "intent", driftSensitivity: "medium", minSegmentMessages: 2 },
      inject: { bufferSize: 0, tokenBudget: 1200 },
    });
    const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];

    try {
      await agent.initialize();
      context.telemetry.start();
      for (const prompt of [
        "Remember that I prefer quiet neighborhoods and small cafes when visiting Kyoto.",
        "What kind of Kyoto itinerary would suit me?",
      ]) {
        const answer = await agent.invoke(prompt);
        assert.ok(answer.trim(), "the chatbot should return a non-empty answer");
        conversation.push({ role: "user", content: prompt }, { role: "assistant", content: answer });
      }

      const snapshot = await agent.getGraphSnapshot();
      assert.ok(snapshot.nodes.length > 0, "the conversation should create topic nodes");
      assert.ok(snapshot.memories.length > 0, "the conversation should create memories");
      const recall = await agent.recall("Kyoto travel preferences", { minSimilarity: 0.2 });
      assert.ok(recall.facts.length > 0, "the stored preference should be recallable");
      const graft = await agent.graft();
      assert.ok(graft.nodes.length > 0, "graft should include persisted topics");

      return {
        assertions: [
          "Chatbot returned non-empty answers",
          "Conversation persisted topic and memory nodes",
          "Stored preference was recallable",
          "Graft included persisted context",
        ],
        metrics: {
          sessionId: agent.getSessionId(),
          topicNodes: snapshot.nodes.length,
          memoryNodes: snapshot.memories.length,
          recalledFacts: recall.facts.length,
          graftNodes: graft.nodes.length,
          graftTokenCount: graft.tokenCount,
          driftScores: snapshot.nodes.map((node) => node.driftScore),
        },
        conversation,
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      context.telemetry.stop();
      await agent.clearSession().catch(() => undefined);
      await agent.close().catch(() => undefined);
    }
  },
};
