import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/token-budget"))) {
  const agent = await createInitializedAgent({
    inject: {
      tokenBudget: 5,
      bufferSize: 1,
    },
  });
  await seedConversation(agent);

  const graft = await agent.graft();
  assert.ok(graft.tokenCount <= 5);

  await agent.close();
  await cleanupDatabase();
}
