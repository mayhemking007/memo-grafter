import { describe, expect, it } from "vitest";
import { SmokeMetricsCollector } from "../manual/live-smoke/helpers/metrics.js";

describe("live smoke metrics collector", () => {
  it("excludes database activity outside the active workflow", () => {
    const metrics = new SmokeMetricsCollector();
    metrics.databaseTelemetry.onQuery?.({ operation: "read" });
    metrics.start();
    metrics.databaseTelemetry.onQuery?.({ operation: "read" });
    metrics.databaseTelemetry.onQuery?.({ operation: "write" });
    metrics.databaseTelemetry.onQuery?.({ operation: "other" });
    metrics.stop();
    metrics.databaseTelemetry.onQuery?.({ operation: "write" });

    expect(metrics.databaseSnapshot()).toEqual({ total: 3, reads: 1, writes: 1, other: 1 });
  });

  it("reports unique completed jobs and first/last payload sizes", () => {
    const metrics = new SmokeMetricsCollector();
    const queue = metrics.createQueueTelemetry();
    metrics.start();
    queue.onJobCompleted?.({
      jobId: "job-1",
      kind: "messages",
      messageCount: 2,
      queuedAt: 1,
      startedAt: 2,
      completedAt: 3,
    });
    queue.onJobCompleted?.({
      jobId: "job-2",
      kind: "messages",
      messageCount: 4,
      queuedAt: 4,
      startedAt: 5,
      completedAt: 6,
    });
    metrics.stop();

    expect(metrics.queueSnapshot()).toEqual({
      completedJobs: 2,
      failedJobs: 0,
      totalMessages: 6,
      firstJobMessageCount: 2,
      lastJobMessageCount: 4,
      firstJobKind: "messages",
      lastJobKind: "messages",
    });
  });

  it("does not double-count a retried job that eventually completes", () => {
    const metrics = new SmokeMetricsCollector();
    const queue = metrics.createQueueTelemetry();
    const event = {
      jobId: "job-1",
      kind: "text" as const,
      messageCount: 1,
      queuedAt: 1,
      startedAt: 2,
      completedAt: 3,
    };
    metrics.start();
    queue.onJobFailed?.(event);
    queue.onJobCompleted?.(event);

    expect(metrics.queueSnapshot()?.completedJobs).toBe(1);
    expect(metrics.queueSnapshot()?.failedJobs).toBe(0);
  });
});
