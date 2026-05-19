import type { TopicNode } from "../../types.js";
import { cosineSimilarity } from "./cosineSimilarity.js";

export function findReentryNodeId(
  embedding: number[],
  existingNodes: TopicNode[],
  reentryThreshold: number,
): string | null {
  for (const node of existingNodes) {
    const similarity = cosineSimilarity(embedding, node.embedding);
    if (similarity >= reentryThreshold) return node.id;
  }

  return null;
}
