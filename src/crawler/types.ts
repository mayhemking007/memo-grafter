export interface CrawlerConfig {
  intervalMs?: number;
  passes?: CrawlerPass[];
  stopOnPassError?: boolean;
}

export interface CrawlerPass {
  name: string;
  run(context: CrawlerPassContext): Promise<CrawlerPassResult> | CrawlerPassResult;
}

export interface CrawlerPassContext {
  signal?: AbortSignal;
}

export interface CrawlerPassResult {
  inspected?: number;
  annotated?: number;
  skipped?: number;
  notes?: string[];
}

export interface CrawlerPassReport {
  name: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: CrawlerPassResult;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface CrawlerReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  passes: CrawlerPassReport[];
  ok: boolean;
}
