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