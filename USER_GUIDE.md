# MemoGrafter User Guide

## Introduction

MemoGrafter is an experimental Node.js and TypeScript framework for structured chatbot memory. It stores chatbot conversations as message buffers, topic segments, topic nodes, and graph edges. Later, it can inject relevant memory into a chatbot turn or copy selected memory into another chatbot/session.

The project is intentionally focused. MemoGrafter is a chatbot memory framework, not an autonomous agent runtime. It does not run tools, schedule work, or decide goals for an agent. It helps a chatbot remember, retrieve, and transfer conversational context.

The most important idea is memory grafting. A chatbot can build useful memory during one conversation, and another chatbot can absorb only the relevant parts.

## Requirements

- Node.js 18 or newer.
- TypeScript or modern JavaScript using ES modules.
- PostgreSQL with the `pgvector` extension enabled for the built-in `PostgresGraphStore`.
- An LLM adapter.
- An embedding adapter.
- An OpenAI API key only if using the included OpenAI adapters.
- An Anthropic API key only if using the included Anthropic LLM adapter.
- A Gemini API key only if using the included Gemini adapters.
- Redis only if enabling queue mode.

MemoGrafter is server-side only. Do not run it in browser code.

## Installation

Install from npm:

```bash
npm install memo-grafter
```

Install from a local clone before publishing or while developing:

```bash
cd path/to/your-app
npm install D:/cohort/projects/project-memoGrafter
```

If you are working inside this repository, build it first:

```bash
cd D:/cohort/projects/project-memoGrafter
npm install
npm run build
```

## Environment Setup

Create a `.env` file in your app:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memo_grafter
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379
```

`DATABASE_URL` is required when using the built-in PostgreSQL storage.

`OPENAI_API_KEY` is required only when using `OpenAILLMAdapter` or `OpenAIEmbedAdapter`.

`ANTHROPIC_API_KEY` is required only when using `AnthropicLLMAdapter`.

`GEMINI_API_KEY` is required only when using `GeminiLLMAdapter` or `GeminiEmbedAdapter`.

`REDIS_URL` is optional and only needed when you pass `queue` config.

Enable `pgvector` in PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The built-in `PostgresGraphStore` creates its own tables during `initialize()`.

Current v1 tables:

- `mg_message_buffer`
- `mg_segments`
- `mg_topic_nodes`
- `mg_topic_edges`
- `mg_memory_nodes`
- `mg_memory_edges`
- `mg_fleets`
- `mg_fleet_agents`

## Quick Start

Create `src/index.ts`:

```ts
import "dotenv/config";

import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "memo-grafter";

const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
});

try {
  await agent.initialize();

  console.log(await agent.invoke("I am planning a Japan trip."));
  console.log(await agent.invoke("I like quiet towns and local cafes."));
  console.log(await agent.invoke("What should I remember while planning?"));

  const nodes = await agent.getActiveNodes();
  console.log(nodes.map((node) => ({ label: node.label, summary: node.summary })));
} finally {
  await agent.close();
}
```

Run it:

```bash
npx tsx --env-file=.env src/index.ts
```

## Core Concepts

### Messages

A message is one user or assistant turn:

```ts
export interface Message {
  role: "user" | "assistant";
  content: string;
}
```

`MemoGrafterAgent` keeps an in-memory history for the current session and stores messages in PostgreSQL during ingestion.

### Segments

A segment is a range of messages that belong to the same topic. MemoGrafter uses drift detection to decide where topic boundaries are.

Drift detection combines several signals:

- how far the current message is from the current topic embedding,
- whether the current message is a sharp pivot from the previous user message,
- whether the message contains structural phrases such as "by the way", "different topic", or "going back to",
- short-message dampening so filler like "okay" or "got it" is less likely to create false boundaries,
- optional LLM classification for ambiguous topic-shift scores.

Example:

```text
messages 0-4  -> Japan travel planning
messages 5-8  -> cover letter writing
```

Segments are stored in `mg_segments`.

### Topic Nodes

A topic node is the main unit of memory. It represents a segment as a label, summary, embedding, message range, and metadata.

Important fields:

- `id`: unique topic node ID.
- `label`: short label.
- `summary`: structured summary of the segment.
- `embedding`: vector used for semantic search.
- `messageRange`: source message range.
- `topicOrder`: chronological order.
- `driftScore`: topic-change score.
- `agentColor`, `fleetId`, `agentId`: nullable fleet metadata.

Topic nodes are stored in `mg_topic_nodes`.

### Graph Edges

Edges connect related topic nodes. They can represent temporal, semantic, grafted, or reentry relationships.

- `temporal`: one topic followed another in the conversation.
- `semantic`: two topics are similar by embedding search.
- `grafted`: a topic was copied from another session or chatbot.
- `reentry`: the conversation returned to an earlier topic after discussing something else.

Edges are stored in `mg_topic_edges`.

### Grafting

Grafting is the process of selecting memory nodes and turning them into useful context for another prompt or another chatbot.

There are two common forms:

- Preview memory with `graft()`.
- Copy memory into another chatbot with `absorbFromAgent()` or `ingestGraftedNodes()`.

## Using MemoGrafterAgent

`MemoGrafterAgent` is the easiest API to start with.

```ts
const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
});
```

Initialize it before use:

```ts
await agent.initialize();
```

Send user messages with `invoke()`:

```ts
const answer = await agent.invoke("Help me plan a Kyoto itinerary.");
```

Close resources when done:

```ts
await agent.close();
```

### What `invoke()` Does

On every call, `invoke()`:

1. Adds the user message to local history.
2. Loads existing topic nodes for the session.
3. Builds a memory injection prompt from those nodes.
4. Sends history plus memory prompt to the LLM.
5. Adds the assistant response to history.
6. Ingests the updated conversation into the memory graph.

On the first turn there may be no memory to inject. Later turns can use memory created from earlier turns.

## Inspecting Memory

Read active topic nodes:

```ts
const nodes = await agent.getActiveNodes();

for (const node of nodes) {
  console.log({
    id: node.id,
    label: node.label,
    summary: node.summary,
    messageRange: node.messageRange,
    topicOrder: node.topicOrder,
    driftScore: node.driftScore,
  });
}
```

Read active segments:

```ts
const segments = await agent.getActiveSegments();
console.log(segments);
```

Read the in-memory chat history:

```ts
const history = agent.getHistory();
console.log(history);
```

Read the session ID:

```ts
console.log(agent.getSessionId());
```

## Grafting Memory

Use `graft()` to preview what memory would be injected:

```ts
const graft = await agent.graft();

console.log(graft.systemPrompt);
console.log(graft.nodes);
console.log(graft.tokenCount);
```

You can graft specific topic IDs:

```ts
const nodes = await agent.getActiveNodes();

const graft = await agent.graft([nodes[0]!.id]);
```

`graft()` returns:

- `systemPrompt`: memory context suitable for an LLM system prompt.
- `nodes`: selected topic nodes.
- `tokenCount`: estimated token count.

## Absorbing Memory Into Another Chatbot

Use `absorbFromAgent()` to copy selected memory from one chatbot into another.

```ts
const travelBot = new MemoGrafterAgent(config);
const writingBot = new MemoGrafterAgent(config);

await travelBot.initialize();
await writingBot.initialize();

await travelBot.invoke("I am planning a Japan trip.");
await travelBot.invoke("I like quiet towns, bookstores, and local cafes.");
await travelBot.invoke("My budget is around 2500 dollars.");

const copiedNodes = await writingBot.absorbFromAgent(travelBot, {
  prompt: "Japan travel preferences",
  minSimilarity: 0.6,
  limit: 3,
});

console.log(`Copied ${copiedNodes.length} nodes.`);

const response = await writingBot.invoke(
  "Suggest a reflective blog intro for my Japan trip."
);

console.log(response);
```

### Absorb By Semantic Prompt

```ts
await targetAgent.absorbFromAgent(sourceAgent, {
  prompt: "Japan travel preferences",
  minSimilarity: 0.6,
  limit: 3,
});
```

Use this when you want MemoGrafter to find relevant memory by meaning.

### Absorb By Topic ID

```ts
const sourceNodes = await sourceAgent.getActiveNodes();

await targetAgent.absorbFromAgent(sourceAgent, {
  topicIds: [sourceNodes[0]!.id],
});
```

Use this when your UI lets a user choose memory nodes manually.

### Ingest Grafted Nodes Directly

```ts
const graft = await sourceAgent.graft();
await targetAgent.ingestGraftedNodes(graft.nodes);
```

Use this when you want to inspect or filter a graft before copying it.

## Configuration

Full shape:

```ts
const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm,
  embedder,
  drift: {
    mode: "intent",
    windowSize: 5,
    driftSensitivity: "medium",
    minSegmentMessages: 3,
    llmAmbiguityDetection: false,
    reentryDetection: true,
    reentryThreshold: 0.85,
  },
  graph: {
    topK: 5,
    hopDepth: 2,
  },
  inject: {
    bufferSize: 4,
    tokenBudget: 1500,
  },
});
```

### `db`

```ts
db: {
  connectionString: process.env.DATABASE_URL!,
}
```

PostgreSQL connection string used by the built-in `PostgresGraphStore`.

MemoGrafter currently constructs `PostgresGraphStore` from this config internally. Advanced users can also import the storage contract directly:

```ts
import {
  PostgresGraphStore,
  type GraphStore,
} from "memo-grafter";

const store: GraphStore = new PostgresGraphStore(process.env.DATABASE_URL!);
```

`GraphStore` is the public storage interface. `PostgresGraphStore` is the default PostgreSQL and pgvector implementation.

Useful store inspection methods include:

- `getNodesBySession(sessionId)`: read topic nodes for a session.
- `getSegmentsBySession(sessionId)`: read topic segments for a session.
- `getEdgesByType(sessionId, type)`: inspect graph edges such as `"reentry"`, `"semantic"`, `"temporal"`, or `"grafted"`.

### `llm`

```ts
llm: new OpenAILLMAdapter("gpt-4o")
```

Adapter used to generate assistant responses and summarize segments.

Anthropic models can be used with the included Anthropic adapter:

```ts
llm: new AnthropicLLMAdapter("claude-sonnet-4-5")
```

Gemini models can be used with the included Gemini adapter:

```ts
llm: new GeminiLLMAdapter("gemini-2.5-flash")
```

### `embedder`

```ts
embedder: new OpenAIEmbedAdapter("text-embedding-3-small")
```

Adapter used to create vectors for semantic search.

Anthropic does not provide a native embedding API. Pair `AnthropicLLMAdapter` with `OpenAIEmbedAdapter` or another custom `EmbedAdapter`.

Gemini embeddings can be used with the included Gemini embedder:

```ts
embedder: new GeminiEmbedAdapter("gemini-embedding-001")
```

`GeminiEmbedAdapter` requests 1536-dimensional embeddings by default to match MemoGrafter's current `vector(1536)` database schema. If you change the schema dimension, pass the matching value as the second constructor argument.

### `drift`

```ts
drift: {
  mode: "intent",
  windowSize: 5,
  driftSensitivity: "medium",
  minSegmentMessages: 3,
  llmAmbiguityDetection: false,
  reentryDetection: true,
  reentryThreshold: 0.85,
}
```

Controls topic boundary detection.

- `mode`: `"intent"` or `"window"`.
- `windowSize`: message window size for window mode.
- `driftSensitivity`: preferred sensitivity preset, one of `"low"`, `"medium"`, or `"high"`.
- `threshold`: deprecated numeric threshold. It still works when `driftSensitivity` is not set, but MemoGrafter logs a one-time warning.
- `minSegmentMessages`: minimum messages before a boundary.
- `llmAmbiguityDetection`: optional LLM check for borderline topic shifts. Defaults to `false`.
- `reentryDetection`: whether to link later topic returns back to earlier topic nodes. Defaults to `true`.
- `reentryThreshold`: embedding similarity threshold for reentry detection. Defaults to `0.85`.

Use `"intent"` for most chatbot memory demos. In intent mode, user messages drive topic shifts.

Sensitivity presets resolve internally to numeric thresholds:

- `"low"`: `0.25`
- `"medium"`: `0.35`
- `"high"`: `0.50`

Use `"medium"` first. Boundaries are cut when a drift score exceeds the resolved threshold, so lower numeric thresholds split more readily and higher numeric thresholds require stronger evidence.

If both `driftSensitivity` and `threshold` are provided, `driftSensitivity` wins.

#### Reentry Detection

Reentry detection handles conversations that leave a topic and later return to it:

```text
database choice -> authentication flow -> database connection pooling
```

Without reentry detection, the later database discussion is just another topic node. With reentry detection, MemoGrafter creates a `reentry` edge from the later database node back to the earlier database node.

This helps graph traversal and memory injection recover earlier related context. A later question about connection pooling can still be connected to the original PostgreSQL/ACID discussion.

Reentry edges are written between the current rebuilt topic nodes. They do not point at deleted nodes from previous ingestion passes.

### `graph`

```ts
graph: {
  topK: 5,
  hopDepth: 2,
}
```

Controls graph retrieval and traversal.

- `topK`: number of similar nodes to retrieve.
- `hopDepth`: how far grafting walks graph neighbors.

### `inject`

```ts
inject: {
  bufferSize: 4,
  tokenBudget: 1500,
}
```

Controls how much memory is inserted into the prompt.

- `bufferSize`: nearby raw messages to include.
- `tokenBudget`: approximate memory prompt budget.

## Queue Mode

Without queue config, ingestion runs synchronously after `invoke()`.

With queue config, MemoGrafter uses BullMQ and Redis:

```ts
const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  queue: {
    redisUrl: process.env.REDIS_URL!,
    removeOnComplete: true,
    removeOnFail: true,
  },
});
```

Queue mode is useful when ingestion becomes too slow to run inline. Redis connection problems are logged as warnings and should not throw from normal chatbot invocation.

## Custom Adapters

You can use any model provider if you implement the public adapter interfaces.

Custom LLM adapter:

```ts
import type { LLMAdapter, Message } from "memo-grafter";

class MyLLMAdapter implements LLMAdapter {
  async complete(messages: Message[], system?: string): Promise<string> {
    // Call your model provider here.
    return "Assistant response";
  }
}
```

Custom embedding adapter:

```ts
import type { EmbedAdapter } from "memo-grafter";

class MyEmbedAdapter implements EmbedAdapter {
  async embed(text: string): Promise<number[]> {
    // Return an embedding vector from your provider here.
    return [];
  }
}
```

Use them normally:

```ts
const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new MyLLMAdapter(),
  embedder: new MyEmbedAdapter(),
});
```

Your embedding vector dimension must match the vector dimension expected by the database schema.

## Storage Backends

MemoGrafter exposes storage through the `GraphStore` interface. The built-in implementation is `PostgresGraphStore`, which stores relational data, graph edges, and vector search data in PostgreSQL with `pgvector`.

Most users do not need to instantiate a store directly. `MemoGrafter` and `MemoGrafterAgent` use `PostgresGraphStore` from the `db.connectionString` config:

```ts
const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm,
  embedder,
});
```

If you are extending MemoGrafter, use `GraphStore` as the contract and keep concrete storage details behind an implementation:

```ts
import type { GraphStore } from "memo-grafter";

class MyGraphStore implements GraphStore {
  // Implement the full GraphStore contract.
}
```

Future storage implementations can use the same interface without changing pipeline or fleet code. For example, a SQLite plus vector-database implementation would implement `GraphStore` while preserving the same behavior expected by ingestion, grafting, and fleet APIs.

## Fleet API

Fleets let you group color-scoped worker chatbots and use a conductor to graft memory across workers.

```ts
import {
  MemoGrafterFleet,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "memo-grafter";

const fleet = new MemoGrafterFleet(
  {
    db: {
      connectionString: process.env.DATABASE_URL!,
    },
    llm: new OpenAILLMAdapter("gpt-4o"),
    embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  },
  {
    id: "support-fleet",
    name: "Support Fleet",
  }
);

await fleet.initialize();

const conductor = fleet.createConductor();
const billing = await fleet.createWorker({ color: "billing" });
const technical = await fleet.createWorker({ color: "technical" });

await billing.invoke("The customer needs help understanding invoice credits.");
await conductor.graftColorIntoAgent("billing", technical);

const answer = await technical.invoke(
  "Use any relevant billing context while helping with this technical issue."
);

console.log(answer);

await fleet.close();
```

The worker color `conductor` is reserved.

Prompt-guided fleet grafting:

```ts
await conductor.graftByPrompt("invoice credit policy", technical, {
  minSimilarity: 0.6,
  limit: 3,
});
```

## Example Project

This repository includes a runnable example:

```text
examples/chatbot-memory-demo
```

Run it:

```bash
cd D:/cohort/projects/project-memoGrafter
npm install
npm run build

cd examples/chatbot-memory-demo
npm install
cp .env.example .env
npm run dev
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

The example creates a travel chatbot and a writing chatbot, transfers Japan travel memory, and asks the writing bot to use that transferred context.

## Troubleshooting

### `DATABASE_URL is not reachable`

Check that PostgreSQL is running and the connection string is correct.

Confirm `pgvector` is enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### No Topic Nodes Are Created

Common causes:

- The conversation is too short.
- `minSegmentMessages` is too high for the demo.
- The LLM adapter failed.
- The embedding adapter failed.
- Queue mode is enabled and background ingestion has not finished yet.

For small demos, try:

```ts
drift: {
  mode: "intent",
  driftSensitivity: "medium",
  minSegmentMessages: 3,
}
```

If segments are too coarse, try a lower resolved threshold:

```ts
drift: {
  mode: "intent",
  driftSensitivity: "low",
  minSegmentMessages: 2,
}
```

If segments are too fragmented, try a higher resolved threshold:

```ts
drift: {
  mode: "intent",
  driftSensitivity: "high",
  minSegmentMessages: 4,
}
```

### Absorb Copies Zero Nodes

Inspect the source memory:

```ts
console.log(await sourceAgent.getActiveNodes());
```

Then try a lower similarity threshold:

```ts
await targetAgent.absorbFromAgent(sourceAgent, {
  prompt: "Japan travel preferences",
  minSimilarity: 0.3,
  limit: 3,
});
```

### Redis Warnings

Redis is only required when you pass `queue` config. If you do not need background ingestion, remove the `queue` section.

### Browser Runtime Error

MemoGrafter is server-side only. Run it in Node.js.

## Production Notes

MemoGrafter v0.1.0 is experimental. Treat it as a starting point for prototypes and evaluation, not a finished production memory platform.

Practical notes:

- Keep secrets in environment variables.
- Use PostgreSQL with `pgvector` enabled.
- Tune `tokenBudget` to control prompt size and cost.
- Use queue mode if ingestion becomes slow.
- Store your own user/session mapping outside MemoGrafter.
- Call `close()` during graceful shutdown.
- Do not expose database credentials or OpenAI keys to browser code.
- Run your own evaluation before trusting memory transfer behavior in user-facing flows.

## Public API Overview

Main exports:

- `MemoGrafterAgent`
- `MemoGrafter`
- `MemoGrafterFleet`
- `WorkerAgent`
- `ConductorAgent`
- `AnthropicLLMAdapter`
- `GeminiLLMAdapter`
- `GeminiEmbedAdapter`
- `OpenAILLMAdapter`
- `OpenAIEmbedAdapter`
- `PostgresGraphStore`
- `GraphStore`
- `FleetAgentRecord`
- public shared and fleet types

Useful `GraphStore` inspection methods:

- `getNodesBySession(sessionId)`
- `getSegmentsBySession(sessionId)`
- `getEdgesByType(sessionId, type)`

Common `MemoGrafterAgent` methods:

- `initialize()`: initialize storage.
- `invoke(message)`: send a user message and receive an assistant response.
- `getHistory()`: read local chat history.
- `getSessionId()`: read the current session ID.
- `getActiveNodes()`: inspect topic nodes.
- `getActiveSegments()`: inspect topic segments.
- `graft(topicIds?)`: preview memory injection.
- `ingestGraftedNodes(nodes)`: copy provided nodes into this agent.
- `absorbFromAgent(sourceAgent, options)`: select and copy memory from another agent.
- `close()`: close database and queue resources.
