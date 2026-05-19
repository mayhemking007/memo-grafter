import type { GraphStore } from "../store/index.js";
import type { DriftSensitivity, EmbedAdapter, LLMAdapter, Message, TopicNode } from "../types.js";
import { cosineSimilarity } from "../utils/drift/cosineSimilarity.js";
import { normalizeText } from "../utils/normalizeText.js";
import { SegmentProcessor } from "./SegmentProcessor.js";
import { type DriftSegment, TopicDriftDetector } from "./TopicDriftDetector.js";

export class IngestPipeline {
  private readonly driftDetector: TopicDriftDetector;
  private readonly segmentProcessor: SegmentProcessor;

  constructor(
    private readonly store: GraphStore,
    llm: LLMAdapter,
    private readonly embedder: EmbedAdapter,
    private readonly config: {
      windowSize: number;
      threshold?: number;
      driftSensitivity?: DriftSensitivity;
      topK: number;
      mode: "window" | "intent";
      minSegmentMessages: number;
      llmAmbiguityDetection?: boolean;
      reentryDetection?: boolean;
      reentryThreshold?: number;
    },
  ) {
    this.driftDetector = new TopicDriftDetector(
      {
        windowSize: config.windowSize,
        threshold: IngestPipeline.resolveDriftThreshold(config),
        mode: config.mode,
        minSegmentMessages: config.minSegmentMessages,
        llmAmbiguityDetection: config.llmAmbiguityDetection ?? false,
        reentryDetection: config.reentryDetection ?? true,
        reentryThreshold: config.reentryThreshold ?? 0.85,
      },
      llm,
    );
    this.segmentProcessor = new SegmentProcessor(store, llm, embedder, {
      topK: config.topK,
      semanticThreshold: 0.6,
    });
  }

  async run(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    if (messages.length === 0) return [];

    await this.store.saveMessages(sessionId, messages);
    const existingNodes = await this.store.getNodesBySession(sessionId);
    await this.store.clearSession(sessionId);

    const embeddings = await Promise.all(messages.map((message) => this.embedMessage(message)));
    const { segments, reentryMap } = await this.driftDetector.detectSegments(messages, embeddings, existingNodes);
    const nodes: TopicNode[] = [];
    const nodeByTopicOrder = new Map<number, TopicNode>();

    for (const segment of segments) {
      const node = await this.segmentProcessor.process(segment, messages, sessionId);
      nodes.push(node);
      nodeByTopicOrder.set(segment.topicOrder, node);
    }

    await this.store.rebuildEdgesForSession(sessionId, this.config.topK);
    const savedReentryPairs = await this.saveReentryEdges(reentryMap, existingNodes, nodeByTopicOrder);
    await this.saveCurrentRunReentryEdges(segments, messages, embeddings, nodeByTopicOrder, savedReentryPairs);

    return nodes;
  }

  private async saveReentryEdges(
    reentryMap: Map<number, string>,
    existingNodes: TopicNode[],
    nodeByTopicOrder: Map<number, TopicNode>,
  ): Promise<Set<string>> {
    const savedPairs = new Set<string>();
    if (reentryMap.size === 0) return savedPairs;

    const oldNodeById = new Map(existingNodes.map((node) => [node.id, node]));

    for (const [topicOrder, matchedOldNodeId] of reentryMap.entries()) {
      const sourceNode = nodeByTopicOrder.get(topicOrder);
      const matchedOldNode = oldNodeById.get(matchedOldNodeId);
      const targetNode = matchedOldNode ? nodeByTopicOrder.get(matchedOldNode.topicOrder) : undefined;

      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;

      await this.store.saveEdge({
        srcId: sourceNode.id,
        dstId: targetNode.id,
        weight: 1,
        type: "reentry",
      });
      savedPairs.add(this.edgePairKey(sourceNode.id, targetNode.id));
    }

    return savedPairs;
  }

  private async saveCurrentRunReentryEdges(
    segments: DriftSegment[],
    messages: Message[],
    embeddings: number[][],
    nodeByTopicOrder: Map<number, TopicNode>,
    savedPairs: Set<string>,
  ): Promise<void> {
    if (this.config.reentryDetection === false || segments.length < 2) return;

    const segmentEmbeddings = segments.map((segment) => ({
      segment,
      embeddings: this.segmentUserEmbeddings(segment, messages, embeddings),
      hasReentryCue: this.segmentHasReentryCue(segment, messages),
      terms: this.segmentMeaningfulTerms(segment, messages),
    }));

    for (const current of segmentEmbeddings) {
      if (current.embeddings.length === 0) continue;

      let best: { topicOrder: number; similarity: number } | null = null;
      let bestLexical: { topicOrder: number; score: number } | null = null;
      for (const candidate of segmentEmbeddings) {
        if (candidate.segment.topicOrder >= current.segment.topicOrder - 1 || candidate.embeddings.length === 0) continue;

        const similarity = this.maxPairwiseSimilarity(current.embeddings, candidate.embeddings);
        if (!best || similarity > best.similarity) {
          best = { topicOrder: candidate.segment.topicOrder, similarity };
        }

        const lexicalScore = this.lexicalOverlap(current.terms, candidate.terms);
        if (!bestLexical || lexicalScore > bestLexical.score) {
          bestLexical = { topicOrder: candidate.segment.topicOrder, score: lexicalScore };
        }
      }

      const threshold = current.hasReentryCue ? Math.min(this.config.reentryThreshold ?? 0.85, 0.72) : this.config.reentryThreshold ?? 0.85;
      const lexicalReentry = current.hasReentryCue && bestLexical && bestLexical.score >= 0.08;
      if ((!best || best.similarity < threshold) && !lexicalReentry) continue;

      const sourceNode = nodeByTopicOrder.get(current.segment.topicOrder);
      const targetTopicOrder = best && best.similarity >= threshold ? best.topicOrder : bestLexical?.topicOrder;
      const targetNode = targetTopicOrder ? nodeByTopicOrder.get(targetTopicOrder) : undefined;
      if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) continue;

      const pairKey = this.edgePairKey(sourceNode.id, targetNode.id);
      if (savedPairs.has(pairKey)) continue;

      await this.store.saveEdge({
        srcId: sourceNode.id,
        dstId: targetNode.id,
        weight: best && best.similarity >= threshold ? best.similarity : bestLexical?.score ?? 1,
        type: "reentry",
      });
      savedPairs.add(pairKey);
    }
  }

  private segmentUserEmbeddings(segment: DriftSegment, messages: Message[], embeddings: number[][]): number[][] {
    const segmentEmbeddings: number[][] = [];

    for (let index = segment.start; index <= segment.end; index += 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (!this.isMeaningfulReentryMessage(message)) continue;

      const embedding = embeddings[index];
      if (embedding) segmentEmbeddings.push(embedding);
    }

    return segmentEmbeddings;
  }

  private maxPairwiseSimilarity(left: number[][], right: number[][]): number {
    let best = -Infinity;

    for (const leftEmbedding of left) {
      for (const rightEmbedding of right) {
        best = Math.max(best, cosineSimilarity(leftEmbedding, rightEmbedding));
      }
    }

    return best;
  }

  private isMeaningfulReentryMessage(message: Message): boolean {
    const tokenEstimate = message.content.trim().split(/\s+/).filter(Boolean).length;
    return tokenEstimate >= 5 || this.hasReentryCue(message.content);
  }

  private segmentHasReentryCue(segment: DriftSegment, messages: Message[]): boolean {
    for (let index = segment.start; index <= segment.end; index += 1) {
      const message = messages[index];
      if (message?.role === "user" && this.hasReentryCue(message.content)) return true;
    }

    return false;
  }

  private hasReentryCue(content: string): boolean {
    const normalized = content.toLowerCase();
    return [
      "going back to",
      "back to",
      "returning to",
      "circling back",
      "as i mentioned",
      "as discussed",
      "earlier",
    ].some((marker) => normalized.includes(marker));
  }

  private segmentMeaningfulTerms(segment: DriftSegment, messages: Message[]): Set<string> {
    const terms = new Set<string>();

    for (let index = segment.start; index <= segment.end; index += 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (!this.isMeaningfulReentryMessage(message)) continue;

      for (const term of this.contentTerms(message.content)) {
        terms.add(term);
      }
    }

    return terms;
  }

  private lexicalOverlap(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    for (const term of left) {
      if (right.has(term)) intersection += 1;
    }

    return intersection / Math.min(left.size, right.size);
  }

  private contentTerms(content: string): string[] {
    const stopwords = new Set([
      "the",
      "and",
      "or",
      "a",
      "an",
      "to",
      "of",
      "for",
      "in",
      "on",
      "as",
      "is",
      "are",
      "was",
      "were",
      "we",
      "us",
      "our",
      "i",
      "it",
      "this",
      "that",
      "should",
      "need",
      "needs",
      "use",
      "using",
      "going",
      "back",
      "actually",
      "question",
    ]);

    return content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !stopwords.has(term));
  }

  private edgePairKey(srcId: string, dstId: string): string {
    return `${srcId}:${dstId}`;
  }

  private async embedMessage(message: Message): Promise<number[]> {
    const content = normalizeText(message.content) ?? message.content;
    return this.embedder.embed(content);
  }

  private static thresholdWarningLogged = false;

  private static resolveDriftThreshold(config: {
    driftSensitivity?: DriftSensitivity;
    threshold?: number;
  }): number {
    if (config.driftSensitivity === "low") return 0.25;
    if (config.driftSensitivity === "high") return 0.5;
    if (config.driftSensitivity === "medium") return 0.35;

    if (config.threshold !== undefined) {
      if (!IngestPipeline.thresholdWarningLogged) {
        console.warn("[MemoGrafter] drift.threshold is deprecated, use drift.driftSensitivity instead");
        IngestPipeline.thresholdWarningLogged = true;
      }
      return config.threshold;
    }

    return 0.35;
  }
}
