import { describe, expect, it, vi } from "vitest";
import { documentReceipt, hydrateDocumentRun, processDocumentRun } from "../../../src/ingestion/documentRun.js";
import { MemoGrafterError } from "../../../src/diagnostics.js";
import type { GraphStore } from "../../../src/store/GraphStore.js";
import type { IngestionRun, IngestionTransition, PreparedIngestion, TextIngestionReceipt } from "../../../src/ingestion/types.js";
import { assertIngestionTransition } from "../../../src/ingestion/stateMachine.js";
import { MemoGrafter } from "../../../src/core/MemoGrafter.js";
import { IngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";
import type { AcceptIngestionRequest } from "../../../src/ingestion/types.js";
import type { EmbedAdapter, IngestTextOptions, LLMAdapter } from "../../../src/core/types.js";
import { validateDocument } from "../../../src/ingestion/validateDocument.js";

export function documentFixture() {
  let run: IngestionRun = {
    id: "run", sessionId: "session", kind: "text", startIndex: 0, endIndex: 0,
    status: "accepted", attemptCount: 0, createdAt: new Date(), updatedAt: new Date(),
    document: { version: 1, text: "Original document.", chunks: [{ content: "Original document.", start: 0, end: 18 }],
      options: { replace: true, sourceType: "document", segmentation: { strategy: "single" } },
      pipeline: { windowSize: 2, topK: 2, mode: "intent", minSegmentMessages: 1, clustering: { enabled: false } },
      deadlineAt: new Date(Date.now() + 60_000).toISOString(), requestFingerprint: "fingerprint", baseCursor: -1, baseEnd: -1 },
  };
  const read = () => hydrateDocumentRun(structuredClone(run));
  const store = {
    getIngestionRun: vi.fn(async () => read()),
    transitionIngestionRun: vi.fn(async (t: IngestionTransition) => {
      assertIngestionTransition(t.from, t.to);
      if (!t.from.includes(run.status) || t.expectedWorkerId !== undefined && t.expectedWorkerId !== run.workerId
        || t.expectedAttemptCount !== undefined && t.expectedAttemptCount !== run.attemptCount
        || t.leaseExpiredBefore && (!run.leaseExpiresAt || run.leaseExpiresAt > t.leaseExpiredBefore)) throw new Error("State comparison failed");
      run.status = t.to;
      run.leaseExpiresAt = t.leaseExpiresAt;
      if (t.workerId) run.workerId = t.workerId;
      if (t.to === "running") { run.attemptCount++; run.startedAt ??= new Date(); }
      if (t.to === "failed" || t.to === "cancelled") run.failedAt = new Date();
      if (t.error) { run.lastErrorCode = t.error.code; run.retryable = t.error.retryable; }
      return read();
    }),
    renewIngestionRunLease: vi.fn(async (_id: string, worker: string, until: Date) => {
      if (run.workerId !== worker || run.status !== "running") throw new Error("Lease lost");
      run.leaseExpiresAt = until;
    }),
    cancelIngestionRun: vi.fn(async () => {
      if (["accepted", "queued", "running", "retry_pending"].includes(run.status)) {
        run.status = "cancelled"; run.cancelRequestedAt = new Date(); run.failedAt = new Date();
      }
      return read();
    }),
    recordDocumentProgress: vi.fn(async (_id: string, _worker: string, _attempt: number, progress: Pick<TextIngestionReceipt, "phase" | "counts" | "warnings">) => {
      run.result = { ...documentReceipt(run), ...structuredClone(progress) };
    }),
    stageDocumentIngestion: vi.fn(async (_id: string, prepared: PreparedIngestion) => { run.prepared = structuredClone(prepared); return read(); }),
    commitPreparedIngestion: vi.fn(async (prepared: PreparedIngestion) => {
      run.status = "completed"; run.completedAt = new Date();
      run.result = { ...documentReceipt(run), status: "completed", phase: "committed", postProcessing: "pending", nodes: prepared.nodes, warnings: prepared.warnings ?? [],
        ...(prepared.documentCounts ? { counts: { ...prepared.documentCounts, persisted: prepared.memories.length, acknowledged: prepared.memories.length } } : {}) };
      return { run: read(), nodes: prepared.nodes };
    }),
    finishDocumentIngestion: vi.fn(async (_id: string, work: TextIngestionReceipt["warnings"] | ((run: IngestionRun) => Promise<TextIngestionReceipt["warnings"]>)) => {
      const warnings = typeof work === "function" ? await work(read()) : work;
      run.status = warnings.length ? "completed_with_warnings" : "completed";
      run.result = { ...documentReceipt(run), phase: "finished", postProcessing: "finished", warnings }; return read();
    }),
  };
  const prepared: PreparedIngestion = { runId: run.id, sessionId: run.sessionId, startIndex: 0, endIndex: 0, expectedCursor: -1, segments: [], nodes: [], memories: [], requiredEdges: [] };
  return { store, graph: store as unknown as GraphStore, prepared, read, edit: (work: (value: IngestionRun) => void) => { work(run); }, set: (value: IngestionRun) => { run = value; } };
}

describe("durable document worker", () => {
  it("retries a failed commit using the persisted preparation without provider work", async () => {
    const f = documentFixture();
    f.store.commitPreparedIngestion.mockRejectedValueOnce(new Error("temporary database outage"));
    const prepare = vi.fn(async () => f.prepared);
    await expect(processDocumentRun(f.graph, f.read(), "first", 1000, prepare)).rejects.toMatchObject({ code: "INGESTION_FAILED", retryable: true });
    expect(f.read()).toMatchObject({ status: "retry_pending", prepared: { workerId: "first" } });
    const retry = await processDocumentRun(f.graph, f.read(), "second", 1000, prepare);
    expect(retry.run).toMatchObject({ status: "completed", attemptCount: 2, prepared: { workerId: "second", attemptCount: 2 } });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(f.store.commitPreparedIngestion).toHaveBeenCalledTimes(2);
  });

  it("does not commit a document cancelled during preparation", async () => {
    const f = documentFixture();
    const result = await processDocumentRun(f.graph, f.read(), "worker", 1000, async () => {
      await f.store.cancelIngestionRun(); return f.prepared;
    });
    expect(result.run.status).toBe("cancelled");
    expect(f.store.stageDocumentIngestion).not.toHaveBeenCalled();
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
  });

  it("persists an in-process abort as cancellation", async () => {
    const f = documentFixture(), controller = new AbortController();
    const result = await processDocumentRun(f.graph, f.read(), "worker", 1000, async (_run, control) => {
      controller.abort();
      expect(control.signal.aborted).toBe(true);
      return f.prepared;
    }, { signal: controller.signal });
    expect(result.run.status).toBe("cancelled");
    expect(f.store.cancelIngestionRun).toHaveBeenCalledOnce();
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
  });

  it("fails an expired queued document before preparation", async () => {
    const f = documentFixture();
    f.edit(run => { run.status = "queued"; run.document!.deadlineAt = new Date(Date.now() - 100).toISOString(); });
    const prepare = vi.fn();
    const result = await processDocumentRun(f.graph, f.read(), "worker", 1000, prepare);
    expect(result.run).toMatchObject({ status: "failed", lastErrorCode: "OPERATION_TIMEOUT", retryable: false });
    expect(prepare).not.toHaveBeenCalled();
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
  });

  it("keeps persisted progress when extraction later fails", async () => {
    const f = documentFixture();
    await expect(processDocumentRun(f.graph, f.read(), "worker", 1000, async (_run, control) => {
      await control.report({ phase: "extracted", counts: { extracted: 4, rejected: 1 }, warnings: [] });
      throw new Error("provider unavailable");
    })).rejects.toMatchObject({ code: "INGESTION_FAILED" });
    expect(f.read().result).toMatchObject({ status: "retry_pending", phase: "extracted", counts: { extracted: 4, rejected: 1 } });
  });

  it("refuses a live lease and recovers an expired lease with a comparison", async () => {
    const f = documentFixture();
    f.edit(run => { run.status = "running"; run.workerId = "old"; run.attemptCount = 1; run.leaseExpiresAt = new Date(Date.now() + 5000); });
    const prepare = vi.fn(async () => f.prepared);
    await expect(processDocumentRun(f.graph, f.read(), "new", 1000, prepare)).rejects.toMatchObject({ code: "INGESTION_ORDER_PENDING" });
    expect(prepare).not.toHaveBeenCalled();
    f.edit(run => { run.leaseExpiresAt = new Date(Date.now() - 100); });
    await processDocumentRun(f.graph, f.read(), "new", 1000, prepare);
    expect(f.store.transitionIngestionRun).toHaveBeenCalledWith(expect.objectContaining({ from: ["running"], to: "retry_pending", expectedWorkerId: "old", expectedAttemptCount: 1, leaseExpiredBefore: expect.any(Date) }));
    expect(f.read().attemptCount).toBe(2);
  });

  it("does not let a stale worker change the new owner's state", async () => {
    const f = documentFixture();
    await expect(processDocumentRun(f.graph, f.read(), "old", 1000, async () => {
      f.edit(run => { run.workerId = "new"; run.attemptCount++; }); return f.prepared;
    })).rejects.toMatchObject({ code: "INGESTION_ORDER_PENDING" });
    expect(f.read()).toMatchObject({ status: "running", workerId: "new", attemptCount: 2 });
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
  });

  it("rejects unknown payload versions without changing document data", async () => {
    const f = documentFixture();
    f.edit(run => { Object.assign(run.document!, { version: 99 }); });
    const prepare = vi.fn();
    await expect(processDocumentRun(f.graph, f.read(), "worker", 1000, prepare)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(f.read().status).toBe("failed");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("resumes post-commit work without preparing or committing again", async () => {
    const f = documentFixture();
    const prepare = vi.fn(async () => f.prepared);
    const finish = vi.fn(async () => { throw new Error("lost connection after commit"); });
    const first = await processDocumentRun(f.graph, f.read(), "worker", 1000, prepare, undefined, finish);
    expect(first.run.status).toBe("completed");
    expect(first.run.result?.postProcessing).toBe("pending");
    finish.mockImplementation(async () => f.store.finishDocumentIngestion("run", []));
    const second = await processDocumentRun(f.graph, f.read(), "worker", 1000, prepare, undefined, finish);
    expect(second.run.result?.postProcessing).toBe("finished");
    expect(prepare).toHaveBeenCalledOnce();
    expect(f.store.commitPreparedIngestion).toHaveBeenCalledOnce();
  });

  it("sanitizes durable warnings without retaining provider exceptions", async () => {
    const f = documentFixture();
    f.prepared.warnings = [{ code: "BEST_EFFORT_OPERATION_FAILED", operation: "ingest", stage: "embedding", cause: new Error("secret provider payload"), context: { sessionId: "private" } }];
    const result = await processDocumentRun(f.graph, f.read(), "worker", 1000, async () => f.prepared);
    expect(result.warnings).toEqual([{ code: "BEST_EFFORT_OPERATION_FAILED", operation: "ingest", stage: "embedding" }]);
    expect(JSON.stringify(f.read())).not.toContain("secret provider payload");
  });

  it("gives a terminal duration that stops at cancellation", () => {
    const f = documentFixture();
    f.edit(run => { run.status = "cancelled"; run.startedAt = new Date(100); run.failedAt = new Date(150); });
    expect(documentReceipt(f.read()).durationMs).toBe(50);
  });

  it("leaves non-retryable preparation failures terminal", async () => {
    const f = documentFixture();
    await expect(processDocumentRun(f.graph, f.read(), "worker", 1000, async () => { throw new MemoGrafterError("bad", { code: "INPUT_INVALID", operation: "ingest" }); })).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(f.read().status).toBe("failed");
  });
});

function apiFixture() {
  const f = documentFixture();
  const llm: LLMAdapter = { complete: vi.fn(async () => JSON.stringify({ label: "Document", user_intent: "Project design", outcome: "Use TypeScript", open: null, memories: [
    { memory_type: "fact", subject: "project", predicate: "uses", value: "TypeScript", quality: { explicitness: 1, sourceReliability: 1, stability: 1, salience: 1 }, provenance: { speaker: "document", message_indexes: [1], extraction_method: "document-extraction" } },
  ] })) };
  const embedder: EmbedAdapter = { embed: vi.fn(async () => [1, 0]), dimensions: 2 };
  const store = Object.assign(f.store, {
    acceptIngestionRun: vi.fn(async (request: AcceptIngestionRequest) => {
      f.edit(run => { run.document = { ...request.document!, baseCursor: -1, baseEnd: -1 }; run.sessionId = request.sessionId; run.endIndex = request.document!.chunks.length - 1; });
      return f.read();
    }),
    getSessionIngestState: vi.fn(async () => null),
    getNodesBySession: vi.fn(async () => []), getSegmentsBySession: vi.fn(async () => []),
    getSimilarNodes: vi.fn(async () => []), saveEpisodeBundle: vi.fn(),
    saveEdge: vi.fn(), buildMemoryEdges: vi.fn(), clearSession: vi.fn(),
  });
  const pipeline = new IngestPipeline(store as unknown as GraphStore, llm, embedder, f.read().document!.pipeline);
  const memo = new MemoGrafter({ db: { connectionString: "postgres://unused" }, llm, embedder });
  Object.assign(memo, { storageInitialized: true, store, ingestPipeline: pipeline });
  return { ...f, store, llm, embedder, pipeline, memo };
}

describe("detailed document ingestion API", () => {
  it("runs the actual document pipeline with durable options, provenance and selected-memory counters", async () => {
    const f = apiFixture();
    const text = "# Architecture\nUse TypeScript.\n\n# Deployment\nUse containers.";
    const result = await f.memo.ingestTextDetailed(text, "session", {
      chunking: { strategy: "section", targetCharacters: 40 }, segmentation: { strategy: "per-chunk" },
      memoryBudget: { maxPerDocument: 1, deduplicate: true }, replace: true, source: "architecture.md", idempotencyKey: "revision-1",
    });
    expect(result).toMatchObject({ status: "completed", phase: "finished", chunkCount: 2, segmentCount: 2, counts: { extracted: 2, deduplicated: 1, selected: 1, persisted: 1 }, postProcessing: "finished" });
    expect(f.store.clearSession).not.toHaveBeenCalled();
    expect(f.store.getNodesBySession).not.toHaveBeenCalled();
    expect(f.store.saveEpisodeBundle).not.toHaveBeenCalled();
    const doc = f.read().document!;
    expect(doc).toMatchObject({ version: 1, options: { source: "architecture.md", sourceType: "document", replace: true }, pipeline: { concurrency: { extraction: 2, embedding: 8 } } });
    for (const chunk of doc.chunks) expect(chunk.content).toBe(text.slice(chunk.start, chunk.end));
    expect(doc.chunks[1]?.headings).toEqual(["Deployment"]);
    expect(f.read().prepared?.memories[0]?.provenance?.messageIndexes).toEqual([0]);
    expect(f.llm.complete).toHaveBeenCalledTimes(2);
    expect(f.embedder.embed).toHaveBeenCalledTimes(3); // Two topic summaries and one selected memory; no drift embeddings.
  });

  it.each([
    { chunking: { strategy: "fixed", targetCharacters: 5, overlapCharacters: 5 } },
    { segmentation: { strategy: "per-chunk", minChunks: 2 } },
    { concurrency: { extraction: 0 } }, { memoryBudget: { maxPerDocument: -1 } },
    { qualityPolicy: { mode: "unknown" } }, { tags: [1] }, { replace: "yes" },
    { chunking: null }, { segmentation: [] }, { qualityPolicy: "enforce" },
  ])("rejects invalid options before providers or storage: %j", async options => {
    const f = apiFixture();
    await expect(f.memo.ingestTextDetailed("Useful document", "session", options as IngestTextOptions)).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(f.store.acceptIngestionRun).not.toHaveBeenCalled();
    expect(f.llm.complete).not.toHaveBeenCalled();
    expect(f.embedder.embed).not.toHaveBeenCalled();
  });

  it("rejects an already aborted request before acceptance", async () => {
    const f = apiFixture(), controller = new AbortController(); controller.abort();
    await expect(f.memo.ingestTextDetailed("Document", "session", {}, { signal: controller.signal })).rejects.toMatchObject({ code: "OPERATION_ABORTED" });
    expect(f.store.acceptIngestionRun).not.toHaveBeenCalled();
  });

  it("requires the custom store's durable staging and atomic commit capabilities", async () => {
    const f = apiFixture(); Object.assign(f.memo, { store: {} });
    await expect(f.memo.ingestTextDetailed("Document", "session")).rejects.toMatchObject({ code: "CONFIGURATION_INVALID" });
    expect(f.llm.complete).not.toHaveBeenCalled();
  });

  it("queues only a durable run and returns progress through getIngestionRun", async () => {
    const f = apiFixture();
    const enqueueRun = vi.fn(async () => { f.edit(run => { run.status = "queued"; }); });
    Object.assign(f.memo, { ingestQueue: { enqueueRun } });
    const result = await f.memo.ingestTextDetailed("Document", "session", { chunking: { strategy: "single" } }, { timeoutMs: 42_000 });
    expect(result).toMatchObject({ ingestionRunId: "run", status: "queued", phase: "accepted", chunkCount: 1 });
    expect(enqueueRun).toHaveBeenCalledOnce();
    expect(enqueueRun.mock.calls[0]).toHaveLength(1);
    expect(f.read().document!.deadlineAt).toEqual(expect.any(String));
    expect(JSON.stringify(f.read().document)).not.toContain("signal");
    await expect(f.memo.getIngestionRun("run")).resolves.toMatchObject({ result: { status: "queued" } });
    expect(f.llm.complete).not.toHaveBeenCalled();
  });

  it("returns committed nodes on idempotent replay without extraction or embedding", async () => {
    const f = apiFixture();
    const options = { idempotencyKey: "revision", segmentation: { strategy: "single" as const } };
    const first = await f.memo.ingestTextDetailed("Document", "session", options);
    f.store.acceptIngestionRun.mockImplementation(async () => f.read());
    const second = await f.memo.ingestTextDetailed("Document", "session", options);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.nodes?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(f.llm.complete).toHaveBeenCalledOnce();
    expect(f.store.commitPreparedIngestion).toHaveBeenCalledOnce();
  });

  it("uses frozen settings when a retry is processed by a differently configured worker", async () => {
    const f = apiFixture();
    Object.assign(f.memo, { ingestQueue: { enqueueRun: vi.fn(async () => { f.edit(run => { run.status = "queued"; }); }) } });
    await f.memo.ingestTextDetailed("Document", "session", { segmentation: { strategy: "single" } });
    const worker = new IngestPipeline(f.store as unknown as GraphStore, f.llm, f.embedder, { windowSize: 20, minSegmentMessages: 99, topK: 5, mode: "intent", clustering: { enabled: false } });
    const result = await worker.processIngestionRun(f.read(), { segmentation: { strategy: "per-chunk" } });
    expect(result.run.result?.segmentCount).toBe(1);
    expect(f.embedder.embed).toHaveBeenCalledTimes(2);
  });

  it("cancels a provider that ignores AbortSignal without ever committing later", async () => {
    const f = apiFixture();
    let release!: (value: string) => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(f.llm.complete).mockImplementation(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const controller = new AbortController();
    const pending = f.memo.ingestTextDetailed("Document", "session", { segmentation: { strategy: "single" } }, { signal: controller.signal });
    await ready; controller.abort();
    expect(await pending).toMatchObject({ status: "cancelled" });
    release("{}");
    await Promise.resolve();
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
  });

  it("hashes equivalent option key order identically and includes budgets and deadlines", () => {
    const a = validateDocument("Document", { replace: true, memoryBudget: { maxPerSegment: 1, maxPerDocument: 2 } }, 1000);
    const b = validateDocument("Document", { memoryBudget: { maxPerDocument: 2, maxPerSegment: 1 }, replace: true, idempotencyKey: "different" }, 1000);
    expect(a.requestFingerprint).toBe(b.requestFingerprint);
    expect(validateDocument("Document", { replace: true, memoryBudget: { maxPerDocument: 3 } }, 1000).requestFingerprint).not.toBe(a.requestFingerprint);
    expect(validateDocument("Document", { replace: true, memoryBudget: { maxPerSegment: 1, maxPerDocument: 2 } }, 2000).requestFingerprint).not.toBe(a.requestFingerprint);
  });

  it("enforces the deadline while an adapter ignores cancellation", async () => {
    const f = apiFixture();
    let release!: (value: string) => void;
    vi.mocked(f.llm.complete).mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const result = await f.memo.ingestTextDetailed("Document", "session", { segmentation: { strategy: "single" } }, { timeoutMs: 40 });
    expect(result.status).toBe("failed");
    expect(f.read().lastErrorCode).toBe("OPERATION_TIMEOUT");
    expect(f.store.commitPreparedIngestion).not.toHaveBeenCalled();
    release("{}");
  });

  it("records extraction warnings in the durable receipt", async () => {
    const f = apiFixture();
    vi.mocked(f.llm.complete).mockResolvedValue(JSON.stringify({ label: "Document", user_intent: "design", outcome: "captured", memories: [{ memory_type: "fact", subject: "project", predicate: "uses", value: "TypeScript", provenance: { speaker: "document", message_indexes: [1], extraction_method: "document-extraction" } }] }));
    const result = await f.memo.ingestTextDetailed("Document", "session", { segmentation: { strategy: "single" } });
    expect(result.status).toBe("completed_with_warnings");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "MEMORY_QUALITY_DEFAULTED" }));
    expect(f.read().result?.warnings).toEqual(result.warnings);
  });

  it("attaches the durable run ID when enqueueing fails", async () => {
    const f = apiFixture();
    Object.assign(f.memo, { ingestQueue: { enqueueRun: vi.fn(async () => { throw new Error("Redis unavailable"); }) } });
    await expect(f.memo.ingestTextDetailed("Document", "session")).rejects.toMatchObject({ code: "INGESTION_FAILED", context: { jobId: "run", sessionId: "session", retrySafe: true } });
  });

  it("shares the durable worker with structured ingestion and preserves duplicate section evidence", async () => {
    const f = apiFixture();
    const result = await f.memo.ingestDocumentDetailed({ id: "doc", title: "Architecture", sections: [
      { id: "a", title: "Language", content: "Use TypeScript." },
      { id: "b", title: "Build", content: "Use TypeScript." },
    ] }, "session", { segmentation: { strategy: "per-chunk" }, memoryBudget: { deduplicate: true } });
    expect(result).toMatchObject({ status: "completed", counts: { selected: 1, deduplicated: 1 } });
    expect(f.read().document).toMatchObject({ version: 2, structured: { id: "doc" } });
    expect(f.read().prepared?.memories[0]?.sourceSpans?.map(span => span.section.id)).toEqual(["a", "b"]);
    expect(vi.mocked(f.llm.complete).mock.calls[0]?.[0]?.[0]?.content).toContain("Language");
  });

  it("supports the nodes-only structured wrapper and rejects ambiguous input before accepting a run", async () => {
    const f = apiFixture();
    await expect(f.memo.ingestDocument({ content: "Document" }, "session", { segmentation: { strategy: "single" } })).resolves.toHaveLength(1);
    f.store.acceptIngestionRun.mockClear();
    await expect(f.memo.ingestDocumentDetailed({ content: "text", sections: [] } as never, "session")).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(f.store.acceptIngestionRun).not.toHaveBeenCalled();
  });
});
