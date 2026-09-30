import type { MemoryBudget, MemoryNodeInsert } from "../core/types.js";

/** Conservative: preserve case, punctuation, negation, dates, and numeric values. */
const normalize = (value: string) => value.normalize("NFC").replace(/\s+/gu, " ").trim();
export function selectMemories(groups: MemoryNodeInsert[][], budget: MemoryBudget = {}) {
  const candidates = groups.flatMap((memories, segment) => memories.map((memory, index) => ({ memory, segment, index })));
  const score = (memory: MemoryNodeInsert) => memory.quality.salience * 0.4 + memory.quality.explicitness * 0.25 + memory.quality.stability * 0.2 + memory.quality.sourceReliability * 0.15;
  const preference = (memory: MemoryNodeInsert) => {
    const index = budget.preferredTypes?.indexOf(memory.memoryType) ?? -1;
    return index < 0 ? Infinity : index;
  };
  const ranked = [...candidates].sort((a, b) => score(b.memory) - score(a.memory) || preference(a.memory) - preference(b.memory) || a.segment - b.segment || a.index - b.index);
  const seen = new Set<string>();
  const unique = ranked.filter(({ memory }) => {
    if (!budget.deduplicate) return true;
    const key = JSON.stringify([memory.memoryType, memory.subject, memory.predicate, memory.value].map(normalize));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const selected = new Set<MemoryNodeInsert>();
  const counts = groups.map(() => 0);
  for (const { memory, segment } of unique) {
    if (selected.size >= (budget.maxPerDocument ?? Infinity) || counts[segment]! >= (budget.maxPerSegment ?? Infinity)) continue;
    selected.add(memory); counts[segment]!++;
  }
  return {
    groups: groups.map((memories) => memories.filter((memory) => selected.has(memory))),
    deduplicated: candidates.length - unique.length,
    budgetExcluded: unique.length - selected.size,
    selected: selected.size,
  };
}
