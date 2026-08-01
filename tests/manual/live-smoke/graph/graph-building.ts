import assert from "node:assert/strict";
import { MemoGrafter, type Message } from "../../../../src/index.js";
import {
  createOpenAITelemetry,
  OPENAI_RUNTIME,
  openAIConfig,
  uniqueId,
} from "../helpers/fixtures.js";
import type { SmokeTestDefinition } from "../helpers/types.js";

export const graphBuildingSmoke: SmokeTestDefinition = {
  suite: "graph",
  name: "graph-building",
  runtime: OPENAI_RUNTIME,
  async run(context) {
    const telemetry = createOpenAITelemetry(context.telemetry);
    const memo = new MemoGrafter(openAIConfig(telemetry, {
      drift: {
        mode: "intent",
        driftSensitivity: "low",
        minSegmentMessages: 2,
      },
    }, context.telemetry));
    const sessionId = uniqueId("live-smoke-graph");
    const transcript: Message[] = [
      { role: "user", content: "I am planning a quiet Kyoto trip and prefer small neighborhood cafes." },
      { role: "assistant", content: "I will focus on calm Kyoto neighborhoods and independent cafes." },
      { role: "user", content: "I also enjoy used bookstores and uncrowded temples while travelling." },
      { role: "assistant", content: "I will remember those Kyoto travel preferences." },
      { role: "user", content: "Now I need a software engineering cover letter for a TypeScript role." },
      { role: "assistant", content: "Let us switch to your TypeScript job application." },
      { role: "user", content: "The letter should emphasize API design and mentoring experience." },
      { role: "assistant", content: "I will emphasize API design, TypeScript, and mentoring." },
    ];

    try {
      await memo.initialize();
      context.telemetry.start();
      await memo.ingestNow(transcript, sessionId);
      const { nodes, segments } = await memo.getTopics(sessionId);
      const memories = await memo.store.getMemoriesBySession(sessionId);
      const topicEdges = await memo.store.getEdgesBySession(sessionId);
      const memoryEdges = await memo.store.getMemoryEdgesBySession(sessionId);

      assert.ok(segments.length >= 2, "OpenAI embeddings should separate the two explicit subjects");
      assert.ok(nodes.length >= 2, "graph building should persist multiple topic nodes");
      assert.ok(memories.length >= 2, "OpenAI extraction should persist memories for both subjects");
      assert.ok(nodes.every((node) => node.label.trim() && node.summary.trim()), "every topic should have a label and summary");
      assert.ok(nodes.every((node) => node.embedding.length === 1536), "every topic should have an OpenAI embedding");
      assert.ok(memories.every((memory) => memory.embedding.length === 1536), "every memory should have an OpenAI embedding");
      assert.ok(topicEdges.some((edge) => edge.type === "temporal"), "multiple topics should create a temporal graph edge");
      const topicIds = new Set(nodes.map((node) => node.id));
      assert.ok(memories.every((memory) => topicIds.has(memory.topicNodeId)), "every memory should belong to a persisted topic");

      return {
        assertions: [
          "OpenAI embeddings separated two explicit subjects",
          "OpenAI created topic labels, summaries, and structured memories",
          "Topic and memory embeddings had the expected dimensions",
          "The graph contained a temporal edge",
          "Every memory belonged to a persisted topic",
        ],
        metrics: {
          sessionId,
          segments: segments.length,
          topicNodes: nodes.length,
          memoryNodes: memories.length,
          topicEdges: topicEdges.length,
          memoryEdges: memoryEdges.length,
          embeddingDimensions: [...new Set([
            ...nodes.map((node) => node.embedding.length),
            ...memories.map((memory) => memory.embedding.length),
          ])],
          topics: nodes.map((node) => ({
            label: node.label,
            summary: node.summary,
            driftScore: Number(node.driftScore.toFixed(3)),
            messageRange: node.messageRange,
          })),
          memories: memories.map((memory) => ({
            subject: memory.subject,
            predicate: memory.predicate,
            value: memory.value,
          })),
        },
        tokenUsage: telemetry.snapshot(),
      };
    } finally {
      context.telemetry.stop();
      await memo.store.clearSession(sessionId).catch(() => undefined);
      await memo.close().catch(() => undefined);
    }
  },
};
