import type { GraphStore } from "../store/GraphStore.js";
import type { EmbedAdapter, LLMAdapter, Message, TopicNode } from "../types.js";
import { normalizeText } from "../utils/normalizeText.js";
import { SegmentProcessor } from "./SegmentProcessor.js";
import { TopicDriftDetector, type DriftState } from "./TopicDriftDetector.js";

export class IngestPipeline {
  private readonly driftDetector: TopicDriftDetector;
  private readonly segmentProcessor: SegmentProcessor;

  constructor(
    private readonly store: GraphStore,
    llm: LLMAdapter,
    private readonly embedder: EmbedAdapter,
    config: {
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
    await this.store.clearSessionGraph(sessionId);

    let driftState: DriftState | null = null;
    const nodes: TopicNode[] = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message) continue;

      const embedding = await this.embedMessage(message);
      driftState ??= this.driftDetector.createInitialState(index);

      const result = this.driftDetector.processMessage(driftState, message, embedding, index);
      driftState = result.state;

      if (result.segment) {
        nodes.push(await this.segmentProcessor.process(result.segment, messages, sessionId));
      }
    }

    if (driftState) {
      const finalSegment = this.driftDetector.createFinalSegment(driftState);
      if (finalSegment) {
        nodes.push(await this.segmentProcessor.process(finalSegment, messages, sessionId));
      }
    }

    return nodes;
  }

  private async embedMessage(message: Message): Promise<number[]> {
    const content = normalizeText(message.content) ?? message.content;
    return this.embedder.embed(content);
  }
}
