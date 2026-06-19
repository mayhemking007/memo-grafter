# MemoGrafter
[![npm version](https://img.shields.io/npm/v/memo-grafter.svg)](https://www.npmjs.com/package/memo-grafter)

Structured memory for TypeScript chatbots.

MemoGrafter helps chatbot applications remember conversations without stuffing every old message back into the prompt. It turns conversation history into topic-based memory, recalls relevant details later, and can copy useful memory from one chatbot or session into another.

It is a memory framework, not an autonomous agent runtime. It does not run tools, schedule work, or decide goals for an agent.

MemoGrafter builds the memory graph incrementally. New chatbot turns append topic and memory nodes to the existing graph instead of clearing and rebuilding the session on every response, so grafted and externally enriched memory can survive later conversation turns. Use `clearSession()` explicitly when you want to reset an agent's local history and stored session memory.

## Playground

- Try the [MemoGrafter Playground](https://mgplayground-green.vercel.app/).
- View the playground demo repo at [mayhemking007/mg-demo](https://github.com/mayhemking007/mg-demo).

## What It Is For

- Chatbots that need long-running memory.
- Editors, document imports, and transcripts that need memory without assistant responses.
- Assistants that should recall user preferences, prior context, and open questions.
- Multi-chatbot or multi-session flows where selected memory can be grafted into another conversation.
- TypeScript apps that need reusable memory, retrieval, and graph-backed conversation primitives.

## How It Works

```text
chat messages
  -> topic-based memory
  -> graph links
  -> relevant recall
  -> optional memory grafting
```

MemoGrafter stores conversation turns, tracks which messages have already been ingested, detects topic changes for new turns with recent context, summarizes useful context, links related memories, and retrieves or grafts memory when needed.

## Install

```bash
npm install memo-grafter
npx memo-grafter init
npx memo-grafter migrate
npx memo-grafter studio
```

MemoGrafter runs server-side on Node.js. The built-in storage backend uses PostgreSQL with `pgvector`.

`init` creates local project files under `src/memo-grafter/` (`mg-schema.ts`, `schema.ts`, and `mg.config.ts`) without touching your database. `migrate` creates or updates MemoGrafter-owned `mg_*` tables. `studio` starts a local MemoGrafter Studio host with a session browser and read-only graph viewer backed by an internal DB API. Application tables remain managed by your existing tool, such as Prisma, Drizzle, or SQL migrations.

Studio resolves its database connection the same way as migration:

```bash
npx memo-grafter studio --db postgres://user:password@localhost:5432/memo_grafter
```

If `--db` is omitted, Studio reads `.env` / `DATABASE_URL`, then `mg.config.ts`. It starts on `http://localhost:2891` or the next available port and keeps running until you stop the process.

## Minimal Example

```ts
import "dotenv/config";

import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "memo-grafter";

const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
});

await agent.initialize();

await agent.invoke("I am planning a Japan trip.");
await agent.invoke("I like quiet towns, bookstores, and local cafes.");

await agent.ingestText("The product roadmap now prioritizes document imports.", {
  source: "import",
});

await agent.remember("The user prefers concise TypeScript examples.");

const recall = await agent.recall("travel preferences");
console.log(recall.facts);

await agent.close();
```

## Shared Fleet Memory

Fleets can store common knowledge once and make it available to workers without
copying it into each worker session.

```ts
const fleet = new MemoGrafterFleet(config, {
  id: "support-fleet",
  defaultWorkerMemory: "both",
});

await fleet.initialize();
await fleet.ingestToFleet("Refund policy: customers can request a refund within 30 days.");

const support = await fleet.createWorker({ color: "support" });
const recall = await support.recall("refund policy", { memory: "both" });

console.log(recall.facts);
```

## Learn More

- [USER_GUIDE.md](https://github.com/mayhemking007/memo-grafter/blob/main/USER_GUIDE.md) covers setup, configuration, adapters, queue mode, fleet APIs, examples, and troubleshooting.
- [ARCHITECTURE.md](https://github.com/mayhemking007/memo-grafter/blob/main/ARCHITECTURE.md) explains the current high-level implementation.
- `examples/basic-chat-memory` is the simplest runnable single-agent memory demo.
- `examples/chatbot-memory-demo` shows the larger two-agent grafting workflow.

## License

MIT
