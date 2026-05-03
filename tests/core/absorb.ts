import { assert, cleanupDatabase, createInitializedAgent, seedConversation, skipWithoutDatabase } from "../setup.js";

if (!(await skipWithoutDatabase("core/absorb"))) {
  const source = await createInitializedAgent();
  const target = await createInitializedAgent();
  await seedConversation(source);
  const sourceNodes = await source.getActiveNodes();
  assert.ok(sourceNodes.length > 0);

  const copiedById = await target.absorbFromAgent(source, { topicIds: [sourceNodes[0]!.id] });
  assert.equal(copiedById.length, 1);
  assert.notEqual(copiedById[0]!.id, sourceNodes[0]!.id);
  assert.deepEqual(copiedById[0]!.messageRange, [0, 0]);

  const copiedByPrompt = await target.absorbFromAgent(source, {
    prompt: "Japan trip",
    minSimilarity: 0.5,
  });
  assert.ok(copiedByPrompt.every((node) => node.summary.includes("Japan") || node.label.includes("Japan")));
  assert.equal((await target.getActiveNodes()).length, 2);

  await source.close();
  await target.close();
  await cleanupDatabase();
}
