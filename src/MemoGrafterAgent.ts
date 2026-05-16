import { randomUUID } from "node:crypto";
import { MemoGrafter } from "./MemoGrafter.js";
import { formatCompressedTopic } from "./prompts/historyCompressionPrompt.js";
import type {
  AbsorbFromAgentOptions,
  InjectionResult,
  MemoGrafterConfig,
  Message,
  TopicNode,
  TopicSegment,
} from "./types.js";

export class MemoGrafterAgent {
  private readonly core: MemoGrafter;
  private readonly sessionId = randomUUID();
  private readonly history: Message[] = [];
  private readonly baseSystemPrompt: string;
  private readonly historyTokenBudget: number;
  private pendingIngest: Promise<void> = Promise.resolve();

  constructor(config: MemoGrafterConfig) {
    this.core = new MemoGrafter(config);
    this.baseSystemPrompt = config.systemPrompt ?? "";
    this.historyTokenBudget = config.inject?.tokenBudget ?? 4000;
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

  async graft(topicIds?: string[]): Promise<InjectionResult> {
    await this.pendingIngest;
    const { nodes } = await this.core.getTopics(this.sessionId);
    const selectedTopicIds = topicIds ?? nodes.map((node) => node.id);
    return this.core.inject(this.sessionId, selectedTopicIds);
  }

  ingestGraftedNodes(nodes: TopicNode[]): Promise<TopicNode[]> {
    return this.core.ingestGraftedNodes(nodes, this.sessionId);
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
    const tokenCount = this.countTokens(this.history.map((message) => message.content).join("\n"));
    const overflowThreshold = this.historyTokenBudget * 0.8;

    if (tokenCount < overflowThreshold) {
      return this.history;
    }

    const { nodes, segments } = await this.core.getTopics(this.sessionId);

    if (nodes.length === 0 || segments.length === 0) {
      return this.history;
    }

    const lastCoveredIndex = Math.max(...segments.map((segment) => segment.endIndex));
    const summaryBlocks: Message[] = nodes.map((node) => ({
      role: "system",
      content: formatCompressedTopic(node),
    }));
    const recentMessages = this.history.slice(lastCoveredIndex + 1);

    return [...summaryBlocks, ...recentMessages];
  }

  private countTokens(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }

  close(): Promise<void> {
    return this.pendingIngest.then(() => this.core.close());
  }
}
