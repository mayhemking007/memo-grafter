import { describe, expect, it } from "vitest";
import { normalizeTags } from "../../../src/utils/tags.js";

describe("normalizeTags", () => {
  it("trims, lowercases, sorts, and deduplicates tags", () => {
    expect(normalizeTags([
      " Project:Memo-Grafter ",
      "planning",
      "PLANNING",
      "",
      "  ",
      "week:2026-05-25",
    ])).toEqual([
      "planning",
      "project:memo-grafter",
      "week:2026-05-25",
    ]);
  });

  it("returns an empty array when no tags are provided", () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});
