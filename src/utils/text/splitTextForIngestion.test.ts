import { describe, expect, it } from "vitest";
import { splitTextForIngestion } from "./splitTextForIngestion.js";

describe("splitTextForIngestion", () => {
  it("splits raw text by lines and sentence boundaries", () => {
    expect(splitTextForIngestion([
      "The roadmap prioritizes imports. The editor autosaves drafts.",
      "",
      "Hiring plans begin next quarter.",
    ].join("\n"))).toEqual([
      "The roadmap prioritizes imports.",
      "The editor autosaves drafts.",
      "Hiring plans begin next quarter.",
    ]);
  });

  it("returns no chunks for whitespace-only text", () => {
    expect(splitTextForIngestion(" \n \t ")).toEqual([]);
  });
});
