import type { IngestionRun, PreparedIngestion, TextIngestionReceipt } from "./types.js";
import type { MemoGrafterWarning } from "../diagnostics.js";
import { enrichMemoGrafterError, isMemoGrafterError, MemoGrafterError } from "../diagnostics.js";
import type { GraphStore } from "../store/GraphStore.js";
import type { MemoGrafterOperationOptions } from "../core/types.js";
import { setMaxListeners } from "node:events";

export const terminalDocumentStatus = (status: IngestionRun["status"]) => ["completed", "completed_with_warnings", "cancelled", "failed", "abandoned"].includes(status);
export const safeWarnings = (warnings: MemoGrafterWarning[]) => [...new Map(warnings.map(({ code, stage, operation }) => {
  const warning = { code, operation, ...(stage ? { stage } : {}) };
  return [JSON.stringify(warning), warning];
})).values()];

/** Only revive known date fields, never arbitrary user metadata or source text. */
export function hydrateDocumentRun(run: IngestionRun): IngestionRun {
  if (run.document) run.result = documentReceipt(run);
  for (const nodes of [run.prepared?.nodes, run.prepared?.topicUpdates, run.result?.nodes]) for (const node of nodes ?? []) {
    node.createdAt = new Date(node.createdAt);
    if (node.firstActiveAt) node.firstActiveAt = new Date(node.firstActiveAt);
    if (node.lastActiveAt) node.lastActiveAt = new Date(node.lastActiveAt);
  }
  for (const item of [...(run.prepared?.segments ?? []), ...(run.prepared?.episodes ?? [])]) item.createdAt = new Date(item.createdAt);
  if (run.result) {
    run.result.createdAt = new Date(run.result.createdAt);
    if (run.result.startedAt) run.result.startedAt = new Date(run.result.startedAt);
    if (run.result.completedAt) run.result.completedAt = new Date(run.result.completedAt);
  }
  return run;
}

export function documentReceipt(run: IngestionRun): TextIngestionReceipt {
  return {
    ...run.result,
    ingestionRunId: run.id, sessionId: run.sessionId, status: run.status,
    chunkCount: run.document?.chunks.length ?? 0, createdAt: run.createdAt,
    phase: run.result?.phase ?? (run.prepared ? "prepared" : "accepted"),
    ...(run.startedAt ? { startedAt: run.startedAt, durationMs: Math.max(0, (run.completedAt ?? (terminalDocumentStatus(run.status) ? run.failedAt : undefined) ?? new Date()).getTime() - run.startedAt.getTime()) } : {}),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.prepared ? { segmentCount: run.prepared.segments.length, topicCount: new Set([...run.prepared.nodes, ...(run.prepared.topicUpdates ?? [])].map(node => node.id)).size } : {}),
    ...((run.result?.counts ?? run.prepared?.documentCounts) ? { counts: run.result?.counts ?? run.prepared!.documentCounts } : {}),
    warnings: run.result?.warnings ?? safeWarnings(run.prepared?.warnings ?? []),
  };
}

export interface DocumentRunControl {
  signal: AbortSignal;
  check: () => Promise<void>;
  report: (progress: Pick<TextIngestionReceipt, "phase" | "counts" | "warnings">) => Promise<void>;
}

export async function processDocumentRun(
  store: GraphStore, input: IngestionRun, workerId: string, leaseMs: number,
  prepare: (run: IngestionRun, control: DocumentRunControl) => Promise<PreparedIngestion>,
  operation?: MemoGrafterOperationOptions,
  finish?: (run: IngestionRun) => Promise<IngestionRun>,
): Promise<{ nodes: import("../core/types.js").TopicNode[]; warnings: MemoGrafterWarning[]; run: IngestionRun }> {
  if (!store.getIngestionRun || !store.stageDocumentIngestion || !store.recordDocumentProgress || !store.cancelIngestionRun || !store.transitionIngestionRun || !store.renewIngestionRunLease || !store.commitPreparedIngestion) {
    throw new MemoGrafterError("Store does not support durable document processing.", { code: "CONFIGURATION_INVALID", operation: "ingest" });
  }
  if (!Number.isFinite(leaseMs) || leaseMs < 300) throw new MemoGrafterError("Worker lease must be at least 300ms.", { code: "INPUT_INVALID", operation: "ingest" });
  const found = await store.getIngestionRun(input.id);
  if (!found) throw new MemoGrafterError("Document ingestion run was not found.", { code: "INPUT_INVALID", operation: "ingest" });
  let run: IngestionRun = found;
  const result = () => ({ nodes: run.result?.nodes ?? [], warnings: documentReceipt(run).warnings, run });
  if (terminalDocumentStatus(run.status) || run.supersededAt) {
    if (finish && !run.supersededAt && run.result?.postProcessing === "pending" && ["completed", "completed_with_warnings"].includes(run.status)) run = await finish(run);
    return result();
  }
  if (run.status === "running") {
    if (!run.leaseExpiresAt || run.leaseExpiresAt.getTime() > Date.now()) throw new MemoGrafterError("Another document worker owns this run.", { code: "INGESTION_ORDER_PENDING", operation: "ingest", retryable: true });
    await store.transitionIngestionRun({ runId: run.id, from: ["running"], to: "retry_pending", expectedWorkerId: run.workerId!, expectedAttemptCount: run.attemptCount, leaseExpiredBefore: new Date(), error: { message: "Worker lease expired.", retryable: true } });
  }
  try {
    run = await store.transitionIngestionRun({ runId: run.id, from: ["accepted", "queued", "retry_pending"], to: "running", workerId, leaseExpiresAt: new Date(Date.now() + leaseMs) });
  } catch (cause) {
    const current = await store.getIngestionRun(run.id);
    if (current && terminalDocumentStatus(current.status)) { run = current; return result(); }
    throw new MemoGrafterError("Document run was claimed concurrently.", { code: "INGESTION_ORDER_PENDING", operation: "ingest", retryable: true, cause });
  }
  const attempt = run.attemptCount;
  const controller = new AbortController();
  setMaxListeners(0, controller.signal);
  let cancellation: Promise<unknown> | undefined;
  let stopReason: MemoGrafterError | undefined;
  const stop = (error: MemoGrafterError) => { stopReason ??= error; controller.abort(error); return error; };
  const abort = () => {
    stop(new MemoGrafterError("Document ingestion cancelled.", { code: "OPERATION_ABORTED", operation: "ingest" }));
    cancellation = store.cancelIngestionRun!(run.id); void cancellation.catch(() => undefined);
  };
  operation?.signal?.addEventListener("abort", abort, { once: true });
  if (operation?.signal?.aborted) abort();
  const deadline = new Date(run.document?.deadlineAt ?? "").getTime();
  const deadlineError = () => new MemoGrafterError("Document ingestion deadline expired.", { code: "OPERATION_TIMEOUT", operation: "ingest", retryable: false });
  const timeout = Number.isFinite(deadline) ? setTimeout(() => stop(deadlineError()), Math.max(0, Math.min(2_147_483_647, deadline - Date.now()))) : undefined;
  const check = async () => {
    if (stopReason) throw stopReason;
    if (Date.now() >= deadline) throw stop(deadlineError());
    const current = await store.getIngestionRun!(run.id);
    if (current?.cancelRequestedAt || current?.status === "cancelled") throw stop(new MemoGrafterError("Document ingestion cancelled.", { code: "OPERATION_ABORTED", operation: "ingest" }));
    if (!current || current.status !== "running" || current.workerId !== workerId || current.attemptCount !== attempt || !current.leaseExpiresAt || current.leaseExpiresAt.getTime() <= Date.now()) {
      throw stop(new MemoGrafterError("Document worker lease was lost.", { code: "INGESTION_ORDER_PENDING", operation: "ingest", retryable: true }));
    }
  };
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void check().then(() => store.renewIngestionRunLease!(run.id, workerId, new Date(Date.now() + leaseMs))).catch(cause => stop(isMemoGrafterError(cause) ? cause : new MemoGrafterError("Document lease renewal failed.", { code: "INGESTION_ORDER_PENDING", operation: "ingest", retryable: true, cause }))).finally(() => { renewing = false; });
  }, Math.max(100, Math.min(1000, leaseMs / 3)));
  try {
    if (run.document?.version !== 1 || !Number.isFinite(deadline)) throw new MemoGrafterError("Unsupported or invalid document payload.", { code: "INPUT_INVALID", operation: "ingest" });
    await check();
    const report: DocumentRunControl["report"] = async progress => {
      await check();
      await store.recordDocumentProgress!(run.id, workerId, attempt, { ...progress, warnings: safeWarnings(progress.warnings) });
    };
    const prepared = run.prepared ?? await prepare(run, { signal: controller.signal, check, report });
    prepared.workerId = workerId; prepared.attemptCount = attempt;
    prepared.warnings = safeWarnings(prepared.warnings ?? []);
    await check();
    run = await store.stageDocumentIngestion!(run.id, prepared);
    await check();
    const committed = await store.commitPreparedIngestion!(prepared);
    run = committed.run;
    clearInterval(heartbeat); clearTimeout(timeout);
    operation?.signal?.removeEventListener("abort", abort);
    if (finish) run = await finish(run);
    return { nodes: committed.nodes, warnings: documentReceipt(run).warnings, run };
  } catch (error) {
    if (cancellation) await cancellation.catch(() => undefined);
    const current = await store.getIngestionRun!(run.id);
    if (current && terminalDocumentStatus(current.status)) { run = current; return result(); }
    const expired = Date.now() >= deadline;
    const typed = expired ? deadlineError() : stopReason
      ?? (isMemoGrafterError(error) ? error : new MemoGrafterError("Document ingestion preparation failed.", { code: "INGESTION_FAILED", operation: "ingest", retryable: true, cause: error }));
    const status = typed.code === "OPERATION_ABORTED" ? "cancelled" : typed.retryable ? "retry_pending" : "failed";
    await store.transitionIngestionRun!({ runId: run.id, from: ["running"], to: status, expectedWorkerId: workerId, expectedAttemptCount: attempt, error: { code: typed.code, message: `Document ingestion failed (${typed.code}).`, retryable: typed.retryable } }).catch(() => undefined);
    run = await store.getIngestionRun!(run.id) ?? run;
    if (status === "cancelled" || expired) return result();
    throw enrichMemoGrafterError(typed, { context: { sessionId: run.sessionId, jobId: run.id, retrySafe: typed.retryable, messagesPersisted: false, graphProcessed: false, cursorAdvanced: false } });
  } finally {
    clearInterval(heartbeat); clearTimeout(timeout); operation?.signal?.removeEventListener("abort", abort);
  }
}
