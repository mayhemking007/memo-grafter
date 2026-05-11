# MemoGrafter

Experimental structured memory for TypeScript chatbots.

MemoGrafter turns chatbot conversations into topic segments, topic nodes, and graph edges, then injects relevant memory into future turns. Its core idea is memory grafting: copying useful conversational memory from one chatbot or session into another.

MemoGrafter is a chatbot memory framework. It is not an autonomous agent runtime.

## Why MemoGrafter?

Most chatbots either forget old context or keep stuffing long chat history back into the prompt. MemoGrafter explores a different shape:

- store conversations as structured memory
- detect topic shifts
- summarize topic segments into memory nodes
- connect related nodes in a graph
- inject only relevant memory into later calls
- graft selected memory into another chatbot/session

The project is early-stage and experimental, but it is useful for demos, prototypes, and exploring memory workflows beyond plain chat history.

## How It Works

```text
chat messages
  -> topic segments
  -> topic nodes
  -> graph edges
  -> memory injection
  -> selective grafting into another chatbot
```

On each chatbot call, MemoGrafter can retrieve existing topic memory and pass it to the LLM as a system prompt. After the response, it ingests the updated conversation so future turns have better memory.

## Installation

```bash
npm install memo-grafter
```

For local development from this repository:

```bash
git clone <repo-url> project-memoGrafter
cd project-memoGrafter
npm install
npm run build
```

Then install it from a local app:

```bash
npm install D:/cohort/projects/project-memoGrafter
```

## Environment

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memo_grafter
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379
```

`DATABASE_URL` is required. PostgreSQL must have `pgvector` enabled.

`OPENAI_API_KEY` is only needed when using the included OpenAI adapters.

`REDIS_URL` is optional and only needed for queue mode.

## Minimal Usage

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

await agent.initialize();

console.log(await agent.invoke("I am planning a Japan trip."));
console.log(await agent.invoke("I like quiet towns, bookstores, and local cafes."));

const nodes = await agent.getActiveNodes();
console.log(nodes.map((node) => ({ label: node.label, summary: node.summary })));

await agent.close();
```

Run with:

```bash
npx tsx --env-file=.env src/index.ts
```

## Memory Grafting

Memory grafting copies selected memory from one chatbot/session into another.

```ts
const travelBot = new MemoGrafterAgent(config);
const writingBot = new MemoGrafterAgent(config);

await travelBot.initialize();
await writingBot.initialize();

await travelBot.invoke("I am planning a Japan trip.");
await travelBot.invoke("I like quiet towns, bookstores, and local cafes.");
await travelBot.invoke("My budget is around 2500 dollars.");

await writingBot.absorbFromAgent(travelBot, {
  prompt: "Japan travel preferences",
  minSimilarity: 0.6,
  limit: 3,
});

const intro = await writingBot.invoke(
  "Suggest a reflective blog intro for my Japan trip."
);

console.log(intro);

await travelBot.close();
await writingBot.close();
```

You can also preview a graft before copying it:

```ts
const graft = await travelBot.graft();

console.log(graft.systemPrompt);
console.log(graft.nodes);
console.log(graft.tokenCount);
```

## Key Features

- Structured chatbot memory over PostgreSQL and pgvector.
- Topic drift detection for splitting conversations into segments.
- Topic nodes with summaries, embeddings, message ranges, and graph edges.
- Automatic memory injection during chatbot calls.
- Selective memory grafting by topic ID or semantic prompt.
- Optional BullMQ/Redis queue mode for background ingestion.
- OpenAI adapters included.
- Custom LLM and embedding adapters supported.
- Minimal fleet API for color-scoped worker chatbots and conductor grafting.

## Requirements

- Node.js 18 or newer.
- Server-side Node.js runtime.
- PostgreSQL with `pgvector`.
- An LLM adapter and embedding adapter.
- OpenAI API key if using `OpenAILLMAdapter` or `OpenAIEmbedAdapter`.
- Redis only if using queue mode.

MemoGrafter does not run in browser code.

## Learn More

Read the full [USER_GUIDE.md](./USER_GUIDE.md) for setup, concepts, configuration, queue mode, custom adapters, fleet usage, examples, and troubleshooting.

This repository also includes a runnable demo:

```text
examples/chatbot-memory-demo
```

## License

MIT
