import { randomUUID } from "node:crypto";
import { MemoGrafter } from "./MemoGrafter.js";
import type { InjectionResult, MemoGrafterConfig, Message, TopicNode, TopicSegment } from "./types.js";

export class MemoGrafterAgent {
  private readonly core: MemoGrafter;
  private readonly sessionId = randomUUID();
  private readonly history: Message[] = [];

  constructor(config: MemoGrafterConfig) {
    this.core = new MemoGrafter(config);
  }

  initialize(): Promise<void> {
    return this.core.initialize();
  }

  async invoke(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    await this.core.ingest(this.history, this.sessionId);
    const { nodes } = await this.core.getTopics(this.sessionId);
    const topicIds = nodes.map((node) => node.id);
    const { systemPrompt } = await this.core.inject(this.sessionId, topicIds);
    const response = await this.core.llm.complete(this.history, systemPrompt);

    this.history.push({ role: "assistant", content: response });
    await this.core.ingest(this.history, this.sessionId);

    return response;
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  getSessionId(): string {
    return this.sessionId;
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

  close(): Promise<void> {
    return this.core.close();
  }
}
