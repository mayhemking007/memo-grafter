import type {
  DatabaseQueryTelemetryEvent,
  MemoGrafterDatabaseTelemetry,
  MemoGrafterQueueTelemetry,
  QueueJobTelemetryEvent,
} from "../../../../src/index.js";
import type { DatabaseUsage, QueueUsage, TokenUsage } from "./types.js";

export class SmokeMetricsCollector {
  private active = false;
  private readonly database: DatabaseUsage = { total: 0, reads: 0, writes: 0, other: 0 };
  private readonly completed = new Map<string, QueueJobTelemetryEvent>();
  private readonly failed = new Map<string, QueueJobTelemetryEvent>();
  private queueEnabled = false;
  private readonly llm: TokenUsage = {
    calls: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedTotalTokens: 0,
  };

  readonly databaseTelemetry: MemoGrafterDatabaseTelemetry = {
    onQuery: (event) => this.recordDatabaseQuery(event),
  };

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  createQueueTelemetry(): MemoGrafterQueueTelemetry {
    this.queueEnabled = true;
    return {
      onJobCompleted: (event) => {
        if (this.active) {
          this.completed.set(event.jobId, event);
          this.failed.delete(event.jobId);
        }
      },
      onJobFailed: (event) => {
        if (this.active && !this.completed.has(event.jobId)) this.failed.set(event.jobId, event);
      },
    };
  }

  databaseSnapshot(): DatabaseUsage {
    return { ...this.database };
  }

  queueSnapshot(): QueueUsage | undefined {
    if (!this.queueEnabled) return undefined;
    const ordered = [...this.completed.values()].sort((left, right) => left.queuedAt - right.queuedAt);
    const first = ordered[0];
    const last = ordered.at(-1);
    return {
      completedJobs: this.completed.size,
      failedJobs: this.failed.size,
      totalMessages: ordered.reduce((total, job) => total + job.messageCount, 0),
      totalPayloadBytes: ordered.reduce((total, job) => total + (job.payloadBytes ?? 0), 0),
      maximumJobPayloadBytes: ordered.reduce((maximum, job) => Math.max(maximum, job.payloadBytes ?? 0), 0),
      firstJobMessageCount: first?.messageCount ?? null,
      lastJobMessageCount: last?.messageCount ?? null,
      firstJobPayloadBytes: first?.payloadBytes ?? null,
      lastJobPayloadBytes: last?.payloadBytes ?? null,
      firstJobKind: first?.kind ?? null,
      lastJobKind: last?.kind ?? null,
    };
  }

  recordLlmCall(usage: { inputTokens: number; outputTokens: number }): void {
    this.llm.calls += 1;
    this.llm.estimatedInputTokens += usage.inputTokens;
    this.llm.estimatedOutputTokens += usage.outputTokens;
    this.llm.estimatedTotalTokens = this.llm.estimatedInputTokens + this.llm.estimatedOutputTokens;
  }

  tokenSnapshot(): TokenUsage | undefined {
    return this.llm.calls > 0 ? { ...this.llm } : undefined;
  }

  private recordDatabaseQuery(event: DatabaseQueryTelemetryEvent): void {
    if (!this.active) return;
    this.database.total += 1;
    this.database[event.operation === "read" ? "reads" : event.operation === "write" ? "writes" : "other"] += 1;
  }
}
