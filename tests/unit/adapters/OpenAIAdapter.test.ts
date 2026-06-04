import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  embeddingsCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn(function MockOpenAI() {
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
  }),
}));

import { OpenAILLMAdapter } from "../../../src/adapters/OpenAIAdapter.js";

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
});
