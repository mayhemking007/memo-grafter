import type { TopicNode } from "../core/types.js";

export function formatCompressedTopic(node: TopicNode): string {
  return `[Topic: ${node.label}] ${node.summary}`;
}
