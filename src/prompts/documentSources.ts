import type { MemoryNode } from "../core/types.js";

export function formatDocumentSources(memory: MemoryNode): string {
  const references = [...new Set((memory.sourceSpans ?? []).map(span => JSON.stringify({
    title: span.section.title ?? span.document.title,
    url: span.section.url ?? span.document.url,
    sectionId: span.section.id,
  })))].filter(value => value !== "{}");
  return references.length ? ` [sources: ${references.join("; ")}]` : "";
}
