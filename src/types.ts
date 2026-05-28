export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export type DriftMode = "window" | "intent";
export type DriftSensitivity = "low" | "medium" | "high";

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

export type MemoryType = "fact" | "insight" | "question" | "task" | "reference";
export type MemorySourceType = "conversation" | "note" | "document" | "code";

export interface MemoryNode {
  id: string;
  segmentId: string;
  topicNodeId: string;
  agentId: string | null;
  sessionId: string;
  memoryType: MemoryType;
  sourceType: MemorySourceType;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
  embedding: number[];
  sourceUrl: string | null;
  sourceTitle: string | null;
  supersededBy: string | null;
  decayed: boolean;
  agentColor: string | null;
  fleetId: string | null;
  createdAt: Date;
}

export interface MemoryNodeInsert extends Omit<MemoryNode, "createdAt"> {}

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: "semantic" | "conflicts" | "updates" | "related";
  weight: number;
  createdAt: Date;
}

export interface ExtractedMemory {
  memoryType: MemoryType;
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
}

export interface SegmentExtractionResult {
  label: string;
  userIntent: string;
  outcome: string;
  open: string | null;
  memories: ExtractedMemory[];
}

export interface InjectionResult {
  systemPrompt: string;
  nodes: TopicNode[];
  memories?: MemoryNode[];
  tokenCount: number;
}

export interface GraftRegistryEntry {
  id: string;
  sessionId: string;
  nodeId: string;
  sourceSessionId: string;
  sourceNodeId: string;
  graftedAt: Date;
}

export interface GraftOrigin {
  sourceSessionId: string;
  sourceNodeId: string;
  graftedAt: Date;
}

export interface GraphSnapshotNode {
  node: TopicNode;
  graftOrigin?: GraftOrigin;
}

export interface GraphSnapshot {
  sessionId: string;
  nodes: TopicNode[];
  snapshotNodes?: GraphSnapshotNode[];
  edges: TopicEdge[];
  memories: MemoryNode[];
  capturedAt: string;
}

export interface SessionIngestState {
  sessionId: string;
  lastIngestedMessageIndex: number;
  updatedAt: Date;
}

export interface RetrieverConfig {
  limit?: number;
  minSimilarity?: number;
  tokenBudget?: number;
  cache?: {
    ttlSeconds?: number;
  };
}

export interface RetrievalResult {
  facts: (MemoryNode & { similarity: number })[];
  nodes: TopicNode[];
  systemPrompt: string;
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
  driftSensitivity?: DriftSensitivity;
  /** @deprecated Use driftSensitivity instead. */
  threshold?: number;
  minSegmentMessages?: number;
  llmAmbiguityDetection?: boolean;
  reentryDetection?: boolean;
  reentryThreshold?: number;
}

export interface MemoGrafterGraphConfig {
  topK?: number;
  hopDepth?: number;
}

export interface MemoGrafterInjectConfig {
  bufferSize?: number;
  tokenBudget?: number;
  /** Default 20. How many raw messages to keep after the pinned recall block. */
  recentWindowSize?: number;
  /** Default 6. How many recalled facts to inject before each invoke. */
  recallLimit?: number;
  /** Default 0.55. Minimum similarity for recalled facts injected before each invoke. */
  recallMinSimilarity?: number;
}

export interface MemoGrafterQueueConfig {
  redisUrl: string;
  queueName?: string;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

export interface MemoGrafterCacheConfig {
  connectionString: string;
  ttlSeconds?: number;
}

export interface MemoGrafterConfig {
  db: { connectionString: string };
  llm: LLMAdapter;
  embedder: EmbedAdapter;
  systemPrompt?: string;
  drift?: MemoGrafterDriftConfig;
  graph?: MemoGrafterGraphConfig;
  inject?: MemoGrafterInjectConfig;
  queue?: MemoGrafterQueueConfig;
  cache?: MemoGrafterCacheConfig;
}
