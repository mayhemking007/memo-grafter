import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestionRun } from "../../../src/ingestion/types.js";
import type { GraphStore } from "../../../src/store/GraphStore.js";
import type { IngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";
import { MemoGrafterError } from "../../../src/diagnostics.js";
import { IngestQueue } from "../../../src/ingestion/IngestQueue.js";

const queueMock = vi.hoisted(() => ({
  add: vi.fn(), getJob: vi.fn(),
  process: undefined as ((job: unknown) => Promise<void>) | undefined,
  events: new Map<string, (job: unknown) => void>(),
}));
vi.mock("ioredis", () => ({ Redis: class { on() {} disconnect() {} } }));
vi.mock("bullmq", () => ({
  Queue: class { add = queueMock.add; getJob = queueMock.getJob; on() {} },
  Worker: class {
    constructor(_name: string, process: (job: unknown) => Promise<void>) { queueMock.process = process; }
    on(name: string, handler: (job: unknown) => void) { queueMock.events.set(name, handler); }
  },
  UnrecoverableError: class extends Error {},
}));

beforeEach(() => { vi.clearAllMocks(); queueMock.events.clear(); queueMock.process = undefined; queueMock.getJob.mockResolvedValue(undefined); queueMock.add.mockResolvedValue({ id: "run" }); });

function fixture() {
  const run = { id: "run", sessionId: "session", kind: "text", startIndex: 0, endIndex: 2, status: "accepted", attemptCount: 0, document: { version: 1 }, createdAt: new Date(), updatedAt: new Date() } as IngestionRun;
  const store = {
    getIngestionRun: vi.fn(async () => ({ ...run })),
    transitionIngestionRun: vi.fn(async ({ to }: { to: IngestionRun["status"] }) => { run.status = to; return { ...run }; }),
  };
  const pipeline = { processIngestionRun: vi.fn(async () => ({ run, nodes: [], warnings: [] })) };
  const telemetry = { onCancelled: vi.fn(), onCompleted: vi.fn(), onCompletedWithWarnings: vi.fn(), onFailed: vi.fn() };
  const queue = new IngestQueue(pipeline as unknown as IngestPipeline, { redisUrl: "redis://unused", telemetry }, store as unknown as GraphStore);
  const job = { id: "run", data: { kind: "run", ingestionRunId: "run", sessionId: "session", startIndex: 0, endIndex: 2 }, timestamp: Date.now(), attemptsMade: 1, opts: { attempts: 3 } };
  return { run, store, pipeline, telemetry, queue, job };
}

describe("durable document queue", () => {
  it("queues a reference to the durable run without copying document options", async () => {
    const f = fixture();
    await f.queue.enqueueRun(f.run, { replace: false });
    expect(queueMock.add).toHaveBeenCalledWith("ingestion-run", f.job.data, expect.objectContaining({ jobId: "run" }));
    expect(f.store.transitionIngestionRun).toHaveBeenCalledWith({ runId: "run", from: ["accepted", "retry_pending"], to: "queued" });
  });

  it("recovers an expired worker before enqueueing its durable run", async () => {
    const f = fixture();
    Object.assign(f.run, { status: "running", workerId: "expired", attemptCount: 2, leaseExpiresAt: new Date(0) });
    await f.queue.enqueueRun(f.run);
    expect(f.store.transitionIngestionRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ to: "retry_pending", expectedWorkerId: "expired", expectedAttemptCount: 2, leaseExpiredBefore: expect.any(Date) }));
    expect(f.run.status).toBe("queued");
  });

  it("uses the run from storage when processing a job", async () => {
    const f = fixture();
    await f.queue.enqueueRun(f.run);
    await queueMock.process!(f.job);
    expect(f.pipeline.processIngestionRun).toHaveBeenCalledWith(expect.objectContaining({ id: "run", document: { version: 1 } }), {}, expect.stringMatching(/^bullmq-/), 60_000);
  });

  it("reports cancellation rather than successful ingestion when the job settles", async () => {
    const f = fixture();
    await f.queue.enqueueRun(f.run);
    f.run.status = "cancelled";
    await queueMock.process!(f.job);
    queueMock.events.get("completed")!(f.job);
    await vi.waitFor(() => expect(f.telemetry.onCancelled).toHaveBeenCalledOnce());
    expect(f.telemetry.onCompleted).not.toHaveBeenCalled();
  });

  it("does not retry terminal deadline failures", async () => {
    const f = fixture();
    await f.queue.enqueueRun(f.run);
    f.run.status = "failed"; f.run.lastErrorSafeMessage = "Deadline expired";
    await expect(queueMock.process!(f.job)).rejects.toThrow("Deadline expired");
    f.pipeline.processIngestionRun.mockRejectedValueOnce(new MemoGrafterError("provider rejected input", { code: "INPUT_INVALID", operation: "ingest" }));
    await expect(queueMock.process!(f.job)).rejects.toThrow("Document ingestion failed (INPUT_INVALID)");
  });

  it("retains accepted work for recovery if Redis enqueue fails", async () => {
    const f = fixture(); queueMock.add.mockRejectedValueOnce(new Error("Redis unavailable"));
    await expect(f.queue.enqueueRun(f.run)).rejects.toThrow("Redis unavailable");
    expect(f.run.status).toBe("retry_pending");
    expect(f.pipeline.processIngestionRun).not.toHaveBeenCalled();
  });
});
