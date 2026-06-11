import { assert, cleanupDatabase, createInitializedFleet, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("fleet/shared-memory"))) {
  const fleet = await createInitializedFleet();

  try {
    await fleet.ingestToFleet("Company refund policy: customers can request a refund within 30 days.", {
      tags: ["policy"],
    });

    const shared = await fleet.getSharedMemory();
    assert.equal(shared.sessionId, fleet.getSharedSessionId());
    assert.ok(shared.nodes.length > 0);
    assert.ok(shared.memories.some((memory) => memory.value.includes("30 days")));
    assert.ok(shared.nodes.every((node) => node.fleetId === fleet.id));
    assert.ok(shared.memories.every((memory) => memory.fleetId === fleet.id));

    const fleetRecall = await fleet.recallFromFleet("refund policy");
    assert.ok(fleetRecall.facts.some((fact) => fact.value.includes("30 days")));

    const support = await fleet.createWorker({ color: "support" });
    const localOnly = await support.recall("refund policy", { memory: "local" });
    assert.equal(localOnly.facts.length, 0);

    const fleetOnly = await support.recall("refund policy", { memory: "fleet" });
    assert.ok(
      fleetOnly.facts.some((fact) => fact.value.includes("30 days")),
      `fleet-only recall should include shared refund policy; got ${fleetOnly.facts.length} facts`,
    );

    const combined = await support.recall("refund policy", { memory: "both" });
    assert.ok(
      combined.facts.some((fact) => fact.value.includes("30 days")),
      `combined recall should include shared refund policy; got ${combined.facts.length} facts`,
    );

    const grafted = await support.graftByRelevance("refund policy", {
      memory: "fleet",
      minSimilarity: 0.5,
      expansionStrategy: "none",
    });
    assert.ok(
      grafted.nodes.some((node) => node.sessionId === fleet.getSharedSessionId()),
      `fleet graft should include a shared-memory node; got sessions ${grafted.nodes.map((node) => node.sessionId).join(",")}`,
    );

    const otherFleet = await createInitializedFleet();
    try {
      const otherRecall = await otherFleet.recallFromFleet("refund policy");
      assert.equal(otherRecall.facts.length, 0);
    } finally {
      await otherFleet.close();
    }
  } finally {
    await fleet.close();
    await cleanupDatabase();
  }
}
