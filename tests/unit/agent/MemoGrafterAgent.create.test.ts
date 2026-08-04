import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoGrafterAgent } from "../../../src/agents/MemoGrafterAgent.js";
import { MemoGrafter } from "../../../src/core/MemoGrafter.js";

const config = {
  db: { connectionString: "postgres://example" },
  llm: { complete: vi.fn(async () => "ok") },
  embedder: { embed: vi.fn(async () => [0.1]) },
};

describe("MemoGrafterAgent.create", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns an agent after initializing the existing core", async () => {
    const initialize = vi.spyOn(MemoGrafter.prototype, "initialize").mockResolvedValue();

    const agent = await MemoGrafterAgent.create(config);

    expect(agent).toBeInstanceOf(MemoGrafterAgent);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("closes partially initialized resources when initialization fails", async () => {
    const failure = new Error("database unavailable");
    vi.spyOn(MemoGrafter.prototype, "initialize").mockRejectedValue(failure);
    const close = vi.spyOn(MemoGrafter.prototype, "close").mockResolvedValue();

    await expect(MemoGrafterAgent.create(config)).rejects.toBe(failure);

    expect(close).toHaveBeenCalledOnce();
  });
});
