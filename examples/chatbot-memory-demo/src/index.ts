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
  const db = {
    connectionString: requiredEnv("DATABASE_URL"),
  };

  const llm = new OpenAILLMAdapter("gpt-4o");
  const embedder = new OpenAIEmbedAdapter("text-embedding-3-small");

  // Create two independent chatbots that share the same adapters and database.
  const travelBot = new MemoGrafterAgent({
    db,
    llm,
    embedder,
    drift: {
      mode: "intent",
      threshold: 0.3,
      minSegmentMessages: 3,
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

  const writingBot = new MemoGrafterAgent({
    db,
    llm,
    embedder,
    drift: {
      mode: "intent",
      threshold: 0.3,
      minSegmentMessages: 3,
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

  try {
    // Initialize database tables and agent internals.
    await travelBot.initialize();
    await writingBot.initialize();

    const travelMessages = [
      "I am planning a Japan trip.",
      "I like quiet towns, bookstores, and local cafes.",
      "My budget is around 2500 dollars.",
    ];

    console.log("\n--- Travel bot conversation ---");

    for (const message of travelMessages) {
      console.log(`\nUser: ${message}`);
      const response = await travelBot.invoke(message);
      console.log(`TravelBot: ${response}`);
    }

    // Inspect the structured topic nodes generated from the travel conversation.
    const travelNodes = await travelBot.getActiveNodes();

    console.log("\n--- Travel bot topic nodes ---");

    if (travelNodes.length === 0) {
      console.log("No topic nodes were generated yet.");
    }

    for (const node of travelNodes) {
      console.log({
        id: node.id,
        label: node.label,
        summary: node.summary,
        messageRange: node.messageRange,
        topicOrder: node.topicOrder,
      });
    }

    // Demonstrate graft inspection before copying memory into the second chatbot.
    const graft = await travelBot.graft();

    console.log("\n--- Graft preview ---");
    console.log(`Selected nodes: ${graft.nodes.length}`);
    console.log(`Estimated tokens: ${graft.tokenCount}`);

    // Transfer only memory semantically related to Japan travel preferences.
    const absorbedNodes = await writingBot.absorbFromAgent(travelBot, {
      prompt: "Japan travel preferences",
      minSimilarity: 0.3,
      limit: 3,
    });

    console.log("\n--- Absorbed memory into writing bot ---");
    console.log(`Copied nodes: ${absorbedNodes.length}`);

    for (const node of absorbedNodes) {
      console.log({
        id: node.id,
        label: node.label,
        summary: node.summary,
      });
    }

    // The writing bot now uses transferred memory while answering a writing request.
    const writingPrompt = "Suggest a reflective blog intro for my Japan trip.";

    console.log("\n--- Writing bot with transferred memory ---");
    console.log(`\nUser: ${writingPrompt}`);

    const writingResponse = await writingBot.invoke(writingPrompt);
    console.log(`WritingBot: ${writingResponse}`);
  } finally {
    await Promise.allSettled([travelBot.close(), writingBot.close()]);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
