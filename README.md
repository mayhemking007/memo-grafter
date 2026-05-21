# MemoGrafter
[![npm version](https://img.shields.io/npm/v/memo-grafter.svg)](https://www.npmjs.com/package/memo-grafter)

Structured memory for TypeScript chatbots.

MemoGrafter helps chatbot applications remember conversations without stuffing every old message back into the prompt. It turns conversation history into topic-based memory, recalls relevant details later, and can copy useful memory from one chatbot or session into another.

It is a memory framework, not an autonomous agent runtime. It does not run tools, schedule work, or decide goals for an agent.

## What It Is For

- Chatbots that need long-running memory.
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

MemoGrafter stores conversation turns, detects topic changes, summarizes useful context, links related memories, and retrieves or grafts memory when needed.

## Install

```bash
npm install memo-grafter
```

MemoGrafter runs server-side on Node.js. The built-in storage backend uses PostgreSQL with `pgvector`.

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

const recall = await agent.recall("travel preferences");
console.log(recall.facts);

await agent.close();
```

## Learn More

- [USER_GUIDE.md](https://github.com/mayhemking007/memo-grafter/blob/main/USER_GUIDE.md) covers setup, configuration, adapters, queue mode, fleet APIs, examples, and troubleshooting.
- [ARCHITECTURE.md](https://github.com/mayhemking007/memo-grafter/blob/main/ARCHITECTURE.md) explains the current high-level implementation.
- `examples` contains runnable demo.

## License

MIT
