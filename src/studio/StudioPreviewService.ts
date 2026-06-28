import { GraftRelevancePipeline } from "../retrieval/GraftRelevancePipeline.js";
import { GrafterPipeline } from "../retrieval/GrafterPipeline.js";
import { RetrieverPipeline } from "../retrieval/RetrieverPipeline.js";
import type {
  EmbedAdapter,
  GraftByRelevanceOptions,
  InjectionResult,
  MemoGrafterConfig,
  RetrievalResult,
  RetrieverConfig,
} from "../core/types.js";
import type { GraphStore } from "../store/index.js";

export type StudioPreviewMode = "graft" | "recall";

export interface StudioPreviewRequest {
  mode: StudioPreviewMode;
  sessionId: string;
  query: string;
  graft?: GraftByRelevanceOptions;
  recall?: RetrieverConfig;
}

export type StudioPreviewResult =
  | (InjectionResult & {
    mode: "graft";
    query: string;
    generatedAt: string;
  })
  | (RetrievalResult & {
    mode: "recall";
    query: string;
    generatedAt: string;
  });

export interface StudioPreviewStatus {
  available: boolean;
  reason?: string;
}

export interface StudioPreviewService {
  getStatus(): StudioPreviewStatus;
  run(request: StudioPreviewRequest): Promise<StudioPreviewResult>;
}

export interface StudioPreviewServiceConfig {
  embedder?: EmbedAdapter;
  graph?: MemoGrafterConfig["graph"];
  inject?: MemoGrafterConfig["inject"];
  cache?: MemoGrafterConfig["cache"];
}

export function createStudioPreviewService(
  store: GraphStore,
  config: StudioPreviewServiceConfig | null | undefined,
): StudioPreviewService {
  if (!config?.embedder) {
    return new UnavailableStudioPreviewService(
      "Prompt Preview requires an embedder in mg.config.ts or mg.config.js. Run memo-grafter init to scaffold one, then set OPENAI_API_KEY or provide your own embedder.",
    );
  }

  return new PipelineStudioPreviewService(store, config.embedder, config);
}

export class UnavailableStudioPreviewService implements StudioPreviewService {
  constructor(private readonly reason: string) {}

  getStatus(): StudioPreviewStatus {
    return {
      available: false,
      reason: this.reason,
    };
  }

  run(): Promise<StudioPreviewResult> {
    throw new Error(this.reason);
  }
}

export class PipelineStudioPreviewService implements StudioPreviewService {
  private readonly grafterPipeline: GrafterPipeline;
  private readonly graftRelevancePipeline: GraftRelevancePipeline;

  constructor(
    private readonly store: GraphStore,
    private readonly embedder: EmbedAdapter,
    private readonly config: StudioPreviewServiceConfig,
  ) {
    const hopDepth = config.graph?.hopDepth ?? 1;
    this.grafterPipeline = new GrafterPipeline(store, {
      hopDepth,
      bufferSize: config.inject?.bufferSize ?? 1,
      tokenBudget: config.inject?.tokenBudget ?? 4000,
    });
    this.graftRelevancePipeline = new GraftRelevancePipeline(store, embedder, this.grafterPipeline, {
      topK: config.graph?.topK ?? 5,
      hopDepth,
    });
  }

  getStatus(): StudioPreviewStatus {
    return {
      available: true,
    };
  }

  async run(request: StudioPreviewRequest): Promise<StudioPreviewResult> {
    const query = request.query.trim();
    if (!query) {
      throw new Error("Prompt Preview requires a non-empty query.");
    }

    if (request.mode === "graft") {
      const result = await this.graftRelevancePipeline.run(request.sessionId, query, request.graft);
      return {
        ...result,
        mode: "graft",
        query,
        generatedAt: new Date().toISOString(),
      };
    }

    const cacheConfig = request.recall?.cache ?? (this.config.cache
      ? {
        ...(this.config.cache.ttlSeconds !== undefined ? { ttlSeconds: this.config.cache.ttlSeconds } : {}),
      }
      : undefined);
    const pipeline = new RetrieverPipeline(
      this.store,
      this.embedder,
      {
        ...request.recall,
        ...(cacheConfig !== undefined ? { cache: cacheConfig } : {}),
      },
    );
    const result = await pipeline.run(query, request.sessionId);

    return {
      ...result,
      mode: "recall",
      query,
      generatedAt: new Date().toISOString(),
    };
  }
}
