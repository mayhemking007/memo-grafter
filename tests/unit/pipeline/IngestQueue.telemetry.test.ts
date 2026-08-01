import { describe, expect, it, vi } from "vitest";
import type { Message, QueueJobTelemetryEvent } from "../../../src/index.js";
import {
  countIngestJobMessages,
  safelyReportQueueTelemetry,
} from "../../../src/ingestion/IngestQueue.js";

const messages: Message[] = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
];

const event: QueueJobTelemetryEvent = {
  jobId: "job-1",
  kind: "messages",
  messageCount: 2,
  queuedAt: 1,
  startedAt: 2,
  completedAt: 3,
};

describe("IngestQueue telemetry", () => {
  it("counts conversation messages", () => {
    expect(countIngestJobMessages({ kind: "messages", messages, sessionId: "session-1" })).toBe(2);
  });

  it("counts text chunks as logical messages", () => {
    expect(countIngestJobMessages({
      kind: "text",
      text: "First paragraph.\n\nSecond paragraph.",
      sessionId: "session-1",
    })).toBe(2);
  });

  it("reports events when configured", () => {
    const callback = vi.fn();
    safelyReportQueueTelemetry(callback, event);
    expect(callback).toHaveBeenCalledWith(event);
  });

  it("does not let telemetry errors affect queue behavior", () => {
    expect(() => safelyReportQueueTelemetry(() => {
      throw new Error("telemetry failed");
    }, event)).not.toThrow();
  });
});
