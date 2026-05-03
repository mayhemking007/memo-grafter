export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type DriftMode = "window" | "intent";

export interface TopicNode {
  id: string;
  sessionId: string;
  segmentId: string;
  label: string;
  summary: string;
  embedding: number[];
  messageRange: [number, number];
  topicOrder: number;
  driftScore: number;
  agentColor: string | null;
  fleetId: string | null;
  agentId: string | null;
  createdAt: Date;
}

export interface TopicEdge {
  srcId: string;
  dstId: string;
  weight: number;
  type: string;
}

export interface TopicSegment {
  id: string;
  sessionId: string;
  startIndex: number;
  endIndex: number;
  topicOrder: number;
  driftScore: number;
  createdAt: Date;
}

export interface InjectionResult {
  systemPrompt: string;
  nodes: TopicNode[];
  tokenCount: number;
}

export interface AbsorbFromAgentOptions {
  topicIds?: string[];
  prompt?: string;
  minSimilarity?: number;
  limit?: number;
}

export interface LLMAdapter {
  complete(messages: Message[], system?: string): Promise<string>;
}

export interface EmbedAdapter {
  embed(text: string): Promise<number[]>;
}

export interface MemoGrafterDriftConfig {
  mode?: DriftMode;
  windowSize?: number;
  threshold?: number;
  minSegmentMessages?: number;
}

export interface MemoGrafterGraphConfig {
  topK?: number;
  hopDepth?: number;
}

export interface MemoGrafterInjectConfig {
  bufferSize?: number;
  tokenBudget?: number;
}

export interface MemoGrafterQueueConfig {
  redisUrl: string;
  queueName?: string;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

export interface MemoGrafterConfig {
  db: { connectionString: string };
  llm: LLMAdapter;
  embedder: EmbedAdapter;
  drift?: MemoGrafterDriftConfig;
  graph?: MemoGrafterGraphConfig;
  inject?: MemoGrafterInjectConfig;
  queue?: MemoGrafterQueueConfig;
}
