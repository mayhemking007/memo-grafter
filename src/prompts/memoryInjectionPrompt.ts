import type { MemoryNode, Message, TopicNode } from "../types.js";

export function buildMemoryInjectionPrompt(blocks: string[]): string {
  return [
    "MemoGrafter retrieved memory context:",
    "Use these memories as prior conversation context when answering the user.",
    "If the user asks what you remember, answer from these memories instead of saying you have no record.",
    "",
    blocks.join("\n---\n"),
  ].join("\n");
}

export interface MemoryMaintenancePromptContext {
  notes?: string[];
  activeMemories?: MemoryNode[];
}

export function formatMemoryNode(
  node: TopicNode,
  messages: Message[],
  maintenance: MemoryMaintenancePromptContext = {},
): string {
  const context = messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const maintenanceBlock = formatMaintenanceBlock(maintenance);

  return [
    `[Topic: ${node.label}]`,
    `Summary: ${node.summary}`,
    maintenanceBlock,
    `Context:\n${context}`,
  ].filter(Boolean).join("\n");
}

function formatMaintenanceBlock(maintenance: MemoryMaintenancePromptContext): string {
  const lines: string[] = [];

  if (maintenance.notes && maintenance.notes.length > 0) {
    lines.push("Memory maintenance notes:");
    for (const note of maintenance.notes) {
      lines.push(`- ${note}`);
    }
  }

  const activeMemories = maintenance.activeMemories?.filter((memory) =>
    !memory.decayed && memory.supersededBy == null
  ) ?? [];
  if (activeMemories.length > 0) {
    lines.push("Active memory facts:");
    for (const memory of activeMemories) {
      lines.push(`- ${memory.subject} ${memory.predicate}: ${memory.value}`);
    }
  }

  return lines.join("\n");
}
