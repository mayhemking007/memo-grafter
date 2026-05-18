import type { GraphStore } from "../store/index.js";
import type { EmbedAdapter, LLMAdapter, Message, TopicNode } from "../types.js";
import { normalizeText } from "../utils/normalizeText.js";
import { SegmentProcessor } from "./SegmentProcessor.js";
import { TopicDriftDetector } from "./TopicDriftDetector.js";

export class IngestPipeline {
  private readonly driftDetector: TopicDriftDetector;
  private readonly segmentProcessor: SegmentProcessor;

  constructor(
    private readonly store: GraphStore,
    llm: LLMAdapter,
    private readonly embedder: EmbedAdapter,
    private readonly config: {
      windowSize: number;
      threshold: number;
      topK: number;
      mode: "window" | "intent";
      minSegmentMessages: number;
    },
  ) {
    this.driftDetector = new TopicDriftDetector({
      windowSize: config.windowSize,
      threshold: config.threshold,
      mode: config.mode,
      minSegmentMessages: config.minSegmentMessages,
    });
    this.segmentProcessor = new SegmentProcessor(store, llm, embedder, {
      topK: config.topK,
      semanticThreshold: 0.6,
    });
  }

  async run(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    if (messages.length === 0) return [];

    await this.store.saveMessages(sessionId, messages);
    await this.store.clearSession(sessionId);

    const embeddings = await Promise.all(messages.map((message) => this.embedMessage(message)));
    const segments = this.driftDetector.detectSegments(messages, embeddings);
    const nodes: TopicNode[] = [];

    for (const segment of segments) {
      nodes.push(await this.segmentProcessor.process(segment, messages, sessionId));
    }

    await this.store.rebuildEdgesForSession(sessionId, this.config.topK);

    return nodes;
  }

  private async embedMessage(message: Message): Promise<number[]> {
    const content = normalizeText(message.content) ?? message.content;
    return this.embedder.embed(content);
  }
}
