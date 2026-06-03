# Changelog

All notable changes to this project will be documented here.

## [0.1.1] - 2026-05-14

### Added

- Anthropic adapter support

### Changed

- Refactored prompts into dedicated prompts folder structure

## [0.2.0] - 2026-05-20

### Added

- Gemini adapter support
- Atomic fact extraction and storage as a second memory graph layer
- RetrieverPipeline for semantic fact retrieval and recall workflows

### Changed

- Redesigned drift detection with multi-signal scoring and adaptive thresholds
- Introduced pluggable `GraphStore` interface for future database/vector store extensibility

### Internal

- Refactored reusable domain utilities out of pipeline classes
- Removed mid-session graph injection from invoke pipeline
- Added Vitest unit testing setup

## [0.2.1] - 2026-05-22

### Added

- Optional Redis cache layer for `recall()` results
- Exposed pipeline classes and `PostgresGraphStore` as public API components

### Changed

- Integrated `recall()` into `buildHistory()` for context window overflow handling

## [0.2.2] - 2026-05-22

### Added

- Added `getGraphSnapshot()` method for retrieving a snapshot of the current session graph, including memory state and graph structure

## [0.2.3] - 2026-05-28

### Fixed

- Ensured grafted memories reach the LLM in the default `invoke()` path
- Preserved grafted memory across ingest rebuilds

### Changed

- Made `IngestPipeline` incremental using ingest cursors to avoid full-history rebuilds and improve memory durability

## [0.2.4] - 2026-05-30

### Added

- Added `MemoGrafterCrawler` maintenance passes for deterministic conflict detection, memory versioning, and decay scoring.
- Added memory lifecycle annotations including `hasConflict`, `supersededBy`, and `decayed`, plus `conflicts` and `updates` memory edges.

### Changed

- Updated graph snapshots and graft prompts so conflicted, superseded, and decayed memory state is visible and active facts are preferred over stale summaries.

## [0.2.5] - 2026-06-01

### Added

- Added session tagging and filtered memory retrieval for scoped memory organization and targeted recall.
- Added confidence-weighted ranking to semantic retrieval for improved memory selection quality.
- Added adaptive drift sensitivity tuning for dynamic topic boundary detection.

### Fixed

- Prevented false-positive conflict detection caused by broad topic memories.

## [0.2.6] - 2026-06-03

### Added

- Added `ingestText()` API for ingesting non-conversational text directly into the memory graph.

### Fixed

- Separated conflict detection from versioning classification to improve memory lifecycle accuracy and prevent incorrect conflict annotations.