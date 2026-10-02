import { validateProviderOptions } from "../../ingestion/providerWork.js";
import type { IngestTextOptions } from "../../core/types.js";
import { MemoGrafterError } from "../../diagnostics.js";
import { splitTextForIngestion } from "./splitTextForIngestion.js";

/** Half-open UTF-16 offsets into the original input. */
export interface TextChunk { content: string; start: number; end: number; headings?: string[]; sourceSpans?: import("../../ingestion/structuredDocument.js").DocumentSourceSpan[]; }

function invalid(message: string): never {
  throw new MemoGrafterError(message, { code: "INPUT_INVALID", operation: "ingest", retryable: false });
}

export function prepareTextChunks(text: string, options: IngestTextOptions = {}): TextChunk[] {
  validateProviderOptions(options);
  const c = options.chunking ?? {}, s = options.segmentation ?? {};
  const strategy = c.strategy ?? "sentence";
  if (!["sentence", "paragraph", "section", "fixed", "single"].includes(strategy)) invalid("Unknown chunking strategy.");
  if (!["drift", "per-chunk", "single"].includes(s.strategy ?? "drift")) invalid("Unknown segmentation strategy.");
  for (const [name, value] of Object.entries({ targetCharacters: c.targetCharacters, maxCharacters: c.maxCharacters, maxChunks: c.maxChunks, minChunks: s.minChunks, maxTopics: s.maxTopics, minSegmentMessages: options.minSegmentMessages })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) invalid(`${name} must be a positive safe integer.`);
  }
  if (s.minChunks !== undefined && options.minSegmentMessages !== undefined && s.minChunks !== options.minSegmentMessages) invalid("Conflicting segment minimums.");
  if (s.strategy && s.strategy !== "drift" && (s.minChunks !== undefined || options.minSegmentMessages !== undefined)) invalid("Segment minimums apply only to drift segmentation.");
  const max = c.maxCharacters ?? Infinity;
  const target = c.targetCharacters ?? Math.min(1800, max);
  if (target > max) invalid("targetCharacters cannot exceed maxCharacters.");
  const overlap = c.overlapCharacters ?? 0;
  if (!Number.isSafeInteger(overlap) || overlap < 0 || (c.overlapCharacters !== undefined && strategy !== "fixed") || overlap >= target) invalid("Overlap requires fixed windows and must be smaller than the window.");
  if (c.preserveHeadings !== undefined && typeof c.preserveHeadings !== "boolean") invalid("preserveHeadings must be boolean.");
  if (!text.trim()) return [];
  let chunks: TextChunk[] = [];
  const safeEnd = (start: number, requested: number): number => {
    let end = Math.min(text.length, requested);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
    if (end <= start) invalid("Character limit cannot fit a Unicode code point.");
    return end;
  };
  const add = (start: number, end: number) => { if (end > start) chunks.push({ content: text.slice(start, end), start, end }); };
  if (!options.chunking || (strategy === "sentence" && c.maxCharacters === undefined && c.targetCharacters === undefined)) {
    // Keep normalized legacy output exactly, while recovering original source ranges.
    let cursor = 0;
    for (const content of splitTextForIngestion(text)) {
      const pattern = content.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
      const match = new RegExp(pattern).exec(text.slice(cursor));
      const start = cursor + (match?.index ?? 0), end = start + (match?.[0].length ?? content.length);
      chunks.push({ content, start, end }); cursor = end;
    }
  } else if (strategy === "single") {
    if (text.length > max) invalid("Single chunk exceeds maxCharacters.");
    add(0, text.length);
  } else if (strategy === "fixed") {
    for (let start = 0; start < text.length;) {
      const end = safeEnd(start, start + target);
      add(start, end);
      if (end === text.length) break;
      start = Math.max(start + 1, end - overlap);
      if (/[\uDC00-\uDFFF]/.test(text[start]!) && /[\uD800-\uDBFF]/.test(text[start - 1]!)) start++;
    }
  } else {
    const boundaries = [0];
    let fence: string | undefined;
    for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
      const line = match[0], at = match.index;
      if (!line) continue;
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = undefined;
        continue;
      }
      if (fence) continue;
      if (strategy === "section" && /^ {0,3}#{1,6}\s/.test(line) && at > 0) boundaries.push(at);
      if ((strategy === "paragraph" || strategy === "section") && !line.trim()) boundaries.push(at + line.length);
      if (strategy === "sentence") {
        for (const sentence of line.matchAll(/[.!?](\s+)|\r?\n/g)) boundaries.push(at + sentence.index + sentence[0].length);
      }
    }
    boundaries.push(text.length);
    const unique = [...new Set(boundaries)].sort((a, b) => a - b);
    for (let i = 1; i < unique.length; i++) {
      let start = unique[i - 1]!;
      const end = unique[i]!;
      while (end - start > max) { const next = safeEnd(start, start + max); add(start, next); start = next; }
      add(start, end);
    }
    if (strategy === "paragraph" || strategy === "section" || (strategy === "sentence" && c.targetCharacters !== undefined)) {
      const packed: TextChunk[] = [];
      for (const chunk of chunks) {
        const previous = packed.at(-1);
        const headingBoundary = strategy === "section" && /^ {0,3}#{1,6}\s/.test(chunk.content);
        if (previous && !headingBoundary && chunk.end - previous.start <= target) { previous.end = chunk.end; previous.content = text.slice(previous.start, chunk.end); }
        else packed.push(chunk);
      }
      chunks = packed;
    }
  }
  if (chunks.length > (c.maxChunks ?? Infinity)) {
    const merged: TextChunk[] = [];
    for (const chunk of chunks) {
      const previous = merged.at(-1);
      if (previous && chunk.end - previous.start <= max) {
        previous.end = chunk.end;
        previous.content = text.slice(previous.start, chunk.end);
      } else merged.push({ ...chunk });
    }
    chunks = merged;
    if (chunks.length > c.maxChunks!) {
      // Hard limits outrank soft structure boundaries. Repartition before rejecting
      // a document that can fit, rather than letting an unlucky merge lose content.
      chunks = [];
      for (let start = 0; start < text.length;) {
        const end = safeEnd(start, start + max);
        add(start, end); start = end;
      }
      if (chunks.length > c.maxChunks!) invalid("Cannot satisfy maxChunks and maxCharacters without dropping content.");
    }
  }
  if (s.strategy === "per-chunk" && chunks.length > (s.maxTopics ?? Infinity)) invalid("per-chunk segmentation exceeds maxTopics.");
  // Heading context is metadata, never synthetic text that changes source offsets or limits.
  if (c.preserveHeadings !== false && options.chunking) {
    const headings: Array<{ at: number; titles: string[] }> = [];
    const titles: string[] = [];
    let fence: string | undefined;
    for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line[0])?.[1];
      if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line[0])) fence = undefined; continue; }
      if (fence) continue;
      const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*$/.exec(line[0]);
      if (heading) { titles.length = heading[1]!.length - 1; titles.push(heading[2]!); headings.push({ at: line.index, titles: titles.filter(Boolean) }); }
    }
    for (const chunk of chunks) chunk.headings = headings.filter((heading) => heading.at <= chunk.start).at(-1)?.titles ?? [];
  }
  return chunks;
}
