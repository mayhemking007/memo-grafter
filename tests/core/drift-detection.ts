import { assert } from "../setup.js";
import { TopicDriftDetector } from "../../src/pipeline/TopicDriftDetector.js";

const messages = [
  { role: "user" as const, content: "Japan itinerary" },
  { role: "assistant" as const, content: "Visit Tokyo and Kyoto." },
  { role: "user" as const, content: "Japan food experiences" },
  { role: "assistant" as const, content: "Try ramen and sushi." },
  { role: "user" as const, content: "Cover letter for software role" },
  { role: "assistant" as const, content: "Draft a focused cover letter." },
];

const embeddings = [
  [1, 0],
  [1, 0],
  [0.95, 0.05],
  [0.95, 0.05],
  [0, 1],
  [0, 1],
];

const detector = new TopicDriftDetector({
  mode: "intent",
  windowSize: 5,
  threshold: 0.3,
  minSegmentMessages: 3,
  llmAmbiguityDetection: false,
  reentryDetection: true,
  reentryThreshold: 0.85,
});

assert.deepEqual(detector.detect(messages, embeddings), [4]);
const { segments } = await detector.detectSegments(messages, embeddings);
assert.equal(segments.length, 2);
