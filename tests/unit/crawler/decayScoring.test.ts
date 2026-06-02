import { describe, expect, it } from "vitest";
import { computeMemoryDecayScore } from "../../../src/crawler/decayScoring.js";

describe("computeMemoryDecayScore", () => {
  const now = new Date("2026-01-31T00:00:00.000Z");

  it("returns full confidence when the memory has no age", () => {
    const score = computeMemoryDecayScore(
      { confidence: 0.8, createdAt: now },
      { now, halfLifeDays: 30 },
    );

    expect(score).toBeCloseTo(0.8);
  });

  it("returns half confidence after one half-life", () => {
    const score = computeMemoryDecayScore(
      { confidence: 0.8, createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { now, halfLifeDays: 30 },
    );

    expect(score).toBeCloseTo(0.4);
  });

  it("returns quarter confidence after two half-lives", () => {
    const score = computeMemoryDecayScore(
      { confidence: 0.8, createdAt: new Date("2025-12-02T00:00:00.000Z") },
      { now, halfLifeDays: 30 },
    );

    expect(score).toBeCloseTo(0.2);
  });

  it("multiplies the recency factor by the memory confidence", () => {
    const score = computeMemoryDecayScore(
      { confidence: 0.5, createdAt: new Date("2026-01-16T00:00:00.000Z") },
      { now, halfLifeDays: 30 },
    );

    expect(score).toBeCloseTo(0.5 * Math.sqrt(0.5));
  });

  it("treats future memories as age zero", () => {
    const score = computeMemoryDecayScore(
      { confidence: 0.7, createdAt: new Date("2026-02-15T00:00:00.000Z") },
      { now, halfLifeDays: 30 },
    );

    expect(score).toBeCloseTo(0.7);
  });
});
