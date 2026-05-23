import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./cosineSimilarity.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("handles opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it("handles decimal values", () => {
    expect(cosineSimilarity([0.5, 1.5], [1.5, 0.5])).toBeCloseTo(0.6);
  });

  it("returns NaN when a zero vector is provided", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBeNaN();
    expect(cosineSimilarity([0, 0], [0, 0])).toBeNaN();
  });

  it("documents current behavior for mismatched vector lengths", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 99])).toBe(1);
    expect(cosineSimilarity([1, 0, 1], [1, 0])).toBeNaN();
  });
});
