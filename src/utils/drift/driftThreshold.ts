import type { DriftSensitivity } from "../../types.js";

let thresholdWarningLogged = false;

export function resolveDriftThreshold(config: {
  driftSensitivity?: DriftSensitivity;
  threshold?: number;
}): number {
  if (config.driftSensitivity === "low") return 0.25;
  if (config.driftSensitivity === "high") return 0.5;
  if (config.driftSensitivity === "medium") return 0.35;

  if (config.threshold !== undefined) {
    if (!thresholdWarningLogged) {
      console.warn("[MemoGrafter] drift.threshold is deprecated, use drift.driftSensitivity instead");
      thresholdWarningLogged = true;
    }
    return config.threshold;
  }

  return 0.35;
}

export function resetDriftThresholdWarningForTests(): void {
  thresholdWarningLogged = false;
}
