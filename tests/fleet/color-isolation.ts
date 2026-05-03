import { assert, cleanupDatabase, createInitializedFleet, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("fleet/color-isolation"))) {
  const fleet = await createInitializedFleet();
  const billing = await fleet.createWorker({ color: "billing" });
  const technical = await fleet.createWorker({ color: "technical" });

  await billing.invoke("I need help with a Japan travel invoice.");
  await technical.invoke("I need help writing a cover letter.");

  const billingNodes = await billing.getActiveNodes();
  const technicalNodes = await technical.getActiveNodes();

  assert.ok(billingNodes.length > 0);
  assert.ok(technicalNodes.length > 0);
  assert.ok(billingNodes.every((node) => node.agentColor === "billing"));
  assert.ok(technicalNodes.every((node) => node.agentColor === "technical"));

  await fleet.close();
  await cleanupDatabase();
}
