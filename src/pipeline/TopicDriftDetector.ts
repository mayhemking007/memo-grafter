import type { DriftMode, Message } from "../types.js";
import { cosineSimilarity } from "../utils/drift/cosineSimilarity.js";
import { avg } from "../utils/drift/vectorAvg.js";

export interface DriftSegment {
  start: number;
  end: number;
  topicOrder: number;
  driftScore: number;
}

interface DriftBoundary {
  index: number;
  score: number;
}

export class TopicDriftDetector {
  constructor(
    private readonly config: {
      windowSize: number;
      threshold: number;
      mode: DriftMode;
      minSegmentMessages: number;
    },
  ) {}

  detect(messages: Message[], embeddings: number[][]): number[] {
    return this.detectBoundaries(messages, embeddings).map((boundary) => boundary.index);
  }

  detectSegments(messages: Message[], embeddings: number[][]): DriftSegment[] {
    if (messages.length === 0) return [];

    const boundaries = this.detectBoundaries(messages, embeddings);
    const segments: DriftSegment[] = [];
    let start = 0;

    for (const [index, boundary] of boundaries.entries()) {
      const end = boundary.index - 1;
      if (end >= start) {
        segments.push({
          start,
          end,
          topicOrder: index + 1,
          driftScore: boundary.score,
        });
      }
      start = boundary.index;
    }

    segments.push({
      start,
      end: messages.length - 1,
      topicOrder: segments.length + 1,
      driftScore: 0,
    });

    return segments;
  }

  private detectBoundaries(messages: Message[], embeddings: number[][]): DriftBoundary[] {
    if (this.config.mode === "intent") {
      return this.detectIntentBoundaries(messages, embeddings);
    }

    return this.detectWindowBoundaries(messages, embeddings);
  }

  private detectIntentBoundaries(messages: Message[], embeddings: number[][]): DriftBoundary[] {
    const boundaries: DriftBoundary[] = [];
    let segmentStart = 0;
    let topicEmbeddings: number[][] = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const embedding = embeddings[index];
      if (!message || !embedding || message.role !== "user") continue;

      if (topicEmbeddings.length === 0) {
        topicEmbeddings = [embedding];
        continue;
      }

      const driftScore = 1 - cosineSimilarity(avg(topicEmbeddings), embedding);
      const segmentLength = index - segmentStart;

      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        boundaries.push({ index, score: driftScore });
        segmentStart = index;
        topicEmbeddings = [embedding];
        continue;
      }

      topicEmbeddings.push(embedding);
    }

    return boundaries;
  }

  private detectWindowBoundaries(messages: Message[], embeddings: number[][]): DriftBoundary[] {
    const boundaries: DriftBoundary[] = [];
    const halfWindowSize = Math.floor(this.config.windowSize / 2);
    if (halfWindowSize < 1) return boundaries;

    let segmentStart = 0;
    let window: Array<{ index: number; embedding: number[] }> = [];

    for (let index = 0; index < messages.length; index += 1) {
      const embedding = embeddings[index];
      if (!embedding) continue;

      window = [...window, { index, embedding }].slice(-this.config.windowSize);
      if (window.length < this.config.windowSize) continue;

      const previous = window.slice(0, halfWindowSize).map((item) => item.embedding);
      const current = window.slice(-halfWindowSize).map((item) => item.embedding);
      const driftScore = 1 - cosineSimilarity(avg(previous), avg(current));
      const boundaryIndex = window.at(-halfWindowSize)?.index ?? index;
      const segmentLength = boundaryIndex - segmentStart;

      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        boundaries.push({ index: boundaryIndex, score: driftScore });
        segmentStart = boundaryIndex;
        window = window.filter((item) => item.index >= boundaryIndex);
      }
    }

    return boundaries;
  }
}
