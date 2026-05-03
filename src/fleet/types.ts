import type { AbsorbFromAgentOptions, InjectionResult, MemoGrafterConfig, Message, TopicNode } from "../types.js";

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
}

export interface WorkerAgentConfig {
  color: string;
  sessionId?: string;
  id?: string;
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
}

export type { MemoGrafterConfig };
