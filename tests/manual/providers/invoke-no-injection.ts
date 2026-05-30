/*
 * Manual smoke test for the invoke() pipeline.
 *
 * This verifies that short live sessions use in-memory conversation history only:
 * invoke() should not query graph topics or assemble injected graph memory while the
 * session is still under the history token budget. The graph is still built by the
 * background ingest path so it can support a future cold-start graft.
 */
import assert from "node:assert/strict";
import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
  type TopicNode,
  type TopicSegment,
} from "../../../src/index.js";

type CoreWithTopics = {
  getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }>;
};

function getAgentCore(agent: MemoGrafterAgent): CoreWithTopics {
  return (agent as unknown as { core: CoreWithTopics }).core;
}

const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  systemPrompt: "You are a helpful assistant. Keep each answer to one short paragraph.",
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
    tokenBudget: 100000,
  },
});

await agent.initialize();

const core = getAgentCore(agent);
const originalGetTopics = core.getTopics.bind(core);
let getTopicsCallCount = 0;

core.getTopics = async (sessionId: string) => {
  getTopicsCallCount += 1;
  return originalGetTopics(sessionId);
};

const prompts = [
  "I am planning a 7 day trip to Japan in April with a focus on Kyoto and Tokyo.",
  "Help me choose neighborhoods to stay in for that trip.",
  "What food experiences should I prioritize in Kyoto?",
  "Now switch to the budget: I want to keep flights, hotels, and meals under $4,000.",
  "Can you break that into rough daily spending categories?",
  "Given everything we discussed, what is the best compromise itinerary?",
];

let finalResponse = "";

for (const prompt of prompts) {
  finalResponse = await agent.invoke(prompt);
  console.log("History messages:", agent.getHistory().length);
}

assert.equal(getTopicsCallCount, 0);

console.log("Final response:", finalResponse);

const nodes = await agent.getActiveNodes();
console.log("getTopics calls after explicit getActiveNodes():", getTopicsCallCount);
console.log("Nodes:", nodes.map((node) => ({
  id: node.id,
  label: node.label,
  range: node.messageRange,
  summary: node.summary,
  topicOrder: node.topicOrder,
  driftScore: node.driftScore,
})));

await agent.close();
