import { randomUUID } from "node:crypto";
import { buildSegmentExtractionPrompt } from "../prompts/segmentExtractionPrompt.js";
import type { GraphStore } from "../store/index.js";
import type {
  EmbedAdapter,
  ExtractedMemory,
  LLMAdapter,
  MemoryNodeInsert,
  Message,
  SegmentExtractionResult,
  TopicNode,
  TopicSegment,
} from "../types.js";
import {
  buildSegmentSummary,
  formatMemoryEmbeddingText,
  parseSegmentExtraction,
} from "../utils/extraction/segmentExtraction.js";
import type { DriftSegment } from "./TopicDriftDetector.js";

export class SegmentProcessor {
  private lastExtraction: SegmentExtractionResult = {
    label: "Unknown",
    userIntent: "",
    outcome: "",
    open: null,
    memories: [],
  };

  constructor(
    private readonly store: GraphStore,
    private readonly llm: LLMAdapter,
    private readonly embedder: EmbedAdapter,
    private readonly config: {
      topK: number;
      semanticThreshold: number;
    },
  ) {}

  async process(segment: DriftSegment, messages: Message[], sessionId: string): Promise<TopicNode> {
    const savedSegment = await this.createSegment(segment, sessionId);
    const topicNode = await this.nodeRunner(savedSegment, messages);
    await this.processMemories(this.lastExtraction.memories, savedSegment, topicNode);
    return topicNode;
  }

  private async createSegment(segment: DriftSegment, sessionId: string): Promise<TopicSegment> {
    return this.store.saveSegment({
      id: randomUUID(),
      sessionId,
      startIndex: segment.start,
      endIndex: segment.end,
      topicOrder: segment.topicOrder,
      driftScore: segment.driftScore,
      createdAt: new Date(),
    });
  }

  private async nodeRunner(segment: TopicSegment, messages: Message[]): Promise<TopicNode> {
    const node = await this.nodeProcessor(messages, segment);
    await this.store.saveNode(node);
    return node;
  }

  private async nodeProcessor(messages: Message[], segment: TopicSegment): Promise<TopicNode> {
    const segmentMessages = messages.slice(segment.startIndex, segment.endIndex + 1);
    const extractionPrompt = buildSegmentExtractionPrompt(segmentMessages);
    const raw = await this.llm.complete([{ role: "user", content: extractionPrompt }]);
    const extracted = parseSegmentExtraction(raw);
    this.lastExtraction = extracted;
    const summary = buildSegmentSummary(extracted);
    const embedding = await this.embedder.embed(summary);

    return {
      id: randomUUID(),
      sessionId: segment.sessionId,
      segmentId: segment.id,
      label: extracted.label,
      summary,
      embedding,
      messageRange: [segment.startIndex, segment.endIndex],
      topicOrder: segment.topicOrder,
      driftScore: segment.driftScore,
      agentColor: null,
      fleetId: null,
      agentId: null,
      createdAt: new Date(),
    };
  }

  private async processMemories(
    memories: ExtractedMemory[],
    segment: TopicSegment,
    topicNode: TopicNode,
  ): Promise<void> {
    if (memories.length === 0) return;

    try {
      const nodes: MemoryNodeInsert[] = [];

      for (const memory of memories) {
        const embedding = await this.embedder.embed(formatMemoryEmbeddingText(memory));
        nodes.push({
          id: randomUUID(),
          segmentId: segment.id,
          topicNodeId: topicNode.id,
          sessionId: segment.sessionId,
          agentId: topicNode.agentId,
          agentColor: topicNode.agentColor,
          fleetId: topicNode.fleetId,
          memoryType: memory.memoryType,
          sourceType: "conversation",
          subject: memory.subject,
          predicate: memory.predicate,
          value: memory.value,
          confidence: memory.confidence,
          embedding,
          sourceUrl: null,
          sourceTitle: null,
          supersededBy: null,
          decayed: false,
        });
      }

      await this.store.insertMemories(nodes);
      await this.store.buildMemoryEdges(topicNode.id, segment.sessionId, this.config.semanticThreshold);
    } catch (error) {
      console.warn("SegmentProcessor memory processing warning:", error);
    }
  }
}
