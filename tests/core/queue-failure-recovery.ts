import { assert, cleanupDatabase, createInitializedAgent, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/queue-failure-recovery"))) {
  const warn = console.warn;
  console.warn = () => undefined;

  try {
    const agent = await createInitializedAgent({
      queue: {
        redisUrl: "redis://127.0.0.1:1",
      },
    });

    const response = await agent.invoke("I want to plan a trip to Japan in April.");
    assert.equal(response, "Response to: I want to plan a trip to Japan in April.");
    assert.equal(agent.getHistory().length, 2);

    await agent.close();
    await cleanupDatabase();
  } finally {
    console.warn = warn;
  }
}
