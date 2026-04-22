import { GrafterPipeline } from "./pipeline/GrafterPipeline.js";
import { IngestPipeline } from "./pipeline/IngestPipeline.js";
import { GraphStore } from "./store/GraphStore.js";
import type { InjectionResult, LLMAdapter, MemoGrafterConfig, Message, TopicNode, TopicSegment } from "./types.js";

export class MemoGrafter {
  readonly llm: LLMAdapter;
  private readonly store: GraphStore;
  private readonly ingestPipeline: IngestPipeline;
  private readonly grafterPipeline: GrafterPipeline;

  constructor(config: MemoGrafterConfig) {
    const windowSize = config.drift?.windowSize ?? 6;
    const mode = config.drift?.mode ?? "intent";
    const threshold = config.drift?.threshold ?? (mode === "intent" ? 0.8 : 0.3);
    const minSegmentMessages = config.drift?.minSegmentMessages ?? 1;
    const topK = config.graph?.topK ?? 5;
    const hopDepth = config.graph?.hopDepth ?? 1;
    const bufferSize = config.inject?.bufferSize ?? 1;
    const tokenBudget = config.inject?.tokenBudget ?? 4000;

    this.llm = config.llm;
    this.store = new GraphStore(config.db.connectionString);
    this.ingestPipeline = new IngestPipeline(this.store, config.llm, config.embedder, {
      windowSize,
      threshold,
      topK,
      mode,
      minSegmentMessages,
    });
    this.grafterPipeline = new GrafterPipeline(this.store, {
      hopDepth,
      bufferSize,
      tokenBudget,
    });
  }

  initialize(): Promise<void> {
    return this.store.initialize();
  }

  ingest(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    return this.ingestPipeline.run(messages, sessionId);
  }

  async getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }> {
    const nodes = await this.store.getNodesBySession(sessionId);
    const segments = await this.store.getSegmentsBySession(sessionId);
    return { nodes, segments };
  }

  inject(sessionId: string, topicIds: string[]): Promise<InjectionResult> {
    return this.grafterPipeline.run(sessionId, topicIds);
  }

  close(): Promise<void> {
    return this.store.close();
  }
}
