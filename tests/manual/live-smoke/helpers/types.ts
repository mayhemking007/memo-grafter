export type SmokeStatus = "passed" | "failed" | "skipped";

export type SmokeMetricValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | Record<string, unknown>[];

export interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  calls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
}

export interface RuntimeComponent {
  provider: string;
  model: string;
}

export interface RuntimeDescriptor {
  llm: RuntimeComponent;
  embedder: RuntimeComponent;
}

export interface ServiceMetrics {
  configured: boolean;
  reachable: boolean;
  connectAndPingMs?: number;
  warmPingMs?: number;
  error?: string;
  usage: string;
}

export interface InfrastructureMetrics {
  postgres: ServiceMetrics;
  redis: ServiceMetrics;
}

export interface SmokeTestResult {
  suite: string;
  name: string;
  status: SmokeStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  runtime: RuntimeDescriptor;
  assertions: string[];
  metrics: Record<string, SmokeMetricValue>;
  conversation?: ConversationEntry[];
  tokenUsage?: TokenUsage;
  reason?: string;
  error?: string;
}

export interface SmokeContext {
  strict: boolean;
  verbose: boolean;
  timeoutMs: number;
}

export interface SmokeTestDefinition {
  suite: string;
  name: string;
  runtime: RuntimeDescriptor;
  run(context: SmokeContext): Promise<Omit<SmokeTestResult, "suite" | "name" | "status" | "startedAt" | "finishedAt" | "durationMs" | "runtime">>;
}

export interface SmokeRunOptions extends SmokeContext {
  writeDoc: boolean;
  reportPath?: string;
}
