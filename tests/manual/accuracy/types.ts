import type { Message, MemoryNode, TopicNode } from "../../../src/index.js";
import type { DatabaseUsage, TokenUsage } from "../live-smoke/helpers/types.js";

export interface ExpectedConcept {
  name: string;
  requiredTerms: string[];
  messageRange?: [number, number];
}

export interface AccuracyCheckpoint {
  query: string;
  expectedFacts: ExpectedConcept[];
  forbiddenFacts?: ExpectedConcept[];
  answerRequirements: string[];
}

export interface AccuracyCase {
  id: string;
  description: string;
  conversation: Message[];
  expectedTopics: ExpectedConcept[];
  expectedMemories: ExpectedConcept[];
  checkpoint: AccuracyCheckpoint;
}

export interface AccuracyAssertion {
  name: string;
  passed: boolean;
  detail: string;
}

export interface AccuracyScores {
  topicPrecision: number;
  topicRecall: number;
  topicF1: number;
  topicRangeIoU: number;
  memoryPrecision: number;
  memoryRecall: number;
  memoryF1: number;
  recallPrecisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  graftCoverage: number;
  graftSignalRatio: number;
  answerCoverage: number;
}

export interface JudgeResult {
  topicAccuracy: number;
  memoryAccuracy: number;
  retrievalRelevance: number;
  graftRelevance: number;
  answerFaithfulness: number;
  hallucinationDetected: boolean;
  reason: string;
}

export interface AccuracyCaseResult {
  caseId: string;
  description: string;
  status: "evaluated" | "failed";
  durationMs: number;
  sessionId: string;
  conversation: Message[];
  expectedTopics: ExpectedConcept[];
  expectedMemories: ExpectedConcept[];
  checkpoint: AccuracyCheckpoint;
  topics: TopicNode[];
  memories: MemoryNode[];
  recallFacts: Array<MemoryNode & { similarity: number }>;
  recallPrompt: string;
  graftPrompt: string;
  graftTopicIds: string[];
  finalAnswer: string;
  assertions: AccuracyAssertion[];
  scores: AccuracyScores;
  systemUsage: TokenUsage;
  judgeUsage?: TokenUsage;
  databaseUsage: DatabaseUsage;
  judge?: JudgeResult;
  error?: string;
}

export interface AccuracyRunOptions {
  judge: boolean;
  writeDoc: boolean;
  reportPath?: string;
  strict: boolean;
  verbose: boolean;
  timeoutMs: number;
}
