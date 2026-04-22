import type { GraphStore } from "../store/GraphStore.js";
import type { InjectionResult, Message, TopicNode } from "../types.js";

export class GrafterPipeline {
  constructor(
    private store: GraphStore,
    private config: {
      hopDepth: number;
      bufferSize: number;
      tokenBudget: number;
    },
  ) {}

  async run(sessionId: string, topicIds: string[]): Promise<InjectionResult> {
    if (topicIds.length === 0) {
      return { systemPrompt: "", nodes: [], tokenCount: 0 };
    }

    const neighbourhood = await this.store.getNeighbours(topicIds, this.config.hopDepth);
    const nodes = neighbourhood.sort((a, b) => a.messageRange[0] - b.messageRange[0]);
    const fittedNodes = [...nodes];
    let systemPrompt = await this.assemblePrompt(sessionId, fittedNodes);
    let tokenCount = this.countTokens(systemPrompt);

    while (tokenCount > this.config.tokenBudget && fittedNodes.length > 1) {
      fittedNodes.pop();
      systemPrompt = await this.assemblePrompt(sessionId, fittedNodes);
      tokenCount = this.countTokens(systemPrompt);
    }

    return {
      systemPrompt,
      nodes: fittedNodes,
      tokenCount,
    };
  }

  private async assemblePrompt(sessionId: string, nodes: TopicNode[]): Promise<string> {
    const blocks: string[] = [];

    for (const node of nodes) {
      const start = Math.max(0, node.messageRange[0] - this.config.bufferSize);
      const end = node.messageRange[1] + this.config.bufferSize;
      const messages = await this.store.getBufferMessages(sessionId, start, end);
      blocks.push(this.formatNode(node, messages));
    }

    return blocks.join("\n---\n");
  }

  private formatNode(node: TopicNode, messages: Message[]): string {
    const context = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    return `[Topic: ${node.label}]\nSummary: ${node.summary}\nContext:\n${context}`;
  }

  private countTokens(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }
}
