import { assert, cleanupDatabase, createInitializedFleet, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("fleet/fleet-init"))) {
  const fleet = await createInitializedFleet();
  const billing = await fleet.createWorker({ color: "billing" });
  const technical = await fleet.createWorker({ color: "technical" });
  const graph = await fleet.getGraph();

  assert.equal(graph.agents.length, 2);
  assert.ok(graph.agents.some((agent) => agent.color === billing.getColor()));
  assert.ok(graph.agents.some((agent) => agent.color === technical.getColor()));

  await fleet.close();
  await cleanupDatabase();
}
