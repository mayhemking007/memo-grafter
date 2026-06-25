import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "../../../dist/index.js";

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env before running this example.`);
  }

  return value;
}

const connectionString = requiredEnv("DATABASE_URL");
requiredEnv("OPENAI_API_KEY");

const llm = new OpenAILLMAdapter("gpt-4o-mini");
const embedder = new OpenAIEmbedAdapter("text-embedding-3-small");

const productAgent = new MemoGrafterAgent({
  db: { connectionString },
  llm,
  embedder,
  systemPrompt: "You are a concise product planning assistant.",
  drift: {
    mode: "intent",
    threshold: 0.3,
    minSegmentMessages: 2,
  },
});

const personalAgent = new MemoGrafterAgent({
  db: { connectionString },
  llm,
  embedder,
  systemPrompt: "You are a concise personal planning assistant.",
  drift: {
    mode: "intent",
    threshold: 0.3,
    minSegmentMessages: 2,
  },
});

async function runSession(
  name: string,
  agent: MemoGrafterAgent,
  messages: string[],
): Promise<void> {
  console.log(`\n--- ${name} ---`);
  console.log(`Session ID: ${agent.getSessionId()}`);

  for (const message of messages) {
    console.log(`\nUser: ${message}`);
    const response = await agent.invoke(message);
    console.log(`Assistant: ${response}`);
  }

  const snapshot = await agent.getGraphSnapshot();
  console.log(`\nStored ${snapshot.nodes.length} topics and ${snapshot.memories.length} memories.`);
}

try {
  await Promise.all([productAgent.initialize(), personalAgent.initialize()]);

  await productAgent.setSessionTags(["example:studio", "project:product-launch"]);
  await personalAgent.setSessionTags(["example:studio", "project:personal-planning"]);

  await runSession("Product launch session", productAgent, [
    "We are preparing a private beta for our analytics dashboard in October.",
    "The launch should track onboarding completion and weekly active teams.",
    "We will use PostgreSQL for event storage and React for the dashboard.",
    "Switching topics: we also need an incident runbook with an owner and escalation path.",
  ]);

  await runSession("Personal planning session", personalAgent, [
    "I am planning a Japan trip for April and want to spend a few days in Kyoto.",
    "I prefer quiet neighborhoods, vegetarian food, and small local cafes.",
    "My total trip budget is about 2500 dollars.",
    "Switching topics: I am also training for a 10K and run three mornings each week.",
  ]);

  console.log("\nStudio data is ready.");
  console.log("Run: npx memo-grafter studio");
} finally {
  await Promise.allSettled([productAgent.close(), personalAgent.close()]);
}
