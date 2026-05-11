import { randomUUID } from "node:crypto";
import type { GraphStore } from "../store/GraphStore.js";
import type { EmbedAdapter, LLMAdapter, Message, TopicNode, TopicSegment } from "../types.js";
import { normalizeText } from "../utils/normalizeText.js";
import type { DriftSegment } from "./TopicDriftDetector.js";

export class SegmentProcessor {
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
    return this.nodeRunner(savedSegment, messages);
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
    const messageContent = segmentMessages
      .map((message, index) => `Message ${index + 1}:\n[${message.role}] ${normalizeText(message.content) ?? message.content}`)
      .join("\n\n");

    const extractionPrompt = [
      "Analyze this conversation segment and extract structured memory for a future chatbot.",
      "",
      "Identify:",
      "- The core topic being discussed",
      "- What the user wanted to know, do, or accomplish",
      "- What the assistant provided, decided, or concluded",
      "- Any unresolved questions or open threads",
      "",
      "Respond only in this exact format with no extra text:",
      "LABEL: <3-6 word topic label>",
      "USER_INTENT: <two-three sentences describing what the user was trying to achieve or understand>",
      "OUTCOME: <one-two sentences describing what was concluded, decided, or provided>",
      "OPEN: <one sentence describing any unresolved question or follow-up, or None if fully resolved>",
      "",
      "Conversation segment:",
      messageContent,
    ].join("\n");

    const raw = await this.llm.complete([{ role: "user", content: extractionPrompt }]);
    const extracted = this.parseExtraction(raw);
    const embedding = await this.embedder.embed(extracted.summary);

    return {
      id: randomUUID(),
      sessionId: segment.sessionId,
      segmentId: segment.id,
      label: extracted.label,
      summary: extracted.summary,
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

  private parseExtraction(raw: string): { label: string; summary: string } {
    const label = raw.match(/^LABEL:\s*(.+)$/im)?.[1]?.trim() ?? "Unknown";
    const userIntent = raw.match(/^USER_INTENT:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const outcome = raw.match(/^OUTCOME:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const open = raw.match(/^OPEN:\s*(.+)$/im)?.[1]?.trim() ?? "";

    const parts = [
      userIntent && `User wanted: ${userIntent}`,
      outcome && `Outcome: ${outcome}`,
      open && open.toLowerCase() !== "none" && `Still open: ${open}`,
    ].filter(Boolean);

    return {
      label,
      summary: parts.join(" "),
    };
  }
}
