import { describe, expect, it } from "vitest";
import {
  GrafterPipeline,
  IngestPipeline,
  RetrieverPipeline,
} from "../../src/index.js";
import { GrafterPipeline as DirectGrafterPipeline } from "../../src/pipeline/GrafterPipeline.js";
import { IngestPipeline as DirectIngestPipeline } from "../../src/pipeline/IngestPipeline.js";
import { RetrieverPipeline as DirectRetrieverPipeline } from "../../src/pipeline/RetrieverPipeline.js";

describe("public pipeline exports", () => {
  it("exports pipeline classes from the package entrypoint", () => {
    expect(GrafterPipeline).toBe(DirectGrafterPipeline);
    expect(IngestPipeline).toBe(DirectIngestPipeline);
    expect(RetrieverPipeline).toBe(DirectRetrieverPipeline);
  });
});
