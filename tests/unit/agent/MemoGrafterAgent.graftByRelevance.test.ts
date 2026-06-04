import { describe, expect, it, vi } from "vitest";
import { MemoGrafterAgent } from "../../../src/MemoGrafterAgent.js";
import type { EmbedAdapter, InjectionResult, LLMAdapter } from "../../../src/index.js";

describe("MemoGrafterAgent.graftByRelevance", () => {
  it("delegates semantic grafting to the current session", async () => {
    const llm: LLMAdapter = {
      complete: vi.fn(async () => "response"),
    };
    const embedder: EmbedAdapter = {
      embed: vi.fn(async () => [0.1, 0.2]),
    };
    const agent = new MemoGrafterAgent({
      db: { connectionString: "postgres://example" },
      llm,
      embedder,
    });
    const graft: InjectionResult = {
      systemPrompt: "prompt",
      nodes: [],
      tokenCount: 1,
    };
    const core = {
      graftByRelevance: vi.fn(async () => graft),
    };
    (agent as unknown as { core: typeof core }).core = core;

    const result = await agent.graftByRelevance("authentication discussion", {
      topK: 3,
      expansionStrategy: "none",
    });

    expect(result).toBe(graft);
    expect(core.graftByRelevance).toHaveBeenCalledWith(
      agent.getSessionId(),
      "authentication discussion",
      {
        topK: 3,
        expansionStrategy: "none",
      },
    );
  });
});
