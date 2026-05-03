import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
  type TopicNode,
} from "../../src/index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const useQueue = Boolean(process.env.REDIS_URL);

const createAgent = () => new MemoGrafterAgent({
  db: { connectionString: requiredEnv("DATABASE_URL") },
  llm: new OpenAILLMAdapter("gpt-4o"),
  embedder: new OpenAIEmbedAdapter("text-embedding-3-small"),
  ...(useQueue
    ? {
        queue: {
          redisUrl: requiredEnv("REDIS_URL"),
        },
      }
    : {}),
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
});

const chatA = createAgent();
const chatB = createAgent();

await chatA.initialize();
await chatB.initialize();

try {
  console.log("\n=== Chatbot A: seed memory ===");
  await say(chatA, "A", "I am planning a 9 day Japan trip in April. I care most about cherry blossoms, trains, and food markets.");
  await say(chatA, "A", "Please remember that my Japan budget is about 3000 dollars and I prefer Kyoto over Osaka.");
  await say(chatA, "A", "I also need a cover letter for a senior TypeScript backend role at a health tech startup.");
  await say(chatA, "A", "For the cover letter, remember that I want to emphasize Postgres, queues, and pragmatic product engineering.");

  const chatANodes = await waitForNodes(chatA, 2, "Chatbot A");
  printNodes("Chatbot A nodes before graft", chatANodes);

  const nodesToGraft = pickTwoRelevantNodes(chatANodes);
  const graftFromA = await chatA.graft(nodesToGraft.map((node) => node.id));

  console.log("\n=== Graft A -> B ===");
  console.log("Grafted node labels:", graftFromA.nodes.map((node) => node.label));
  console.log("Graft token count:", graftFromA.tokenCount);
  await chatB.ingestGraftedNodes(graftFromA.nodes);

  const chatBAfterGraft = await waitForNodes(chatB, 1, "Chatbot B after graft");
  printNodes("Chatbot B nodes after receiving graft", chatBAfterGraft);

  console.log("\n=== Chatbot B: recall grafted memory ===");
  await say(chatB, "B", "What do you remember about my Japan trip preferences from previous context?");
  await say(chatB, "B", "What should my cover letter emphasize based on the memory you received?");

  console.log("\n=== Chatbot B: add different topics ===");
  await say(chatB, "B", "Now switch topics: I want to make butter chicken without cream. What substitutes should I use?");
  await say(chatB, "B", "Also remember that I want the butter chicken to stay high protein and not too spicy.");
  await say(chatB, "B", "One more unrelated note: explain how a treadmill motor controls speed in simple terms.");

  const chatBNodes = await waitForNodes(chatB, 3, "Chatbot B");
  printNodes("Chatbot B nodes before reverse graft", chatBNodes);

  console.log("\n=== Graft B -> A by prompt: butter chicken ===");
  const copiedToA = await chatA.absorbFromAgent(chatB, {
    prompt: "butter chicken without cream high protein not too spicy",
    minSimilarity: 0.45,
    limit: 2,
  });
  console.log("Copied node labels into A:", copiedToA.map((node) => node.label));

  const chatAAfterReverseGraft = await waitForNodes(chatA, 3, "Chatbot A after reverse graft");
  printNodes("Chatbot A nodes after receiving B topic", chatAAfterReverseGraft);

  console.log("\n=== Chatbot A: recall topic grafted back from B ===");
  await say(chatA, "A", "What do you remember about my butter chicken preferences?");

  console.log("\nDone.");
} finally {
  await chatA.close();
  await chatB.close();
}

async function say(agent: MemoGrafterAgent, label: string, message: string): Promise<void> {
  console.log(`\n${label} user: ${message}`);
  const response = await agent.invoke(message);
  console.log(`${label} assistant: ${response}`);
}

async function waitForNodes(agent: MemoGrafterAgent, minimum: number, label: string): Promise<TopicNode[]> {
  const attempts = useQueue ? 20 : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const nodes = await agent.getActiveNodes();
    if (nodes.length >= minimum) return nodes;

    if (useQueue) {
      console.log(`${label}: waiting for background ingest (${nodes.length}/${minimum} nodes)...`);
      await sleep(1000);
    }
  }

  const nodes = await agent.getActiveNodes();
  if (nodes.length < minimum) {
    console.warn(`${label}: expected at least ${minimum} nodes, found ${nodes.length}. Continuing so you can inspect output.`);
  }
  return nodes;
}

function pickTwoRelevantNodes(nodes: TopicNode[]): TopicNode[] {
  const japan = nodes.find((node) => includesAny(node, ["japan", "kyoto", "travel"]));
  const coverLetter = nodes.find((node) => includesAny(node, ["cover", "letter", "typescript", "postgres"]));
  const picked = [japan, coverLetter].filter((node): node is TopicNode => Boolean(node));

  for (const node of nodes) {
    if (picked.length >= 2) break;
    if (!picked.some((pickedNode) => pickedNode.id === node.id)) {
      picked.push(node);
    }
  }

  if (picked.length === 0) {
    throw new Error("No nodes were available to graft from Chatbot A.");
  }

  return picked.slice(0, 2);
}

function includesAny(node: TopicNode, terms: string[]): boolean {
  const text = `${node.label} ${node.summary}`.toLowerCase();
  return terms.some((term) => text.includes(term));
}

function printNodes(title: string, nodes: TopicNode[]): void {
  console.log(`\n${title}:`);
  console.table(nodes.map((node) => ({
    id: node.id,
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
