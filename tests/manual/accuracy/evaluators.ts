import type { MemoryNode, TopicNode } from "../../../src/index.js";
import type {
  AccuracyAssertion,
  AccuracyCase,
  AccuracyScores,
  ExpectedConcept,
} from "./types.js";

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const divide = (numerator: number, denominator: number): number => denominator === 0 ? 0 : numerator / denominator;
const f1 = (precision: number, recall: number): number =>
  precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);

export function conceptMatches(text: string, concept: ExpectedConcept): boolean {
  const normalized = text.toLowerCase();
  return concept.requiredTerms.every((term) => normalized.includes(term.toLowerCase()));
}

function topicText(topic: TopicNode): string {
  return `${topic.label} ${topic.summary}`;
}

function memoryText(memory: MemoryNode): string {
  return `${memory.subject} ${memory.predicate} ${memory.value}`;
}

function matchCount(actual: string[], expected: ExpectedConcept[]): number {
  return expected.filter((concept) => actual.some((text) => conceptMatches(text, concept))).length;
}

function rangeIoU(actual: [number, number], expected: [number, number]): number {
  const intersection = Math.max(0, Math.min(actual[1], expected[1]) - Math.max(actual[0], expected[0]) + 1);
  const union = Math.max(actual[1], expected[1]) - Math.min(actual[0], expected[0]) + 1;
  return divide(intersection, union);
}

export function evaluateCase(
  definition: AccuracyCase,
  topics: TopicNode[],
  memories: MemoryNode[],
  recallFacts: Array<MemoryNode & { similarity: number }>,
  graftPrompt: string,
  answer: string,
): { scores: AccuracyScores; assertions: AccuracyAssertion[] } {
  const topicTexts = topics.map(topicText);
  const memoryTexts = memories.map(memoryText);
  const recalledTexts = recallFacts.map(memoryText);
  const matchedTopics = matchCount(topicTexts, definition.expectedTopics);
  const matchedMemories = matchCount(memoryTexts, definition.expectedMemories);
  const relevantRecallIndexes = recallFacts
    .map((fact, index) => definition.checkpoint.expectedFacts.some((concept) => conceptMatches(memoryText(fact), concept)) ? index : -1)
    .filter((index) => index >= 0);
  const relevantRecall = relevantRecallIndexes.length;
  const forbiddenRecall = (definition.checkpoint.forbiddenFacts ?? [])
    .filter((concept) => recalledTexts.some((text) => conceptMatches(text, concept))).length;
  const requiredInGraft = definition.checkpoint.expectedFacts
    .filter((concept) => conceptMatches(graftPrompt, concept)).length;
  const forbiddenInGraft = (definition.checkpoint.forbiddenFacts ?? [])
    .filter((concept) => conceptMatches(graftPrompt, concept)).length;
  const topicPrecision = divide(matchedTopics, topics.length);
  const topicRecall = divide(matchedTopics, definition.expectedTopics.length);
  const memoryPrecision = divide(matchedMemories, memories.length);
  const memoryRecall = divide(matchedMemories, definition.expectedMemories.length);
  const rangeScores = definition.expectedTopics.flatMap((expected) => {
    if (!expected.messageRange) return [];
    const candidates = topics.filter((topic) => conceptMatches(topicText(topic), expected));
    return [Math.max(0, ...candidates.map((topic) => rangeIoU(topic.messageRange, expected.messageRange!)))];
  });
  const answerHits = definition.checkpoint.answerRequirements
    .filter((term) => answer.toLowerCase().includes(term.toLowerCase())).length;
  const scores: AccuracyScores = {
    topicPrecision: clamp(topicPrecision),
    topicRecall: clamp(topicRecall),
    topicF1: clamp(f1(topicPrecision, topicRecall)),
    topicRangeIoU: clamp(divide(rangeScores.reduce((sum, score) => sum + score, 0), rangeScores.length)),
    memoryPrecision: clamp(memoryPrecision),
    memoryRecall: clamp(memoryRecall),
    memoryF1: clamp(f1(memoryPrecision, memoryRecall)),
    recallPrecisionAtK: clamp(divide(relevantRecall, recallFacts.length)),
    recallAtK: clamp(divide(relevantRecall, definition.checkpoint.expectedFacts.length)),
    reciprocalRank: relevantRecallIndexes.length === 0 ? 0 : 1 / (relevantRecallIndexes[0]! + 1),
    graftCoverage: clamp(divide(requiredInGraft, definition.checkpoint.expectedFacts.length)),
    graftSignalRatio: clamp(divide(requiredInGraft, requiredInGraft + forbiddenInGraft)),
    answerCoverage: clamp(divide(answerHits, definition.checkpoint.answerRequirements.length)),
  };

  return {
    scores,
    assertions: [
      { name: "Graph formed topics", passed: topics.length > 0, detail: `${topics.length} topic nodes formed.` },
      { name: "Graph formed memories", passed: memories.length > 0, detail: `${memories.length} memory nodes formed.` },
      { name: "Expected memories found", passed: matchedMemories === definition.expectedMemories.length, detail: `${matchedMemories}/${definition.expectedMemories.length} expected concepts matched.` },
      { name: "Recall returned required facts", passed: relevantRecall > 0, detail: `${relevantRecall}/${recallFacts.length} recalled facts matched a requirement.` },
      { name: "Recall excluded forbidden facts", passed: forbiddenRecall === 0, detail: `${forbiddenRecall} forbidden fact concepts were recalled.` },
      { name: "Graft included required context", passed: requiredInGraft > 0, detail: `${requiredInGraft}/${definition.checkpoint.expectedFacts.length} required concepts appeared in the graft.` },
      { name: "Graft excluded forbidden context", passed: forbiddenInGraft === 0, detail: `${forbiddenInGraft} forbidden concepts appeared in the graft.` },
      { name: "Answer used expected facts", passed: answerHits === definition.checkpoint.answerRequirements.length, detail: `${answerHits}/${definition.checkpoint.answerRequirements.length} required answer terms appeared.` },
    ],
  };
}
