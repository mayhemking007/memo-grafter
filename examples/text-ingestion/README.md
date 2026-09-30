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

### Selecting document memories and limiting provider work

Text ingestion extracts candidates across the current document before embedding memories. Opt into selection limits:

```ts
await memo.ingestText(markdown, sessionId, {
  chunking: { strategy: "section", maxCharacters: 3000 },
  segmentation: { strategy: "per-chunk" },
  memoryBudget: {
    maxPerSegment: 4,
    maxPerDocument: 12,
    deduplicate: true,
    preferredTypes: ["task", "fact", "insight"],
  },
  concurrency: { extraction: 2, embedding: 4 },
  qualityPolicy: { mode: "enforce", minExplicitness: 0.65 },
});
```

Budgets are non-negative integers; zero means no memory embeddings or inserts, while topics are still produced. Omitted budgets are unlimited and deduplication defaults to off. Existing quality policies retain their observe/enforce behavior. Budget validation occurs before replacement clears a session. These controls also pass through agent text ingestion and queued text jobs.

Candidates first pass schema/provenance validation and quality admission. Ranking uses salience × 0.4 + explicitness × 0.25 + stability × 0.2 + source reliability × 0.15. Type preferences break equal-score ties, followed by source order. Textual deduplication compares memory type, subject, predicate, and value after Unicode NFC and whitespace normalization. It intentionally preserves case, punctuation, negations, dates, numbers, decisions, and conflicting values; paraphrases are not deduplicated. The highest-ranked equivalent retains its original provenance. Per-segment and document caps then select candidates, with embeddings and writes restored to source order. Rejected, duplicate, and over-budget memories incur no memory embedding calls.

Instance-wide provider ceilings live in `MemoGrafterConfig.ingestion.concurrency` (defaults: extraction 2, embedding 8). Per-call concurrency can lower the effective limit; it cannot exceed the instance ceiling. Shared schedulers cover nested ingestion calls, drift ambiguity requests, topic classification, and overlapping imports on the same instance. Separate instances/processes have separate limits. Retrieval and other non-ingestion operations are outside this scheduler. Limits count in-flight requests, not tokens or requests per minute.

Adapters may implement `embedMany(texts, operationOptions?)`, returning vectors in input order. Ingestion uses batches of at most 32 inputs and validates count, dimensions when declared, and finite vector values. OpenAI's adapter restores response indexes explicitly. Custom adapters must preserve input order. Without batch support, individual requests use the same embedding limiter. Batch failures are never retried as individual calls. Topic embedding failures fail ingestion; memory embedding failures retain the existing best-effort behavior for the affected segment and emit a warning. Batch size bounds input count, not provider token limits.

`diagnostics.onMemorySelection(stats)` receives an end-of-attempt snapshot for nonempty documents, including failed attempts:

| Field | Meaning |
| --- | --- |
| `extracted` | Raw memory items returned by successful extraction responses |
| `rejected` | Schema, provenance, or enforced quality rejections |
| `deduplicated` | Equivalent candidates removed before budgets |
| `budgetExcluded` | Remaining candidates excluded by either budget |
| `selected` | Candidates selected for memory embedding |
| `acknowledged` | Candidates submitted in successful memory insert calls, including reinforcement |
| `persisted` | Newly inserted rows; PostgreSQL reports the exact count, custom stores returning void yield null after successful writes |

Embedding or persistence failures can make acknowledged/persisted counts lower than selected. Counts describe this attempt and are not stored as durable receipts. Optional store insert results use `{ inserted: number }`; existing `Promise<void>` stores remain compatible. No database migration is required.

Run `npm run benchmark:document-ingestion` for a credential-free, deterministic provider simulation comparing sequential preparation with selection, bounded work, and batching. Its elapsed times are synthetic, not predictions of live provider latency.
