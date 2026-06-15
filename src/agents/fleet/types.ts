import type {
  AbsorbFromAgentOptions,
  GraftByRelevanceOptions,
  FleetMemoryMode,
  InjectionResult,
  IngestTextOptions,
  MemoryNode,
  MemoGrafterConfig,
  Message,
  RetrievalResult,
  RetrieverConfig,
  TopicNode,
  TopicSegment,
} from "../../core/types.js";

export interface FleetGraph {
  id: string;
  name?: string;
  agents: FleetAgentInfo[];
}

export interface FleetAgentInfo {
  id: string;
  sessionId: string;
  color: string;
}

export interface MemoGrafterFleetOptions {
  id?: string;
  name?: string;
  defaultWorkerMemory?: FleetMemoryMode;
}

export interface WorkerAgentConfig {
  color: string;
  sessionId?: string;
  id?: string;
  memory?: FleetMemoryMode;
}

export interface FleetMemoryOptions extends IngestTextOptions {
  tags?: string[];
  replace?: boolean;
}

export interface SharedMemorySnapshot {
  sessionId: string;
  nodes: TopicNode[];
  segments: TopicSegment[];
  memories: MemoryNode[];
}

export interface FleetRetrievalOptions extends RetrieverConfig {
  memory?: FleetMemoryMode;
}

export interface FleetGraftByRelevanceOptions extends GraftByRelevanceOptions {
  memory?: FleetMemoryMode;
}

export interface ConductorGraftOptions {
  topicIds?: string[];
  prompt?: string;
  minSimilarity?: number;
  limit?: number;
}

export type FleetAbsorbOptions = AbsorbFromAgentOptions;

export interface FleetWorker {
  getAgentId(): string;
  getSessionId(): string;
  getColor(): string;
  invoke(userMessage: string): Promise<string>;
  getHistory(): Message[];
  getActiveNodes(): Promise<TopicNode[]>;
  graft(topicIds?: string[]): Promise<InjectionResult>;
  graftByRelevance(query: string, options?: FleetGraftByRelevanceOptions): Promise<InjectionResult>;
  recall(query: string, options?: FleetRetrievalOptions): Promise<RetrievalResult>;
}

export type { MemoGrafterConfig };
