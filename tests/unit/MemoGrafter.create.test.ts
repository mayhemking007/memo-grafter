import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoGrafter } from "../../src/core/MemoGrafter.js";
import type { MemoGrafterProjectConfig } from "../../src/config.js";
import type { MemoGrafterConfig } from "../../src/core/types.js";

function createConfig(): MemoGrafterProjectConfig {
  return {
    db: { connectionString: "postgres://example" },
    llm: { complete: vi.fn(async () => "ok") },
    embedder: { embed: vi.fn(async () => [0.1]) },
    graph: { topK: 5, hopDepth: 2 },
  };
}

describe("MemoGrafter.create", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["object", () => createConfig()],
    ["sync factory", () => () => createConfig()],
    ["async factory", () => async () => createConfig()],
  ])("returns an initialized MemoGrafter from an %s config", async (_name, sourceFactory) => {
    const initialize = vi.spyOn(MemoGrafter.prototype, "initialize").mockResolvedValue();

    const memo = await MemoGrafter.create(sourceFactory());

    expect(memo).toBeInstanceOf(MemoGrafter);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it("applies runtime overrides through the shared resolver", async () => {
    vi.spyOn(MemoGrafter.prototype, "initialize").mockResolvedValue();
    const replacementLlm = { complete: vi.fn(async () => "replacement") };

    const memo = await MemoGrafter.create(createConfig(), {
      llm: replacementLlm,
      graph: { topK: 10 },
    });
    const internals = memo as unknown as {
      graphTopK: number;
      graphHopDepth: number;
    };

    expect(memo.llm).toBe(replacementLlm);
    expect(internals.graphTopK).toBe(10);
    expect(internals.graphHopDepth).toBe(2);
  });

  it("closes partially initialized resources and preserves the original error", async () => {
    const failure = new Error("database unavailable");
    vi.spyOn(MemoGrafter.prototype, "initialize").mockRejectedValue(failure);
    const close = vi.spyOn(MemoGrafter.prototype, "close").mockResolvedValue();

    await expect(MemoGrafter.create(createConfig())).rejects.toBe(failure);

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not close a successfully created instance", async () => {
    vi.spyOn(MemoGrafter.prototype, "initialize").mockResolvedValue();
    const close = vi.spyOn(MemoGrafter.prototype, "close").mockResolvedValue();

    await MemoGrafter.create(createConfig());

    expect(close).not.toHaveBeenCalled();
  });

  it("keeps constructor initialization explicit", () => {
    const initialize = vi.spyOn(MemoGrafter.prototype, "initialize").mockResolvedValue();
    const config: MemoGrafterConfig = {
      db: { connectionString: "postgres://example" },
      llm: { complete: vi.fn(async () => "ok") },
      embedder: { embed: vi.fn(async () => [0.1]) },
    };

    const memo = new MemoGrafter(config);

    expect(memo).toBeInstanceOf(MemoGrafter);
    expect(initialize).not.toHaveBeenCalled();
  });
});
