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

## [0.2.7] - 2026-06-04

### Added

- Added `graftByRelevance()` for semantic selective grafting without requiring explicit topic node IDs.
- Added configurable graft selection controls including relevance-based seed node discovery, similarity filtering, and graph expansion options.
- Added streaming support to `OpenAIAdapter` with optional token callbacks for real-time response generation.

## [0.2.8] - 2026-06-09

### Added

- Added `getMemoryHistory()` API to inspect memory evolution, supersession chains, and historical fact updates.
- Added manual memory pruning APIs for explicit memory removal and suppression.
- Added graph-level support for reviewing active, superseded, and historical memory states.

## [0.3.0] - 2026-06-16

### Added

- Added `agent.remember()` API for direct memory injection without requiring conversational ingestion.
- Added CLI foundation with `npx memo-grafter init` and `npx memo-grafter migrate` commands for project setup and schema management.
- Added shared fleet-level memory accessible across worker agents within a fleet.

### Changed

- Reorganized the source tree into dedicated `core`, `ingestion`, `retrieval`, `maintenance`, and `agents` modules.
- Refactored graph snapshot infrastructure to support upcoming browser-based session exploration and graph inspection tooling.

### Internal

- Improved project structure and module boundaries to support future CLI, fleet, and visualization capabilities.

## [0.4.0] - 2026-06-28

### Added

- Added MemoGrafter Studio with graph, tables, and Prompt Preview tabs.
- Added `memo-grafter studio` CLI command and internal Studio API.
- Added read-only table inspection and prompt preview runtime wiring.

### Changed

- Redesigned Studio graph visualization, filtering, node details, and lifecycle actions.
- Enforced explicit `init` / `migrate` setup before Studio startup.

### Internal

- Refactored Studio infrastructure for future developer tooling.

## [0.4.1] - 2026-06-28

### Added

- Added session labels and search to MemoGrafter Studio for improved workspace organization.
- Added graph search with result navigation for locating memories and topics within large session graphs.

### Changed

- Enhanced Studio graph visualization with advanced navigation, interaction, and graph exploration capabilities.
- Applied a unified visual design system across MemoGrafter Studio for a more consistent and polished user experience.