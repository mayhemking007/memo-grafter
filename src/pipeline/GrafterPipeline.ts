import { buildMemoryInjectionPrompt, formatMemoryNode } from "../prompts/memoryInjectionPrompt.js";
import type { GraphStore } from "../store/index.js";
import type { InjectionResult, MemoryEdge, MemoryNode, TopicNode } from "../types.js";
import { countApproxTokens } from "../utils/text/tokenCount.js";

export class GrafterPipeline {
  constructor(
    /** @internal */
    private store: GraphStore,
    /** @internal */
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
    let tokenCount = countApproxTokens(systemPrompt);

    while (tokenCount > this.config.tokenBudget && fittedNodes.length > 0) {
      fittedNodes.pop();
      systemPrompt = await this.assemblePrompt(sessionId, fittedNodes);
      tokenCount = countApproxTokens(systemPrompt);
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
    const sessionMemories = await this.store.getMemoriesBySession(sessionId);
    const memoryEdges = await this.store.getMemoryEdgesBySession(sessionId);

    for (const node of nodes) {
      const start = Math.max(0, node.messageRange[0] - this.config.bufferSize);
      const end = node.messageRange[1] + this.config.bufferSize;
      const messages = await this.store.getBufferMessages(sessionId, start, end);
      const topicMemories = sessionMemories.filter((memory) => memory.topicNodeId === node.id);
      blocks.push(formatMemoryNode(
        node,
        messages,
        buildMaintenancePromptContext(topicMemories, sessionMemories, memoryEdges),
      ));
    }

    return buildMemoryInjectionPrompt(blocks);
  }

}

function buildMaintenancePromptContext(
  topicMemories: MemoryNode[],
  sessionMemories: MemoryNode[],
  memoryEdges: MemoryEdge[],
): { notes?: string[]; activeMemories?: MemoryNode[] } {
  const notes: string[] = [];
  const topicMemoryIds = new Set(topicMemories.map((memory) => memory.id));
  const memoriesById = new Map(sessionMemories.map((memory) => [memory.id, memory]));
  const hasMaintenanceEdge = memoryEdges.some((edge) =>
    (edge.edgeType === "conflicts" || edge.edgeType === "updates")
    && (topicMemoryIds.has(edge.sourceId) || topicMemoryIds.has(edge.targetId))
  );
  const hasConflict = topicMemories.some((memory) => memory.hasConflict);
  const supersededMemories = topicMemories.filter((memory) => memory.supersededBy != null);

  for (const memory of supersededMemories) {
    const supersedingMemory = memory.supersededBy ? memoriesById.get(memory.supersededBy) : undefined;
    if (supersedingMemory) {
      notes.push(
        `The fact "${memory.subject} ${memory.predicate}: ${memory.value}" was superseded by "${supersedingMemory.value}".`,
      );
    } else {
      notes.push(
        `The fact "${memory.subject} ${memory.predicate}: ${memory.value}" was superseded by a newer memory.`,
      );
    }
  }

  if (hasConflict || supersededMemories.length > 0 || hasMaintenanceEdge) {
    notes.push("Prefer active memory facts over contradictory historical summary details.");
  }

  const activeMemoriesById = new Map<string, MemoryNode>();
  for (const memory of topicMemories) {
    if (!memory.decayed && memory.supersededBy == null) {
      activeMemoriesById.set(memory.id, memory);
    }
  }
  for (const memory of supersededMemories) {
    const supersedingMemory = memory.supersededBy ? memoriesById.get(memory.supersededBy) : undefined;
    if (supersedingMemory && !supersedingMemory.decayed && supersedingMemory.supersededBy == null) {
      activeMemoriesById.set(supersedingMemory.id, supersedingMemory);
    }
  }
  const activeMemories = [...activeMemoriesById.values()];

  return {
    ...(notes.length > 0 ? { notes } : {}),
    ...(notes.length > 0 && activeMemories.length > 0 ? { activeMemories } : {}),
  };
}
