import type { GraphStore } from "../store/index.js";
import type { DriftSensitivity, EmbedAdapter, LLMAdapter, Message, TopicNode } from "../types.js";
import { resolveDriftThreshold } from "../utils/drift/driftThreshold.js";
import { normalizeText } from "../utils/text/normalizeText.js";
import { buildExistingNodeReentryEdges, findCurrentRunReentryEdges } from "../utils/reentry/reentryEdges.js";
import { SegmentProcessor } from "./SegmentProcessor.js";
import { TopicDriftDetector } from "./TopicDriftDetector.js";

export class IngestPipeline {
  private readonly driftDetector: TopicDriftDetector;
  private readonly segmentProcessor: SegmentProcessor;

  constructor(
    /** @internal */
    private readonly store: GraphStore,
    /** @internal */
    llm: LLMAdapter,
    /** @internal */
    private readonly embedder: EmbedAdapter,
    /** @internal */
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
        threshold: resolveDriftThreshold(config),
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
    const { edges: existingNodeReentryEdges, savedPairs } = buildExistingNodeReentryEdges(
      reentryMap,
      existingNodes,
      nodeByTopicOrder,
    );
    for (const edge of existingNodeReentryEdges) {
      await this.store.saveEdge(edge);
    }

    if (this.config.reentryDetection !== false) {
      const currentRunReentryEdges = findCurrentRunReentryEdges({
        segments,
        messages,
        embeddings,
        nodeByTopicOrder,
        reentryThreshold: this.config.reentryThreshold ?? 0.85,
        existingPairs: savedPairs,
      });

      for (const edge of currentRunReentryEdges) {
        await this.store.saveEdge(edge);
      }
    }

    return nodes;
  }

  private async embedMessage(message: Message): Promise<number[]> {
    const content = normalizeText(message.content) ?? message.content;
    return this.embedder.embed(content);
  }
}
