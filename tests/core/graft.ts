import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/graft"))) {
  const agent = await createInitializedAgent();
  await seedConversation(agent);

  const graft = await agent.graft();
  assert.ok(graft.nodes.length > 0);
  assert.ok(graft.systemPrompt.length > 0);
  assert.ok(graft.tokenCount > 0);

  await agent.close();
  await cleanupDatabase();
}
