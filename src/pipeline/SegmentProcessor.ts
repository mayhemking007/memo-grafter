import { randomUUID } from "node:crypto";
import { buildSegmentExtractionPrompt } from "../prompts/segmentExtractionPrompt.js";
import type { GraphStore } from "../store/index.js";
import type {
  EmbedAdapter,
  ExtractedMemory,
  LLMAdapter,
  MemoryNodeInsert,
  MemoryType,
  Message,
  SegmentExtractionResult,
  TopicNode,
  TopicSegment,
} from "../types.js";
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
    const extracted = this.parseExtraction(raw);
    const summary = this.buildSummary(extracted);
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

  private parseExtraction(raw: string): SegmentExtractionResult {
    try {
      const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
      const result: SegmentExtractionResult = {
        label: this.stringValue(parsed.label) || "Unknown",
        userIntent: this.stringValue(parsed.user_intent),
        outcome: this.stringValue(parsed.outcome),
        open: this.nullableStringValue(parsed.open),
        memories: this.parseMemories(parsed.memories),
      };

      this.lastExtraction = result;
      return result;
    } catch (error) {
      console.warn("SegmentProcessor extraction JSON parse failed; falling back to legacy parsing.", error);
    }

    const label = raw.match(/^LABEL:\s*(.+)$/im)?.[1]?.trim() ?? "Unknown";
    const userIntent = raw.match(/^USER_INTENT:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const outcome = raw.match(/^OUTCOME:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const openText = raw.match(/^OPEN:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const open = openText && openText.toLowerCase() !== "none" ? openText : null;

    const result: SegmentExtractionResult = {
      label,
      userIntent,
      outcome,
      open,
      memories: [],
    };

    this.lastExtraction = result;
    return result;
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
        const embedding = await this.embedder.embed(this.formatMemoryEmbeddingText(memory));
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

  private formatMemoryEmbeddingText(memory: ExtractedMemory): string {
    return `${memory.memoryType}: ${memory.subject} ${memory.predicate}: ${memory.value}`;
  }

  private buildSummary(extracted: SegmentExtractionResult): string {
    const parts = [
      extracted.userIntent && `User wanted: ${extracted.userIntent}`,
      extracted.outcome && `Outcome: ${extracted.outcome}`,
      extracted.open && `Still open: ${extracted.open}`,
    ].filter(Boolean);

    return parts.join(" ");
  }

  private parseMemories(value: unknown): ExtractedMemory[] {
    if (!Array.isArray(value)) return [];

    const validTypes = new Set<MemoryType>(["fact", "insight", "question", "task", "reference"]);
    const memories: ExtractedMemory[] = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        console.warn("SegmentProcessor skipped invalid memory item:", item);
        continue;
      }

      const record = item as Record<string, unknown>;
      const memoryType = this.stringValue(record.memory_type) as MemoryType;
      const subject = this.stringValue(record.subject);
      const predicate = this.stringValue(record.predicate);
      const memoryValue = this.stringValue(record.value);

      if (!validTypes.has(memoryType) || !subject || !predicate || !memoryValue) {
        console.warn("SegmentProcessor skipped incomplete memory item:", item);
        continue;
      }

      memories.push({
        memoryType,
        subject,
        predicate,
        value: memoryValue,
        confidence: this.numberValue(record.confidence, 1),
      });
    }

    return memories;
  }

  private stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private nullableStringValue(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    const text = this.stringValue(value);
    if (!text || text.toLowerCase() === "none") return null;
    return text;
  }

  private numberValue(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
}
