import { AsyncLocalStorage } from "node:async_hooks";
import type { EmbedAdapter, IngestionConcurrency, IngestTextOptions, LLMAdapter } from "../core/types.js";
import { MemoGrafterError } from "../diagnostics.js";
import { validateEmbedding } from "../adapters/validation.js";

export function validateProviderOptions(options: IngestTextOptions): void {
  for (const [name, value] of Object.entries(options.concurrency ?? {})) {
    if (!Number.isSafeInteger(value) || value < 1) throw new MemoGrafterError(`${name} concurrency must be a positive safe integer.`, { code: "INPUT_INVALID", operation: "ingest" });
  }
  for (const value of [options.memoryBudget?.maxPerSegment, options.memoryBudget?.maxPerDocument]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new MemoGrafterError("Memory budgets must be non-negative safe integers.", { code: "INPUT_INVALID", operation: "ingest" });
  }
  const budget = options.memoryBudget;
  if (budget?.deduplicate !== undefined && typeof budget.deduplicate !== "boolean") throw new MemoGrafterError("deduplicate must be boolean.", { code: "INPUT_INVALID", operation: "ingest" });
  if (budget?.preferredTypes !== undefined && (!Array.isArray(budget.preferredTypes) || budget.preferredTypes.some((type) => !["fact", "insight", "question", "task", "reference"].includes(type)))) throw new MemoGrafterError("Invalid preferred memory types.", { code: "INPUT_INVALID", operation: "ingest" });
}

/** FIFO permits wrap only actual provider requests, never nested ingestion stages. */
export class ProviderGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const enter = () => { this.active++; resolve(); };
      if (this.active < this.limit) enter(); else this.waiting.push(enter);
    });
    try { return await work(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}

export class IngestionProviderWork {
  private readonly scope = new AsyncLocalStorage<{ extraction: ProviderGate; embedding: ProviderGate }>();
  private readonly control = new AsyncLocalStorage<{ signal: AbortSignal; check: () => Promise<void> }>();
  private readonly extraction: ProviderGate;
  private readonly embedding: ProviderGate;
  constructor(private readonly limits: IngestionConcurrency = {}) {
    validateProviderOptions({ concurrency: limits });
    this.extraction = new ProviderGate(limits.extraction ?? 2);
    this.embedding = new ProviderGate(limits.embedding ?? 8);
  }
  run<T>(options: IngestTextOptions, work: () => Promise<T>): Promise<T> {
    validateProviderOptions(options);
    return this.scope.run({
      extraction: new ProviderGate(options.concurrency?.extraction ?? this.limits.extraction ?? 2),
      embedding: new ProviderGate(options.concurrency?.embedding ?? this.limits.embedding ?? 8),
    }, work);
  }
  withControl<T>(control: { signal: AbortSignal; check: () => Promise<void> }, work: () => Promise<T>): Promise<T> { return this.control.run(control, work); }
  private request<T>(kind: "extraction" | "embedding", work: () => Promise<T>): Promise<T> {
    const local = this.scope.getStore()?.[kind];
    const control = this.control.getStore();
    const guarded = async () => { await control?.check(); return work(); };
    const pending = local ? local.run(() => this[kind].run(guarded)) : this[kind].run(guarded);
    if (!control) return pending;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new MemoGrafterError("Document provider work aborted.", { code: "OPERATION_ABORTED", operation: "ingest" }));
      if (control.signal.aborted) abort(); else control.signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, reject).finally(() => control.signal.removeEventListener("abort", abort));
    });
  }
  wrapLLM(adapter: LLMAdapter): LLMAdapter {
    return { complete: (...args) => this.request("extraction", () => adapter.complete(args[0], args[1], this.control.getStore() ? { ...args[2], signal: this.control.getStore()!.signal } : args[2])) };
  }
  wrapEmbedder(adapter: EmbedAdapter): EmbedAdapter {
    return {
      ...(adapter.dimensions !== undefined ? { dimensions: adapter.dimensions } : {}),
      embed: (...args) => this.request("embedding", () => adapter.embed(args[0], this.control.getStore() ? { ...args[1], signal: this.control.getStore()!.signal } : args[1])),
      ...(adapter.embedMany ? { embedMany: (texts, options) => this.request("embedding", () => adapter.embedMany!(texts, this.control.getStore() ? { ...options, signal: this.control.getStore()!.signal } : options)) } satisfies Pick<EmbedAdapter, "embedMany"> : {}),
    };
  }
}

/** Batch size bounds request payload count; failed batches are never retried as singles. */
export async function embedTexts(adapter: EmbedAdapter, texts: string[]): Promise<number[][]> {
  const settle = async <T>(work: Promise<T>[]): Promise<T[]> => {
    const results = await Promise.allSettled(work);
    return results.map((result) => { if (result.status === "rejected") throw result.reason; return result.value; });
  };
  const validateDimensions = (vectors: number[][]) => vectors.map((vector) => validateEmbedding(vector, adapter.dimensions ?? vectors[0]?.length));
  if (!adapter.embedMany) return validateDimensions(await settle(texts.map(async (text) => validateEmbedding(await adapter.embed(text), adapter.dimensions))));
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += 32) batches.push(texts.slice(i, i + 32));
  return validateDimensions((await settle(batches.map(async (batch) => {
    const vectors = await adapter.embedMany!(batch);
    if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new MemoGrafterError("Batch embedding count does not match inputs.", { code: "EMBEDDING_RESPONSE_INVALID", operation: "ingest", stage: "embedding" });
    return vectors.map((vector) => validateEmbedding(vector, adapter.dimensions));
  }))).flat());
}
