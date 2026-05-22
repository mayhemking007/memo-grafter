import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
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
    private cacheRedis: Redis | null = null,
  ) {}

  async run(query: string, sessionId: string): Promise<RetrievalResult> {
    const limit = this.config.limit ?? 10;
    const minSimilarity = this.config.minSimilarity ?? 0.6;
    const tokenBudget = this.config.tokenBudget ?? 1200;

    const embedding = await this.embedder.embed(query);
    const searchedFacts = await this.searchMemories(embedding, sessionId, limit, minSimilarity);
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

  private async searchMemories(
    embedding: number[],
    sessionId: string,
    limit: number,
    minSimilarity: number,
  ): Promise<ScoredMemoryNode[]> {
    if (!this.config.cache || !this.cacheRedis) {
      return this.store.searchMemories(
        embedding,
        sessionId,
        limit,
        minSimilarity,
      );
    }

    const ttl = Math.min(Math.max(this.config.cache.ttlSeconds ?? 90, 60), 120);
    const cacheKey = `mg:recall:${sessionId}:${limit}:${minSimilarity}:${this.hashEmbedding(embedding)}`;

    try {
      const hit = await this.cacheRedis.get(cacheKey);

      if (hit) {
        return JSON.parse(hit) as ScoredMemoryNode[];
      }

      const searchedFacts = await this.store.searchMemories(
        embedding,
        sessionId,
        limit,
        minSimilarity,
      );
      await this.cacheRedis.setex(cacheKey, ttl, JSON.stringify(searchedFacts));

      return searchedFacts;
    } catch (error: unknown) {
      console.warn("MemoGrafter recall cache warning:", error);
      return this.store.searchMemories(
        embedding,
        sessionId,
        limit,
        minSimilarity,
      );
    }
  }

  private hashEmbedding(embedding: number[]): string {
    const str = embedding.map((value) => value.toFixed(6)).join(",");
    return createHash("sha1").update(str).digest("hex").slice(0, 16);
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
