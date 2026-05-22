import { randomUUID } from "node:crypto";
import { MemoGrafter } from "./MemoGrafter.js";
import { RetrieverPipeline } from "./pipeline/RetrieverPipeline.js";
import { countApproxTokens } from "./utils/text/tokenCount.js";
import type {
  AbsorbFromAgentOptions,
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
  private readonly historyTokenBudget: number;
  private readonly recentWindowSize: number;
  private readonly cacheConfig: MemoGrafterConfig["cache"];
  private pendingIngest: Promise<void> = Promise.resolve();

  constructor(config: MemoGrafterConfig) {
    this.core = new MemoGrafter(config);
    this.baseSystemPrompt = config.systemPrompt ?? "";
    this.historyTokenBudget = config.inject?.tokenBudget ?? 4000;
    this.recentWindowSize = config.inject?.recentWindowSize ?? 20;
    this.cacheConfig = config.cache;
  }

  initialize(): Promise<void> {
    return this.core.initialize();
  }

  async invoke(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const messages = await this.buildHistory();
    const response = await this.core.llm.complete(messages, this.baseSystemPrompt);

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

    return {
      sessionId: this.sessionId,
      nodes,
      edges,
      memories,
      capturedAt: new Date().toISOString(),
    };
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

  private async buildHistory(): Promise<Message[]> {
    const tokenCount = countApproxTokens(this.history.map((message) => message.content).join("\n"));
    const overflowThreshold = this.historyTokenBudget * 0.8;

    if (tokenCount < overflowThreshold) {
      return this.history;
    }

    const recentMessages = this.history.slice(-this.recentWindowSize);
    const recentContext = this.history
      .slice(-6)
      .map((message) => message.content)
      .join("\n");

    try {
      const result = await this.recall(recentContext, { limit: 5, minSimilarity: 0.65 });
      const pinnedMessage: Message = {
        role: "system",
        content: result.systemPrompt,
      };

      return [pinnedMessage, ...recentMessages];
    } catch (error: unknown) {
      console.warn("MemoGrafter recall warning:", error);
      return recentMessages;
    }
  }

  close(): Promise<void> {
    return this.pendingIngest.then(() => this.core.close());
  }
}
