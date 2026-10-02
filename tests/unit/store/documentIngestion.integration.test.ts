import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGraphStore } from "../../../src/store/index.js";
import { validateDocument } from "../../../src/ingestion/validateDocument.js";
import type { IngestionRun, PreparedIngestion } from "../../../src/ingestion/types.js";
import type { IngestTextOptions, TopicNode } from "../../../src/core/types.js";
import { IngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";

// Opt-in: only a randomly generated schema is removed; never use a production database.
const url = process.env.MEMOGRAFTER_DOCUMENT_TEST_DB;
describe.skipIf(!url)("durable documents on PostgreSQL/pgvector", () => {
  const schema = `mg_document_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Sql, sql: Sql, store: PostgresGraphStore;
  const vector = () => [1, ...new Array<number>(1535).fill(0)];
  beforeAll(async () => {
    admin = postgres(url!, { onnotice: () => undefined });
    await admin`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
    await admin`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`;
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    sql = postgres(url!, { onnotice: () => undefined, max: 6, connection: { search_path: `${schema},public` } });
    store = new PostgresGraphStore(url!);
    Object.assign(store, { sql });
    await store.migrate();
    await store.migrate();
    await store.verifySchema();
  }, 60_000);
  afterAll(async () => {
    await sql?.end();
    if (admin) { await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });

  async function accept(sessionId: string, text = "Replacement document", options: IngestTextOptions = { replace: true }, key?: string) {
    const validated = validateDocument(text, options, 60_000);
    return store.acceptIngestionRun({ sessionId, kind: "text", messages: validated.chunks.map(chunk => ({ role: "user", content: chunk.content })), ...(key ? { idempotencyKey: key } : {}),
      document: { version: 1, text, chunks: validated.chunks, options: { ...options, sourceType: "document" }, pipeline: { windowSize: 2, topK: 2, minSegmentMessages: 1, mode: "intent", clustering: { enabled: false } }, deadlineAt: new Date(Date.now() + 60_000).toISOString(), requestFingerprint: validated.requestFingerprint } });
  }
  const claim = (run: IngestionRun, worker = randomUUID()) => store.transitionIngestionRun({ runId: run.id, from: ["accepted", "queued", "retry_pending"], to: "running", workerId: worker, leaseExpiresAt: new Date(Date.now() + 30_000) });
  function prepare(run: IngestionRun): PreparedIngestion {
    const createdAt = new Date(), segmentId = randomUUID();
    const topicOrder = run.startIndex + 1;
    const node: TopicNode = { id: randomUUID(), sessionId: run.sessionId, segmentId, label: run.document?.text ?? "Old topic", summary: "Project uses TypeScript", embedding: vector(), tags: [], messageRange: [run.startIndex, run.endIndex], topicOrder, driftScore: 0, agentColor: null, fleetId: null, agentId: null, createdAt };
    return { runId: run.id, sessionId: run.sessionId, startIndex: run.startIndex, endIndex: run.endIndex, expectedCursor: run.document?.baseCursor ?? run.startIndex - 1,
      workerId: run.workerId, attemptCount: run.attemptCount, nodes: [node], segments: [{ id: segmentId, sessionId: run.sessionId, startIndex: run.startIndex, endIndex: run.endIndex, topicOrder, driftScore: 0, createdAt }],
      memories: [{ id: randomUUID(), sessionId: run.sessionId, segmentId, topicNodeId: node.id, agentId: null, memoryType: "fact", sourceType: "document", subject: "project", predicate: "uses", value: "TypeScript", quality: { explicitness: 1, sourceReliability: 1, stability: 1, salience: 1 }, embedding: vector(), sourceUrl: null, sourceTitle: null, supersededBy: null, decayed: false, agentColor: null, fleetId: null }],
      requiredEdges: [], warnings: [], documentCounts: { sessionId: run.sessionId, extracted: 1, rejected: 0, deduplicated: 0, budgetExcluded: 0, selected: 1, acknowledged: 0, persisted: 0 } };
  }
  async function seed(sessionId: string) {
    const run = await claim(await store.acceptIngestionRun({ sessionId, kind: "append", messages: [{ role: "user", content: "Old document" }] }));
    return store.commitPreparedIngestion(prepare(run));
  }

  it("serializes concurrent idempotent accepts and rejects changed input", async () => {
    const sessionId = randomUUID();
    const [a, b] = await Promise.all([accept(sessionId, "Document", {}, "same-key"), accept(sessionId, "Document", {}, "same-key")]);
    expect(a.id).toBe(b.id);
    expect(await store.getMessagesBySession(sessionId)).toEqual([]);
    expect(await store.listIngestionRuns(sessionId)).toHaveLength(1);
    await expect(accept(sessionId, "Different", {}, "same-key")).rejects.toMatchObject({ code: "INGESTION_INVARIANT_VIOLATION" });
    await expect(store.appendMessages(sessionId, [{ role: "user", content: "racing append" }])).rejects.toMatchObject({ code: "INGESTION_ORDER_PENDING" });
    await expect(store.saveMessagesAt(sessionId, 0, [{ role: "user", content: "racing overwrite" }])).rejects.toMatchObject({ code: "INGESTION_ORDER_PENDING" });
    await store.cancelIngestionRun(a.id);
  });

  it("preserves the old session until commit and atomically replaces all graph data and its cursor", async () => {
    const sessionId = randomUUID();
    const old = await seed(sessionId);
    const oldSecond = await seed(sessionId);
    const run = await claim(await accept(sessionId));
    const prepared = prepare(run);
    const staged = await store.stageDocumentIngestion(run.id, prepared);
    expect(staged.prepared?.nodes[0]?.createdAt).toBeInstanceOf(Date);
    expect(await store.getMessagesBySession(sessionId)).toHaveLength(2);
    expect((await store.getNodesBySession(sessionId)).map(node => node.id)).toContain(old.nodes[0]!.id);
    const result = await store.commitPreparedIngestion(prepared);
    await store.finishDocumentIngestion(run.id, []);
    expect(await store.getMessagesBySession(sessionId)).toEqual([{ role: "user", content: "Replacement document" }]);
    expect((await store.getNodesBySession(sessionId)).map(node => node.id)).toEqual([prepared.nodes[0]!.id]);
    expect(await store.getSegmentsBySession(sessionId)).toHaveLength(1);
    expect(await store.getMemoriesBySession(sessionId)).toHaveLength(1);
    expect((await store.getSessionIngestState(sessionId))?.lastIngestedMessageIndex).toBe(0);
    expect(result.run.result).toMatchObject({ status: "completed", phase: "committed", postProcessing: "pending", counts: { persisted: 1 } });
    expect((await store.getIngestionRun(old.run.id))?.supersededAt).toBeInstanceOf(Date);
    expect((await store.getIngestionRun(oldSecond.run.id))?.supersededAt).toBeInstanceOf(Date);
    expect(await store.inspectIngestionConsistency(sessionId)).toEqual([]);
    // Reusing index 1 must not collide with the superseded historical message run.
    expect((await seed(sessionId)).run.startIndex).toBe(1);
  });

  it("rolls back deletion, messages and cursor if an insert fails during replacement", async () => {
    const sessionId = randomUUID(), old = await seed(sessionId);
    const run = await claim(await accept(sessionId));
    const prepared = prepare(run);
    prepared.nodes[0]!.embedding = [1, 0]; // pgvector rejects the wrong dimension after the deletes.
    await store.stageDocumentIngestion(run.id, prepared);
    await expect(store.commitPreparedIngestion(prepared)).rejects.toThrow();
    expect((await store.getNodesBySession(sessionId))[0]?.id).toBe(old.nodes[0]!.id);
    expect(await store.getMessagesBySession(sessionId)).toEqual([{ role: "user", content: "Old document" }]);
    expect((await store.getSessionIngestState(sessionId))?.lastIngestedMessageIndex).toBe(0);
    expect((await store.getIngestionRun(old.run.id))?.supersededAt).toBeUndefined();
    expect((await store.getIngestionRun(run.id))?.status).toBe("running");
    await store.cancelIngestionRun(run.id);
  });

  it("fences stale staging and commits after worker recovery", async () => {
    const run = await claim(await accept(randomUUID()), "old-worker");
    const original = prepare(run);
    await store.stageDocumentIngestion(run.id, original);
    await sql`UPDATE mg_ingestion_runs SET lease_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=${run.id}`;
    await expect(store.renewIngestionRunLease(run.id, "old-worker", new Date(Date.now() + 1000))).rejects.toThrow();
    await store.transitionIngestionRun({ runId: run.id, from: ["running"], to: "retry_pending", expectedWorkerId: "old-worker", expectedAttemptCount: 1, leaseExpiredBefore: new Date() });
    const recovered = await claim((await store.getIngestionRun(run.id))!, "new-worker");
    await expect(store.stageDocumentIngestion(run.id, original)).rejects.toMatchObject({ code: "INGESTION_ORDER_PENDING" });
    await expect(store.commitPreparedIngestion(original)).rejects.toMatchObject({ code: "INGESTION_INVARIANT_VIOLATION" });
    const resumed = { ...recovered.prepared!, workerId: recovered.workerId, attemptCount: recovered.attemptCount };
    await store.stageDocumentIngestion(run.id, resumed);
    expect((await store.commitPreparedIngestion(resumed)).run.attemptCount).toBe(2);
  });

  it("rejects a commit different from its staged preparation", async () => {
    const run = await claim(await accept(randomUUID()));
    const prepared = prepare(run);
    await store.stageDocumentIngestion(run.id, prepared);
    prepared.nodes[0]!.summary = "Changed after staging";
    await expect(store.commitPreparedIngestion(prepared)).rejects.toMatchObject({ code: "INGESTION_INVARIANT_VIOLATION" });
    expect(await store.getMessagesBySession(run.sessionId)).toEqual([]);
    await store.cancelIngestionRun(run.id);
  });

  it("honors persisted cancellation and deadlines after staging", async () => {
    for (const mode of ["cancel", "deadline"] as const) {
      const sessionId = randomUUID(), old = await seed(sessionId);
      const run = await claim(await accept(sessionId)), prepared = prepare(run);
      await store.stageDocumentIngestion(run.id, prepared);
      if (mode === "cancel") await store.cancelIngestionRun(run.id);
      else await sql`UPDATE mg_ingestion_runs SET document_payload=jsonb_set(document_payload,'{deadlineAt}',to_jsonb((clock_timestamp()-INTERVAL '1 second')::text)) WHERE id=${run.id}`;
      await expect(store.commitPreparedIngestion(prepared)).rejects.toThrow();
      expect((await store.getNodesBySession(sessionId))[0]?.id).toBe(old.nodes[0]!.id);
      await store.cancelIngestionRun(run.id);
    }
  });

  it("serializes cancellation racing a commit, with no partially replaced session", async () => {
    const sessionId = randomUUID(), old = await seed(sessionId);
    const run = await claim(await accept(sessionId)), prepared = prepare(run);
    await store.stageDocumentIngestion(run.id, prepared);
    await Promise.allSettled([store.cancelIngestionRun(run.id), store.commitPreparedIngestion(prepared)]);
    const final = (await store.getIngestionRun(run.id))!;
    if (final.status === "completed") await store.finishDocumentIngestion(run.id, []);
    expect(["completed", "cancelled"]).toContain(final.status);
    const expected = final.status === "completed" ? prepared.nodes[0]!.id : old.nodes[0]!.id;
    expect((await store.getNodesBySession(sessionId)).map(node => node.id)).toEqual([expected]);
    expect(await store.inspectIngestionConsistency(sessionId)).toEqual([]);
  });

  it("persists final warnings and date-valued results across clients", async () => {
    const run = await claim(await accept(randomUUID())), prepared = prepare(run);
    await store.stageDocumentIngestion(run.id, prepared); await store.commitPreparedIngestion(prepared);
    await store.finishDocumentIngestion(run.id, [{ code: "BEST_EFFORT_OPERATION_FAILED", operation: "ingest", stage: "graph-processing", cause: new Error("private") }]);
    const recovered = await store.getIngestionRun(run.id);
    expect(recovered?.result).toMatchObject({ status: "completed_with_warnings", phase: "finished", warnings: [{ code: "BEST_EFFORT_OPERATION_FAILED", operation: "ingest", stage: "graph-processing" }] });
    expect(recovered?.result?.nodes?.[0]?.createdAt).toBeInstanceOf(Date);
    expect(recovered?.result?.completedAt).toBeInstanceOf(Date);
    await store.migrate();
    expect((await store.getIngestionRun(run.id))?.result?.nodes?.[0]?.id).toBe(prepared.nodes[0]!.id);
  });

  it("runs extraction through atomic replacement, reuses staged topics, and replays the result", async () => {
    const sessionId = randomUUID();
    await seed(sessionId);
    let extractions = 0;
    const pipeline = new IngestPipeline(store, { complete: async () => {
      extractions++;
      return JSON.stringify({ label: "Architecture", user_intent: "Project design", outcome: "Use TypeScript", open: null, memories: [{
        memory_type: "fact", subject: "project", predicate: "uses", value: "TypeScript",
        quality: { explicitness: 1, sourceReliability: 1, stability: 1, salience: 1 },
        provenance: { speaker: "document", message_indexes: [1], extraction_method: "document-extraction" },
      }] });
    } }, { embed: async () => vector(), dimensions: 1536 }, { windowSize: 2, topK: 2, mode: "intent", minSegmentMessages: 1, clustering: { enabled: false } });
    const run = await accept(sessionId, "First document paragraph.\n\nSecond document paragraph.", {
      replace: true, chunking: { strategy: "paragraph", targetCharacters: 28 }, segmentation: { strategy: "per-chunk" },
      memoryBudget: { deduplicate: true },
    });
    const result = await pipeline.processIngestionRun((await store.getIngestionRun(run.id))!);
    expect(result.run).toMatchObject({ status: "completed", result: { segmentCount: 2, topicCount: 1, postProcessing: "finished", counts: { extracted: 2, selected: 1, persisted: 1 } } });
    expect(await store.getEpisodesBySession(sessionId)).toHaveLength(2);
    expect(await store.getNodesBySession(sessionId)).toHaveLength(1);
    expect(await store.inspectIngestionConsistency(sessionId)).toEqual([]);
    const replay = await pipeline.processIngestionRun((await store.getIngestionRun(run.id))!);
    expect(replay.nodes.map(node => node.id)).toEqual(result.nodes.map(node => node.id));
    expect(extractions).toBe(2);
  });
});
