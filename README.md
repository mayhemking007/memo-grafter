# MemoGrafter
[![npm version](https://img.shields.io/npm/v/memo-grafter.svg)](https://www.npmjs.com/package/memo-grafter)

Structured memory for TypeScript chatbots.

MemoGrafter helps chatbot applications remember conversations without stuffing every old message back into the prompt. It turns conversations into topic-based memory, retrieves the relevant parts later, and can copy useful memory from one chatbot or session into another.

It is a memory framework, not an autonomous agent runtime. It does not run tools, schedule tasks, or decide goals for an agent.

## What You Can Build

- Chatbots that remember user preferences across long conversations.
- Support or tutoring assistants that recall prior topics without replaying full history.
- Multi-chatbot demos where one bot can absorb selected memory from another.
- Prototypes for graph-based conversational memory, retrieval, and memory transfer.
- Server-side TypeScript apps that need reusable LLM memory primitives.

## How It Works

At a high level:

```text
chat messages
  -> topic segments
  -> memory nodes
  -> graph links
  -> relevant memory injection
  -> optional memory grafting
```

MemoGrafter stores conversation turns, detects topic shifts, summarizes segments into memory nodes, links related nodes, and injects relevant memory into future LLM calls. Drift detection uses embedding distance, sharp message pivots, short-message dampening, and structural phrases like "by the way" or "going back to" to split conversations into useful topic segments. Memory grafting lets one chatbot or session copy selected memory from another.

## Install

```bash
npm install memo-grafter
```

MemoGrafter runs server-side on Node.js. The built-in storage implementation is `PostgresGraphStore`, which requires PostgreSQL with `pgvector`. Included provider adapters require their matching API keys.

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memo_grafter
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...
```

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

console.log(await agent.invoke("I am planning a Japan trip."));
console.log(await agent.invoke("I like quiet towns, bookstores, and local cafes."));
console.log(await agent.invoke("What do you remember about my travel preferences?"));

await agent.close();
```

## Adapters

MemoGrafter includes provider adapters such as `OpenAILLMAdapter`, `OpenAIEmbedAdapter`, `AnthropicLLMAdapter`, `GeminiLLMAdapter`, and `GeminiEmbedAdapter`. You can also bring any provider by implementing the public adapter interfaces:

```ts
import {
  type EmbedAdapter,
  type LLMAdapter,
  type Message,
} from "memo-grafter";

class MyLLMAdapter implements LLMAdapter {
  async complete(messages: Message[], system?: string): Promise<string> {
    // Call your model provider here.
    return "Assistant response";
  }
}

class MyEmbedAdapter implements EmbedAdapter {
  async embed(text: string): Promise<number[]> {
    // Return an embedding vector matching your storage schema.
    return [];
  }
}
```

## Storage

MemoGrafter uses a public `GraphStore` interface internally. The default implementation is `PostgresGraphStore`, backed by PostgreSQL and `pgvector`, and this is what `MemoGrafter` and `MemoGrafterAgent` construct from the `db.connectionString` config today.

```ts
import {
  PostgresGraphStore,
  type GraphStore,
} from "memo-grafter";

const store: GraphStore = new PostgresGraphStore(process.env.DATABASE_URL!);
```

The interface boundary keeps the Postgres implementation isolated and gives future storage backends a clear contract to implement.

## Memory Grafting

Memory grafting is the core idea behind the name: one chatbot can build memory, and another chatbot can absorb only the useful parts.

```ts
await writingBot.absorbFromAgent(travelBot, {
  prompt: "Japan travel preferences",
  limit: 3,
});
```

## Drift And Reentry

Use `driftSensitivity` for developer-friendly topic segmentation:

```ts
const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm,
  embedder,
  drift: {
    mode: "intent",
    driftSensitivity: "medium",
    minSegmentMessages: 3,
    reentryDetection: true,
  },
});
```

Sensitivity presets are `"low"`, `"medium"`, and `"high"`. The older numeric `threshold` option is still accepted for compatibility, but `driftSensitivity` is preferred.

When a conversation returns to an earlier topic, MemoGrafter can create a `reentry` edge between the new topic node and the earlier related topic node. For example, a chat can move from database decisions to authentication, then back to database pooling; the later database segment is linked back to the original database topic instead of becoming an isolated duplicate.

## Learn More

Read [USER_GUIDE.md](https://github.com/mayhemking007/memo-grafter/blob/main/USER_GUIDE.md) for setup, configuration, queue mode, custom adapters, fleet APIs, examples, and troubleshooting.

This repository also includes a runnable demo:

```text
examples/chatbot-memory-demo
```

## License

MIT
