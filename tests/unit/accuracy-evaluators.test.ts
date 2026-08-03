import { describe, expect, it } from "vitest";
import type { MemoryNode, TopicNode } from "../../src/index.js";
import { conceptMatches, evaluateCase } from "../manual/accuracy/evaluators.js";
import type { AccuracyCase } from "../manual/accuracy/types.js";

const definition: AccuracyCase = {
  id: "fixture",
  description: "fixture",
  conversation: [],
  expectedTopics: [{ name: "travel", requiredTerms: ["kyoto", "travel"], messageRange: [0, 3] }],
  expectedMemories: [{ name: "preference", requiredTerms: ["quiet", "cafe"] }],
  checkpoint: {
    query: "Where should I go?",
    expectedFacts: [{ name: "preference", requiredTerms: ["quiet", "cafe"] }],
    forbiddenFacts: [{ name: "career", requiredTerms: ["typescript", "job"] }],
    answerRequirements: ["quiet", "cafe"],
  },
};

const topic = {
  id: "topic", label: "Kyoto Travel", summary: "Quiet travel preferences", messageRange: [0, 3],
} as unknown as TopicNode;
const memory = {
  id: "memory", subject: "user", predicate: "preference", value: "quiet independent cafe",
} as unknown as MemoryNode & { similarity: number };

describe("accuracy deterministic evaluators", () => {
  it("matches concepts case-insensitively", () => {
    expect(conceptMatches("Quiet KYOTO cafe", { name: "fixture", requiredTerms: ["quiet", "kyoto"] })).toBe(true);
  });

  it("scores a fully matching retrieval pipeline", () => {
    const result = evaluateCase(
      definition,
      [topic],
      [memory],
      [{ ...memory, similarity: 0.9 }],
      "The user prefers a quiet independent cafe.",
      "Choose a quiet neighborhood cafe.",
    );
    expect(result.scores.topicF1).toBe(1);
    expect(result.scores.memoryF1).toBe(1);
    expect(result.scores.recallAtK).toBe(1);
    expect(result.scores.graftCoverage).toBe(1);
    expect(result.scores.answerCoverage).toBe(1);
    expect(result.assertions.every((assertion) => assertion.passed)).toBe(true);
  });

  it("reports forbidden retrieval and graft content", () => {
    const forbidden = {
      ...memory,
      id: "forbidden",
      value: "TypeScript job application",
      similarity: 0.8,
    };
    const result = evaluateCase(
      definition,
      [topic],
      [memory],
      [{ ...memory, similarity: 0.9 }, forbidden],
      "quiet cafe plus TypeScript job",
      "quiet cafe",
    );
    expect(result.assertions.find((assertion) => assertion.name === "Recall excluded forbidden facts")?.passed).toBe(false);
    expect(result.assertions.find((assertion) => assertion.name === "Graft excluded forbidden context")?.passed).toBe(false);
  });
});
