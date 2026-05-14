import {
  AnthropicLLMAdapter,
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
} from "../../src/index.js";

const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new AnthropicLLMAdapter("claude-sonnet-4-5"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  queue: {
    redisUrl: process.env.REDIS_URL!,
  },
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
    bufferSize: 2,
    tokenBudget: 1500,
  },
});

await agent.initialize();

console.log(await agent.invoke("I want to plan a trip to Japan in April."));
console.log(await agent.invoke("What food experiences should I try there?"));
console.log(await agent.invoke("Now help me write a cover letter for a software role."));

const nodes = await agent.getActiveNodes();
const graft = await agent.graft();

console.log("Session:", agent.getSessionId());
console.log("Nodes:", nodes.map((node) => ({
  id: node.id,
  label: node.label,
  range: node.messageRange,
  summary: node.summary,
  topicOrder: node.topicOrder,
  driftScore: node.driftScore,
})));
console.log("Graft token count:", graft.tokenCount);
console.log("Graft prompt:", graft.systemPrompt);

await agent.close();
