import assert from "node:assert/strict";
import { MemoGrafterAgent } from "../../../../src/index.js";
import { splitTextForIngestion } from "../../../../src/utils/text/splitTextForIngestion.js";
import {
  createOpenAITelemetry,
  OPENAI_RUNTIME,
  openAIConfig,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const ingestTextSmoke: SmokeTestDefinition = {
  suite: "ingestion",
  name: "ingest-text",
  runtime: OPENAI_RUNTIME,
  async run(context) {
    const telemetry = createOpenAITelemetry(context.telemetry);
    const agent = new MemoGrafterAgent(openAIConfig(telemetry, {
      drift: { mode: "intent", driftSensitivity: "medium", minSegmentMessages: 1 },
    }, context.telemetry));
    const paragraphs = [
      "Project Atlas imports customer documents and turns them into searchable knowledge.",
      "The current roadmap prioritizes PDF ingestion, source attribution, and reliable retrieval.",
    ];
    const text = paragraphs.join("\n\n");
    const replacementText = "Project Atlas now prioritizes secure HTML document ingestion.";

    try {
      await agent.initialize();
      context.telemetry.start();
      assert.equal(agent.getHistory().length, 0, "chat history should start empty");

      await agent.ingestText(text, {
        label: "Project Atlas Notes",
        source: "live-smoke-document",
      });
      assert.equal(agent.getHistory().length, 0, "ingestText should not add chat history");

      const beforeReplace = await agent.getGraphSnapshot();
      assert.ok(beforeReplace.nodes.length > 0, "ingestText should create topic nodes");
      assert.ok(beforeReplace.memories.length > 0, "ingestText should extract memories");
      assert.ok(beforeReplace.nodes.every((node) => node.label.trim() && node.summary.trim()), "topics should have labels and summaries");
      assert.ok(beforeReplace.nodes.every((node) => node.source === "live-smoke-document"), "topic source metadata should persist");
      assert.ok(beforeReplace.memories.every((memory) => memory.source === "live-smoke-document"), "memory source metadata should persist");
      assert.ok(beforeReplace.memories.every((memory) => memory.sourceType === "document"), "ingestText memories should use document source type");
      assert.ok(beforeReplace.nodes.every((node) => node.embedding.length === 1536), "topics should have OpenAI embeddings");
      assert.ok(beforeReplace.memories.every((memory) => memory.embedding.length === 1536), "memories should have OpenAI embeddings");

      const recall = await agent.recall("What does the Project Atlas roadmap prioritize?", { minSimilarity: 0.2 });
      assert.ok(recall.facts.length > 0, "document content should be recallable");
      const originalNodeIds = new Set(beforeReplace.nodes.map((node) => node.id));

      await agent.ingestText(replacementText, {
        replace: true,
        source: "live-smoke-replacement",
      });
      const afterReplace = await agent.getGraphSnapshot();
      assert.ok(afterReplace.nodes.length > 0, "replacement text should create a new topic");
      assert.ok(afterReplace.nodes.every((node) => !originalNodeIds.has(node.id)), "replace should remove the previous topic graph");
      assert.ok(afterReplace.nodes.every((node) => node.source === "live-smoke-replacement"), "replacement source metadata should persist");

      const prompt = "In one short sentence, what does Project Atlas prioritize now?";
      const answer = await agent.invoke(prompt);
      assert.ok(answer.trim(), "invoke should still work after ingestText replacement");
      assert.equal(agent.getHistory().length, 2, "invoke should retain normal chat history behavior");
      await agent.getGraphSnapshot();

      return {
        assertions: [
          "ingestText created OpenAI-backed topics and document memories",
          "ingestText did not modify public chat history",
          "Source and document metadata persisted",
          "Document memory was recallable",
          "replace removed the previous session graph",
          "Normal invoke behavior worked after replacement",
        ],
        metrics: {
          sessionId: agent.getSessionId(),
          ingestTextCalls: 2,
          inputCharacters: text.length + replacementText.length,
          inputChunks: splitTextForIngestion(text).length + splitTextForIngestion(replacementText).length,
          topicsBeforeReplace: beforeReplace.nodes.length,
          memoriesBeforeReplace: beforeReplace.memories.length,
          topicsAfterReplace: afterReplace.nodes.length,
          memoriesAfterReplace: afterReplace.memories.length,
          recalledFacts: recall.facts.length,
          topicLabels: beforeReplace.nodes.map((node) => node.label),
          extractedMemories: beforeReplace.memories.map((memory) => memory.value),
        },
        conversation: [
          { role: "user", content: prompt },
          { role: "assistant", content: answer },
        ],
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      context.telemetry.stop();
      await agent.clearSession().catch(() => undefined);
      await agent.close().catch(() => undefined);
    }
  },
};
