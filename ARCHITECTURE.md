# MemoGrafter Architecture

This document describes the high-level architecture and core design of memo-grafter. It is intended for contributors and coding agents who need to understand how the main pieces fit together without duplicating setup or API usage details from `README.md` and `USER_GUIDE.md`.

## System Overview

MemoGrafter is a server-side TypeScript memory framework for chatbot applications. It records conversation turns, groups them into topic segments, extracts structured memory, stores topic and memory graphs, and later retrieves or grafts relevant memory into another prompt or session.

The main runtime layers are:

- `MemoGrafterAgent`: the high-level conversational wrapper used by most applications.
- `MemoGrafter`: the internal coordinator that wires storage, pipelines, adapters, and optional queueing.
- Pipeline classes: ingestion, drift detection, segment processing, retrieval, and graft prompt assembly.
- `GraphStore`: the persistence boundary for messages, segments, topic nodes, memory nodes, edges, and fleet metadata.
- `PostgresGraphStore`: the current built-in `GraphStore` implementation, backed by PostgreSQL and `pgvector`.

At a simplified level:

```text
user / assistant messages
  -> message buffer
  -> topic drift detection
  -> topic segments
  -> topic nodes
  -> atomic memory nodes
  -> graph edges
  -> recall, injection, or grafting
```

## Core Pipeline Flow

The default application flow starts with `MemoGrafterAgent.invoke()`:

1. The user message is appended to the agent's in-memory session history.
2. The agent builds the message history for the LLM call.
3. If the current history is near the injection token budget, older covered history can be represented as compressed topic summaries.
4. The configured `LLMAdapter` produces the assistant response.
5. The assistant response is appended to session history.
6. The full history snapshot is queued for background ingestion.
7. Ingestion persists messages, rebuilds topic state for the session, and updates graph edges.

This keeps the foreground chatbot turn simple while memory construction happens after the response. Calls that need consistent memory state, such as `getActiveNodes()`, `getActiveSegments()`, `graft()`, and `close()`, wait for pending ingestion to finish.

## Ingestion Flow

`IngestPipeline` is responsible for turning a session message history into graph state.

```text
messages + sessionId
  -> save message buffer
  -> load existing topic nodes
  -> clear current session graph
  -> embed each message
  -> detect topic segments
  -> process each segment
  -> rebuild temporal and semantic edges
  -> add reentry edges when detected
```

The current ingestion model rebuilds the session's non-grafted topic graph from the latest message snapshot. This favors consistency and straightforward reasoning over incremental patching.

## Main Components

### MemoGrafterAgent

`MemoGrafterAgent` is the public session-oriented wrapper around `MemoGrafter`. It owns the current session ID, in-memory chat history, base system prompt, history token budget, and pending background ingestion promise.

Its responsibilities include:

- accepting user messages through `invoke()`;
- calling the configured LLM with either raw recent history or compressed topic summaries plus recent uncovered turns;
- scheduling ingestion after assistant responses;
- exposing active topic nodes and segments for the current session;
- providing high-level grafting and absorbing helpers;
- providing targeted recall through `RetrieverPipeline`;
- waiting for pending ingestion before reads that depend on memory state.

`MemoGrafterAgent` is intentionally a memory-aware chatbot wrapper, not an autonomous agent runtime.

### IngestPipeline

`IngestPipeline` coordinates the write-side memory pipeline. It receives a complete message snapshot and a session ID, saves the message buffer, embeds messages, delegates topic boundary detection to `TopicDriftDetector`, delegates node creation to `SegmentProcessor`, and asks the store to rebuild graph edges.

It also handles reentry linking in two forms:

- matching newly detected topic boundaries back to existing session nodes;
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

This pipeline is used by `MemoGrafter.inject()` and `MemoGrafterAgent.graft()`. Copying memory into another session is handled by store-level node absorption, followed by edge rebuilding.

### GraphStore

`GraphStore` is the persistence interface used by the core and pipeline layers. It keeps storage-specific concerns out of the orchestration code.

The interface covers:

- initialization and shutdown;
- message buffer persistence;
- segment, topic node, and topic edge persistence;
- memory node insertion, memory lookup, and memory edge construction;
- vector similarity queries for topic and memory retrieval;
- graph neighbourhood traversal;
- grafted node absorption;
- fleet and agent metadata;
- session graph rebuilding.

The built-in `PostgresGraphStore` creates and manages the current schema, including `mg_message_buffer`, `mg_segments`, `mg_topic_nodes`, `mg_topic_edges`, `mg_memory_nodes`, `mg_memory_edges`, `mg_fleets`, and `mg_fleet_agents`.

## Recall Path

Targeted recall is handled by `RetrieverPipeline`, which is used by `MemoGrafterAgent.recall()`.

The recall path embeds the query, searches active memory nodes by vector similarity, filters decayed or superseded memories, groups facts by parent topic node, ranks those topic blocks by best fact similarity, and formats a token-budgeted system prompt.

This read-side path is separate from grafting:

- recall returns atomic memories and parent topics for a query;
- grafting assembles broader topic context from selected topic nodes and their neighbours;
- absorbing copies selected topic nodes into another session.

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
6. Topic edges are rebuilt:
   - `temporal` edges link adjacent topic nodes;
   - `semantic` edges link similar topic nodes;
   - `reentry` edges link a returned topic to an earlier related topic.
7. Memory edges may link semantically related memories within a topic.
8. Grafted nodes are copied into a target session and linked to their source with `grafted` edges.

During session rebuilds, non-grafted topic edges for that session are regenerated from current topic nodes. Grafted edges are preserved so memory transfer history is not lost.

## Current Architecture Decisions

- **Server-only runtime:** `MemoGrafter` checks for browser globals and is designed for Node.js server environments.
- **Adapter boundary:** model providers are represented by `LLMAdapter` and `EmbedAdapter`, keeping provider-specific code outside the pipelines.
- **Storage boundary:** core logic depends on `GraphStore`; PostgreSQL with `pgvector` is the current implementation, not a requirement baked into pipeline code.
- **Session graph rebuilds:** ingestion rebuilds session topic state from the latest message snapshot to keep segment and edge state coherent.
- **Separate topic and memory layers:** topic nodes preserve conversational structure, while memory nodes support precise fact-level recall.
- **Token-budgeted reads:** both history compression and graft prompt assembly respect token budgets by summarizing or trimming context.
- **Optional asynchronous ingestion:** queue mode can move ingestion work behind a BullMQ/Redis queue without changing the pipeline contract.
- **Grafting is explicit:** memory transfer copies selected topic nodes into a target session and records graph edges instead of silently mixing sessions.
