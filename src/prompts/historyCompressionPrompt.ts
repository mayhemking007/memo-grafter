import type { TopicNode } from "../types.js";

export function formatCompressedTopic(node: TopicNode): string {
  return `[Topic: ${node.label}] ${node.summary}`;
}
