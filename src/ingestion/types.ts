import type * as importTypes from "../core/types.js";
import type { Episode, MemoryNodeInsert, Message, TopicEdge, TopicNode, TopicSegment } from "../core/types.js";
import type { MemoGrafterErrorCode, MemoGrafterStage, MemoGrafterWarning } from "../diagnostics.js";

export type IngestionKind = "messages" | "append" | "text";
export type IngestionRunStatus = "accepted" | "queued" | "running" | "retry_pending" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "abandoned";

export interface IngestionRun {
  document?: DocumentIngestionPayload;
  prepared?: PreparedIngestion;
  result?: TextIngestionReceipt;
  cancelRequestedAt?: Date;
  supersededAt?: Date;
  id: string; sessionId: string; kind: IngestionKind; startIndex: number; endIndex: number;
  idempotencyKey?: string; status: IngestionRunStatus; attemptCount: number;
  queuedAt?: Date; startedAt?: Date; completedAt?: Date; failedAt?: Date;
  leaseExpiresAt?: Date; heartbeatAt?: Date; lastErrorCode?: MemoGrafterErrorCode;
  lastErrorStage?: MemoGrafterStage; lastErrorSafeMessage?: string; retryable?: boolean;
  workerId?: string; createdAt: Date; updatedAt: Date;
}

export interface AcceptIngestionRequest {
  document?: DocumentIngestionPayload;
  sessionId: string; kind: IngestionKind; messages: Message[]; idempotencyKey?: string;
}

export interface IngestionTransition {
  expectedWorkerId?: string;
  expectedAttemptCount?: number;
  /** Compare the lease in the same statement that recovers an expired worker. */
  leaseExpiredBefore?: Date;
  runId: string; from: IngestionRunStatus[]; to: IngestionRunStatus; workerId?: string;
  leaseExpiresAt?: Date; error?: { code?: MemoGrafterErrorCode; stage?: MemoGrafterStage; message: string; retryable: boolean };
}

export interface PreparedIngestion {
  workerId?: string;
  attemptCount?: number;
  documentCounts?: import("../diagnostics.js").MemorySelectionStats;
  runId: string; sessionId: string; startIndex: number; endIndex: number; expectedCursor: number;
  segments: TopicSegment[]; nodes: TopicNode[]; memories: MemoryNodeInsert[]; requiredEdges: TopicEdge[]; warnings?: MemoGrafterWarning[];
  episodes?: Episode[];
  /** Existing stable topics whose aggregate metadata must be updated at commit. */
  topicUpdates?: TopicNode[];
}

export interface AnalyzeDetailedInput {
  sessionId: string; userMessage: string; assistantMessage: string; tags?: string[]; idempotencyKey?: string;
}

export interface AnalyzeReceipt {
  status: "processed" | "queued"; ingestionRunId: string; sessionId: string;
  messageRange: [number, number]; messagesPersisted: boolean; graphProcessed: boolean;
  nodes?: TopicNode[]; warnings?: MemoGrafterWarning[];
  job?: { id: string; queueName: string };
}

export interface IngestionRequirements {
  topic?: "required"; memories?: "required" | "best-effort";
  semanticEdges?: "required" | "best-effort"; telemetry?: "best-effort";
}
export type IngestionEventType = "accepted" | "queued" | "started" | "retry_scheduled" | "completed" | "completed_with_warnings" | "failed" | "cancelled" | "abandoned";
export interface IngestionEvent { type: IngestionEventType; ingestionRunId: string; sessionId: string; messageRange: [number, number]; attemptCount: number; timestamp: number; jobId?: string; workerId?: string; errorCode?: MemoGrafterErrorCode }

export type ReconciliationIssueCode = "accepted-not-started" | "expired-worker-lease" | "retryable-failure" | "document-postprocessing-pending" | "cursor-behind-buffer" | "cursor-ahead-of-buffer" | "topic-without-segment" | "segment-without-topic" | "completed-cursor-behind" | "duplicate-range";
export interface ReconciliationIssue { code: ReconciliationIssueCode; severity: "warning" | "error"; sessionId: string; runId?: string; message: string; repairable: boolean }
export interface ReconciliationReport { mode: "inspect" | "repair"; issues: ReconciliationIssue[]; repaired: ReconciliationIssueCode[] }
export interface ReconciliationOptions { mode?: "inspect" | "repair"; repairs?: Array<"requeue-retryable" | "recover-expired-lease" | "queue-accepted" | "finish-document"> }

export interface MemoGrafterCloseOptions { drain?: boolean; timeoutMs?: number }
export class MemoGrafterShutdownError extends Error {
  constructor(message: string, readonly failures: string[], readonly pendingRunCount: number, readonly jobsMayBeActive: boolean) { super(message); this.name = "MemoGrafterShutdownError"; }
}

export interface IngestTextDetailedOptions extends importTypes.IngestTextOptions { idempotencyKey?: string; }
export interface DocumentIngestionPayload {
  version: 1;
  text: string;
  chunks: import("../utils/text/prepareTextChunks.js").TextChunk[];
  options: importTypes.IngestPipelineOptions;
  pipeline: Omit<ConstructorParameters<typeof import("./conversation/IngestPipeline.js").IngestPipeline>[3], "diagnostics">;
  deadlineAt: string;
  requestFingerprint: string;
  baseCursor?: number;
  baseEnd?: number;
}
export interface TextIngestionReceipt {
  ingestionRunId: string;
  sessionId: string;
  status: IngestionRunStatus;
  chunkCount: number;
  segmentCount?: number;
  topicCount?: number;
  counts?: Partial<import("../diagnostics.js").MemorySelectionStats>;
  phase?: "accepted" | "segmenting" | "extracted" | "selected" | "embedded" | "prepared" | "committed" | "finished";
  /** Optional graph enrichment can be resumed after a crash without repeating extraction. */
  postProcessing?: "pending" | "finished";
  durationMs?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  warnings: MemoGrafterWarning[];
  nodes?: TopicNode[];
}
