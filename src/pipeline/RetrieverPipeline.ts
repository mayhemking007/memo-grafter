import {
  buildFactRetrievalPrompt,
  formatFactBlock,
} from "../prompts/factRetrievalPrompt.js";
import type { GraphStore } from "../store/index.js";
import type {
  EmbedAdapter,
  MemoryNode,
  RetrievalResult,
  RetrieverConfig,
  TopicNode,
} from "../types.js";
import { countApproxTokens } from "../utils/text/tokenCount.js";

type ScoredMemoryNode = MemoryNode & { similarity: number };

interface RetrievedBlock {
  facts: ScoredMemoryNode[];
  parentNode: TopicNode;
  score: number;
}

export class RetrieverPipeline {
  constructor(
    private store: GraphStore,
    private embedder: EmbedAdapter,
    private config: RetrieverConfig,
  ) {}

  async run(query: string, sessionId: string): Promise<RetrievalResult> {
    const limit = this.config.limit ?? 10;
    const minSimilarity = this.config.minSimilarity ?? 0.6;
    const tokenBudget = this.config.tokenBudget ?? 1200;

    const embedding = await this.embedder.embed(query);
    const searchedFacts = await this.store.searchMemories(
      embedding,
      sessionId,
      limit,
      minSimilarity,
    );
    const activeFacts = searchedFacts.filter((fact) =>
      fact.decayed === false && fact.supersededBy == null
    );

    if (activeFacts.length === 0) {
      return {
        facts: [],
        nodes: [],
        systemPrompt: buildFactRetrievalPrompt([]),
        tokenCount: 0,
      };
    }

    const rankedBlocks = (await this.buildBlocks(activeFacts, sessionId))
      .sort((a, b) => b.score - a.score);
    const includedBlocks: string[] = [];
    const facts: ScoredMemoryNode[] = [];
    const nodes: TopicNode[] = [];
    let tokenCount = 0;

    for (const block of rankedBlocks) {
      const formattedBlock = formatFactBlock(block.facts, block.parentNode);
      const blockTokenCount = countApproxTokens(formattedBlock);

      if (tokenCount + blockTokenCount > tokenBudget) {
        break;
      }

      includedBlocks.push(formattedBlock);
      facts.push(...block.facts);
      nodes.push(block.parentNode);
      tokenCount += blockTokenCount;
    }

    return {
      facts,
      nodes,
      systemPrompt: buildFactRetrievalPrompt(includedBlocks),
      tokenCount,
    };
  }

  private async buildBlocks(
    facts: ScoredMemoryNode[],
    sessionId: string,
  ): Promise<RetrievedBlock[]> {
    const factsByTopic = new Map<string, ScoredMemoryNode[]>();

    for (const fact of facts) {
      const topicFacts = factsByTopic.get(fact.topicNodeId) ?? [];
      topicFacts.push(fact);
      factsByTopic.set(fact.topicNodeId, topicFacts);
    }

    const blocks: RetrievedBlock[] = [];

    for (const [topicNodeId, topicFacts] of factsByTopic) {
      const parentNode = await this.store.getTopicNode(topicNodeId, sessionId);

      if (!parentNode) {
        continue;
      }

      blocks.push({
        facts: topicFacts,
        parentNode,
        score: Math.max(...topicFacts.map((fact) => fact.similarity)),
      });
    }

    return blocks;
  }
}
