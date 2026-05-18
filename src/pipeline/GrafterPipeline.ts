import { buildMemoryInjectionPrompt, formatMemoryNode } from "../prompts/memoryInjectionPrompt.js";
import type { GraphStore } from "../store/index.js";
import type { InjectionResult, TopicNode } from "../types.js";

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

    const neighbourhood = await this.store.getNeighbours(topicIds, this.config.hopDepth, sessionId);
    const nodes = neighbourhood.sort((a, b) =>
      a.messageRange[0] - b.messageRange[0]
      || a.messageRange[1] - b.messageRange[1]
      || a.topicOrder - b.topicOrder
    );
    const fittedNodes = [...nodes];
    let systemPrompt = await this.assemblePrompt(sessionId, fittedNodes);
    let tokenCount = this.countTokens(systemPrompt);

    while (tokenCount > this.config.tokenBudget && fittedNodes.length > 0) {
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
    if (nodes.length === 0) return "";

    const blocks: string[] = [];

    for (const node of nodes) {
      const start = Math.max(0, node.messageRange[0] - this.config.bufferSize);
      const end = node.messageRange[1] + this.config.bufferSize;
      const messages = await this.store.getBufferMessages(sessionId, start, end);
      blocks.push(formatMemoryNode(node, messages));
    }

    return buildMemoryInjectionPrompt(blocks);
  }

  private countTokens(prompt: string): number {
    return Math.ceil(prompt.length / 4);
  }
}
