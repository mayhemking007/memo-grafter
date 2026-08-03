import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  embeddingsCreate: vi.fn(),
  constructor: vi.fn(),
}));

vi.mock("openai", () => ({
  default: function MockOpenAI() {
    mocks.constructor();
    return {
      chat: {
        completions: {
          create: mocks.create,
        },
      },
      embeddings: {
        create: mocks.embeddingsCreate,
      },
    };
  },
}));

import { OpenAIEmbedAdapter, OpenAILLMAdapter } from "../../../src/adapters/OpenAIAdapter.js";

async function* createStream(chunks: Array<string | undefined>) {
  for (const content of chunks) {
    yield {
      choices: [
        {
          delta: content === undefined ? {} : { content },
        },
      ],
    };
  }
}

describe("OpenAILLMAdapter", () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.embeddingsCreate.mockReset();
    mocks.constructor.mockReset();
  });

  it("does not construct the SDK client until the first provider operation", async () => {
    const adapter = new OpenAILLMAdapter("gpt-test");
    expect(mocks.constructor).not.toHaveBeenCalled();

    mocks.create.mockResolvedValue({ choices: [{ message: { content: "ok" } }] });
    await Promise.all([
      adapter.complete([{ role: "user", content: "one" }]),
      adapter.complete([{ role: "user", content: "two" }]),
    ]);

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
  });

  it("uses the existing non-streaming completion path by default", async () => {
    mocks.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "full response",
          },
        },
      ],
    });

    const adapter = new OpenAILLMAdapter("gpt-test");
    const response = await adapter.complete(
      [{ role: "user", content: "Hello" }],
      "System prompt",
    );

    expect(response).toBe("full response");
    expect(mocks.create).toHaveBeenCalledWith({
      model: "gpt-test",
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("streams chunks when enabled and still returns the full response", async () => {
    mocks.create.mockResolvedValueOnce(createStream(["Hel", "lo", undefined, " world"]));
    const chunks: string[] = [];
    const adapter = new OpenAILLMAdapter("gpt-test", {
      streaming: true,
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
    });

    const response = await adapter.complete([{ role: "user", content: "Hello" }]);

    expect(chunks).toEqual(["Hel", "lo", " world"]);
    expect(response).toBe("Hello world");
    expect(mocks.create).toHaveBeenCalledWith({
      model: "gpt-test",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    });
  });

  it("wraps completion failures and preserves the provider error", async () => {
    const providerError = new Error("invalid api key");
    mocks.create.mockRejectedValueOnce(providerError);

    const error = await new OpenAILLMAdapter("gpt-test")
      .complete([{ role: "user", content: "Hello" }])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/OpenAI completion failed.*OPENAI_API_KEY/);
    expect((error as Error).cause).toBe(providerError);
  });

  it("loads the embedder lazily and labels embedding failures", async () => {
    const adapter = new OpenAIEmbedAdapter("embed-test");
    expect(mocks.constructor).not.toHaveBeenCalled();

    const providerError = new Error("invalid api key");
    mocks.embeddingsCreate.mockRejectedValueOnce(providerError);
    const error = await adapter.embed("Hello").catch((caught: unknown) => caught);

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toMatch(/OpenAI embedding failed.*OPENAI_API_KEY/);
    expect((error as Error).cause).toBe(providerError);
  });
});
