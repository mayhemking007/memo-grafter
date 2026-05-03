import { assert, cleanupDatabase, createInitializedAgent, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/single-turn"))) {
  const agent = await createInitializedAgent();
  const response = await agent.invoke("I want to plan a trip to Japan in April.");

  assert.equal(response, "Response to: I want to plan a trip to Japan in April.");
  assert.equal(agent.getHistory().length, 2);
  assert.equal(agent.getHistory()[0]?.role, "user");
  assert.equal(agent.getHistory()[1]?.role, "assistant");

  await agent.close();
  await cleanupDatabase();
}
