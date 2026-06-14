import { randomUUID } from "node:crypto";
import type { MemoGrafter } from "../../core/MemoGrafter.js";
import { RetrieverPipeline } from "../../retrieval/RetrieverPipeline.js";
import type {
  FleetMemoryMode,
  InjectionResult,
  Message,
  RetrievalResult,
  TopicNode,
  TopicSegment,
} from "../../core/types.js";
import type { FleetGraftByRelevanceOptions, FleetRetrievalOptions, WorkerAgentConfig } from "./types.js";

export class WorkerAgent {
  private readonly agentId: string;
  private readonly sessionId: string;
  private readonly memory: FleetMemoryMode;
  private readonly history: Message[] = [];
  readonly color: string;

  constructor(
    private readonly core: MemoGrafter,
    private readonly fleetId: string,
    private readonly sharedSessionId: string,
    config: WorkerAgentConfig,
  ) {
    if (config.color === "conductor") {
      throw new Error("Worker color 'conductor' is reserved.");
    }

    this.color = config.color;
    this.agentId = config.id ?? randomUUID();
    this.sessionId = config.sessionId ?? randomUUID();
    this.memory = config.memory ?? "local";
  }

  getAgentId(): string {
    return this.agentId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getColor(): string {
    return this.color;
  }

  async invoke(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    const { nodes } = await this.core.getTopics(this.sessionId);
    const topicIds = nodes.map((node) => node.id);
    const { systemPrompt } = await this.core.inject(this.sessionId, topicIds);
    const memoryPrompt = await this.buildFleetMemoryContext(userMessage);
    const combinedPrompt = [systemPrompt, memoryPrompt].filter(Boolean).join("\n\n");
    const response = await this.core.llm.complete(this.history, combinedPrompt);

    this.history.push({ role: "assistant", content: response });
    await this.core.ingestNow(this.history, this.sessionId).catch((error: unknown) => {
      console.warn("MemoGrafter worker ingest warning:", error);
    });
    await this.tagNodes().catch((error: unknown) => {
      console.warn("MemoGrafter worker node tagging warning:", error);
    });

    return response;
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  async getActiveNodes(): Promise<TopicNode[]> {
    const { nodes } = await this.core.getTopics(this.sessionId);
    return nodes;
  }

  async getActiveSegments(): Promise<TopicSegment[]> {
    const { segments } = await this.core.getTopics(this.sessionId);
    return segments;
  }

  async graft(topicIds?: string[]): Promise<InjectionResult> {
    const { nodes } = await this.core.getTopics(this.sessionId);
    const selectedTopicIds = topicIds ?? nodes.map((node) => node.id);
    return this.core.inject(this.sessionId, selectedTopicIds);
  }

  graftByRelevance(query: string, options: FleetGraftByRelevanceOptions = {}): Promise<InjectionResult> {
    const { memory: mode, ...graftOptions } = options;
    return this.core.graftByRelevance(this.sessionId, query, {
      ...graftOptions,
      sessionIds: this.resolveMemorySessionIds(mode),
    });
  }

  recall(query: string, options: FleetRetrievalOptions = {}): Promise<RetrievalResult> {
    const { memory: mode, ...retrievalOptions } = options;
    const pipeline = new RetrieverPipeline(
      this.core.store,
      this.core.embedder,
      {
        ...retrievalOptions,
        sessionIds: this.resolveMemorySessionIds(mode),
      },
      this.core.recallCache,
    );
    return pipeline.run(query, this.sessionId);
  }

  async ingestGraftedNodes(nodes: TopicNode[]): Promise<TopicNode[]> {
    const copiedNodes = await this.core.store.absorbNodes(nodes, this.sessionId, {
      fleetId: this.fleetId,
      agentId: this.agentId,
      agentColor: this.color,
    });
    await this.core.store.rebuildEdgesForSession(this.sessionId);
    return copiedNodes;
  }

  async absorbFromWorker(sourceWorker: WorkerAgent, options: {
    topicIds?: string[];
    prompt?: string;
    minSimilarity?: number;
    limit?: number;
  } = {}): Promise<TopicNode[]> {
    const nodes = await this.selectNodesFromWorker(sourceWorker, options);
    return this.ingestGraftedNodes(nodes);
  }

  async tagNodes(): Promise<void> {
    await this.core.store.tagSessionNodes(this.sessionId, {
      fleetId: this.fleetId,
      agentId: this.agentId,
      agentColor: this.color,
    });
  }

  private async selectNodesFromWorker(sourceWorker: WorkerAgent, options: {
    topicIds?: string[];
    prompt?: string;
    minSimilarity?: number;
    limit?: number;
  }): Promise<TopicNode[]> {
    const sourceNodes = await sourceWorker.getActiveNodes();

    if (options.topicIds && options.topicIds.length > 0) {
      const topicIds = new Set(options.topicIds);
      return sourceNodes.filter((node) => topicIds.has(node.id));
    }

    if (options.prompt) {
      const embedding = await this.core.embedder.embed(options.prompt);
      return this.core.store.getSimilarNodes(embedding, sourceWorker.getSessionId(), {
        k: options.limit ?? 5,
        minSimilarity: options.minSimilarity ?? 0.6,
      });
    }

    return sourceNodes;
  }

  private resolveMemorySessionIds(mode: FleetMemoryMode = this.memory): string[] {
    if (mode === "fleet") return [this.sharedSessionId];
    if (mode === "both") return [this.sessionId, this.sharedSessionId];
    return [this.sessionId];
  }

  private async buildFleetMemoryContext(query: string): Promise<string> {
    if (this.memory === "local") return "";

    try {
      const result = await this.recall(query, {
        memory: this.memory,
        limit: 6,
        minSimilarity: 0.55,
      });
      return result.facts.length > 0 ? result.systemPrompt : "";
    } catch (error: unknown) {
      console.warn("MemoGrafter worker fleet recall warning:", error);
      return "";
    }
  }
}
