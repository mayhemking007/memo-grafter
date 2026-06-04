import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { EmbedAdapter, LLMAdapter, Message } from "../types.js";

export interface OpenAILLMAdapterOptions {
  streaming?: boolean;
  onChunk?: (chunk: string) => void | Promise<void>;
}

export class OpenAILLMAdapter implements LLMAdapter {
  private readonly client = new OpenAI();

  constructor(
    private readonly model = "gpt-4o",
    private readonly options: OpenAILLMAdapterOptions = {},
  ) {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const openAiMessages: ChatCompletionMessageParam[] = [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    if (this.options.streaming) {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: openAiMessages,
        stream: true,
      });
      let response = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta.content;
        if (!content) continue;

        response += content;
        await this.options.onChunk?.(content);
      }

      return response;
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openAiMessages,
    });

    return response.choices[0]?.message.content ?? "";
  }
}

export class OpenAIEmbedAdapter implements EmbedAdapter {
  private readonly client = new OpenAI();

  constructor(private readonly model = "text-embedding-3-small") {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0]?.embedding ?? [];
  }
}
