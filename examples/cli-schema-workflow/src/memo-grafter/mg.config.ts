declare const process: {
  env: {
    DATABASE_URL?: string;
    OPENAI_API_KEY?: string;
    MEMO_GRAFTER_EMBEDDING_MODEL?: string;
  };
};

const embeddingModel = process.env.MEMO_GRAFTER_EMBEDDING_MODEL ?? "text-embedding-3-small";

export default {
  db: {
    connectionString: process.env.DATABASE_URL,
  },
  // Prompt Preview uses this embedder to run graft/recall preview from Studio.
  // Set OPENAI_API_KEY in your environment or replace this object with your own embedder.
  embedder: process.env.OPENAI_API_KEY
    ? {
      async embed(text: string): Promise<number[]> {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: embeddingModel,
            input: text,
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
        }

        const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
        const embedding = body.data?.[0]?.embedding;
        if (!embedding) throw new Error("OpenAI embeddings response did not include an embedding.");
        return embedding;
      },
    }
    : undefined,
};
