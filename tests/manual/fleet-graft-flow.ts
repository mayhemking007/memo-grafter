import {
  MemoGrafterFleet,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
  type TopicNode,
} from "../../src/index.js";
import type { WorkerAgent } from "../../src/fleet/WorkerAgent.js";

const fleet = new MemoGrafterFleet({
  db: { connectionString: requiredEnv("DATABASE_URL") },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
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
    tokenBudget: 1800,
  },
}, {
  id: `manual-fleet-${Date.now()}`,
  name: "Manual Fleet Graft Flow",
});

await fleet.initialize();

try {
  const conductor = fleet.createConductor();
  const travel = await fleet.createWorker({ color: "travel" });
  const writing = await fleet.createWorker({ color: "writing" });
  const cooking = await fleet.createWorker({ color: "cooking" });

  console.log("\n=== Fleet workers ===");
  console.table((await fleet.getGraph()).agents);

  console.log("\n=== Travel worker: seed Japan memory ===");
  await say(travel, "travel", "I am planning a 9 day Japan trip in April. I care most about cherry blossoms, trains, and food markets.");
  await say(travel, "travel", "Remember that my budget is about 3000 dollars and I prefer Kyoto over Osaka.");

  console.log("\n=== Writing worker: seed cover letter memory ===");
  await say(writing, "writing", "I need a cover letter for a senior TypeScript backend role at a health tech startup.");
  await say(writing, "writing", "Remember to emphasize Postgres, queues, and pragmatic product engineering.");

  console.log("\n=== Cooking worker: seed different topic ===");
  await say(cooking, "cooking", "I want to make butter chicken without cream.");
  await say(cooking, "cooking", "Remember that I want it high protein and not too spicy.");

  printNodes("Travel nodes", await travel.getActiveNodes());
  printNodes("Writing nodes", await writing.getActiveNodes());
  printNodes("Cooking nodes", await cooking.getActiveNodes());

  console.log("\n=== Conductor: graft travel color into writing worker ===");
  const travelCopiedToWriting = await conductor.graftColorIntoAgent("travel", writing, {
    limit: 2,
  });
  console.log("Copied into writing:", travelCopiedToWriting.map((node) => node.label));
  printNodes("Writing nodes after travel graft", await writing.getActiveNodes());

  console.log("\n=== Writing worker: recall grafted travel memory ===");
  await say(writing, "writing", "What do you remember about my Japan trip preferences?");

  console.log("\n=== Conductor: prompt graft cooking memory into travel worker ===");
  const cookingCopiedToTravel = await conductor.graftByPrompt("butter chicken without cream high protein not spicy", travel, {
    minSimilarity: 0.45,
    limit: 2,
  });
  console.log("Copied into travel:", cookingCopiedToTravel.map((node) => node.label));
  printNodes("Travel nodes after cooking graft", await travel.getActiveNodes());

  console.log("\n=== Travel worker: recall grafted cooking memory ===");
  await say(travel, "travel", "What do you remember about my butter chicken preferences?");

  console.log("\n=== Fleet graph after grafts ===");
  console.table((await fleet.getGraph()).agents);

  console.log("\nDone.");
} finally {
  await fleet.close();
}

async function say(worker: WorkerAgent, label: string, message: string): Promise<void> {
  console.log(`\n${label} user: ${message}`);
  const response = await worker.invoke(message);
  console.log(`${label} assistant: ${response}`);
}

function printNodes(title: string, nodes: TopicNode[]): void {
  console.log(`\n${title}:`);
  console.table(nodes.map((node) => ({
    id: node.id,
    color: node.agentColor,
    label: node.label,
    range: node.messageRange.join("-"),
    order: node.topicOrder,
    summary: node.summary.slice(0, 120),
  })));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Add it to .env and run with tsx --env-file=.env.`);
  }
  return value;
}
