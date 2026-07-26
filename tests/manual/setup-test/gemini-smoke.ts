import {
  GeminiEmbedAdapter,
  GeminiLLMAdapter,
  MemoGrafterAgent,
} from "../../../src/index.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env before running this smoke test.`);
  }
  return value;
}

const databaseUrl = requiredEnv("DATABASE_URL");
requiredEnv("GEMINI_API_KEY");

const agent = new MemoGrafterAgent({
  db: { connectionString: databaseUrl },
  llm: new GeminiLLMAdapter("gemini-2.5-flash"),
  embedder: new GeminiEmbedAdapter("gemini-embedding-001"),
  systemPrompt: "You are a concise travel planning assistant.",
  drift: {
    mode: "intent",
    threshold: 0.3,
    minSegmentMessages: 2,
  },
});

try {
  await agent.initialize();

  for (const message of [
    "I am planning a trip to Kyoto in April.",
    "I prefer quiet neighborhoods, bookstores, and small local cafes.",
    "Please suggest a simple way to plan the trip.",
  ]) {
    console.log(`\nUser: ${message}`);
    const response = await agent.invoke(message);
    if (!response.trim()) throw new Error("The Gemini chatbot returned an empty response.");
    console.log(`Assistant: ${response}`);
  }

  const snapshot = await agent.getGraphSnapshot();
  if (snapshot.nodes.length === 0) {
    throw new Error("No topic nodes were stored. Check the migration and database configuration.");
  }

  console.log(`\nStored topics: ${snapshot.nodes.length}`);
  console.log(`Stored memories: ${snapshot.memories.length}`);
  console.log("Gemini contributor setup smoke passed.");
} finally {
  await agent.close();
}
