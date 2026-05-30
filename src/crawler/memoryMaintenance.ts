import type { MemoryNode } from "../types.js";

export interface MemoryConflictGroup {
  key: string;
  nodes: MemoryNode[];
}

export function normalizeMemoryPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findMemoryConflictGroups(memories: MemoryNode[]): MemoryConflictGroup[] {
  const activeMemories = memories.filter((memory) => !memory.decayed && memory.supersededBy == null);
  const byFactKey = new Map<string, MemoryNode[]>();

  for (const memory of activeMemories) {
    const key = [
      memory.sessionId,
      normalizeMemoryPart(memory.subject),
      normalizeMemoryPart(memory.predicate),
    ].join("\u0000");
    const group = byFactKey.get(key);

    if (group) {
      group.push(memory);
    } else {
      byFactKey.set(key, [memory]);
    }
  }

  return [...byFactKey.entries()]
    .filter(([, nodes]) => new Set(nodes.map((node) => normalizeMemoryPart(node.value))).size > 1)
    .map(([key, nodes]) => ({ key, nodes }));
}

export function getNewestMemoryNode(nodes: MemoryNode[]): MemoryNode | null {
  return [...nodes].sort(compareNewestFirst)[0] ?? null;
}

export function compareNewestFirst(left: MemoryNode, right: MemoryNode): number {
  const timeDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (timeDelta !== 0) return timeDelta;

  return right.id.localeCompare(left.id);
}

export function getSkippedMaintenanceCounts(memories: MemoryNode[]): {
  skippedDecayed: number;
  skippedSuperseded: number;
} {
  return {
    skippedDecayed: memories.filter((memory) => memory.decayed).length,
    skippedSuperseded: memories.filter((memory) => memory.supersededBy != null).length,
  };
}
