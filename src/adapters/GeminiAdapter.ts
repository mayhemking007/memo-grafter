import type { Content, GoogleGenAI } from "@google/genai";
import type { EmbedAdapter, LLMAdapter, Message } from "../core/types.js";

export class GeminiLLMAdapter implements LLMAdapter {
  private clientPromise: Promise<GoogleGenAI> | undefined;

  constructor(private readonly model = "gemini-2.5-flash") {}

  async complete(messages: Message[], system?: string): Promise<string> {
    const systemMessages = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    const contents: Content[] = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    const systemInstruction = [system, ...systemMessages].filter(Boolean).join("\n\n");

    try {
      const client = await this.getClient();
      const response = await client.models.generateContent({
        model: this.model,
        contents,
        ...(systemInstruction ? { config: { systemInstruction } } : {}),
      });

      return response.text ?? "";
    } catch (error) {
      if (isMissingGeminiSdkError(error)) throw error;
      throw new Error(
        "Gemini completion failed. Configure GEMINI_API_KEY and verify the model and credentials.",
        { cause: error },
      );
    }
  }

  private getClient(): Promise<GoogleGenAI> {
    if (this.clientPromise) return this.clientPromise;
    const loading = loadGeminiClient();
    this.clientPromise = loading;
    void loading.catch(() => {
      if (this.clientPromise === loading) this.clientPromise = undefined;
    });
    return loading;
  }
}

export class GeminiEmbedAdapter implements EmbedAdapter {
  private clientPromise: Promise<GoogleGenAI> | undefined;

  constructor(
    private readonly model = "gemini-embedding-001",
    private readonly outputDimensionality = 1536
  ) {}

  async embed(text: string): Promise<number[]> {
    try {
      const client = await this.getClient();
      const response = await client.models.embedContent({
        model: this.model,
        contents: text,
        config: {
          outputDimensionality: this.outputDimensionality,
          taskType: "SEMANTIC_SIMILARITY",
        },
      });

      return response.embeddings?.[0]?.values ?? [];
    } catch (error) {
      if (isMissingGeminiSdkError(error)) throw error;
      throw new Error(
        "Gemini embedding failed. Configure GEMINI_API_KEY and verify the embedding model and credentials.",
        { cause: error },
      );
    }
  }

  private getClient(): Promise<GoogleGenAI> {
    if (this.clientPromise) return this.clientPromise;
    const loading = loadGeminiClient();
    this.clientPromise = loading;
    void loading.catch(() => {
      if (this.clientPromise === loading) this.clientPromise = undefined;
    });
    return loading;
  }
}

const missingGeminiSdkMessage =
  'Gemini adapter requires the optional "@google/genai" package. Install it with: npm install @google/genai';

async function loadGeminiClient(): Promise<GoogleGenAI> {
  try {
    const { GoogleGenAI: GoogleGenAIClient } = await import("@google/genai");
    return new GoogleGenAIClient(
      process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {},
    );
  } catch (error) {
    if (isModuleNotFound(error, "@google/genai")) {
      throw new Error(missingGeminiSdkMessage, { cause: error });
    }
    throw error;
  }
}

function isMissingGeminiSdkError(error: unknown): boolean {
  return error instanceof Error && error.message === missingGeminiSdkMessage;
}

function isModuleNotFound(error: unknown, packageName: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")
    && error.message.includes(packageName);
}
