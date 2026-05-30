import { randomUUID } from "node:crypto";
import { MemoGrafter } from "./MemoGrafter.js";
import { RetrieverPipeline } from "./pipeline/RetrieverPipeline.js";
import type {
  AbsorbFromAgentOptions,
  GraftRegistryEntry,
  GraphSnapshot,
  InjectionResult,
  MemoGrafterConfig,
  Message,
  RetrievalResult,
  RetrieverConfig,
  TopicNode,
  TopicSegment,
} from "./types.js";

export class MemoGrafterAgent {
  private readonly core: MemoGrafter;
  private readonly sessionId = randomUUID();
  private readonly history: Message[] = [];
  private readonly baseSystemPrompt: string;
  private readonly recentWindowSize: number;
  private readonly recallLimit: number;
  private readonly recallMinSimilarity: number;
  private readonly cacheConfig: MemoGrafterConfig["cache"];
  private pendingIngest: Promise<void> = Promise.resolve();

  constructor(config: MemoGrafterConfig) {
    this.core = new MemoGrafter(config);
    this.baseSystemPrompt = config.systemPrompt ?? "";
    this.recentWindowSize = config.inject?.recentWindowSize ?? 20;
    this.recallLimit = config.inject?.recallLimit ?? 6;
    this.recallMinSimilarity = config.inject?.recallMinSimilarity ?? 0.55;
    this.cacheConfig = config.cache;
  }

  initialize(): Promise<void> {
    return this.core.initialize();
  }

  async invoke(userMessage: string): Promise<string> {
    const memoryContext = await this._buildMemoryContext(userMessage, {
      limit: this.recallLimit,
      minSimilarity: this.recallMinSimilarity,
    });
    const recentMessages = this.history.slice(-this.recentWindowSize);
    const messages: Message[] = [
      ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
      ...recentMessages,
      { role: "user", content: userMessage },
    ];
    const response = await this.core.llm.complete(messages, this.baseSystemPrompt);

    this.history.push({ role: "user", content: userMessage });
    this.history.push({ role: "assistant", content: response });
    this.enqueueBackgroundIngest();

    return response;
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async getActiveNodes(): Promise<TopicNode[]> {
    await this.pendingIngest;
    const { nodes } = await this.core.getTopics(this.sessionId);
    return nodes;
  }

  async getActiveSegments(): Promise<TopicSegment[]> {
    await this.pendingIngest;
    const { segments } = await this.core.getTopics(this.sessionId);
    return segments;
  }

  async getGraphSnapshot(): Promise<GraphSnapshot> {
    await this.pendingIngest;
    const { nodes } = await this.core.getTopics(this.sessionId);
    const edges = await this.core.store.getEdgesBySession(this.sessionId);
    const memories = await this.core.store.getMemoriesBySession(this.sessionId);
    const memoryEdges = await this.core.store.getMemoryEdgesBySession(this.sessionId);
    const registry = await this.core.store.getGraftRegistry(this.sessionId);
    const registryByNodeId = new Map(registry.map((entry) => [entry.nodeId, entry]));

    return {
      sessionId: this.sessionId,
      nodes,
      snapshotNodes: nodes.map((node) => {
        const graftEntry = registryByNodeId.get(node.id);

        return {
          node,
          ...(graftEntry
            ? {
              graftOrigin: {
                sourceSessionId: graftEntry.sourceSessionId,
                sourceNodeId: graftEntry.sourceNodeId,
                graftedAt: graftEntry.graftedAt,
              },
            }
            : {}),
        };
      }),
      edges,
      memories,
      memoryEdges,
      capturedAt: new Date().toISOString(),
    };
  }

  async getGraftRegistry(): Promise<GraftRegistryEntry[]> {
    await this.pendingIngest;
    return this.core.store.getGraftRegistry(this.sessionId);
  }

  async removeGraft(nodeId: string): Promise<void> {
    await this.pendingIngest;
    const registry = await this.core.store.getGraftRegistry(this.sessionId);
    const entry = registry.find((candidate) => candidate.nodeId === nodeId);
    if (!entry) {
      throw new Error(`No graft registered for node ${nodeId} in this session.`);
    }

    await this.core.store.deleteNode(nodeId, this.sessionId);
  }

  async clearSession(): Promise<void> {
    await this.pendingIngest;
    await this.core.store.clearSession(this.sessionId);
    this.history.splice(0, this.history.length);
  }

  async graft(topicIds?: string[]): Promise<InjectionResult> {
    await this.pendingIngest;
    const { nodes } = await this.core.getTopics(this.sessionId);
    const selectedTopicIds = topicIds ?? nodes.map((node) => node.id);
    return this.core.inject(this.sessionId, selectedTopicIds);
  }

  ingestGraftedNodes(nodes: TopicNode[]): Promise<TopicNode[]> {
    return this.core.ingestGraftedNodes(nodes, this.sessionId);
  }

  async recall(query: string, options: RetrieverConfig = {}): Promise<RetrievalResult> {
    const cacheConfig = options.cache ?? (this.cacheConfig
      ? {
        ...(this.cacheConfig.ttlSeconds !== undefined ? { ttlSeconds: this.cacheConfig.ttlSeconds } : {}),
      }
      : undefined);
    const pipeline = new RetrieverPipeline(
      this.core.store,
      this.core.embedder,
      {
        ...options,
        ...(cacheConfig !== undefined ? { cache: cacheConfig } : {}),
      },
      this.core.recallCache,
    );
    return pipeline.run(query, this.getSessionId());
  }

  async absorbFromAgent(sourceAgent: MemoGrafterAgent, options: AbsorbFromAgentOptions = {}): Promise<TopicNode[]> {
    const nodes = await sourceAgent.core.selectNodesForAbsorb(sourceAgent.getSessionId(), options);
    return this.core.absorbNodes(nodes, this.sessionId);
  }

  private enqueueBackgroundIngest(): void {
    const historySnapshot = [...this.history];

    this.pendingIngest = this.pendingIngest
      .then(() => this.core.enqueueIngest(historySnapshot, this.sessionId))
      .catch((error: unknown) => {
        console.warn("MemoGrafter background ingest warning:", error);
      });
  }

  private async _buildMemoryContext(
    query: string,
    options: { limit: number; minSimilarity: number },
  ): Promise<string | null> {
    try {
      const nodeCount = await this.core.store.getSessionNodeCount(this.sessionId);
      if (nodeCount === 0) return null;

      const result = await this.recall(query, {
        limit: options.limit,
        minSimilarity: options.minSimilarity,
      });

      if (result.facts.length === 0) return null;

      return result.systemPrompt;
    } catch (error: unknown) {
      console.warn("MemoGrafter recall warning:", error);
      return null;
    }
  }

  close(): Promise<void> {
    return this.pendingIngest.then(() => this.core.close());
  }
}
