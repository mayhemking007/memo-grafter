import { describe, expect, it, vi } from "vitest";
import { embedTexts, IngestionProviderWork, validateProviderOptions } from "../../../src/ingestion/providerWork.js";

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

describe("ingestion provider scheduling", () => {
  it("shares instance limits across simultaneous imports and nested stages", async () => {
    const scheduler = new IngestionProviderWork({ embedding: 3, extraction: 2 });
    let active = 0, peak = 0, extractionActive = 0, extractionPeak = 0;
    const perDocument = new Map<string, number>(), peaks = new Map<string, number>();
    const embedder = scheduler.wrapEmbedder({ embed: async (text) => {
      active++; peak = Math.max(peak, active);
      const document = text[0]!;
      perDocument.set(document, (perDocument.get(document) ?? 0) + 1);
      peaks.set(document, Math.max(peaks.get(document) ?? 0, perDocument.get(document)!));
      await pause();
      perDocument.set(document, perDocument.get(document)! - 1); active--;
      return [1, 0];
    } });
    const llm = scheduler.wrapLLM({ complete: async () => {
      extractionActive++; extractionPeak = Math.max(extractionPeak, extractionActive);
      await pause(); extractionActive--; return "ok";
    } });
    await Promise.all(["a", "b"].map((document) => scheduler.run({ concurrency: { embedding: document === "a" ? 1 : 9, extraction: 9 } }, async () => {
      await Promise.all(Array.from({ length: 5 }, async () => {
        await llm.complete([]);
        await embedTexts(embedder, [document + "1", document + "2"]);
      }));
    })));
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(peaks.get("a")).toBe(1);
    expect(extractionPeak).toBe(2);
  });

  it("bounds batches, validates results, and never retries failed batches as singles", async () => {
    const single = vi.fn(async () => [1, 0]);
    const batch = vi.fn(async (texts: string[]) => texts.map((text) => [Number(text), 0]));
    const scheduler = new IngestionProviderWork({ embedding: 1 });
    const adapter = scheduler.wrapEmbedder({ dimensions: 2, embed: single, embedMany: batch });
    const output = await embedTexts(adapter, Array.from({ length: 70 }, (_, index) => String(index)));
    expect(batch.mock.calls.map(([texts]) => texts.length)).toEqual([32, 32, 6]);
    expect(output.map((vector) => vector[0])).toEqual(Array.from({ length: 70 }, (_, index) => index));
    expect(single).not.toHaveBeenCalled();
    batch.mockRejectedValueOnce(new Error("provider failed"));
    await expect(embedTexts(adapter, ["1"])).rejects.toThrow("provider failed");
    batch.mockResolvedValueOnce([]);
    await expect(embedTexts(adapter, ["1"])).rejects.toThrow(/count/);
    batch.mockResolvedValueOnce([[NaN, 0]]);
    await expect(embedTexts(adapter, ["1"])).rejects.toThrow(/non-finite/);
    batch.mockResolvedValueOnce([[1]]);
    await expect(embedTexts(adapter, ["1"])).rejects.toThrow(/dimensions/);
    expect(single).not.toHaveBeenCalled();
    await expect(embedTexts(adapter, ["1"])).resolves.toEqual([[1, 0]]);
  });

  it("rejects invalid budgets/concurrency and permits topic-only ingestion", () => {
    expect(() => validateProviderOptions({ memoryBudget: { maxPerDocument: 0 } })).not.toThrow();
    for (const value of [-1, 1.5, NaN, Infinity]) expect(() => validateProviderOptions({ memoryBudget: { maxPerSegment: value } })).toThrow();
    expect(() => validateProviderOptions({ concurrency: { extraction: 0 } })).toThrow();
  });
  it("rejects inconsistent dimensions even if the adapter declares none", async () => {
    await expect(embedTexts({ embed: async text => text === "a" ? [1] : [1, 0] }, ["a", "b"])).rejects.toThrow(/dimensions/);
  });
});
