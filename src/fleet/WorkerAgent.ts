import { randomUUID } from "node:crypto";
import type { MemoGrafter } from "../MemoGrafter.js";
import type { InjectionResult, Message, TopicNode, TopicSegment } from "../types.js";
import type { WorkerAgentConfig } from "./types.js";

export class WorkerAgent {
  private readonly agentId: string;
  private readonly sessionId: string;
  private readonly history: Message[] = [];
  readonly color: string;

  constructor(
    private readonly core: MemoGrafter,
    private readonly fleetId: string,
    config: WorkerAgentConfig,
  ) {
    if (config.color === "conductor") {
      throw new Error("Worker color 'conductor' is reserved.");
    }

    this.color = config.color;
    this.agentId = config.id ?? randomUUID();
    this.sessionId = config.sessionId ?? randomUUID();
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
    const response = await this.core.llm.complete(this.history, systemPrompt);

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
}
