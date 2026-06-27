import { GrafterPipeline } from "./GrafterPipeline.js";
import type {
  EmbedAdapter,
  GraftByRelevanceOptions,
  GraftExpansionStrategy,
  InjectionResult,
} from "../core/types.js";
import type { GraphStore } from "../store/index.js";

export interface GraftRelevancePipelineConfig {
  topK: number;
  hopDepth: number;
  expansionStrategy?: GraftExpansionStrategy;
}

export class GraftRelevancePipeline {
  constructor(
    /** @internal */
    private readonly store: GraphStore,
    /** @internal */
    private readonly embedder: EmbedAdapter,
    /** @internal */
    private readonly grafterPipeline: GrafterPipeline,
    /** @internal */
    private readonly config: GraftRelevancePipelineConfig,
  ) {}

  async run(
    sessionId: string,
    query: string,
    options: GraftByRelevanceOptions = {},
  ): Promise<InjectionResult> {
    const embedding = await this.embedder.embed(query);
    const configuredSessionIds = options.sessionIds?.filter(Boolean) ?? [];
    const sessionIds = this.resolveSessionIds(sessionId, configuredSessionIds);
    const useConfiguredSessions = configuredSessionIds.length > 0
      && (sessionIds.length > 1 || sessionIds[0] !== sessionId);
    const seedNodes = useConfiguredSessions
      ? await this.store.getSimilarNodesAcrossSessions(embedding, sessionIds, {
        k: options.topK ?? this.config.topK,
        minSimilarity: options.minSimilarity ?? 0.6,
      })
      : await this.store.getSimilarNodes(embedding, sessionId, {
        k: options.topK ?? this.config.topK,
        minSimilarity: options.minSimilarity ?? 0.6,
      });

    if (seedNodes.length === 0) {
      return {
        systemPrompt: "",
        nodes: [],
        tokenCount: 0,
      };
    }

    return this.grafterPipeline.run(
      sessionId,
      seedNodes.map((node) => node.id),
      {
        hopDepth: options.hopDepth ?? this.config.hopDepth,
        expansionStrategy: options.expansionStrategy ?? this.config.expansionStrategy ?? "graph",
        ...(configuredSessionIds.length > 0 ? { sessionIds } : {}),
      },
    );
  }

  private resolveSessionIds(sessionId: string, configured?: string[]): string[] {
    const sessionIds = configured && configured.length > 0 ? configured : [sessionId];
    return [...new Set(sessionIds)];
  }
}
