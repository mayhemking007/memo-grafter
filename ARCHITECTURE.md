# MemoGrafter Architecture

This document describes the high-level architecture and core design of memo-grafter. It is intended for contributors and coding agents who need to understand how the main pieces fit together without duplicating setup or API usage details from `README.md` and `USER_GUIDE.md`.

## System Overview

MemoGrafter is a server-side TypeScript memory framework for chatbot applications. It records conversation turns, groups them into topic segments, extracts structured memory, stores topic and memory graphs, and later retrieves or grafts relevant memory into another prompt or session.

The main runtime layers are:

- `MemoGrafterAgent`: the high-level conversational wrapper used by most applications.
- `MemoGrafter`: the internal coordinator that wires storage, pipelines, adapters, optional queueing, and optional recall caching.
- Pipeline classes: ingestion, drift detection, segment processing, retrieval, and graft prompt assembly.
- `MemoGrafterCrawler`: an optional background maintenance worker for deterministic memory conflict detection and versioning.
- `GraphStore`: the persistence boundary for messages, segments, topic nodes, memory nodes, edges, graft provenance, ingest state, and fleet metadata.
- `PostgresGraphStore`: the current built-in `GraphStore` implementation, backed by PostgreSQL and `pgvector`.

At a simplified level:

```text
user / assistant messages
  -> message buffer
  -> topic drift detection
  -> topic segments
  -> topic nodes
  -> atomic memory nodes
  -> optional crawler maintenance
  -> graph edges
  -> recall, injection, or grafting
```

## Core Pipeline Flow

The default application flow starts with `MemoGrafterAgent.invoke()`:

1. The agent checks whether the session already has topic nodes in storage.
2. If graph content exists, the agent recalls relevant structured memory for the current user message.
3. The agent builds the LLM message list from an optional recalled-memory system message, a recent raw history window, and the current user message.
4. The configured `LLMAdapter` produces the assistant response.
5. The user message and assistant response are appended to session history.
6. The full history snapshot is queued for background ingestion.
7. Ingestion persists messages, processes only unprocessed message ranges, appends new graph state, and updates graph edges.

The node-count guard avoids an embed and memory search on the first turn or while async ingestion has not produced graph content. This keeps the foreground chatbot turn simple while memory construction happens after the response. Calls that need consistent memory state, such as `getActiveNodes()`, `getActiveSegments()`, `getGraphSnapshot()`, `graft()`, and `close()`, wait for pending ingestion to finish.

## Ingestion Flow

`IngestPipeline` is responsible for turning a session message history into graph state.

```text
messages + sessionId
  -> save message buffer
  -> load existing topic nodes
  -> load session ingest cursor
  -> embed each message
  -> detect topic segments for new message ranges
  -> process each new segment
  -> append temporal, semantic, and reentry edges
  -> add reentry edges when detected
```

The current ingestion model is incremental. `mg_session_ingest_state` tracks the last processed message index for each session, so repeated ingestion of the same message snapshot is a no-op for graph creation. Existing topic nodes, grafted nodes, memory nodes, and graph edges are preserved during normal `invoke()` processing. `clearSession()` remains available as an explicit reset API rather than a default ingest step.

## Main Components

### MemoGrafterAgent

`MemoGrafterAgent` is the public session-oriented wrapper around `MemoGrafter`. It owns the current session ID, in-memory chat history, base system prompt, invoke-time recall settings, recent history window size, and pending background ingestion promise.

Its responsibilities include:

- accepting user messages through `invoke()`;
- recalling relevant memory before the LLM call when the session has graph content;
- calling the configured LLM with an optional prepended recall memory block, recent raw turns, and the current user message;
- scheduling ingestion after assistant responses;
- exposing active topic nodes and segments for the current session;
- exposing a read-only graph snapshot for visualization and inspection;
- providing high-level grafting and absorbing helpers;
- providing targeted recall through `RetrieverPipeline`;
- waiting for pending ingestion before reads that depend on memory state.

`MemoGrafterAgent` is intentionally a memory-aware chatbot wrapper, not an autonomous agent runtime.

### IngestPipeline

`IngestPipeline` coordinates the write-side memory pipeline. It receives a complete message snapshot and a session ID, saves the message buffer, reads the session ingest cursor, embeds messages for the unprocessed range plus a small overlap window, delegates topic boundary detection to `TopicDriftDetector`, delegates node creation to `SegmentProcessor`, and appends graph edges.

When adaptive drift sensitivity is enabled, ingestion reads recent saved segments for the session before detection and derives a conservative per-run threshold from the configured static sensitivity. Short, consistently fragmented recent segments raise the threshold slightly; consistently long recent segments lower it slightly. The adjustment is bounded, skipped for short or unstable histories, and does not require schema changes.

It also handles reentry linking in two forms:

- matching newly detected topic boundaries back to existing durable session nodes;
- linking later segments in the current run back to earlier related segments.

### TopicDriftDetector

`TopicDriftDetector` decides where topic boundaries occur. It supports two modes:

- `intent`: evaluates user-message intent changes against the current topic embedding.
- `window`: compares moving windows of message embeddings.

Drift scoring combines embedding distance with message-level signals from the drift utilities. The detector also supports:

- minimum segment length checks to avoid over-fragmenting short runs;
- optional LLM ambiguity detection for borderline shifts;
- optional reentry detection, where a new segment is linked back to an earlier matching topic.

The output is a list of drift segments plus a reentry map used later by ingestion.

### SegmentProcessor

`SegmentProcessor` converts a detected segment into persisted graph objects.

For each segment it:

1. saves a `TopicSegment`;
2. builds a segment extraction prompt from the segment messages;
3. parses the LLM extraction into a label, summary fields, and typed memories;
4. embeds the segment summary;
5. saves a `TopicNode`;
6. embeds and inserts atomic `MemoryNode` records;
7. builds semantic memory edges inside the topic when appropriate.

The topic node is the coarse unit of conversation memory. Memory nodes are the finer-grained facts, insights, questions, tasks, or references used by targeted recall.

### GrafterPipeline

`GrafterPipeline` assembles memory injection context from selected topic nodes.

It starts from requested topic IDs, expands through graph neighbours up to the configured hop depth, orders nodes by conversation position, and formats each topic with a small configurable message buffer around its source range. It then trims from the end until the assembled system prompt fits the configured token budget.

This pipeline is used by `MemoGrafter.inject()` and `MemoGrafterAgent.graft()`. Copying memory into another session is handled by store-level node absorption, followed by edge updates.

When selected topics contain crawler-maintained conflict or version metadata, graft prompt assembly keeps the original topic summary intact and adds deterministic maintenance notes plus active memory facts. This is important because topic summaries are historical segment summaries and may contain older facts. The prompt explicitly tells downstream LLMs to prefer active memory facts over contradictory historical summary details instead of rewriting stored summaries.

Absorption copies selected topic nodes into the target session and records `grafted` edges back to their source nodes. The PostgreSQL store also copies active memory nodes attached to those topics so targeted recall can search the transferred facts. Copied memory rows get fresh IDs, preserve their embeddings, reset `superseded_by` to `NULL`, reset `decayed` to `FALSE`, and are copied only when the source memory is active.

The same store-level absorption path inserts `mg_graft_registry` rows for copied topic nodes. Keeping registry writes in `PostgresGraphStore.absorbNodes()` means `MemoGrafterAgent`, direct graft ingestion, and fleet grafting all get provenance tracking without duplicating logic.

### GraphStore

`GraphStore` is the persistence interface used by the core and pipeline layers. It keeps storage-specific concerns out of the orchestration code.

The interface covers:

- initialization and shutdown;
- message buffer persistence;
- segment, topic node, and topic edge persistence;
- memory node insertion, memory lookup, and memory edge construction;
- session snapshot reads for topic edges, memory nodes, and memory edges;
- memory maintenance reads and annotations for crawler passes;
- session topic-node counts for invoke-time recall guards;
- session ingest cursor reads and writes for incremental ingestion;
- vector similarity queries for topic and memory retrieval;
- graph neighbourhood traversal;
- grafted node absorption, provenance registry reads, and graft node deletion;
- fleet and agent metadata;
- explicit session clearing.

The built-in `PostgresGraphStore` creates and manages the current schema, including `mg_message_buffer`, `mg_segments`, `mg_topic_nodes`, `mg_topic_edges`, `mg_memory_nodes`, `mg_memory_edges`, `mg_session_ingest_state`, `mg_graft_registry`, `mg_fleets`, and `mg_fleet_agents`.

`MemoGrafterAgent.getGraphSnapshot()` is a read-side convenience over this storage boundary. It returns the current session ID, active topic nodes, optional snapshot node wrappers with graft provenance, topic edges that touch the session's nodes, all memory nodes for the session, memory edges that touch those memories, and an ISO capture timestamp. It does not include `mg_message_buffer` content, rendering metadata, layout information, or color decisions. Unlike targeted recall, snapshot memory reads intentionally include decayed, conflicted, and superseded memory rows so callers such as visualizers can decide what to show.

### MemoGrafterCrawler

`MemoGrafterCrawler` is an optional graph maintenance worker. It can be run manually with `runOnce()` or scheduled in-process with `start()` and `stop()`. The crawler does not require Redis or queues, and `intervalMs` only controls the recurring loop started by `start()`; it has no effect on a direct `runOnce()` call.

The built-in maintenance passes are deterministic:

- `ConflictDetectionPass` groups active memories by session, normalized `subject`, and normalized `predicate`. A group conflicts when it contains different normalized `value` strings. Decayed memories and already superseded memories are skipped.
- `VersioningPass` runs over the same conflict groups, picks the newest memory by `createdAt`, falls back to deterministic ID ordering on ties, marks older memories with `superseded_by`, and creates version edges.
- `DecayScoringPass` scores non-superseded active memories with confidence-weighted exponential recency decay. Memories whose score falls below the configured threshold are marked `decayed = TRUE`.

Conflict grouping treats broad topic memories carefully when both the subject and predicate are generic, such as `user asked_about ...` or `conversation discussed ...`. Most broad topic rows are skipped because they describe what was discussed rather than mutually exclusive fact slots. Recognized travel destination plan rows are partitioned into a deterministic `travel-trip-plan` bucket and compared by destination, so `Goa trip plan` can conflict with `Vietnam trip plan`, while unrelated topics like `how to cook rajma chawal` or non-exclusive Vietnam subtopics do not join that conflict group.

Decay scoring uses:

```text
age_days = now - created_at
recency_factor = exp(-(ln(2) / half_life_days) * age_days)
decay_score = confidence * recency_factor
```

The crawler annotates existing memory rows and creates memory edges. It never deletes graph nodes. Conflict detection marks both sides with `has_conflict = TRUE` and creates an idempotent `conflicts` edge. Versioning creates an idempotent `updates` edge using this direction:

```text
newer_memory --updates--> older_memory
```

The original topic summaries are not rewritten. Topic summaries remain historical descriptions of the segment that produced them, while memory-node lifecycle fields and memory edges represent current fact status. The decay pass does not create edges by default; it only marks stale active memory rows as decayed. Stored extraction confidence remains unchanged unless a caller explicitly enables confidence updates on the pass.

The crawler does not delete or prune existing conflict edges. If an older version of the crawler created a false-positive edge, that edge remains historical graph data until a future explicit cleanup pass or display-side active-edge filter handles it.

## Recall Path

Targeted recall is handled by `RetrieverPipeline`, which is used by `MemoGrafterAgent.recall()`.

The recall path embeds the query, searches active memory nodes by vector similarity, filters decayed or superseded memories, combines each fact's similarity and confidence into a confidence-weighted retrieval score, groups facts by parent topic node, ranks those topic blocks by best fact retrieval score, and formats a token-budgeted system prompt.

When `cache` config is provided, `MemoGrafter` owns one shared Redis client for recall caching. `RetrieverPipeline` uses that client only around the raw memory vector search, caching the `store.searchMemories()` result before stale-memory filtering and prompt assembly. Cache keys include the session ID, `limit`, `minSimilarity`, and a short hash of the embedding: `mg:recall:${sessionId}:${limit}:${minSimilarity}:${embeddingHash}`. TTL is clamped to 60-120 seconds, defaulting to 90 seconds. Redis errors are logged as warnings and retrieval falls back to the store.

`MemoGrafterAgent.invoke()` also uses this path before each LLM call when the session has at least one topic node. It uses the current user message as the recall query, calls `recall()` with `inject.recallLimit` and `inject.recallMinSimilarity` defaults of `6` and `0.55`, injects the returned `systemPrompt` as a single prepended system message when facts are found, and keeps only the last `inject.recentWindowSize` raw messages. If the session has no topic nodes, recall returns no facts, or recall fails, the agent proceeds with raw history only and does not fail the foreground `invoke()` call.

This read-side path is separate from grafting:

- recall returns atomic memories and parent topics for a query;
- graph snapshots return raw graph inspection data for a session;
- grafting assembles broader topic context from selected topic nodes and their neighbours;
- absorbing copies selected topic nodes and their active atomic memories into another session.

Crawler versioning and decay feed this path through existing lifecycle fields. Once an older memory has `superseded_by` set, or a stale memory has `decayed = TRUE`, targeted recall and absorption treat it as inactive without needing a separate conflict-resolution step.

## Data And Graph Lifecycle

MemoGrafter stores memory in two related layers:

- Topic layer: `TopicSegment`, `TopicNode`, and `TopicEdge`.
- Memory layer: `MemoryNode` and `MemoryEdge`.

The lifecycle for a normal conversation is:

1. Raw messages are persisted in `mg_message_buffer` by session and message index.
2. Drift detection splits the message range into topic segments.
3. Each segment is saved in `mg_segments`.
4. Each segment produces one topic node in `mg_topic_nodes`.
5. Segment extraction may produce multiple memory nodes in `mg_memory_nodes`.
6. Topic edges are appended:
   - `temporal` edges link adjacent topic nodes;
   - `semantic` edges link similar topic nodes;
   - `reentry` edges link a returned topic to an earlier related topic.
7. Memory edges may link semantically related memories within a topic.
8. Grafted topic nodes are copied into a target session, registered in `mg_graft_registry`, linked to their source with `grafted` edges, and accompanied by copies of active memory nodes when those memories exist.
9. Optional crawler passes can annotate active memory nodes with `has_conflict`, set `superseded_by` on older conflicting facts, mark stale active facts as `decayed`, and add `conflicts` or `updates` edges in `mg_memory_edges`.

During normal ingestion, existing graph state is not cleared. New topic nodes and memory nodes are appended after the stored ingest cursor, and new edges can connect them to prior native or grafted nodes. `clearSession()` is an explicit destructive reset for callers that intentionally want to remove stored session memory.

## Current Architecture Decisions

- **Server-only runtime:** `MemoGrafter` checks for browser globals and is designed for Node.js server environments.
- **Adapter boundary:** model providers are represented by `LLMAdapter` and `EmbedAdapter`, keeping provider-specific code outside the pipelines.
- **Storage boundary:** core logic depends on `GraphStore`; PostgreSQL with `pgvector` is the current implementation, not a requirement baked into pipeline code.
- **Incremental graph growth:** ingestion processes only new message ranges and preserves existing graph state by default; explicit `clearSession()` is the reset path.
- **Separate topic and memory layers:** topic nodes preserve conversational structure, while memory nodes support precise fact-level recall.
- **Non-destructive maintenance:** crawler passes annotate memory lifecycle state and memory edges without deleting graph data or rewriting historical topic summaries.
- **Invoke-time recall:** `MemoGrafterAgent.invoke()` recalls relevant active memories before answering whenever the session has graph content, while still falling back to raw history if recall is unavailable.
- **Token-budgeted graft assembly:** graft prompt assembly respects token budgets by trimming context and includes maintenance notes when active memory facts supersede contradictory summary details.
- **Optional asynchronous ingestion:** queue mode can move ingestion work behind a BullMQ/Redis queue without changing the pipeline contract.
- **Optional recall cache:** recall can cache raw memory search results in Redis for a short bounded TTL without caching final prompt assembly.
- **Grafting is explicit and traceable:** memory transfer copies selected topic nodes and active atomic memories into a target session, records graph edges, and stores provenance in `mg_graft_registry` instead of silently mixing sessions.
