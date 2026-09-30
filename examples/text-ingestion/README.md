# Text Ingestion Example

This example ingests editor or document text into MemoGrafter without generating an assistant response.

```ts
await agent.ingestText(editorContent, {
  replace: true,
  label: "Morning entry",
  source: "classic-editor",
});
```

Use `replace: true` when each call contains the complete current document, such as a debounced editor autosave. Omit it when importing text incrementally.

Run from the repository root after configuring `DATABASE_URL` and `OPENAI_API_KEY`:

```bash
npx memo-grafter migrate
npx tsx --env-file=.env examples/text-ingestion/src/index.ts
```

### Document chunking and segmentation

Existing calls without new controls retain sentence chunking and a minimum of one chunk per drift segment. To preserve document structure, opt in:

```ts
await memo.ingestText(markdown, sessionId, {
  chunking: {
    strategy: "section",
    targetCharacters: 1800,
    maxCharacters: 3000,
    maxChunks: 8,
    preserveHeadings: true,
  },
  segmentation: { strategy: "drift", minChunks: 2, maxTopics: 8 },
});
```

The same options work on `agent.ingestText(text, options)` and queued ingestion.

| Control | Behavior |
| --- | --- |
| `sentence` | Legacy normalized sentences by default; explicit character controls use source-preserving sentence boundaries. |
| `paragraph` | Pack paragraphs toward the target, keeping list and fenced-code blocks intact when they fit. |
| `section` | Markdown ATX headings start sections; paragraphs within a section pack toward the target. Headings inside fenced code are ignored. |
| `fixed` | Character windows; `overlapCharacters` defaults to zero and must be smaller than the window. |
| `single` chunking | Entire document is one chunk; reject if it exceeds an explicit character limit. |
| `drift` | Detect topic changes using embeddings and the configured minimum. |
| `per-chunk` | One segment per chunk; reject when chunk count exceeds `maxTopics`. |
| `single` segmentation | One segment spanning all document chunks. |

`targetCharacters` is a soft packing target (default 1800, reduced to an explicit smaller maximum). It is the window size in fixed mode. Blocks can exceed the target, but never an explicit `maxCharacters`. Oversized blocks split to satisfy that hard maximum. Sizes use JavaScript UTF-16 units; splitting preserves surrogate pairs. Fixed overlap may shorten at a Unicode boundary to preserve characters and forward progress.

`maxChunks` merges adjacent chunks that fit `maxCharacters`; if merging is insufficient, content is repartitioned within the hard maximum. Impossible combinations throw `INPUT_INVALID` without truncating content. Overlapping windows may merge when a chunk cap requires it. No hard size/count limit is imposed unless supplied. Blank input remains a no-op, but options are still validated.

`maxTopics` caps this document's extraction segments, not all topics already stored in the session. Drift mode merges at the weakest adjacent boundaries to meet the cap; topic reuse can yield fewer distinct topics. Explicit segmentation skips drift embeddings and drift-based reentry detection, while retaining topic/memory embeddings and other graph processing.

The drift minimum resolves from `segmentation.minChunks`, then `minSegmentMessages`, then the instance configuration when chunking/segmentation controls are present; otherwise the legacy minimum is one. Conflicting explicit minimums are rejected. Minimums apply only to drift mode; a trailing remainder can be shorter. Chunk caps and topic caps take precedence over soft targets and boundaries.

Chunk preparation retains original source offsets and heading hierarchy internally. `preserveHeadings: false` disables the additional heading-context metadata; source heading text is always retained. Offsets and heading metadata are not yet persisted or exposed through memory provenance. This is Markdown-aware splitting, not a full Markdown parser.

Validation and chunk planning occur before replacement clears a session. `replace: true` still replaces the entire session; this phase does not change persistence or rollback semantics.
