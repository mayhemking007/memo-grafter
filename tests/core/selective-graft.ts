import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/selective-graft"))) {
  const agent = await createInitializedAgent();
  await seedConversation(agent);
  const nodes = await agent.getActiveNodes();
  const selected = nodes[0]!;

  const graft = await agent.graft([selected.id]);
  assert.ok(graft.nodes.some((node) => node.id === selected.id));
  assert.ok(graft.systemPrompt.includes(selected.label));

  await agent.close();
  await cleanupDatabase();
}
