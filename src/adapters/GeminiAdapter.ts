import { GoogleGenAI, type Content } from "@google/genai";
import type { EmbedAdapter, LLMAdapter, Message } from "../core/types.js";

const createGeminiClient = (): GoogleGenAI =>
  new GoogleGenAI(
    process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {}
  );

export class GeminiLLMAdapter implements LLMAdapter {
  private readonly client = createGeminiClient();

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

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      ...(systemInstruction ? { config: { systemInstruction } } : {}),
    });

    return response.text ?? "";
  }
}

export class GeminiEmbedAdapter implements EmbedAdapter {
  private readonly client = createGeminiClient();

  constructor(
    private readonly model = "gemini-embedding-001",
    private readonly outputDimensionality = 1536
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await this.client.models.embedContent({
      model: this.model,
      contents: text,
      config: {
        outputDimensionality: this.outputDimensionality,
        taskType: "SEMANTIC_SIMILARITY",
      },
    });

    return response.embeddings?.[0]?.values ?? [];
  }
}
