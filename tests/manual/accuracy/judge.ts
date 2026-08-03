import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { LLMAdapter, Message } from "../../../src/index.js";
import { TelemetryLLMAdapter } from "../live-smoke/helpers/telemetry.js";
import type { AccuracyCase, JudgeResult } from "./types.js";

export const DEFAULT_JUDGE_MODEL = "gpt-4o-mini";

export function createJudge(): { adapter: TelemetryLLMAdapter; model: string } {
  const model = process.env.ACCURACY_JUDGE_MODEL?.trim() || DEFAULT_JUDGE_MODEL;
  return { adapter: new TelemetryLLMAdapter(new AccuracyJudgeAdapter(model)), model };
}

class AccuracyJudgeAdapter implements LLMAdapter {
  private readonly client = new OpenAI();

  constructor(private readonly model: string) {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const input: ChatCompletionMessageParam[] = [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: input,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    return response.choices[0]?.message.content ?? "";
  }
}

export async function judgeCase(
  adapter: TelemetryLLMAdapter,
  definition: AccuracyCase,
  actual: {
    topics: unknown;
    memories: unknown;
    recallFacts: unknown;
    graftPrompt: string;
    finalAnswer: string;
  },
): Promise<JudgeResult> {
  const payload = JSON.stringify({
    sourceConversation: definition.conversation,
    expectedTopics: definition.expectedTopics,
    expectedMemories: definition.expectedMemories,
    checkpoint: definition.checkpoint,
    actual,
  });
  const messages: Message[] = [{
    role: "user",
    content: `Evaluate this memory-system result using the rubric.\n\n${payload}`,
  }];
  const response = await adapter.complete(messages, [
    "You are an independent evaluator of a conversational memory system.",
    "Score each accuracy field from 0 to 1.",
    "Judge semantic equivalence, correct attribution, relevance, and support from the source conversation.",
    "Penalize invented memories, irrelevant retrieval, irrelevant graft content, and unsupported answer claims.",
    "Return JSON only with: topicAccuracy, memoryAccuracy, retrievalRelevance, graftRelevance,",
    "answerFaithfulness, hallucinationDetected, reason. Keep reason under 80 words.",
  ].join(" "));
  const parsed = parseJudgeJson(response);
  return {
    topicAccuracy: score(parsed.topicAccuracy, "topicAccuracy"),
    memoryAccuracy: score(parsed.memoryAccuracy, "memoryAccuracy"),
    retrievalRelevance: score(parsed.retrievalRelevance, "retrievalRelevance"),
    graftRelevance: score(parsed.graftRelevance, "graftRelevance"),
    answerFaithfulness: score(parsed.answerFaithfulness, "answerFaithfulness"),
    hallucinationDetected: Boolean(parsed.hallucinationDetected),
    reason: typeof parsed.reason === "string" ? parsed.reason : "No reason supplied.",
  };
}

function parseJudgeJson(response: string): Record<string, unknown> {
  const trimmed = response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error(`Judge returned invalid JSON: ${response.slice(0, 200)}`);
  }
}

function score(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Judge response is missing numeric ${field}.`);
  }
  return Math.min(1, Math.max(0, value));
}
