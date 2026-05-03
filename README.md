# MemoGrafter

MemoGrafter is a Node.js and TypeScript framework for structured chatbot memory. It stores conversations as message buffers, topic segments, topic nodes, and graph edges, then grafts relevant memory back into later chatbot turns or related chatbot sessions.

MemoGrafter is a chatbot memory framework, not an autonomous agent runtime.

## Requirements

- Node.js 18 or newer
- PostgreSQL with the `pgvector` extension enabled
- Redis when queue mode is enabled
- An LLM adapter and embedding adapter
- A server-side Node.js runtime

## Clone And Build

```bash
git clone <repo-url> project-memoGrafter
cd project-memoGrafter
npm install
cp .env.example .env
npm run build
```

Fill `.env` with your local services:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memograffer
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379
```

`REDIS_URL` is only required when you want background queue ingestion. Without `queue` config, MemoGrafter ingests synchronously.

## Use In A Local App

From your chat app project, install MemoGrafter from the local clone:

```bash
cd path/to/your-chat-app
npm install ../project-memoGrafter
```

If your app is in another folder, use the correct relative or absolute path:

```bash
npm install D:/cohort/projects/project-memoGrafter
```

Then import it normally from your app:

```ts
import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "memograffer";

const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
});

await agent.initialize();

const answer = await agent.invoke("Help me remember the Japan itinerary.");
console.log(answer);

await agent.close();
```

If you edit MemoGrafter source after installing it locally, rebuild MemoGrafter:

```bash
cd path/to/project-memoGrafter
npm run build
```

Then reinstall it in your app if needed:

```bash
cd path/to/your-chat-app
npm install ../project-memoGrafter
```

## Queue Mode

Without `queue` config, ingestion runs synchronously during `invoke()`.

With `queue` config, the chatbot returns the LLM answer first and enqueues memory ingestion through BullMQ and Redis:

```ts
const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  queue: {
    redisUrl: process.env.REDIS_URL!,
    removeOnComplete: true,
    removeOnFail: true,
  },
});
```

Queue jobs use retries and exponential backoff. Queue failures log warnings and do not throw from chatbot invocation.

## Configuration

```ts
import { MemoGrafter } from "memograffer";

const memo = new MemoGrafter({
  db: { connectionString: process.env.DATABASE_URL! },
  llm,
  embedder,
  drift: {
    mode: "intent",
    windowSize: 5,
    threshold: 0.3,
    minSegmentMessages: 3,
  },
  graph: {
    topK: 5,
    hopDepth: 2,
  },
  inject: {
    bufferSize: 8,
    tokenBudget: 2000,
  },
});
```

Configuration sections:

- `db.connectionString`: PostgreSQL connection string.
- `llm`: adapter with `complete(messages, system?)`.
- `embedder`: adapter with `embed(text)`.
- `drift`: controls topic boundary detection.
- `graph`: controls semantic neighbors and graph traversal depth.
- `inject`: controls message buffer size and prompt token budget.
- `queue`: enables BullMQ background ingestion.

## Grafting

`graft()` returns a system prompt, selected topic nodes, and an estimated token count.

```ts
const graft = await sourceAgent.graft();

console.log(graft.systemPrompt);
console.log(graft.nodes);
console.log(graft.tokenCount);
```

To copy grafted memory into another agent, call `ingestGraftedNodes()`.

```ts
const graft = await sourceAgent.graft();
const copiedNodes = await targetAgent.ingestGraftedNodes(graft.nodes);
```

Agents can also absorb memory from another agent by topic IDs:

```ts
const sourceNodes = await sourceAgent.getActiveNodes();

await targetAgent.absorbFromAgent(sourceAgent, {
  topicIds: [sourceNodes[0]!.id],
});
```

Or by semantic prompt:

```ts
await targetAgent.absorbFromAgent(sourceAgent, {
  prompt: "Japan itinerary details",
  minSimilarity: 0.6,
  limit: 3,
});
```

Copied nodes are inserted into the target session with new IDs and `grafted` edges back to the originals.

## Fleet

Fleets group color-scoped worker agents and a conductor that can graft memory across workers.

```ts
import { MemoGrafterFleet } from "memograffer";

const fleet = new MemoGrafterFleet({
  db: { connectionString: process.env.DATABASE_URL! },
  llm,
  embedder,
}, {
  id: "support-fleet",
  name: "Support Fleet",
});

await fleet.initialize();

const conductor = fleet.createConductor();
const billing = await fleet.createWorker({ color: "billing" });
const technical = await fleet.createWorker({ color: "technical" });

await billing.invoke("Remember this billing workflow.");
await conductor.graftColorIntoAgent("billing", technical);

await fleet.close();
```

Prompt-guided conductor grafting:

```ts
await conductor.graftByPrompt("billing refund policy", technical, {
  minSimilarity: 0.6,
  limit: 3,
});
```

The reserved worker color `conductor` is rejected.

## Manual Smoke Test

After setting `.env`, you can run the two-chatbot graft flow:

```bash
npx tsx --env-file=.env tests/manual/two-chatbots-graft-flow.ts
```

This uses real OpenAI, Postgres, and Redis if `REDIS_URL` is set. It creates two chatbot agents, seeds memory in one, grafts memory into the other, adds a different topic, then grafts that topic back.

## Test

```bash
npm run build
npm run test:core
npm run test:fleet
```

Tests use deterministic fake adapters. Database-backed tests skip cleanly when `DATABASE_URL` is missing or unreachable.

## License

MIT
