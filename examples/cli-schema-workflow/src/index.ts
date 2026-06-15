import { MemoGrafter, type EmbedAdapter, type LLMAdapter, type Message } from "../../../dist/index.js";

class ExampleLLMAdapter implements LLMAdapter {
  async complete(messages: Message[]): Promise<string> {
    return `Example response to: ${messages.at(-1)?.content ?? ""}`;
  }
}

class ExampleEmbedAdapter implements EmbedAdapter {
  async embed(): Promise<number[]> {
    const vector = new Array<number>(1536).fill(0);
    vector[0] = 1;
    return vector;
  }
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env or pass --env-file=.env.");
}

const memo = new MemoGrafter({
  db: { connectionString },
  llm: new ExampleLLMAdapter(),
  embedder: new ExampleEmbedAdapter(),
});

try {
  await memo.initialize();
  console.log("MemoGrafter schema verified. CLI migration is ready to use.");
} finally {
  await memo.close();
}
