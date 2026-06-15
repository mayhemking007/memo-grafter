import type { TopicSegment } from "../../core/types.js";

export interface AdaptiveDriftSensitivityConfig {
  enabled?: boolean;
  minSegments?: number;
  lookbackSegments?: number;
  targetSegmentMessages?: {
    min?: number;
    max?: number;
  };
  adjustmentStep?: number;
  maxAdjustment?: number;
  maxVarianceRatio?: number;
}

export interface AdaptiveDriftThresholdResult {
  threshold: number;
  adjusted: boolean;
  reason: "disabled" | "insufficient-history" | "unstable-history" | "coarse" | "fragmented" | "within-target";
}

const DEFAULT_MIN_SEGMENTS = 4;
const DEFAULT_LOOKBACK_SEGMENTS = 8;
const DEFAULT_TARGET_MIN_MESSAGES = 3;
const DEFAULT_TARGET_MAX_MESSAGES = 8;
const DEFAULT_ADJUSTMENT_STEP = 0.05;
const DEFAULT_MAX_ADJUSTMENT = 0.1;
const DEFAULT_MAX_VARIANCE_RATIO = 0.75;
const MIN_THRESHOLD = 0.2;
const MAX_THRESHOLD = 0.55;

export function resolveAdaptiveDriftThreshold(
  baseThreshold: number,
  segments: TopicSegment[],
  config?: AdaptiveDriftSensitivityConfig,
): AdaptiveDriftThresholdResult {
  if (!config?.enabled) {
    return { threshold: baseThreshold, adjusted: false, reason: "disabled" };
  }

  const minSegments = config.minSegments ?? DEFAULT_MIN_SEGMENTS;
  const lookbackSegments = config.lookbackSegments ?? DEFAULT_LOOKBACK_SEGMENTS;
  const recentSegments = segments.slice(-lookbackSegments);

  if (recentSegments.length < minSegments) {
    return { threshold: baseThreshold, adjusted: false, reason: "insufficient-history" };
  }

  const lengths = recentSegments
    .map(segmentMessageCount)
    .filter((length) => Number.isFinite(length) && length > 0);

  if (lengths.length < minSegments) {
    return { threshold: baseThreshold, adjusted: false, reason: "insufficient-history" };
  }

  const averageLength = average(lengths);
  const varianceRatio = standardDeviation(lengths, averageLength) / averageLength;
  const maxVarianceRatio = config.maxVarianceRatio ?? DEFAULT_MAX_VARIANCE_RATIO;

  if (varianceRatio > maxVarianceRatio) {
    return { threshold: baseThreshold, adjusted: false, reason: "unstable-history" };
  }

  const targetMin = config.targetSegmentMessages?.min ?? DEFAULT_TARGET_MIN_MESSAGES;
  const targetMax = config.targetSegmentMessages?.max ?? DEFAULT_TARGET_MAX_MESSAGES;
  const step = Math.abs(config.adjustmentStep ?? DEFAULT_ADJUSTMENT_STEP);
  const maxAdjustment = Math.abs(config.maxAdjustment ?? DEFAULT_MAX_ADJUSTMENT);

  if (averageLength < targetMin) {
    return {
      threshold: clampThreshold(baseThreshold, baseThreshold + Math.min(step, maxAdjustment), maxAdjustment),
      adjusted: true,
      reason: "fragmented",
    };
  }

  if (averageLength > targetMax) {
    return {
      threshold: clampThreshold(baseThreshold, baseThreshold - Math.min(step, maxAdjustment), maxAdjustment),
      adjusted: true,
      reason: "coarse",
    };
  }

  return { threshold: baseThreshold, adjusted: false, reason: "within-target" };
}

function segmentMessageCount(segment: TopicSegment): number {
  return segment.endIndex - segment.startIndex + 1;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function clampThreshold(baseThreshold: number, threshold: number, maxAdjustment: number): number {
  const lower = Math.max(MIN_THRESHOLD, baseThreshold - maxAdjustment);
  const upper = Math.min(MAX_THRESHOLD, baseThreshold + maxAdjustment);
  return Math.min(Math.max(threshold, lower), upper);
}
