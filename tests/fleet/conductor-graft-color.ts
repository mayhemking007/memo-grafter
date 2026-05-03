import { assert, cleanupDatabase, createInitializedFleet, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("fleet/conductor-graft-color"))) {
  const fleet = await createInitializedFleet();
  const billing = await fleet.createWorker({ color: "billing" });
  const technical = await fleet.createWorker({ color: "technical" });
  const conductor = fleet.createConductor();

  await billing.invoke("I need help with a Japan travel invoice.");
  const copied = await conductor.graftColorIntoAgent("billing", technical);

  assert.ok(copied.length > 0);
  assert.ok(copied.every((node) => node.agentColor === "technical"));

  await fleet.close();
  await cleanupDatabase();
}
