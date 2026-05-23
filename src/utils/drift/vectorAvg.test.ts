import { describe, expect, it } from "vitest";
import { avg } from "./vectorAvg.js";

describe("avg", () => {
  it("averages multiple vectors", () => {
    expect(avg([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ])).toEqual([4, 5, 6]);
  });

  it("works with a single vector", () => {
    expect(avg([[2, 4, 6]])).toEqual([2, 4, 6]);
  });

  it("handles decimal values", () => {
    const result = avg([
      [0.1, 0.2],
      [0.2, 0.4],
    ]);

    expect(result[0]).toBeCloseTo(0.15);
    expect(result[1]).toBeCloseTo(0.3);
  });

  it("throws for empty input", () => {
    expect(() => avg([])).toThrow();
  });

  it("documents current behavior for mismatched vector lengths", () => {
    expect(avg([
      [2, 4],
      [4],
    ])).toEqual([3, 2]);

    expect(avg([
      [2],
      [4, 6],
    ])).toEqual([3, 3]);
  });
});
