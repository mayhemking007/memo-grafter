/** Deterministic provider simulation; no credentials, network, or database required. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { SegmentProcessor } from "../../../src/ingestion/conversation/SegmentProcessor.js";
import { IngestionProviderWork } from "../../../src/ingestion/providerWork.js";
import type { EmbedAdapter, LLMAdapter, Message } from "../../../src/core/types.js";
import type { GraphStore } from "../../../src/store/index.js";
import type { MemorySelectionStats } from "../../../src/diagnostics.js";

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const messages: Message[] = Array.from({ length: 8 }, (_, index) => ({ role: "user", content: `Section ${index}` }));
const segments = messages.map((_, index) => ({ start: index, end: index, topicOrder: index + 1, driftScore: 0 }));

async function benchmark(optimized: boolean) {
  let extractionCalls = 0, embeddingCalls = 0, embeddedInputs = 0;
  const llm: LLMAdapter = { complete: async () => {
    extractionCalls++; await delay();
    return JSON.stringify({ label: "Document", user_intent: "Record decisions", outcome: "Decisions recorded", open: null,
      memories: Array.from({ length: 6 }, (_, index) => ({ memory_type: "fact", subject: "Project", predicate: "decision", value: `Decision ${index}`,
        quality: { explicitness: 0.9, sourceReliability: 0.9, stability: 0.9, salience: (index + 1) / 6 },
        provenance: { speaker: "document", message_indexes: [1], extraction_method: "document-extraction" } })) });
  } };
  const embedder: EmbedAdapter = {
    dimensions: 2,
    embed: async () => { embeddingCalls++; embeddedInputs++; await delay(); return [1, 0]; },
    ...(optimized ? { embedMany: async (texts: string[]) => { embeddingCalls++; embeddedInputs += texts.length; await delay(); return texts.map(() => [1, 0]); } } : {}),
  };
  const scheduler = new IngestionProviderWork({ extraction: 2, embedding: 4 });
  const processor = new SegmentProcessor({} as GraphStore, scheduler.wrapLLM(llm), scheduler.wrapEmbedder(embedder), { topK: 1, semanticThreshold: 0.6 });
  const started = performance.now();
  const stats: MemorySelectionStats = { sessionId: "benchmark", extracted: 0, rejected: 0, deduplicated: 0, budgetExcluded: 0, selected: 0, acknowledged: 0, persisted: 0 };
  if (optimized) await scheduler.run({}, () => processor.prepareDocument(segments, messages, "benchmark", { sourceType: "document", memoryBudget: { deduplicate: true, maxPerSegment: 4, maxPerDocument: 4 } }, 0, stats));
  else for (const segment of segments) await processor.prepare(segment, messages, "benchmark", { sourceType: "document" });
  return { mode: optimized ? "selected + bounded + batch" : "sequential baseline", extractionCalls, embeddingCalls, embeddedInputs, durationMs: Math.round(performance.now() - started) };
}

const baseline = await benchmark(false), optimized = await benchmark(true);
assert.equal(baseline.embeddedInputs, 56);
assert.equal(optimized.embeddedInputs, 12);
assert.ok(optimized.embeddingCalls < baseline.embeddingCalls);
console.table([baseline, optimized]);
