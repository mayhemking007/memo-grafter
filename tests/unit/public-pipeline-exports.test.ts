import { describe, expect, it } from "vitest";
import {
  ConflictDetectionPass,
  DecayScoringPass,
  GrafterPipeline,
  IngestPipeline,
  MemoGrafterCrawler,
  RetrieverPipeline,
  VersioningPass,
} from "../../src/index.js";
import { ConflictDetectionPass as DirectConflictDetectionPass } from "../../src/crawler/ConflictDetectionPass.js";
import { DecayScoringPass as DirectDecayScoringPass } from "../../src/crawler/DecayScoringPass.js";
import { MemoGrafterCrawler as DirectMemoGrafterCrawler } from "../../src/crawler/MemoGrafterCrawler.js";
import { VersioningPass as DirectVersioningPass } from "../../src/crawler/VersioningPass.js";
import { GrafterPipeline as DirectGrafterPipeline } from "../../src/pipeline/GrafterPipeline.js";
import { IngestPipeline as DirectIngestPipeline } from "../../src/pipeline/IngestPipeline.js";
import { RetrieverPipeline as DirectRetrieverPipeline } from "../../src/pipeline/RetrieverPipeline.js";

describe("public pipeline exports", () => {
  it("exports pipeline classes from the package entrypoint", () => {
    expect(GrafterPipeline).toBe(DirectGrafterPipeline);
    expect(IngestPipeline).toBe(DirectIngestPipeline);
    expect(RetrieverPipeline).toBe(DirectRetrieverPipeline);
    expect(MemoGrafterCrawler).toBe(DirectMemoGrafterCrawler);
    expect(ConflictDetectionPass).toBe(DirectConflictDetectionPass);
    expect(DecayScoringPass).toBe(DirectDecayScoringPass);
    expect(VersioningPass).toBe(DirectVersioningPass);
  });
});
