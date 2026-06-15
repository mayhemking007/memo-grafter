import type { Message } from "../../core/types.js";
import { cosineSimilarity } from "../drift/cosineSimilarity.js";
import { isMeaningfulReentryMessage } from "./reentryText.js";
import type { ReentrySegmentRange } from "./types.js";

export function segmentUserEmbeddings(
  segment: ReentrySegmentRange,
  messages: Message[],
  embeddings: number[][],
): number[][] {
  const segmentEmbeddings: number[][] = [];

  for (let index = segment.start; index <= segment.end; index += 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (!isMeaningfulReentryMessage(message)) continue;

    const embedding = embeddings[index];
    if (embedding) segmentEmbeddings.push(embedding);
  }

  return segmentEmbeddings;
}

export function maxPairwiseSimilarity(left: number[][], right: number[][]): number {
  let best = -Infinity;

  for (const leftEmbedding of left) {
    for (const rightEmbedding of right) {
      best = Math.max(best, cosineSimilarity(leftEmbedding, rightEmbedding));
    }
  }

  return best;
}
