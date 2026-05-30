import type { MemoryNode } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecayScoreOptions {
  now: Date;
  halfLifeDays: number;
}

export function computeMemoryDecayScore(
  memory: Pick<MemoryNode, "confidence" | "createdAt">,
  options: DecayScoreOptions,
): number {
  const ageMs = Math.max(0, options.now.getTime() - memory.createdAt.getTime());
  const ageDays = ageMs / DAY_MS;
  const lambda = Math.log(2) / options.halfLifeDays;
  const recencyFactor = Math.exp(-lambda * ageDays);

  return memory.confidence * recencyFactor;
}
