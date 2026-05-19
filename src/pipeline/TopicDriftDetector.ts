import type { DriftMode, LLMAdapter, Message, TopicNode } from "../types.js";
import { cosineSimilarity } from "../utils/drift/cosineSimilarity.js";
import { avg } from "../utils/drift/vectorAvg.js";

export interface DriftSegment {
  start: number;
  end: number;
  topicOrder: number;
  driftScore: number;
}

export interface DriftDetectionResult {
  segments: DriftSegment[];
  reentryMap: Map<number, string>;
}

interface DriftBoundary {
  index: number;
  score: number;
  reentryNodeId?: string;
}

export class TopicDriftDetector {
  private static readonly SHIFT_MARKERS = [
    "by the way",
    "changing topic",
    "different question",
    "actually",
    "separately",
    "on another note",
    "forget that",
    "never mind",
    "different topic",
    "unrelated question",
  ];

  private static readonly CONTINUATION_MARKERS = [
    "also",
    "additionally",
    "following up",
    "as i mentioned",
    "going back to",
    "continuing",
    "furthermore",
    "moreover",
  ];

  constructor(
    private readonly config: {
      windowSize: number;
      threshold: number;
      mode: DriftMode;
      minSegmentMessages: number;
      llmAmbiguityDetection: boolean;
      reentryDetection: boolean;
      reentryThreshold: number;
    },
    private readonly llm?: LLMAdapter,
  ) {}

  /**
   * @deprecated Use detectSegments() instead. This sync wrapper does not run LLM
   * ambiguity detection or reentry detection.
   */
  detect(messages: Message[], embeddings: number[][]): number[] {
    return this.detectBoundariesSync(messages, embeddings).map((boundary) => boundary.index);
  }

  async detectSegments(
    messages: Message[],
    embeddings: number[][],
    existingNodes: TopicNode[] = [],
  ): Promise<DriftDetectionResult> {
    if (messages.length === 0) {
      return { segments: [], reentryMap: new Map() };
    }

    const boundaries = await this.detectBoundaries(messages, embeddings, existingNodes);
    const segments: DriftSegment[] = [];
    const reentryMap = new Map<number, string>();
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

      const nextTopicOrder = index + 2;
      if (boundary.reentryNodeId) {
        reentryMap.set(nextTopicOrder, boundary.reentryNodeId);
      }

      start = boundary.index;
    }

    segments.push({
      start,
      end: messages.length - 1,
      topicOrder: segments.length + 1,
      driftScore: 0,
    });

    return { segments, reentryMap };
  }

  private async detectBoundaries(
    messages: Message[],
    embeddings: number[][],
    existingNodes: TopicNode[],
  ): Promise<DriftBoundary[]> {
    if (this.config.mode === "intent") {
      return this.detectIntentBoundaries(messages, embeddings, existingNodes);
    }

    return this.detectWindowBoundaries(messages, embeddings, existingNodes);
  }

  private detectBoundariesSync(messages: Message[], embeddings: number[][]): DriftBoundary[] {
    if (this.config.mode === "intent") {
      return this.detectIntentBoundariesSync(messages, embeddings);
    }

    return this.detectWindowBoundariesSync(messages, embeddings);
  }

  private async detectIntentBoundaries(
    messages: Message[],
    embeddings: number[][],
    existingNodes: TopicNode[],
  ): Promise<DriftBoundary[]> {
    const boundaries: DriftBoundary[] = [];
    let segmentStart = 0;
    let topicEmbeddings: number[][] = [];
    let previousUserEmbedding: number[] | null = null;

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const embedding = embeddings[index];
      if (!message || !embedding || message.role !== "user") continue;

      if (topicEmbeddings.length === 0) {
        topicEmbeddings = [embedding];
        previousUserEmbedding = embedding;
        continue;
      }

      let driftScore = this.computeDriftScore(embedding, message, avg(topicEmbeddings), previousUserEmbedding);
      driftScore = await this.resolveAmbiguousScore(driftScore, messages.slice(Math.max(0, index - 3), index), message);

      const segmentLength = index - segmentStart;
      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        const reentryNodeId = this.maybeCheckReentry(embedding, existingNodes);
        boundaries.push({
          index,
          score: driftScore,
          ...(reentryNodeId ? { reentryNodeId } : {}),
        });
        segmentStart = index;
        topicEmbeddings = [embedding];
        previousUserEmbedding = embedding;
        continue;
      }

      topicEmbeddings.push(embedding);
      previousUserEmbedding = embedding;
    }

    return boundaries;
  }

  private async detectWindowBoundaries(
    messages: Message[],
    embeddings: number[][],
    existingNodes: TopicNode[],
  ): Promise<DriftBoundary[]> {
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

      const previous = window.slice(0, halfWindowSize);
      const current = window.slice(-halfWindowSize);
      const boundaryIndex = window.at(-halfWindowSize)?.index ?? index;
      const currentMessage = messages[boundaryIndex];
      const currentEmbedding = embeddings[boundaryIndex] ?? avg(current.map((item) => item.embedding));
      const previousEmbedding = previous.at(-1)?.embedding ?? null;

      if (!currentMessage) continue;

      let driftScore = this.computeDriftScore(
        currentEmbedding,
        currentMessage,
        avg(previous.map((item) => item.embedding)),
        previousEmbedding,
      );
      driftScore = await this.resolveAmbiguousScore(
        driftScore,
        messages.slice(Math.max(0, boundaryIndex - 3), boundaryIndex),
        currentMessage,
      );

      const segmentLength = boundaryIndex - segmentStart;
      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        const reentryNodeId = this.maybeCheckReentry(currentEmbedding, existingNodes);
        boundaries.push({
          index: boundaryIndex,
          score: driftScore,
          ...(reentryNodeId ? { reentryNodeId } : {}),
        });
        segmentStart = boundaryIndex;
        window = window.filter((item) => item.index >= boundaryIndex);
      }
    }

    return boundaries;
  }

  private detectIntentBoundariesSync(messages: Message[], embeddings: number[][]): DriftBoundary[] {
    const boundaries: DriftBoundary[] = [];
    let segmentStart = 0;
    let topicEmbeddings: number[][] = [];
    let previousUserEmbedding: number[] | null = null;

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const embedding = embeddings[index];
      if (!message || !embedding || message.role !== "user") continue;

      if (topicEmbeddings.length === 0) {
        topicEmbeddings = [embedding];
        previousUserEmbedding = embedding;
        continue;
      }

      const driftScore = this.computeDriftScore(embedding, message, avg(topicEmbeddings), previousUserEmbedding);
      const segmentLength = index - segmentStart;

      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        boundaries.push({ index, score: driftScore });
        segmentStart = index;
        topicEmbeddings = [embedding];
        previousUserEmbedding = embedding;
        continue;
      }

      topicEmbeddings.push(embedding);
      previousUserEmbedding = embedding;
    }

    return boundaries;
  }

  private detectWindowBoundariesSync(messages: Message[], embeddings: number[][]): DriftBoundary[] {
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

      const previous = window.slice(0, halfWindowSize);
      const current = window.slice(-halfWindowSize);
      const boundaryIndex = window.at(-halfWindowSize)?.index ?? index;
      const currentMessage = messages[boundaryIndex];
      const currentEmbedding = embeddings[boundaryIndex] ?? avg(current.map((item) => item.embedding));
      const previousEmbedding = previous.at(-1)?.embedding ?? null;

      if (!currentMessage) continue;

      const driftScore = this.computeDriftScore(
        currentEmbedding,
        currentMessage,
        avg(previous.map((item) => item.embedding)),
        previousEmbedding,
      );
      const segmentLength = boundaryIndex - segmentStart;

      if (driftScore > this.config.threshold && segmentLength >= this.config.minSegmentMessages) {
        boundaries.push({ index: boundaryIndex, score: driftScore });
        segmentStart = boundaryIndex;
        window = window.filter((item) => item.index >= boundaryIndex);
      }
    }

    return boundaries;
  }

  private computeDriftScore(
    currentEmbedding: number[],
    currentMessage: Message,
    centroidEmbedding: number[],
    previousEmbedding: number[] | null,
  ): number {
    const tokenEstimate = currentMessage.content.trim().split(/\s+/).filter(Boolean).length;
    const lengthWeight = Math.min(1, tokenEstimate / 20);
    const centroidDrift = (1 - cosineSimilarity(centroidEmbedding, currentEmbedding)) * lengthWeight;
    const pointDrift = previousEmbedding ? 1 - cosineSimilarity(previousEmbedding, currentEmbedding) : 0;
    const sharpShiftBoost = pointDrift > this.config.threshold * 1.5 ? pointDrift * 0.3 : 0;
    const structuralMultiplier = this.structuralMultiplier(currentMessage.content);

    return (centroidDrift + sharpShiftBoost) * structuralMultiplier;
  }

  private structuralMultiplier(content: string): number {
    const normalized = content.toLowerCase();
    if (TopicDriftDetector.SHIFT_MARKERS.some((marker) => normalized.includes(marker))) return 1.3;
    if (TopicDriftDetector.CONTINUATION_MARKERS.some((marker) => normalized.includes(marker))) return 0.7;
    return 1;
  }

  private async resolveAmbiguousScore(
    driftScore: number,
    recentMessages: Message[],
    currentMessage: Message,
  ): Promise<number> {
    const ambiguousLow = this.config.threshold * 0.6;
    const ambiguousHigh = this.config.threshold * 1.2;
    const isAmbiguous = driftScore >= ambiguousLow && driftScore <= ambiguousHigh;

    if (!isAmbiguous || !this.config.llmAmbiguityDetection || !this.llm) return driftScore;

    const isShift = await this.classifyIntentShift(recentMessages, currentMessage);
    return isShift ? this.config.threshold * 1.5 : this.config.threshold * 0.4;
  }

  private async classifyIntentShift(recentMessages: Message[], currentMessage: Message): Promise<boolean> {
    const recent = recentMessages.map((message) => `[${message.role}]: ${message.content}`).join("\n");
    const prompt = [
      "You are a conversation topic classifier.",
      "Given recent conversation messages and a new message, determine if the new message starts a new topic or continues the current one.",
      `Recent messages: ${recent}`,
      `New message: ${currentMessage.content}`,
      "Reply with exactly one word: NEW_TOPIC or CONTINUATION",
    ].join("\n");

    try {
      const response = await this.llm?.complete([{ role: "user", content: prompt }]);
      return response?.includes("NEW_TOPIC") ?? false;
    } catch {
      return false;
    }
  }

  private maybeCheckReentry(embedding: number[], existingNodes: TopicNode[]): string | undefined {
    if (!this.config.reentryDetection || existingNodes.length === 0) return undefined;
    return this.checkReentry(embedding, existingNodes) ?? undefined;
  }

  private checkReentry(embedding: number[], existingNodes: TopicNode[]): string | null {
    for (const node of existingNodes) {
      const similarity = cosineSimilarity(embedding, node.embedding);
      if (similarity >= this.config.reentryThreshold) return node.id;
    }

    return null;
  }
}
