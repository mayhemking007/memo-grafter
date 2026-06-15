import { describe, expect, it } from "vitest";
import {
  ConflictDetectionPass,
  DecayScoringPass,
  GrafterPipeline,
  IngestPipeline,
  MemoGrafterCrawler,
  RetrieverPipeline,
  VersioningPass,
} from "../../../src/index.js";
import { ConflictDetectionPass as DirectConflictDetectionPass } from "../../../src/maintenance/ConflictDetectionPass.js";
import { DecayScoringPass as DirectDecayScoringPass } from "../../../src/maintenance/DecayScoringPass.js";
import { MemoGrafterCrawler as DirectMemoGrafterCrawler } from "../../../src/maintenance/MemoGrafterCrawler.js";
import { VersioningPass as DirectVersioningPass } from "../../../src/maintenance/VersioningPass.js";
import { GrafterPipeline as DirectGrafterPipeline } from "../../../src/retrieval/GrafterPipeline.js";
import { IngestPipeline as DirectIngestPipeline } from "../../../src/ingestion/conversation/IngestPipeline.js";
import { RetrieverPipeline as DirectRetrieverPipeline } from "../../../src/retrieval/RetrieverPipeline.js";

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
