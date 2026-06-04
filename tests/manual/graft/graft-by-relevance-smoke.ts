import { randomUUID } from "node:crypto";
import { assert, cleanupDatabase, createInitializedAgent, skipWithoutDatabase } from "../../setup.js";
import type { MemoGrafterAgent, TopicNode, TopicSegment } from "../../../src/index.js";
import type { GraphStore } from "../../../src/store/index.js";

function storeOf(agent: MemoGrafterAgent): GraphStore {
  return (agent as unknown as { core: { store: GraphStore } }).core.store;
}

function makeSegment(sessionId: string, topicOrder: number): TopicSegment {
  return {
    id: randomUUID(),
    sessionId,
    startIndex: topicOrder * 2,
    endIndex: topicOrder * 2 + 1,
    topicOrder,
    driftScore: 0,
    createdAt: new Date(),
  };
}

function makeTopicNode(segment: TopicSegment, overrides: Partial<TopicNode>): TopicNode {
  return {
    id: randomUUID(),
    sessionId: segment.sessionId,
    segmentId: segment.id,
    label: "Smoke Topic",
    summary: "Smoke topic summary.",
    embedding: new Array<number>(1536).fill(0),
    messageRange: [segment.startIndex, segment.endIndex],
    topicOrder: segment.topicOrder,
    driftScore: segment.driftScore,
    agentColor: null,
    fleetId: null,
    agentId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

if (!(await skipWithoutDatabase("manual/graft/graft-by-relevance-smoke"))) {
  const agent = await createInitializedAgent({
    drift: {
      mode: "intent",
      driftSensitivity: "medium",
      minSegmentMessages: 3,
    },
  });
  const store = storeOf(agent);
  const sessionId = agent.getSessionId();

  try {
    await store.saveMessagesAt(sessionId, 2, [
      { role: "user", content: "I want to plan a Japan trip in April." },
      { role: "assistant", content: "Let's focus on quiet towns, bookstores, and cafes." },
    ]);
    await store.saveMessagesAt(sessionId, 4, [
      { role: "user", content: "Now help me write a cover letter for a software role." },
      { role: "assistant", content: "We can tailor it around backend engineering experience." },
    ]);

    const travelSegment = await store.saveSegment(makeSegment(sessionId, 1));
    const writingSegment = await store.saveSegment(makeSegment(sessionId, 2));
    const travelNode = makeTopicNode(travelSegment, {
      label: "Japan Travel",
      summary: "The user planned a Japan trip with quiet towns, bookstores, and cafes.",
      embedding: [1, ...new Array<number>(1535).fill(0)],
    });
    const writingNode = makeTopicNode(writingSegment, {
      label: "Cover Letter",
      summary: "The user wanted help writing a software role cover letter.",
      embedding: [0, 1, ...new Array<number>(1534).fill(0)],
    });

    await store.saveNode(travelNode);
    await store.saveNode(writingNode);
    await store.saveEdge({
      srcId: travelNode.id,
      dstId: writingNode.id,
      weight: 0.4,
      type: "semantic",
    });

    const graft = await agent.graftByRelevance("Japan travel planning", {
      topK: 1,
      minSimilarity: 0.2,
      hopDepth: 1,
      expansionStrategy: "graph",
    });

    assert.ok(graft.nodes.some((node) => node.id === travelNode.id));
    assert.ok(graft.nodes.some((node) => node.id === writingNode.id));
    assert.ok(graft.systemPrompt.includes("Japan Travel"));

    const seedOnlyGraft = await agent.graftByRelevance("cover letter writing", {
      topK: 1,
      minSimilarity: 0.2,
      expansionStrategy: "none",
    });

    assert.equal(seedOnlyGraft.nodes.length, 1);
    assert.equal(seedOnlyGraft.nodes[0]?.id, writingNode.id);
    assert.ok(seedOnlyGraft.systemPrompt.includes("Cover Letter"));

    console.log("graftByRelevance smoke passed");
    console.log("Relevant graft nodes:", graft.nodes.map((node) => node.label));
    console.log("Seed-only graft nodes:", seedOnlyGraft.nodes.map((node) => node.label));
  } finally {
    await agent.close();
    await cleanupDatabase();
  }
}
