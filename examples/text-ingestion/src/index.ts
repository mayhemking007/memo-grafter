import "dotenv/config";

import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "../../../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const agent = new MemoGrafterAgent({
  db: { connectionString: databaseUrl },
  llm: new OpenAILLMAdapter("gpt-4o-mini"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
});

await agent.initialize();

try {
  const editorContent = [
    "The product roadmap prioritizes document imports.",
    "The editor should autosave after the user pauses typing.",
  ].join(" ");

  await agent.ingestText(editorContent, {
    replace: true,
    label: "Product roadmap",
    source: "classic-editor",
  });

  const recall = await agent.recall("document import roadmap");
  console.log(recall.facts);
  console.log("Chat history remains empty:", agent.getHistory());
} finally {
  await agent.close();
}
