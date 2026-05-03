import { assert, cleanupDatabase, createInitializedFleet, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("fleet/conductor-graft-prompt"))) {
  const fleet = await createInitializedFleet();
  const travel = await fleet.createWorker({ color: "travel" });
  const writing = await fleet.createWorker({ color: "writing" });
  const target = await fleet.createWorker({ color: "target" });
  const conductor = fleet.createConductor();

  await travel.invoke("I want to plan a trip to Japan.");
  await writing.invoke("Help me write a cover letter for a software role.");

  const copied = await conductor.graftByPrompt("Japan itinerary", target, {
    minSimilarity: 0.5,
  });

  assert.ok(copied.length > 0);
  assert.ok(copied.every((node) => node.label.includes("Japan") || node.summary.includes("Japan")));

  await fleet.close();
  await cleanupDatabase();
}
