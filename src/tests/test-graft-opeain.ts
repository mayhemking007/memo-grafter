import dotenv from "dotenv";
import { OpenAIEmbedAdapter, OpenAILLMAdapter } from "../adapters/OpenAIAdapter.js";
import { MemoGrafterAgent } from "../MemoGrafterAgent.js";

dotenv.config();

const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  drift: {
    mode: "intent",
    threshold: 0.82,
    minSegmentMessages: 1,
  },
  graph: {
    hopDepth: 2,
    topK: 5,
  },
  inject: {
    bufferSize: 2,
    tokenBudget: 1200,
  },
});

await agent.initialize();

await agent.invoke("I want to plan a trip to Japan in April.");
await agent.invoke("What food experiences should I try there?");
await agent.invoke("Now help me write a cover letter for a software role.");
await agent.invoke("Can you tell me how to cook butter chicken without using yogurt?");
await agent.invoke("I want to make a healthier version of butter chicken. What can I substitute the cream with?");
await agent.invoke("How does a treadmill work?");


const nodes = await agent.getActiveNodes();
const graft = await agent.graft(["9e430426-8077-4def-bc72-020917192292", "7eff3044-388c-4f04-b99f-53340ed0f980"]);

console.log("Session:", agent.getSessionId());

console.log("Nodes:", nodes.map((node) => ({
  id: node.id,
  segmentId: node.segmentId,
  range: node.messageRange,
  topicOrder: node.topicOrder,
  driftScore: node.driftScore,
  label: node.label,
})));

console.log("Graft:", {
  tokenCount: graft.tokenCount,
  nodeRanges: graft.nodes.map((node) => node.messageRange),
  nodeLabels: graft.nodes.map((node) => node.label),
  systemPrompt: graft.systemPrompt,
});

await agent.close();
