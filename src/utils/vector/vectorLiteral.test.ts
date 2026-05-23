import { describe, expect, it } from "vitest";
import { parseVector, toVectorLiteral } from "./vectorLiteral.js";

describe("toVectorLiteral", () => {
  it("converts a numeric vector into a pgvector literal", () => {
    expect(toVectorLiteral([1, 2, 3])).toBe("[1,2,3]");
  });

  it("handles decimal numbers", () => {
    expect(toVectorLiteral([1.25, 0.5, 3.75])).toBe("[1.25,0.5,3.75]");
  });

  it("handles negative numbers", () => {
    expect(toVectorLiteral([-1, -2.5, 3])).toBe("[-1,-2.5,3]");
  });

  it("throws for an empty vector", () => {
    expect(() => toVectorLiteral([])).toThrow("Cannot serialize an empty embedding.");
  });

  it("documents current behavior for non-finite values", () => {
    expect(toVectorLiteral([Number.NaN, Infinity, -Infinity])).toBe("[NaN,Infinity,-Infinity]");
  });
});

describe("parseVector", () => {
  it("parses a pgvector literal into numbers", () => {
    expect(parseVector("[1,2.5,-3]")).toEqual([1, 2.5, -3]);
  });

  it("filters non-finite values from strings", () => {
    expect(parseVector("[NaN,Infinity,-Infinity,4]")).toEqual([4]);
  });
});
