import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/background-graph-building"))) {
  const agent = await createInitializedAgent();
  await seedConversation(agent);

  const nodes = await agent.getActiveNodes();
  assert.ok(nodes.length >= 2);
  assert.ok(nodes.some((node) => node.label.includes("Japan")));

  await agent.close();
  await cleanupDatabase();
}
