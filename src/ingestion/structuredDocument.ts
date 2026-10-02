import { createHash } from "node:crypto";
import { MemoGrafterError } from "../diagnostics.js";
import { prepareTextChunks, type TextChunk } from "../utils/text/prepareTextChunks.js";
import { validateDocument } from "./validateDocument.js";
import type { IngestTextDetailedOptions, TextIngestionReceipt } from "./types.js";

export type DocumentJSON = null | boolean | number | string | DocumentJSON[] | { [key: string]: DocumentJSON };
export interface DocumentSource { id?: string; title?: string; url?: string; metadata?: { [key: string]: DocumentJSON }; }
export interface DocumentSection extends DocumentSource { content: string; }
export type DocumentInput = DocumentSource & ({ content: string; sections?: never } | { sections: DocumentSection[]; content?: never });
export type IngestDocumentOptions = IngestTextDetailedOptions;
export type DocumentIngestionReceipt = TextIngestionReceipt;
/** Bounds identify a supporting chunk span, not an exact quotation of a fact. */
export interface DocumentSourceSpan {
  document: DocumentSource;
  section: DocumentSource;
  sectionIndex: number;
  start: number;
  end: number;
}
export function mergeSourceSpans(spans: DocumentSourceSpan[]): DocumentSourceSpan[] {
  return [...new Map(spans.map(span => [JSON.stringify(json(span)), span])).values()];
}
const invalid = (message: string): never => { throw new MemoGrafterError(message, { code: "INPUT_INVALID", operation: "ingest" }); };
function json(value: unknown, seen = new Set<object>()): DocumentJSON {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) return invalid("Document metadata must be finite, acyclic JSON.");
  seen.add(value);
  let result: DocumentJSON;
  if (Array.isArray(value)) result = value.map(item => json(item, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype) return invalid("Document metadata must contain plain JSON objects.");
    result = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, json(item, seen)]));
  }
  seen.delete(value); return result;
}
function source(value: DocumentSource): DocumentSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Document and sections must be objects.");
  for (const key of ["id", "title", "url"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key]!.trim())) invalid(`${key} must be a nonblank string.`);
  if (value.url !== undefined) {
    try { const url = new URL(value.url); if (!["http:", "https:", "file:"].includes(url.protocol)) invalid("Source URLs must use http, https, or file."); }
    catch { invalid("Source URL is invalid."); }
  }
  if (value.metadata !== undefined && (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))) invalid("metadata must be a JSON object.");
  return { ...(value.id !== undefined ? { id: value.id } : {}), ...(value.title !== undefined ? { title: value.title } : {}), ...(value.url !== undefined ? { url: value.url } : {}), ...(value.metadata !== undefined ? { metadata: json(value.metadata) as NonNullable<DocumentSource["metadata"]> } : {}) };
}

export function prepareStructuredDocument(input: DocumentInput, options: IngestDocumentOptions = {}, timeoutMs = 300_000) {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalid("Document options must be an object.");
  if (options.chunking !== undefined && (!options.chunking || typeof options.chunking !== "object" || Array.isArray(options.chunking))) invalid("chunking must be an object.");
  const document = source(input);
  const hasContent = Object.hasOwn(input, "content"), hasSections = Object.hasOwn(input, "sections");
  if (hasContent === hasSections) invalid("Provide either content or sections, never both.");
  if (hasSections && (!Array.isArray(input.sections) || !input.sections.length)) invalid("sections must be a nonempty array.");
  const sections = (hasSections ? input.sections! : [{ content: input.content! }]).map(section => {
    const metadata = source(section);
    if (typeof section.content !== "string" || !section.content.trim()) invalid("Every section requires nonblank content.");
    return { ...metadata, content: section.content };
  });
  const ids = sections.flatMap(section => section.id === undefined ? [] : [section.id]);
  if (new Set(ids).size !== ids.length) invalid("Section IDs must be unique within a document.");
  const normalized: DocumentInput = hasSections ? { ...document, sections } : { ...document, content: sections[0]!.content };
  const text = sections.map(section => section.content).join("\n\n");
  const effective = { ...options, chunking: { strategy: "paragraph" as const, ...options.chunking } };
  // Validate the complete request, including hard global limits, before creating any run.
  const validated = validateDocument(text, effective, timeoutMs);
  let offset = 0;
  const ranges = sections.map((section, sectionIndex) => {
    const start = offset; offset += section.content.length + 2;
    return { start, end: start + section.content.length, sectionIndex, section };
  });
  let chunks: TextChunk[];
  const { maxChunks: _cap, ...sectionChunking } = effective.chunking;
  const { segmentation: _segmentation, ...sectionOptions } = effective;
  if (effective.chunking.strategy === "single") chunks = validated.chunks;
  else chunks = ranges.flatMap(range => prepareTextChunks(range.section.content, {
    ...sectionOptions, chunking: sectionChunking,
  }).map(chunk => ({ ...chunk, start: chunk.start + range.start, end: chunk.end + range.start })));
  const cap = options.chunking?.maxChunks ?? Infinity;
  if (chunks.length > cap) {
    const packed: TextChunk[] = [];
    for (const chunk of chunks) {
      const previous = packed.at(-1);
      if (previous && chunk.end - previous.start <= (options.chunking?.maxCharacters ?? Infinity)) { previous.end = chunk.end; previous.content = text.slice(previous.start, previous.end); }
      else packed.push({ ...chunk });
    }
    chunks = packed.length <= cap ? packed : validated.chunks;
  }
  if (options.segmentation?.strategy === "per-chunk" && chunks.length > (options.segmentation.maxTopics ?? Infinity)) invalid("Explicit sections exceed maxTopics; adjust chunk limits or segmentation.");
  chunks = chunks.map(chunk => ({ ...chunk, sourceSpans: ranges.filter(range => range.start < chunk.end && range.end > chunk.start).map(range => ({
    document, section: source(range.section), sectionIndex: range.sectionIndex,
    start: Math.max(0, chunk.start - range.start), end: Math.min(range.section.content.length, chunk.end - range.start),
  })) }));
  const requestFingerprint = createHash("sha256").update(validated.requestFingerprint).update(JSON.stringify(normalized)).digest("hex");
  return { text, chunks, requestFingerprint, structured: normalized };
}
