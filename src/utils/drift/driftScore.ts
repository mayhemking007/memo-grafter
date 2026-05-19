import type { Message } from "../../types.js";
import { cosineSimilarity } from "./cosineSimilarity.js";
import { structuralMultiplier } from "./driftMarkers.js";

export function computeDriftScore(
  currentEmbedding: number[],
  currentMessage: Message,
  centroidEmbedding: number[],
  previousEmbedding: number[] | null,
  threshold: number,
): number {
  const tokenEstimate = currentMessage.content.trim().split(/\s+/).filter(Boolean).length;
  const lengthWeight = Math.min(1, tokenEstimate / 20);
  const centroidDrift = (1 - cosineSimilarity(centroidEmbedding, currentEmbedding)) * lengthWeight;
  const pointDrift = previousEmbedding ? 1 - cosineSimilarity(previousEmbedding, currentEmbedding) : 0;
  const sharpShiftBoost = pointDrift > threshold * 1.5 ? pointDrift * 0.3 : 0;

  return (centroidDrift + sharpShiftBoost) * structuralMultiplier(currentMessage.content);
}
