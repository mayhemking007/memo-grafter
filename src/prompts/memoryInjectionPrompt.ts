import type { Message, TopicNode } from "../types.js";

export function buildMemoryInjectionPrompt(blocks: string[]): string {
  return [
    "MemoGrafter retrieved memory context:",
    "Use these memories as prior conversation context when answering the user.",
    "If the user asks what you remember, answer from these memories instead of saying you have no record.",
    "",
    blocks.join("\n---\n"),
  ].join("\n");
}

export function formatMemoryNode(node: TopicNode, messages: Message[]): string {
  const context = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return `[Topic: ${node.label}]\nSummary: ${node.summary}\nContext:\n${context}`;
}
