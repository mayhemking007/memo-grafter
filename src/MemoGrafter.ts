import { GrafterPipeline } from "./pipeline/GrafterPipeline.js";
import { IngestPipeline } from "./pipeline/IngestPipeline.js";
import { IngestQueue } from "./queue/IngestQueue.js";
import { PostgresGraphStore } from "./store/index.js";
import { MemoGrafterFleet } from "./fleet/MemoGrafterFleet.js";
import type { MemoGrafterFleetOptions } from "./fleet/types.js";
import type { GraphStore } from "./store/index.js";
import type {
  AbsorbFromAgentOptions,
  EmbedAdapter,
  InjectionResult,
  LLMAdapter,
  MemoGrafterConfig,
  Message,
  TopicNode,
  TopicSegment,
} from "./types.js";

export class MemoGrafter {
  readonly llm: LLMAdapter;
  readonly embedder: EmbedAdapter;
  readonly store: GraphStore;
  private readonly ingestPipeline: IngestPipeline;
  private readonly grafterPipeline: GrafterPipeline;
  private readonly ingestQueue: IngestQueue | null;

  constructor(config: MemoGrafterConfig) {
    this.assertServerEnvironment();

    const windowSize = config.drift?.windowSize ?? 5;
    const mode = config.drift?.mode ?? "intent";
    const threshold = config.drift?.threshold;
    const driftSensitivity = config.drift?.driftSensitivity;
    const minSegmentMessages = config.drift?.minSegmentMessages ?? 3;
    const llmAmbiguityDetection = config.drift?.llmAmbiguityDetection;
    const reentryDetection = config.drift?.reentryDetection;
    const reentryThreshold = config.drift?.reentryThreshold;
    const topK = config.graph?.topK ?? 5;
    const hopDepth = config.graph?.hopDepth ?? 1;
    const bufferSize = config.inject?.bufferSize ?? 1;
    const tokenBudget = config.inject?.tokenBudget ?? 4000;

    this.llm = config.llm;
    this.embedder = config.embedder;
    this.store = new PostgresGraphStore(config.db.connectionString);
    const ingestConfig = {
      windowSize,
      topK,
      mode,
      minSegmentMessages,
    };

    this.ingestPipeline = new IngestPipeline(this.store, config.llm, config.embedder, {
      ...ingestConfig,
      ...(threshold !== undefined ? { threshold } : {}),
      ...(driftSensitivity !== undefined ? { driftSensitivity } : {}),
      ...(llmAmbiguityDetection !== undefined ? { llmAmbiguityDetection } : {}),
      ...(reentryDetection !== undefined ? { reentryDetection } : {}),
      ...(reentryThreshold !== undefined ? { reentryThreshold } : {}),
    });
    this.grafterPipeline = new GrafterPipeline(this.store, {
      hopDepth,
      bufferSize,
      tokenBudget,
    });
    this.ingestQueue = config.queue ? new IngestQueue(this.ingestPipeline, config.queue) : null;
  }

  initialize(): Promise<void> {
    return this.store.initialize();
  }

  ingest(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    if (this.ingestQueue) {
      return this.enqueueIngest(messages, sessionId).then(() => []);
    }

    return this.ingestPipeline.run(messages, sessionId);
  }

  ingestNow(messages: Message[], sessionId: string): Promise<TopicNode[]> {
    return this.ingestPipeline.run(messages, sessionId);
  }

  async enqueueIngest(messages: Message[], sessionId: string): Promise<void> {
    if (this.ingestQueue) {
      await this.ingestQueue.enqueue(messages, sessionId);
      return;
    }

    await this.ingestPipeline.run(messages, sessionId);
  }

  async getTopics(sessionId: string): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }> {
    const nodes = await this.store.getNodesBySession(sessionId);
    const segments = await this.store.getSegmentsBySession(sessionId);
    return { nodes, segments };
  }

  inject(sessionId: string, topicIds: string[]): Promise<InjectionResult> {
    return this.grafterPipeline.run(sessionId, topicIds);
  }

  async ingestGraftedNodes(nodes: TopicNode[], targetSessionId: string): Promise<TopicNode[]> {
    const copiedNodes = await this.store.absorbNodes(nodes, targetSessionId);
    await this.store.rebuildEdgesForSession(targetSessionId);
    return copiedNodes;
  }

  async selectNodesForAbsorb(sourceSessionId: string, options: AbsorbFromAgentOptions): Promise<TopicNode[]> {
    const sourceNodes = await this.store.getNodesBySession(sourceSessionId);

    if (options.topicIds && options.topicIds.length > 0) {
      const topicIds = new Set(options.topicIds);
      return sourceNodes.filter((node) => topicIds.has(node.id));
    }

    if (options.prompt) {
      const embedding = await this.embedder.embed(options.prompt);
      return this.store.getSimilarNodes(embedding, sourceSessionId, {
        k: options.limit ?? 5,
        minSimilarity: options.minSimilarity ?? 0.6,
      });
    }

    return sourceNodes;
  }

  async absorbNodes(nodes: TopicNode[], targetSessionId: string): Promise<TopicNode[]> {
    const copiedNodes = await this.store.absorbNodes(nodes, targetSessionId);
    await this.store.rebuildEdgesForSession(targetSessionId);
    return copiedNodes;
  }

  createFleet(options: MemoGrafterFleetOptions = {}): MemoGrafterFleet {
    return new MemoGrafterFleet(this, options);
  }

  async close(): Promise<void> {
    await this.ingestQueue?.close();
    await this.store.close();
  }

  private assertServerEnvironment(): void {
    const globalScope = globalThis as typeof globalThis & {
      document?: unknown;
      window?: unknown;
    };

    if (typeof globalScope.window !== "undefined" && typeof globalScope.document !== "undefined") {
      throw new Error("MemoGrafter requires a Node.js server environment and cannot run in the browser.");
    }
  }
}
