import type { MemoryNode } from "../types.js";

export interface MemoryConflictGroup {
  key: string;
  nodes: MemoryNode[];
}

interface ConflictGrouping {
  key: string;
  value: string;
}

export function normalizeMemoryPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findMemoryConflictGroups(memories: MemoryNode[]): MemoryConflictGroup[] {
  const byFactKey = new Map<string, Array<{ memory: MemoryNode; value: string }>>();

  for (const memory of memories) {
    if (memory.decayed || memory.supersededBy != null) continue;

    const grouping = getConflictGrouping(memory);
    if (!grouping) continue;

    const key = grouping.key;
    const group = byFactKey.get(key);
    const item = {
      memory,
      value: grouping.value,
    };

    if (group) {
      group.push(item);
    } else {
      byFactKey.set(key, [item]);
    }
  }

  return [...byFactKey.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.value)).size > 1)
    .map(([key, items]) => ({
      key,
      nodes: items.map((item) => item.memory),
    }));
}

export function isBroadTopicMemory(memory: Pick<MemoryNode, "subject" | "predicate">): boolean {
  return GENERIC_SUBJECTS.has(normalizeMemoryPart(memory.subject))
    && GENERIC_PREDICATES.has(normalizeMemoryPart(memory.predicate));
}

function getConflictGrouping(memory: MemoryNode): ConflictGrouping | null {
  if (isBroadTopicMemory(memory)) {
    return getBroadTopicConflictGrouping(memory);
  }

  return {
    key: [
      memory.sessionId,
      normalizeMemoryPart(memory.subject),
      normalizeMemoryPart(memory.predicate),
    ].join("\u0000"),
    value: normalizeMemoryPart(memory.value),
  };
}

function getBroadTopicConflictGrouping(memory: MemoryNode): ConflictGrouping | null {
  const value = normalizeMemoryPart(memory.value);
  const destination = extractTravelPlanDestination(value);
  if (!destination) return null;

  return {
    key: [memory.sessionId, "broad-topic", "travel-trip-plan"].join("\u0000"),
    value: destination,
  };
}

function extractTravelPlanDestination(value: string): string | null {
  if (!/\b(trip|travel|itinerary|vacation|holiday)\b/.test(value)) {
    return null;
  }

  const destinationPatterns = [
    /\b(?:to|for|in)\s+([a-z][a-z\s]+?)(?:\s+(?:trip|travel|itinerary|plan|planning|vacation|holiday)\b|$)/,
    /^([a-z][a-z\s]+?)\s+(?:trip|travel|itinerary|plan|planning|vacation|holiday)\b/,
  ];

  for (const pattern of destinationPatterns) {
    const destination = value.match(pattern)?.[1]?.trim();
    if (destination) return destination;
  }

  return null;
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

const GENERIC_SUBJECTS = new Set([
  "conversation",
  "memory",
  "plan",
  "request",
  "topic",
  "user",
]);

const GENERIC_PREDICATES = new Set([
  "asked about",
  "asked_about",
  "asks about",
  "asks_about",
  "discussed",
  "interested in",
  "interested_in",
  "is",
  "mentioned",
  "plan",
  "wants",
]);
