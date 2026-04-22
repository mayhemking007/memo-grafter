export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface TopicNode {
  id: string;
  sessionId: string;
  segmentId: string;
  label: string;
  summary: string;
  embedding: number[];
  messageRange: [number, number];
  topicOrder?: number;
  driftScore?: number;
  createdAt: Date;
}

export interface TopicEdge {
  srcId: string;
  dstId: string;
  weight: number;
  type: "semantic" | "temporal";
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

export interface LLMAdapter {
  complete(messages: Message[], system?: string): Promise<string>;
}

export interface EmbedAdapter {
  embed(text: string): Promise<number[]>;
}

export interface MemoGrafterConfig {
  db: { connectionString: string };
  llm: LLMAdapter;
  embedder: EmbedAdapter;
  drift?: {
    windowSize?: number;
    threshold?: number;
    mode?: "window" | "intent";
    minSegmentMessages?: number;
  };
  graph?: {
    topK?: number;
    hopDepth?: number;
  };
  inject?: {
    bufferSize?: number;
    tokenBudget?: number;
  };
}
