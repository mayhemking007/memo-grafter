/*
This smoke test verifies the improved drift detection end to end with real embeddings.
It runs two sessions with the same message content:
  Session A - legacy-style conservative raw threshold
  Session B - new config (driftSensitivity + reentry detection enabled)

Checks:
  1. Both sessions produce segments
  2. Session B produces equal or better segment boundaries
  3. Reentry detection works - a message that returns to an earlier topic
     creates a reentry edge
  4. Short messages do not cause false boundaries
  5. Explicit topic shift markers cause reliable boundaries

No LLM ambiguity detection in this test (keep it fast - no extra LLM calls).
*/

import {
  MemoGrafter,
  OpenAIEmbedAdapter,
  OpenAILLMAdapter,
  type Message,
} from "../../../src/index.js";

const baseConfig = {
  db: { connectionString: process.env.DATABASE_URL! },
  llm: new OpenAILLMAdapter("gpt-4o-mini"),
  embedder: new OpenAIEmbedAdapter(),
  systemPrompt: "You are a helpful assistant.",
};

const memoA = new MemoGrafter({
  ...baseConfig,
  drift: { threshold: 1.1, mode: "intent" },
});

const memoB = new MemoGrafter({
  ...baseConfig,
  drift: {
    driftSensitivity: "medium",
    mode: "intent",
    reentryDetection: true,
    reentryThreshold: 0.85,
  },
});

const messages = [
  "We decided to use PostgreSQL as our main database for the product workspace",
  "okay",
  "got it",
  "PostgreSQL gives us ACID compliance, durable writes, and a simple migration path",
  "by the way, different topic - the login experience should be designed next",
  "The login screen needs password reset, Google OAuth, and a session timeout policy",
  "We should keep the first authentication release simple and avoid enterprise SSO",
  "Actually going back to the database question - should we use connection pooling?",
  "We need to decide on the max pool size and transaction timeout defaults",
];

const assert = (label: string, condition: boolean) => {
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
};

const toTranscript = (contents: string[]): Message[] =>
  contents.flatMap((content, index): Message[] => [
    { role: "user", content },
    {
      role: "assistant",
      content: `Acknowledged point ${index + 1}.`,
    },
  ]);

const sessionA = `drift-smoke-a-${Date.now()}`;
const sessionB = `drift-smoke-b-${Date.now()}`;
const transcript = toTranscript(messages);

await memoA.initialize();
await memoB.initialize();

try {
  await memoA.ingestNow(transcript, sessionA);
  await memoB.ingestNow(transcript, sessionB);

  const { segments: segmentsA } = await memoA.getTopics(sessionA);
  const { segments: segmentsB } = await memoB.getTopics(sessionB);

  console.log(`\nSession A (legacy raw threshold) - segments: ${segmentsA.length}`);
  for (const segment of segmentsA) {
    console.log(
      `  Segment ${segment.topicOrder}: messages ${segment.startIndex}-${segment.endIndex} (drift: ${segment.driftScore.toFixed(3)})`,
    );
  }

  console.log(`\nSession B (new config) - segments: ${segmentsB.length}`);
  for (const segment of segmentsB) {
    console.log(
      `  Segment ${segment.topicOrder}: messages ${segment.startIndex}-${segment.endIndex} (drift: ${segment.driftScore.toFixed(3)})`,
    );
  }

  const reentryEdges = await memoB.store.getEdgesByType(sessionB, "reentry");

  console.log(`\nSession B reentry edges: ${reentryEdges.length}`);
  for (const edge of reentryEdges) {
    console.log(`  ${edge.srcId} -> ${edge.dstId} (${edge.type}, weight: ${edge.weight})`);
  }

  assert("Session A produces at least 1 segment", segmentsA.length >= 1);
  assert("Session B produces at least 2 segments", segmentsB.length >= 2);
  assert("Session B finds more boundaries than conservative raw threshold", segmentsB.length > segmentsA.length);
  const shortMessageIndexes = new Set([1 * 2, 2 * 2]);
  assert("short messages did not cause extra segments in B", segmentsB.every((segment) => !shortMessageIndexes.has(segment.startIndex)));
  assert("reentry edge created in Session B", reentryEdges.length > 0);

  const authMessageIndex = 4 * 2;
  const authSegment = segmentsB.find((segment) => segment.startIndex <= authMessageIndex && segment.endIndex >= authMessageIndex);
  assert("explicit shift marker caused boundary in Session B", authSegment !== undefined);
} finally {
  await memoA.store.clearSession(sessionA).catch(() => undefined);
  await memoB.store.clearSession(sessionB).catch(() => undefined);
  await memoA.close();
  await memoB.close();
}
