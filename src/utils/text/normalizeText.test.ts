import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalizeText.js";

describe("normalizeText", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  hello world  ")).toBe("hello world");
  });

  it("collapses repeated whitespace, newlines, and tabs", () => {
    expect(normalizeText("hello   \n\t world")).toBe("hello world");
  });

  it("preserves meaningful text", () => {
    expect(normalizeText("keep these words")).toBe("keep these words");
  });

  it("returns null for an empty string", () => {
    expect(normalizeText("")).toBeNull();
  });

  it("returns null for whitespace-only strings", () => {
    expect(normalizeText(" \n\t ")).toBeNull();
  });

  it("preserves punctuation and casing", () => {
    expect(normalizeText("  Hello, WORLD! Isn't this fine?  ")).toBe("Hello, WORLD! Isn't this fine?");
  });
});
