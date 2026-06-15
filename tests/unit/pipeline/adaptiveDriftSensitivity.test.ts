import { describe, expect, it } from "vitest";
import type { TopicSegment } from "../../../src/core/types.js";
import { resolveAdaptiveDriftThreshold } from "../../../src/utils/drift/adaptiveDriftSensitivity.js";

function makeSegment(index: number, length: number): TopicSegment {
  const startIndex = index * 20;

  return {
    id: `segment-${index}`,
    sessionId: "session-1",
    startIndex,
    endIndex: startIndex + length - 1,
    topicOrder: index + 1,
    driftScore: index === 0 ? 0 : 0.4,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("adaptive drift sensitivity", () => {
  it("keeps the base threshold when disabled", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 1), makeSegment(1, 1), makeSegment(2, 1), makeSegment(3, 1)],
    );

    expect(result).toEqual({
      threshold: 0.35,
      adjusted: false,
      reason: "disabled",
    });
  });

  it("waits for enough segment history before adjusting", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 12), makeSegment(1, 12), makeSegment(2, 12)],
      { enabled: true, minSegments: 4 },
    );

    expect(result.threshold).toBe(0.35);
    expect(result.adjusted).toBe(false);
    expect(result.reason).toBe("insufficient-history");
  });

  it("raises the threshold when recent segments are too fragmented", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 2), makeSegment(1, 2), makeSegment(2, 2), makeSegment(3, 2)],
      { enabled: true },
    );

    expect(result.threshold).toBeCloseTo(0.4);
    expect(result.adjusted).toBe(true);
    expect(result.reason).toBe("fragmented");
  });

  it("lowers the threshold when recent segments are too coarse", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 10), makeSegment(1, 10), makeSegment(2, 10), makeSegment(3, 10)],
      { enabled: true },
    );

    expect(result.threshold).toBeCloseTo(0.3);
    expect(result.adjusted).toBe(true);
    expect(result.reason).toBe("coarse");
  });

  it("keeps the base threshold when recent segment lengths are in target range", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 5), makeSegment(1, 6), makeSegment(2, 5), makeSegment(3, 6)],
      { enabled: true },
    );

    expect(result.threshold).toBe(0.35);
    expect(result.adjusted).toBe(false);
    expect(result.reason).toBe("within-target");
  });

  it("skips adjustment when recent segment lengths are unstable", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.35,
      [makeSegment(0, 1), makeSegment(1, 20), makeSegment(2, 1), makeSegment(3, 20)],
      { enabled: true, maxVarianceRatio: 0.5 },
    );

    expect(result.threshold).toBe(0.35);
    expect(result.adjusted).toBe(false);
    expect(result.reason).toBe("unstable-history");
  });

  it("clamps adjustments around the base threshold", () => {
    const result = resolveAdaptiveDriftThreshold(
      0.25,
      [makeSegment(0, 20), makeSegment(1, 20), makeSegment(2, 20), makeSegment(3, 20)],
      {
        enabled: true,
        adjustmentStep: 0.2,
        maxAdjustment: 0.05,
      },
    );

    expect(result.threshold).toBeCloseTo(0.2);
    expect(result.adjusted).toBe(true);
    expect(result.reason).toBe("coarse");
  });
});
