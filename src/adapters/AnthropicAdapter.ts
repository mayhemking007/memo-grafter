import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LLMAdapter, Message } from "../types.js";

export class AnthropicLLMAdapter implements LLMAdapter {
  private readonly client = new Anthropic();

  constructor(
    private readonly model = "claude-sonnet-4-5",
    private readonly maxTokens = 1024
  ) {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const anthropicMessages: MessageParam[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}
