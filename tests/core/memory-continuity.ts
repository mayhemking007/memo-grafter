import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/memory-continuity"))) {
  const agent = await createInitializedAgent();
  await seedConversation(agent);

  const graft = await agent.graft();
  assert.ok(graft.systemPrompt.includes("Japan"));
  assert.ok(graft.systemPrompt.includes("Cover Letter"));

  await agent.close();
  await cleanupDatabase();
}
