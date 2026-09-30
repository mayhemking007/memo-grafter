import { describe, expect, it } from "vitest";
import { prepareTextChunks } from "./prepareTextChunks.js";
import { splitTextForIngestion } from "./splitTextForIngestion.js";
import { countIngestJobMessages } from "../../ingestion/IngestQueue.js";

describe("document chunks", () => {
  it("preserves legacy normalized sentences and explicit sentence defaults", () => {
    const text = " Hello.  World!\r\nNext\tline " + "word ".repeat(300);
    for (const options of [{}, { chunking: { strategy: "sentence" as const } }]) {
      const chunks = prepareTextChunks(text, options);
      expect(chunks.map((chunk) => chunk.content)).toEqual(splitTextForIngestion(text));
      for (const chunk of chunks) expect(text.slice(chunk.start, chunk.end).replace(/\s+/g, " ").trim()).toBe(chunk.content);
    }
  });
  it("preserves Markdown blocks and original CRLF offsets", () => {
    const text = "# Title\r\n\r\n- one\r\n- two\r\n\r\n```md\r\n# Not a heading\r\n\r\ncode\r\n```\r\n## Next\r\nbody";
    const chunks = prepareTextChunks(text, { chunking: { strategy: "section" } });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(text);
    expect(chunks[1]?.headings).toEqual(["Title", "Next"]);
    for (const chunk of chunks) expect(text.slice(chunk.start, chunk.end)).toBe(chunk.content);
  });
  it("packs paragraphs without splitting fitting blocks", () => {
    expect(prepareTextChunks("one\n\ntwo\n\nthree", { chunking: { strategy: "paragraph", targetCharacters: 10 } }).map((chunk) => chunk.content)).toEqual(["one\n\ntwo\n\n", "three"]);
  });
  it("creates overlapping fixed windows and shares queue counts", () => {
    const options = { chunking: { strategy: "fixed" as const, targetCharacters: 5, overlapCharacters: 2 } };
    expect(prepareTextChunks("abcdefghij", options).map((chunk) => [chunk.start, chunk.end])).toEqual([[0, 5], [3, 8], [6, 10]]);
    expect(countIngestJobMessages({ kind: "text", text: "abcdefghij", sessionId: "s", options })).toBe(3);
  });
  it("merges without losing content and rejects impossible limits", () => {
    const text = "a\n\nb\n\nc";
    expect(prepareTextChunks(text, { chunking: { strategy: "paragraph", targetCharacters: 3, maxCharacters: 9, maxChunks: 1 } })[0]?.content).toBe(text);
    expect(() => prepareTextChunks(text, { chunking: { strategy: "fixed", maxCharacters: 2, maxChunks: 1 } })).toThrow(/Cannot satisfy/);
    expect(() => prepareTextChunks(text, { chunking: { strategy: "single", maxCharacters: 2 } })).toThrow(/Single chunk/);
  });
  it("validates segmentation and numeric controls even for empty input", () => {
    expect(() => prepareTextChunks("", { chunking: { maxChunks: 0 } })).toThrow();
    expect(() => prepareTextChunks("a", { segmentation: { minChunks: 2 }, minSegmentMessages: 3 })).toThrow(/Conflicting/);
    expect(() => prepareTextChunks("a", { segmentation: { strategy: "single", minChunks: 2 } })).toThrow(/only/);
    expect(() => prepareTextChunks("a. b.", { segmentation: { strategy: "per-chunk", maxTopics: 1 } })).toThrow(/maxTopics/);
    expect(() => prepareTextChunks("a", { chunking: { strategy: "fixed", targetCharacters: 2, overlapCharacters: 2 } })).toThrow(/Overlap/);
  });
  it("keeps Unicode code points intact at hard boundaries", () => {
    const text = "a😀b😀c";
    const chunks = prepareTextChunks(text, { chunking: { strategy: "fixed", targetCharacters: 2, overlapCharacters: 1 } });
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2);
      expect(chunk.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
    expect(chunks.at(-1)?.end).toBe(text.length);
  });
});
