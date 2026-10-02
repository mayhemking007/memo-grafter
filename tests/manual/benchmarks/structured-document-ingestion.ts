/** Real PostgreSQL, deterministic providers: no external provider credentials required. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { MemoGrafter } from "../../../src/core/MemoGrafter.js";
import { PostgresGraphStore } from "../../../src/store/index.js";
import { IngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";
import type { DocumentInput } from "../../../src/ingestion/structuredDocument.js";
import type { EmbedAdapter, LLMAdapter } from "../../../src/core/types.js";

const url = process.env.MEMOGRAFTER_DOCUMENT_TEST_DB;
if (!url) throw new Error("Set MEMOGRAFTER_DOCUMENT_TEST_DB to a disposable PostgreSQL/pgvector database.");
const schema = `mg_benchmark_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(url, { onnotice: () => undefined });
let operations = 0;
const sql = postgres(url, { onnotice: () => undefined, max: 10, connection: { search_path: `${schema},public` }, debug: () => { operations++; } });
const document: DocumentInput = { id: "benchmark", title: "Engineering decisions", sections: Array.from({ length: 8 }, (_, index) => ({
  id: `section-${index}`, title: `Section ${index}`, content: Array.from({ length: 4 }, (_, item) => `Section ${index} decision ${item}: retain the complete audit history and verify releases.`).join(" "),
})) };
const text = document.sections!.map(section => section.content).join("\n\n");
const vector = [1, ...new Array<number>(1535).fill(0)];
const delay = () => new Promise(resolve => setTimeout(resolve, 5));
const modes = ["legacy", "configured-text", "structured-row-writes", "structured-batched"] as const;
const results: Array<{ mode: string; extractionCalls: number; embeddingCalls: number; embeddedInputs: number; databaseOperations: number; durationMs: number; memories: number; sourceSpans: number }> = [];
try {
  await admin`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
  await admin`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`;
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const setup = new PostgresGraphStore(url); Object.assign(setup, { sql }); await setup.migrate();
  for (const mode of modes) for (let sample = 0; sample < 3; sample++) {
    let extractionCalls = 0, embeddingCalls = 0, embeddedInputs = 0;
    const llm: LLMAdapter = { complete: async () => { extractionCalls++; await delay(); return JSON.stringify({
      label: "Decisions", user_intent: "Record decisions", outcome: "Retain audit history", open: null,
      memories: Array.from({ length: 6 }, (_, index) => ({ memory_type: "fact", subject: "Project", predicate: `decision ${index}`, value: `Retain requirement ${index}`,
        quality: { explicitness: 1, sourceReliability: 1, stability: 1, salience: 1 }, provenance: { speaker: "document", message_indexes: [1], extraction_method: "document-extraction" } })),
    }); } };
    const embedder: EmbedAdapter = { dimensions: 1536, embed: async () => { embeddingCalls++; embeddedInputs++; await delay(); return [...vector]; },
      embedMany: async texts => { embeddingCalls++; embeddedInputs += texts.length; await delay(); return texts.map(() => [...vector]); } };
    const store = new PostgresGraphStore(url, { batchSize: mode === "structured-row-writes" ? 1 : 100 }); Object.assign(store, { sql });
    const pipeline = new IngestPipeline(store, llm, embedder, { windowSize: 2, topK: 2, minSegmentMessages: 1, mode: "intent", clustering: { enabled: false } });
    const memo = new MemoGrafter({ db: { connectionString: url }, llm, embedder }); Object.assign(memo, { store, ingestPipeline: pipeline, storageInitialized: true });
    const sessionId = randomUUID();
    const options = { chunking: { strategy: "paragraph" as const, targetCharacters: 400 }, segmentation: { strategy: "per-chunk" as const }, memoryBudget: { deduplicate: true, maxPerDocument: 6 }, concurrency: { extraction: 2, embedding: 4 } };
    operations = 0; const start = performance.now();
    if (mode === "legacy") await memo.ingestText(text, sessionId);
    else if (mode === "configured-text") await memo.ingestText(text, sessionId, options);
    else await memo.ingestDocumentDetailed(document, sessionId, options);
    const durationMs = Math.round(performance.now() - start), databaseOperations = operations;
    const memories = await store.getMemoriesBySession(sessionId);
    assert.equal(memories.length, 6);
    results.push({ mode, extractionCalls, embeddingCalls, embeddedInputs, databaseOperations, durationMs, memories: memories.length, sourceSpans: memories.reduce((sum, memory) => sum + (memory.sourceSpans?.length ?? 0), 0) });
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const report = modes.map(mode => {
    const runs = results.filter(result => result.mode === mode);
    return { ...runs[0]!, durationMs: median(runs.map(run => run.durationMs)), databaseOperations: median(runs.map(run => run.databaseOperations)) };
  });
  const row = report[2]!, batch = report[3]!;
  assert.equal(row.sourceSpans, batch.sourceSpans);
  assert.equal(row.extractionCalls, batch.extractionCalls);
  assert.ok(batch.databaseOperations < row.databaseOperations);
  console.table(report);
  console.log(JSON.stringify({ node: process.version, samples: 3, simulatedProviderLatencyMs: 5, report }, null, 2));
} finally {
  await sql.end();
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
