import "dotenv/config";

import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "../../../dist/index.js";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function main(): Promise<void> {
  const agent = new MemoGrafterAgent({
    db: {
      connectionString: requiredEnv("DATABASE_URL"),
    },
    llm: new OpenAILLMAdapter("gpt-4o"),
    embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
    drift: {
      mode: "intent",
      threshold: 0.3,
      minSegmentMessages: 2,
    },
    graph: {
      topK: 5,
      hopDepth: 2,
    },
    inject: {
      bufferSize: 4,
      tokenBudget: 1200,
    },
  });

  try {
    await agent.initialize();

    const conversation = [
      "I am planning a Japan trip.",
      "I like quiet towns, used bookstores, and local cafes.",
      "Please keep my budget around 2500 dollars.",
      "What kind of places should I look for?",
    ];

    console.log("\n--- Conversation ---");

    for (const message of conversation) {
      console.log(`\nUser: ${message}`);
      const response = await agent.invoke(message);
      console.log(`Assistant: ${response}`);
    }

    const activeNodes = await agent.getActiveNodes();
    console.log("\n--- Active topic nodes ---");
    console.log(activeNodes.map((node) => ({
      id: node.id,
      label: node.label,
      summary: node.summary,
    })));

    const recall = await agent.recall("Japan travel preferences", {
      limit: 5,
      minSimilarity: 0.3,
    });

    console.log("\n--- Recall facts ---");
    console.log(recall.facts);
  } finally {
    await agent.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
