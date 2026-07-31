import type { LLMAdapter, Message } from "../../../../src/index.js";
import type { TokenUsage } from "./types.js";

function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

export class TelemetryLLMAdapter implements LLMAdapter {
  private readonly usage: TokenUsage = {
    calls: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedTotalTokens: 0,
  };

  constructor(private readonly delegate: LLMAdapter) {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const input = [system ?? "", ...messages.map((message) => message.content)].join("\n");
    const response = await this.delegate.complete(messages, system);
    this.usage.calls += 1;
    this.usage.estimatedInputTokens += estimateTokens(input);
    this.usage.estimatedOutputTokens += estimateTokens(response);
    this.usage.estimatedTotalTokens =
      this.usage.estimatedInputTokens + this.usage.estimatedOutputTokens;
    return response;
  }

  snapshot(): TokenUsage {
    return { ...this.usage };
  }
}
