import type Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { LLMAdapter, Message } from "../core/types.js";

export class AnthropicLLMAdapter implements LLMAdapter {
  private clientPromise: Promise<Anthropic> | undefined;

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

    try {
      const client = await this.getClient();
      const response = await client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: anthropicMessages,
      });

      return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (error) {
      if (isMissingAnthropicSdkError(error)) throw error;
      throw new Error(
        "Anthropic completion failed. Configure ANTHROPIC_API_KEY and verify the model and credentials.",
        { cause: error },
      );
    }
  }

  private getClient(): Promise<Anthropic> {
    if (this.clientPromise) return this.clientPromise;
    const loading = loadAnthropicClient();
    this.clientPromise = loading;
    void loading.catch(() => {
      if (this.clientPromise === loading) this.clientPromise = undefined;
    });
    return loading;
  }
}

const missingAnthropicSdkMessage =
  'AnthropicLLMAdapter requires the optional "@anthropic-ai/sdk" package. Install it with: npm install @anthropic-ai/sdk';

async function loadAnthropicClient(): Promise<Anthropic> {
  try {
    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    return new AnthropicClient();
  } catch (error) {
    if (isModuleNotFound(error, "@anthropic-ai/sdk")) {
      throw new Error(missingAnthropicSdkMessage, { cause: error });
    }
    throw error;
  }
}

function isMissingAnthropicSdkError(error: unknown): boolean {
  return error instanceof Error && error.message === missingAnthropicSdkMessage;
}

function isModuleNotFound(error: unknown, packageName: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")
    && error.message.includes(packageName);
}
