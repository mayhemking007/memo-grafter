import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LLMAdapter, Message } from "../core/types.js";

export class AnthropicLLMAdapter implements LLMAdapter {
  private readonly client = new Anthropic();

  constructor(
    private readonly model = "claude-sonnet-4-5",
    private readonly maxTokens = 1024
  ) {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    const anthropicMessages: MessageParam[] = messages
      .filter((message): message is Message & { role: "user" | "assistant" } => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    const systemPrompt = [system, ...systemMessages].filter(Boolean).join("\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: anthropicMessages,
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}
