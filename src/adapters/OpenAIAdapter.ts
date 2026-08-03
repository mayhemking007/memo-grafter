import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { EmbedAdapter, LLMAdapter, Message } from "../core/types.js";

export interface OpenAILLMAdapterOptions {
  streaming?: boolean;
  onChunk?: (chunk: string) => void | Promise<void>;
}

export class OpenAILLMAdapter implements LLMAdapter {
  private clientPromise: Promise<OpenAI> | undefined;

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

    try {
      const client = await this.getClient();

      if (this.options.streaming) {
        const stream = await client.chat.completions.create({
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

      const response = await client.chat.completions.create({
        model: this.model,
        messages: openAiMessages,
      });

      return response.choices[0]?.message.content ?? "";
    } catch (error) {
      if (isMissingOpenAISdkError(error)) throw error;
      throw new Error(
        "OpenAI completion failed. Configure OPENAI_API_KEY and verify the model and credentials.",
        { cause: error },
      );
    }
  }

  private getClient(): Promise<OpenAI> {
    if (this.clientPromise) return this.clientPromise;
    const loading = loadOpenAIClient();
    this.clientPromise = loading;
    void loading.catch(() => {
      if (this.clientPromise === loading) this.clientPromise = undefined;
    });
    return loading;
  }
}

export class OpenAIEmbedAdapter implements EmbedAdapter {
  private clientPromise: Promise<OpenAI> | undefined;

  constructor(private readonly model = "text-embedding-3-small") {}

  async embed(text: string): Promise<number[]> {
    try {
      const client = await this.getClient();
      const response = await client.embeddings.create({
        model: this.model,
        input: text,
      });

      return response.data[0]?.embedding ?? [];
    } catch (error) {
      if (isMissingOpenAISdkError(error)) throw error;
      throw new Error(
        "OpenAI embedding failed. Configure OPENAI_API_KEY and verify the embedding model and credentials.",
        { cause: error },
      );
    }
  }

  private getClient(): Promise<OpenAI> {
    if (this.clientPromise) return this.clientPromise;
    const loading = loadOpenAIClient();
    this.clientPromise = loading;
    void loading.catch(() => {
      if (this.clientPromise === loading) this.clientPromise = undefined;
    });
    return loading;
  }
}

const missingOpenAISdkMessage =
  'OpenAI adapter requires the optional "openai" package. Install it with: npm install openai';

async function loadOpenAIClient(): Promise<OpenAI> {
  try {
    const { default: OpenAIClient } = await import("openai");
    return new OpenAIClient();
  } catch (error) {
    if (isModuleNotFound(error, "openai")) {
      throw new Error(missingOpenAISdkMessage, { cause: error });
    }
    throw error;
  }
}

function isMissingOpenAISdkError(error: unknown): boolean {
  return error instanceof Error && error.message === missingOpenAISdkMessage;
}

function isModuleNotFound(error: unknown, packageName: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")
    && error.message.includes(packageName);
}
