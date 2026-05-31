import type { GraphStore } from "../store/index.js";
import type {
  DriftSensitivity,
  EmbedAdapter,
  LLMAdapter,
  MemoGrafterDriftConfig,
  Message,
  TopicNode,
} from "../types.js";
import { resolveAdaptiveDriftThreshold } from "../utils/drift/adaptiveDriftSensitivity.js";
import { cosineSimilarity } from "../utils/drift/cosineSimilarity.js";
import { resolveDriftThreshold } from "../utils/drift/driftThreshold.js";
import { normalizeText } from "../utils/text/normalizeText.js";
import { edgePairKey, findCurrentRunReentryEdges } from "../utils/reentry/reentryEdges.js";
import { SegmentProcessor } from "./SegmentProcessor.js";
import { type DriftSegment, TopicDriftDetector } from "./TopicDriftDetector.js";

const INGEST_OVERLAP_MESSAGES = 6;
const INCREMENTAL_SEMANTIC_THRESHOLD = 0.6;

export class IngestPipeline {
  private readonly segmentProcessor: SegmentProcessor;
  private readonly baseDriftThreshold: number;

  constructor(
    /** @internal */
    private readonly store: GraphStore,
    /** @internal */
    private readonly llm: LLMAdapter,
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
      adaptiveSensitivity?: MemoGrafterDriftConfig["adaptiveSensitivity"];
    },
  ) {
    this.baseDriftThreshold = resolveDriftThreshold(config);
    this.segmentProcessor = new SegmentProcessor(store, llm, embedder, {
      topK: config.topK,
      semanticThreshold: 0.6,
    });
  }

  async run(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    if (messages.length === 0) return [];

    await this.store.saveMessages(sessionId, messages);
    const ingestState = await this.store.getSessionIngestState(sessionId);
    const firstNewMessageIndex = (ingestState?.lastIngestedMessageIndex ?? -1) + 1;
    if (firstNewMessageIndex >= messages.length) return [];

    const existingNodes = await this.store.getNodesBySession(sessionId);
    const contextStartIndex = Math.max(0, firstNewMessageIndex - INGEST_OVERLAP_MESSAGES);
    const contextMessages = messages.slice(contextStartIndex);
    const contextEmbeddings = await Promise.all(contextMessages.map((message) => this.embedMessage(message)));
    const driftDetector = await this.createDriftDetector(sessionId);
    const { segments, reentryMap } = await driftDetector.detectSegments(
      contextMessages,
      contextEmbeddings,
      existingNodes,
    );
    const absoluteSegments = this.toNewAbsoluteSegments(
      segments,
      contextStartIndex,
      firstNewMessageIndex,
      existingNodes,
    );

    const nodes: TopicNode[] = [];
    const nodeByDetectorTopicOrder = new Map<number, TopicNode>();
    const savedReentryPairs = new Set<string>();

    for (const { segment, detectorTopicOrder } of absoluteSegments) {
      const node = await this.segmentProcessor.process(segment, messages, sessionId);
      nodes.push(node);
      nodeByDetectorTopicOrder.set(detectorTopicOrder, node);

      const matchedNodeId = reentryMap.get(detectorTopicOrder);
      const matchedNode = matchedNodeId
        ? existingNodes.find((existingNode) => existingNode.id === matchedNodeId)
        : undefined;
      if (matchedNode && matchedNode.id !== node.id) {
        await this.store.saveEdge({
          srcId: node.id,
          dstId: matchedNode.id,
          weight: 1,
          type: "reentry",
        });
        savedReentryPairs.add(edgePairKey(node.id, matchedNode.id));
      }
    }

    if (this.config.reentryDetection !== false) {
      const currentRunReentryEdges = findCurrentRunReentryEdges({
        segments: absoluteSegments.map(({ relativeSegment }) => relativeSegment),
        messages: contextMessages,
        embeddings: contextEmbeddings,
        nodeByTopicOrder: nodeByDetectorTopicOrder,
        reentryThreshold: this.config.reentryThreshold ?? 0.85,
        existingPairs: savedReentryPairs,
      });

      for (const edge of currentRunReentryEdges) {
        await this.store.saveEdge(edge);
      }
    }

    await this.linkIncrementalEdges(sessionId, existingNodes, nodes);
    await this.store.updateSessionIngestState(sessionId, messages.length - 1);

    return nodes;
  }

  private toNewAbsoluteSegments(
    segments: DriftSegment[],
    contextStartIndex: number,
    firstNewMessageIndex: number,
    existingNodes: TopicNode[],
  ): Array<{ segment: DriftSegment; detectorTopicOrder: number; relativeSegment: DriftSegment }> {
    const nextTopicOrder = existingNodes.reduce(
      (max, node) => Math.max(max, node.topicOrder),
      0,
    ) + 1;
    const absoluteSegments: Array<{
      segment: DriftSegment;
      detectorTopicOrder: number;
      relativeSegment: DriftSegment;
    }> = [];

    for (const segment of segments) {
      const absoluteStart = contextStartIndex + segment.start;
      const absoluteEnd = contextStartIndex + segment.end;
      if (absoluteEnd < firstNewMessageIndex) continue;

      absoluteSegments.push({
        detectorTopicOrder: segment.topicOrder,
        relativeSegment: segment,
        segment: {
          start: Math.max(absoluteStart, firstNewMessageIndex),
          end: absoluteEnd,
          topicOrder: nextTopicOrder + absoluteSegments.length,
          driftScore: segment.driftScore,
        },
      });
    }

    return absoluteSegments;
  }

  private async linkIncrementalEdges(
    sessionId: string,
    existingNodes: TopicNode[],
    newNodes: TopicNode[],
  ): Promise<void> {
    if (newNodes.length === 0) return;

    const previousNode = existingNodes.reduce<TopicNode | null>((previous, node) => {
      if (!previous || node.topicOrder > previous.topicOrder) return node;
      return previous;
    }, null);

    for (const [index, node] of newNodes.entries()) {
      const temporalTarget = index === 0 ? previousNode : newNodes[index - 1];
      if (temporalTarget && temporalTarget.id !== node.id) {
        await this.store.saveEdge({
          srcId: node.id,
          dstId: temporalTarget.id,
          weight: cosineSimilarity(node.embedding, temporalTarget.embedding),
          type: "temporal",
        });
      }

      const similarNodes = await this.store.getSimilarNodes(node.embedding, sessionId, {
        k: this.config.topK,
        excludeNodeId: node.id,
        minSimilarity: INCREMENTAL_SEMANTIC_THRESHOLD,
      });

      for (const similarNode of similarNodes) {
        if (similarNode.id === node.id) continue;
        await this.store.saveEdge({
          srcId: node.id,
          dstId: similarNode.id,
          weight: cosineSimilarity(node.embedding, similarNode.embedding),
          type: "semantic",
        });
      }
    }
  }

  private async embedMessage(message: Message): Promise<number[]> {
    const content = normalizeText(message.content) ?? message.content;
    return this.embedder.embed(content);
  }

  private async createDriftDetector(sessionId: string): Promise<TopicDriftDetector> {
    const adaptiveConfig = this.config.adaptiveSensitivity;
    const threshold = adaptiveConfig?.enabled
      ? resolveAdaptiveDriftThreshold(
        this.baseDriftThreshold,
        await this.store.getSegmentsBySession(sessionId),
        adaptiveConfig,
      ).threshold
      : this.baseDriftThreshold;

    return new TopicDriftDetector(
      {
        windowSize: this.config.windowSize,
        threshold,
        mode: this.config.mode,
        minSegmentMessages: this.config.minSegmentMessages,
        llmAmbiguityDetection: this.config.llmAmbiguityDetection ?? false,
        reentryDetection: this.config.reentryDetection ?? true,
        reentryThreshold: this.config.reentryThreshold ?? 0.85,
      },
      this.llm,
    );
  }
}
