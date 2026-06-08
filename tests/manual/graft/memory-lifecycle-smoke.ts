import assert from "node:assert/strict";
import {
  MemoGrafterAgent,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
} from "../../../src/index.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function section(title: string): void {
  console.log("\n========================================");
  console.log(title);
  console.log("========================================");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for memory-lifecycle-smoke.");
}

const agent = new MemoGrafterAgent({
  db: { connectionString: process.env.DATABASE_URL },
  llm: new OpenAILLMAdapter("gpt-4o-mini"),
  embedder: new OpenAIEmbedAdapter(),
  systemPrompt: "You are a helpful assistant.",
});

await agent.initialize();

try {
  section("1. Ingest lifecycle test memory");
  const text = [
    "The user prefers lifecycle smoke tests to use blue notebooks.",
    "The user wants privacy controls to hide billing topics temporarily.",
  ].join("\n");
  console.log(text);
  await agent.ingestText(text);
  await sleep(500);

  const nodesAfterIngest = await agent.getActiveNodes();
  console.log(`Active topics after ingest: ${nodesAfterIngest.length}`);
  for (const node of nodesAfterIngest) {
    console.log(`  topic ${node.id}`);
    console.log(`    label: ${node.label}`);
    console.log(`    summary: ${node.summary}`);
  }

  section("2. Recall before forget()");
  const initialRecall = await agent.recall("blue notebooks lifecycle preference", {
    minSimilarity: 0.2,
  });
  console.log(`Recalled facts before forget: ${initialRecall.facts.length}`);
  for (const fact of initialRecall.facts) {
    console.log(`  memory ${fact.id}`);
    console.log(`    ${fact.subject} ${fact.predicate}: ${fact.value}`);
    console.log(`    similarity: ${fact.similarity.toFixed(3)} | forgotten: ${fact.forgotten ?? false}`);
  }
  assert.ok(initialRecall.facts.length > 0, "expected at least one recalled fact before forgetting");

  const memoryId = initialRecall.facts[0]?.id;
  assert.ok(memoryId, "expected recalled fact to include a memory id");
  console.log(`\nForgetting first recalled memory: ${memoryId}`);
  const forgotChanged = await agent.forget(memoryId);
  console.log(`forget(${memoryId}) changed state: ${forgotChanged}`);
  assert.equal(forgotChanged, true, "expected forget to change memory lifecycle state");

  section("3. Recall after forget()");
  const afterForget = await agent.recall("blue notebooks lifecycle preference", {
    minSimilarity: 0.2,
  });
  console.log(`Recalled facts after forget: ${afterForget.facts.length}`);
  console.log(`Forgotten memory still recalled: ${afterForget.facts.some((fact) => fact.id === memoryId)}`);
  for (const fact of afterForget.facts) {
    console.log(`  memory ${fact.id}`);
    console.log(`    ${fact.subject} ${fact.predicate}: ${fact.value}`);
  }
  assert.equal(
    afterForget.facts.some((fact) => fact.id === memoryId),
    false,
    "forgotten memory should not be recalled",
  );

  section("4. Suppress a topic");
  const activeNodes = await agent.getActiveNodes();
  assert.ok(activeNodes.length > 0, "expected active topic nodes before suppression");
  const topicId = activeNodes[0]?.id;
  assert.ok(topicId, "expected a topic id to suppress");
  console.log(`Active topics before suppressTopic: ${activeNodes.length}`);
  console.log(`Suppressing topic: ${topicId}`);
  console.log(`  label: ${activeNodes[0]?.label}`);
  console.log(`  summary: ${activeNodes[0]?.summary}`);

  const suppressChanged = await agent.suppressTopic(topicId);
  console.log(`suppressTopic(${topicId}) changed state: ${suppressChanged}`);
  assert.equal(suppressChanged, true, "expected suppressTopic to change topic lifecycle state");
  const afterSuppressNodes = await agent.getActiveNodes();
  console.log(`Active topics after suppressTopic: ${afterSuppressNodes.length}`);
  console.log(`Suppressed topic still listed as active: ${afterSuppressNodes.some((node) => node.id === topicId)}`);
  assert.equal(
    afterSuppressNodes.some((node) => node.id === topicId),
    false,
    "suppressed topic should not be returned by active node listing",
  );

  section("5. Verify suppressed topic is excluded from graft()");
  const graft = await agent.graft([topicId]);
  console.log(`Requested graft topic IDs: ${JSON.stringify([topicId])}`);
  console.log(`Graft nodes returned: ${graft.nodes.length}`);
  console.log(`Suppressed topic present in graft result: ${graft.nodes.some((node) => node.id === topicId)}`);
  console.log(`Graft token count: ${graft.tokenCount}`);
  if (graft.systemPrompt) {
    console.log("Graft system prompt:");
    console.log(graft.systemPrompt);
  }
  assert.equal(graft.nodes.some((node) => node.id === topicId), false);

  section("6. Restore the suppressed topic");
  const restoreChanged = await agent.restoreTopic(topicId);
  console.log(`restoreTopic(${topicId}) changed state: ${restoreChanged}`);
  assert.equal(restoreChanged, true, "expected restoreTopic to change topic lifecycle state");
  const afterRestoreNodes = await agent.getActiveNodes();
  console.log(`Active topics after restoreTopic: ${afterRestoreNodes.length}`);
  console.log(`Restored topic listed as active: ${afterRestoreNodes.some((node) => node.id === topicId)}`);
  assert.equal(
    afterRestoreNodes.some((node) => node.id === topicId),
    true,
    "restored topic should return to active node listing",
  );

  section("Result");
  console.log("Memory lifecycle smoke test passed.");
} finally {
  await agent.close();
}
