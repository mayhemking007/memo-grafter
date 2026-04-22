import { OpenAIEmbedAdapter, OpenAILLMAdapter } from "../adapters/OpenAIAdapter.js";
import { MemoGrafterAgent } from "../MemoGrafterAgent.js";
import dotenv from "dotenv";

dotenv.config();

const agent = new MemoGrafterAgent({
  db: {
    connectionString: process.env.DATABASE_URL!,
  },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  drift: {
    mode: "intent",
    threshold: 0.8,
    minSegmentMessages: 1,
  },
});

await agent.initialize();

const r1 = await agent.invoke("I want to plan a trip to Japan in April.");
console.log("R1:", r1);

const r2 = await agent.invoke("What food experiences should I try there?");
console.log("R2:", r2);

const r3 = await agent.invoke("Now help me write a cover letter for a software role.");
console.log("R3:", r3);

const r4 = await agent.invoke("Can you tell me how to cook butter chicken without using yogurt?");
console.log("R4:", r4);

const r5 = await agent.invoke("i want to make a healthier version of butter chicken, what can i substitute the cream with?");
console.log("R5:", r5);

const r6 = await agent.invoke("How does a treadmill work?");
console.log("R6:", r6);

console.log("Session:", agent.getSessionId());
console.log("History:", agent.getHistory().map((message, index) => ({
  index,
  role: message.role,
  content: message.content.slice(0, 120),
})));
const segments = await agent.getActiveSegments();
const topics = await agent.getActiveNodes();

console.log("Segments:", segments.map((segment) => ({
  id: segment.id,
  range: [segment.startIndex, segment.endIndex],
  topicOrder: segment.topicOrder,
  driftScore: segment.driftScore,
})));

console.log("Topics:", topics.map((node) => ({
  id: node.id,
  segmentId: node.segmentId,
  range: node.messageRange,
  topicOrder: node.topicOrder,
  driftScore: node.driftScore,
  label: node.label,
  summary: node.summary,
})));

await agent.close();
