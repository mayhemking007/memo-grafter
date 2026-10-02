# Structured ingestion benchmark

Run with `MEMOGRAFTER_DOCUMENT_TEST_DB` pointing at a disposable PostgreSQL/pgvector database:

```sh
npm run benchmark:structured-ingestion
```

The script creates an isolated schema, migrates it, and removes only that schema afterward. Input is eight explicit sections containing four sentences each. Providers are deterministic with a simulated 5 ms request delay and 1536-dimensional embeddings. All modes expose batch embeddings. Optimized modes use explicit per-chunk segmentation, textual deduplication, and a six-memory budget. Reported database operations include ingestion bookkeeping and graph work, excluding setup and result inspection. Three samples per mode produce median duration/DB-operation counts.

Local measurement on Node v22.14.0 and Docker PostgreSQL/pgvector:

| Mode | Extraction requests | Embedding requests | Embedded inputs | DB operations | Median ms | Memories | Source spans |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy text | 1 | 3 | 39 | 102 | 179 | 6 | 0 |
| Configured text | 8 | 2 | 14 | 134 | 227 | 6 | 0 |
| Structured, batch size 1 | 8 | 2 | 14 | 144 | 285 | 6 | 48 |
| Structured, batch size 100 | 8 | 2 | 14 | 130 | 276 | 6 | 48 |

Batching reduced database operations by 14 (9.7%) with the same providers, memories, and source spans. The simulated embeddings are identical, so legacy drift segmentation produces one segment; explicit segmentation produces eight. Consequently this is not a claim that structured ingestion always makes fewer extraction calls or runs faster than legacy ingestion. Durable acceptance, checkpointing, and source retention have costs. Provider latency, document structure, database placement, and real extraction quality can change the results. Timing is observational, not a test threshold; the benchmark asserts retained-memory parity and fewer operations with batching.
