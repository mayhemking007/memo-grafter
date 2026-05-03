import type { MemoGrafter } from "../MemoGrafter.js";
import type { TopicNode } from "../types.js";
import type { ConductorGraftOptions } from "./types.js";
import { WorkerAgent } from "./WorkerAgent.js";

export class ConductorAgent {
  constructor(
    private readonly core: MemoGrafter,
    private readonly fleetId: string,
    private readonly getWorkerByColor: (color: string) => WorkerAgent | undefined,
  ) {}

  async graftColorIntoAgent(sourceColor: string, targetAgent: WorkerAgent, options: ConductorGraftOptions = {}): Promise<TopicNode[]> {
    const nodes = await this.selectNodesByColor(sourceColor, options);
    return targetAgent.ingestGraftedNodes(nodes);
  }

  async graftByPrompt(prompt: string, targetAgent: WorkerAgent, options: Omit<ConductorGraftOptions, "prompt"> = {}): Promise<TopicNode[]> {
    const sourceNodes = await this.core.store.getSimilarNodesAcrossFleet(this.fleetId, await this.core.embedder.embed(prompt), {
      k: options.limit ?? 5,
      minSimilarity: options.minSimilarity ?? 0.6,
    });
    return targetAgent.ingestGraftedNodes(sourceNodes);
  }

  getWorker(color: string): WorkerAgent | undefined {
    return this.getWorkerByColor(color);
  }

  private async selectNodesByColor(sourceColor: string, options: ConductorGraftOptions): Promise<TopicNode[]> {
    if (options.prompt) {
      return this.core.store.getSimilarNodesAcrossFleet(this.fleetId, await this.core.embedder.embed(options.prompt), {
        k: options.limit ?? 5,
        minSimilarity: options.minSimilarity ?? 0.6,
        agentColor: sourceColor,
      });
    }

    const nodes = await this.core.store.getNodesByColor(this.fleetId, sourceColor);
    if (options.topicIds && options.topicIds.length > 0) {
      const topicIds = new Set(options.topicIds);
      return nodes.filter((node) => topicIds.has(node.id));
    }

    return nodes.slice(0, options.limit ?? nodes.length);
  }
}
