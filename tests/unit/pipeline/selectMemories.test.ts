import { describe, expect, it } from "vitest";
import type { MemoryNodeInsert } from "../../../src/core/types.js";
import { selectMemories } from "../../../src/ingestion/selectMemories.js";

function candidate(value: string, salience = 0.5, memoryType: MemoryNodeInsert["memoryType"] = "fact"): MemoryNodeInsert {
  return { value, subject: "Project", predicate: "decision", memoryType, quality: { explicitness: 0.9, sourceReliability: 0.9, stability: 0.9, salience } } as MemoryNodeInsert;
}

describe("document candidate selection", () => {
  it("selects the strongest duplicate and preserves the winning provenance object", () => {
    const weak = candidate("Ship  on Friday", 0.2), strong = candidate("Ship on Friday", 0.9);
    const result = selectMemories([[weak], [strong]], { deduplicate: true });
    expect(result.groups).toEqual([[], [strong]]);
    expect(result.groups[1]![0]).toBe(strong);
    expect(result.deduplicated).toBe(1);
  });
  it("preserves negations, dates, case, conflicting facts, and decisions", () => {
    const values = ["Ship on Friday", "Do not ship on Friday", "Ship on 2026-10-01", "Ship on 2026-10-02", "Budget is 10", "Budget is 100", "Approved", "Proposed", "US", "us"];
    const result = selectMemories([values.map((value) => candidate(value))], { deduplicate: true });
    expect(result.selected).toBe(values.length);
    expect(result.deduplicated).toBe(0);
  });
  it("applies global and per-segment limits without favoring early segments", () => {
    const a = candidate("A", 0.1), b = candidate("B", 0.8), c = candidate("C", 0.9), d = candidate("D", 1);
    const result = selectMemories([[a, b], [c, d]], { maxPerSegment: 1, maxPerDocument: 2 });
    expect(result.groups).toEqual([[b], [d]]);
    expect(result.budgetExcluded).toBe(2);
  });
  it("uses type preference and source order for ties, retaining original write order", () => {
    const fact = candidate("Fact"), task = candidate("Task", 0.5, "task"), task2 = candidate("Task 2", 0.5, "task");
    expect(selectMemories([[fact, task, task2]], { maxPerDocument: 1, preferredTypes: ["task"] }).groups).toEqual([[task]]);
    expect(selectMemories([[fact, task, task2]]).groups).toEqual([[fact, task, task2]]);
    expect(selectMemories([[fact, task]], { maxPerDocument: 0 }).selected).toBe(0);
  });
});
