import { Redis } from "ioredis";
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
  GraftByRelevanceOptions,
  IngestOptions,
  IngestPipelineOptions,
  IngestTextOptions,
  InjectionResult,
  LLMAdapter,
  MemoryDiff,
  MemoryHistoryOptions,
  MemoryHistoryResult,
  MemoGrafterConfig,
  Message,
  TagFilterOptions,
  TopicNode,
  TopicSegment,
} from "./types.js";

export class MemoGrafter {
  readonly llm: LLMAdapter;
  readonly embedder: EmbedAdapter;
  readonly store: GraphStore;
  readonly recallCache: Redis | null;
  private readonly ingestPipeline: IngestPipeline;
  private readonly grafterPipeline: GrafterPipeline;
  private readonly ingestQueue: IngestQueue | null;
  private readonly graphTopK: number;
  private readonly graphHopDepth: number;

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
    const adaptiveSensitivity = config.drift?.adaptiveSensitivity;
    const topK = config.graph?.topK ?? 5;
    const hopDepth = config.graph?.hopDepth ?? 1;
    const bufferSize = config.inject?.bufferSize ?? 1;
    const tokenBudget = config.inject?.tokenBudget ?? 4000;

    this.llm = config.llm;
    this.embedder = config.embedder;
    this.store = new PostgresGraphStore(config.db.connectionString);
    this.graphTopK = topK;
    this.graphHopDepth = hopDepth;
    this.recallCache = config.cache
      ? new Redis(config.cache.connectionString, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
      : null;
    this.recallCache?.on("error", (error: Error) => {
      console.warn("MemoGrafter recall cache Redis warning:", error.message);
    });
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
      ...(adaptiveSensitivity !== undefined ? { adaptiveSensitivity } : {}),
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

  ingest(messages: Message[], sessionId: string, options: IngestOptions = {}): Promise<TopicNode[]> {
    if (this.ingestQueue) {
      return this.enqueueIngest(messages, sessionId, options).then(() => []);
    }

    return this.ingestPipeline.run(messages, sessionId, options);
  }

  ingestNow(messages: Message[], sessionId: string, options: IngestOptions = {}): Promise<TopicNode[]> {
    return this.ingestPipeline.run(messages, sessionId, options);
  }

  async enqueueIngest(messages: Message[], sessionId: string, options: IngestOptions = {}): Promise<void> {
    if (this.ingestQueue) {
      await this.ingestQueue.enqueue(messages, sessionId, options);
      return;
    }

    await this.ingestPipeline.run(messages, sessionId, options);
  }

  ingestText(text: string, sessionId: string, options: IngestTextOptions & IngestOptions = {}): Promise<TopicNode[]> {
    const pipelineOptions = this.toTextPipelineOptions(options);
    if (this.ingestQueue) {
      return this.enqueueTextIngest(text, sessionId, options).then(() => []);
    }

    return this.ingestPipeline.runText(text, sessionId, pipelineOptions);
  }

  async enqueueTextIngest(text: string, sessionId: string, options: IngestTextOptions & IngestOptions = {}): Promise<void> {
    const pipelineOptions = this.toTextPipelineOptions(options);
    if (this.ingestQueue) {
      await this.ingestQueue.enqueueText(text, sessionId, pipelineOptions);
      return;
    }

    await this.ingestPipeline.runText(text, sessionId, pipelineOptions);
  }

  async getTopics(sessionId: string, options: TagFilterOptions = {}): Promise<{ nodes: TopicNode[]; segments: TopicSegment[] }> {
    const nodes = await this.store.getNodesBySession(sessionId, options);
    const segments = await this.store.getSegmentsBySession(sessionId);
    return { nodes, segments };
  }

  inject(sessionId: string, topicIds: string[]): Promise<InjectionResult> {
    return this.grafterPipeline.run(sessionId, topicIds);
  }

  async forget(memoryId: string): Promise<boolean> {
    const changed = await this.store.forgetMemory(memoryId);
    if (changed) await this.clearRecallCache();
    return changed;
  }

  async forgetMany(memoryIds: string[]): Promise<number> {
    const changed = await this.store.forgetMemories(memoryIds);
    if (changed > 0) await this.clearRecallCache();
    return changed;
  }

  async suppressTopic(topicId: string): Promise<boolean> {
    const changed = await this.store.suppressTopic(topicId);
    if (changed) await this.clearRecallCache();
    return changed;
  }

  async restoreTopic(topicId: string): Promise<boolean> {
    const changed = await this.store.restoreTopic(topicId);
    if (changed) await this.clearRecallCache();
    return changed;
  }

  getMemoryHistory(memoryId: string, options?: MemoryHistoryOptions): Promise<MemoryHistoryResult>;
  getMemoryHistory(subject: string, predicate: string, options?: MemoryHistoryOptions): Promise<MemoryHistoryResult>;
  getMemoryHistory(
    memoryIdOrSubject: string,
    predicateOrOptions?: string | MemoryHistoryOptions,
    options: MemoryHistoryOptions = {},
  ): Promise<MemoryHistoryResult> {
    if (typeof predicateOrOptions === "string") {
      return this.store.getMemoryHistoryByFact(memoryIdOrSubject, predicateOrOptions, options);
    }

    return this.store.getMemoryHistoryById(memoryIdOrSubject, predicateOrOptions ?? {});
  }

  getMemoryDiff(fromMemoryId: string, toMemoryId: string): Promise<MemoryDiff> {
    return this.store.getMemoryDiff(fromMemoryId, toMemoryId);
  }

  async graftByRelevance(
    sessionId: string,
    query: string,
    options: GraftByRelevanceOptions = {},
  ): Promise<InjectionResult> {
    const embedding = await this.embedder.embed(query);
    const configuredSessionIds = options.sessionIds?.filter(Boolean) ?? [];
    const sessionIds = this.resolveSessionIds(sessionId, configuredSessionIds);
    const useConfiguredSessions = configuredSessionIds.length > 0
      && (sessionIds.length > 1 || sessionIds[0] !== sessionId);
    const seedNodes = useConfiguredSessions
      ? await this.store.getSimilarNodesAcrossSessions(embedding, sessionIds, {
        k: options.topK ?? this.graphTopK,
        minSimilarity: options.minSimilarity ?? 0.6,
      })
      : await this.store.getSimilarNodes(embedding, sessionId, {
        k: options.topK ?? this.graphTopK,
        minSimilarity: options.minSimilarity ?? 0.6,
      });

    if (seedNodes.length === 0) {
      return { systemPrompt: "", nodes: [], tokenCount: 0 };
    }

    return this.grafterPipeline.run(
      sessionId,
      seedNodes.map((node) => node.id),
      {
        hopDepth: options.hopDepth ?? this.graphHopDepth,
        expansionStrategy: options.expansionStrategy ?? "graph",
        ...(configuredSessionIds.length > 0 ? { sessionIds } : {}),
      },
    );
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
    await this.recallCache?.quit().catch((error: unknown) => {
      console.warn("MemoGrafter recall cache close warning:", error);
      this.recallCache?.disconnect();
    });
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

  private toTextPipelineOptions(options: IngestTextOptions & IngestOptions): IngestPipelineOptions {
    return {
      ...(options.replace ? { replace: true } : {}),
      ...(options.label ? { label: options.label } : {}),
      ...(options.source ? { source: options.source } : {}),
      ...(options.tags ? { tags: options.tags } : {}),
      sourceType: "document",
    };
  }

  private async clearRecallCache(): Promise<void> {
    if (!this.recallCache) return;

    try {
      const keys = await this.recallCache.keys("mg:recall:*");
      if (keys.length > 0) {
        await this.recallCache.del(...keys);
      }
    } catch (error: unknown) {
      console.warn("MemoGrafter recall cache invalidation warning:", error);
    }
  }

  private resolveSessionIds(sessionId: string, configured?: string[]): string[] {
    const sessionIds = configured && configured.length > 0 ? configured : [sessionId];
    return [...new Set(sessionIds)];
  }
}
