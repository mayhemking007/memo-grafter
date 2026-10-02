import { describe, expect, it, vi } from "vitest";
import { mergeSourceSpans, prepareStructuredDocument, type DocumentInput } from "../../../src/ingestion/structuredDocument.js";
import { structuredFixture } from "../../fixtures/structuredDocuments.js";
import { saveGraphEdges } from "../../../src/ingestion/storeBatch.js";
import type { GraphStore } from "../../../src/store/GraphStore.js";
import type { TopicEdge } from "../../../src/core/types.js";

describe("structured document preparation", () => {
  it("deduplicates source spans after JSONB reorders descriptor keys", () => {
    const span = { document: { id: "doc", title: "Guide" }, section: { id: "s" }, sectionIndex: 0, start: 0, end: 3 };
    const reordered = { end: 3, start: 0, sectionIndex: 0, section: { id: "s" }, document: { title: "Guide", id: "doc" } };
    expect(mergeSourceSpans([span, reordered])).toEqual([span]);
  });
  it("keeps explicit section boundaries and preserves lists, fences, and Unicode", () => {
    const result = prepareStructuredDocument(structuredFixture, { chunking: { maxCharacters: 300 } });
    for (const chunk of result.chunks) {
      expect(chunk.content).toBe(result.text.slice(chunk.start, chunk.end));
      expect(chunk.content.length).toBeLessThanOrEqual(300);
      expect(chunk.sourceSpans).toHaveLength(1);
      const span = chunk.sourceSpans![0]!;
      expect(structuredFixture.sections![span.sectionIndex]!.content.slice(span.start, span.end)).toBe(chunk.content);
    }
    for (const section of structuredFixture.sections!) {
      expect(result.chunks.filter(chunk => chunk.sourceSpans![0]!.section.id === section.id).map(chunk => chunk.content).join("")).toBe(section.content);
    }
    expect(result.chunks.find(chunk => chunk.sourceSpans![0]!.section.id === "code")?.content).toContain("```ts\n");
  });

  it("retains every source when a hard chunk cap merges explicit sections", () => {
    const result = prepareStructuredDocument({ id: "doc", sections: [{ id: "a", title: "One", content: "abc" }, { id: "b", title: "Two", content: "def" }] }, { chunking: { maxChunks: 1, maxCharacters: 8 } });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.content).toBe("abc\n\ndef");
    expect(result.chunks[0]?.sourceSpans?.map(span => [span.section.id, span.start, span.end])).toEqual([["a", 0, 3], ["b", 0, 3]]);
  });

  it("tracks section-relative offsets for overlapping Unicode windows", () => {
    const result = prepareStructuredDocument({ sections: [{ id: "u", content: "😀abcdef😀ghijkl" }] }, { chunking: { strategy: "fixed", targetCharacters: 5, overlapCharacters: 2 } });
    for (const chunk of result.chunks) {
      expect(chunk.sourceSpans![0]!.start).toBe(chunk.start);
      expect(chunk.sourceSpans![0]!.end).toBe(chunk.end);
      expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
    expect(result.chunks[1]!.start).toBeLessThan(result.chunks[0]!.end);
  });

  it.each([
    { content: "text", sections: [{ content: "section" }] }, {}, { sections: [] },
    { sections: [{ content: "" }] }, { sections: [{ id: "same", content: "a" }, { id: "same", content: "b" }] },
    { content: "text", url: "javascript:alert(1)" }, { content: "text", metadata: { bad: NaN } },
    { content: "text", metadata: { date: new Date() } }, { content: "text", metadata: { fn: () => 1 } },
  ])("rejects ambiguous or invalid source input: %j", input => {
    expect(() => prepareStructuredDocument(input as DocumentInput)).toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });

  it("rejects cyclic metadata and impossible global limits", () => {
    const metadata: Record<string, unknown> = {}; metadata.self = metadata;
    expect(() => prepareStructuredDocument({ content: "text", metadata } as DocumentInput)).toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
    expect(() => prepareStructuredDocument(structuredFixture, { chunking: { maxCharacters: 10, maxChunks: 1 } })).toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
    expect(() => prepareStructuredDocument({ sections: [{ content: "a" }, { content: "b" }] }, { segmentation: { strategy: "per-chunk", maxTopics: 1 } })).toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });

  it("fingerprints metadata and section boundaries, with canonical metadata key order", () => {
    const a = prepareStructuredDocument({ content: "abc", metadata: { a: 1, b: 2 } });
    expect(prepareStructuredDocument({ metadata: { b: 2, a: 1 }, content: "abc" }).requestFingerprint).toBe(a.requestFingerprint);
    expect(prepareStructuredDocument({ content: "abc", metadata: { a: 2, b: 2 } }).requestFingerprint).not.toBe(a.requestFingerprint);
    expect(prepareStructuredDocument({ sections: [{ content: "abc" }] }).requestFingerprint).not.toBe(prepareStructuredDocument({ content: "abc" }).requestFingerprint);
  });
});

describe("optional graph batch fallback", () => {
  const edges: TopicEdge[] = Array.from({ length: 205 }, (_, index) => ({ srcId: `s${index}`, dstId: "target", type: "semantic", weight: 1 }));
  it("bounds batch sizes and preserves edge order", async () => {
    const saveEdges = vi.fn(async () => undefined), saveEdge = vi.fn();
    await saveGraphEdges({ saveEdges, saveEdge } as unknown as GraphStore, edges);
    expect(saveEdges.mock.calls.map(call => (call as unknown as [TopicEdge[]])[0].length)).toEqual([100, 100, 5]);
    expect(saveEdge).not.toHaveBeenCalled();
  });
  it("falls back in order and propagates failure without retrying writes", async () => {
    const saveEdge = vi.fn(async (edge: TopicEdge) => { if (edge.srcId === "s2") throw new Error("failed"); });
    await expect(saveGraphEdges({ saveEdge } as unknown as GraphStore, edges)).rejects.toThrow("failed");
    expect(saveEdge.mock.calls.map(([edge]) => edge.srcId)).toEqual(["s0", "s1", "s2"]);
  });
});
