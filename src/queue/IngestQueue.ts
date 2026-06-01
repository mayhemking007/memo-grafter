import { randomUUID } from "node:crypto";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { IngestPipeline } from "../pipeline/IngestPipeline.js";
import type { IngestOptions, MemoGrafterQueueConfig, Message } from "../types.js";

interface IngestJobData {
  messages: Message[];
  sessionId: string;
  options?: IngestOptions;
}

export class IngestQueue {
  private readonly connection: Redis;
  private readonly queue: Queue<IngestJobData>;
  private worker: Worker<IngestJobData> | null = null;
  private readonly defaultJobOptions: JobsOptions;
  private readonly queueName: string;

  constructor(
    private readonly pipeline: IngestPipeline,
    config: MemoGrafterQueueConfig,
  ) {
    this.queueName = config.queueName ?? `mg-ingest-${randomUUID()}`;

    this.connection = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    this.connection.on("error", (error: Error) => {
      console.warn("MemoGrafter ingest queue Redis warning:", error.message);
    });

    this.defaultJobOptions = {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: config.removeOnComplete ?? true,
      removeOnFail: config.removeOnFail ?? true,
    };

    this.queue = new Queue<IngestJobData>(this.queueName, {
      connection: this.connection,
      defaultJobOptions: this.defaultJobOptions,
    });
    this.queue.on("error", (error: Error) => {
      console.warn("MemoGrafter ingest queue warning:", error.message);
    });
  }

  async enqueue(messages: Message[], sessionId: string, options: IngestOptions = {}): Promise<void> {
    try {
      await this.withTimeout(
        this.queue.add(
          "ingest",
          {
            messages: [...messages],
            sessionId,
            options,
          },
          this.defaultJobOptions,
        ),
        1000,
        "MemoGrafter ingest queue enqueue timed out.",
      );
      this.ensureWorker();
    } catch (error) {
      console.warn("MemoGrafter ingest queue enqueue failed:", error);
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.withTimeout(this.worker.close(false), 10000, "MemoGrafter ingest queue worker close timed out.").catch((error: unknown) => {
        console.warn("MemoGrafter ingest queue worker close warning:", error);
      });
    }
    await this.withTimeout(this.queue.close(), 1000, "MemoGrafter ingest queue close timed out.").catch((error: unknown) => {
      console.warn("MemoGrafter ingest queue close warning:", error);
    });
    if (this.worker) {
      await Promise.resolve(this.worker.disconnect()).catch((error: unknown) => {
        console.warn("MemoGrafter ingest queue worker disconnect warning:", error);
      });
    }
    await Promise.resolve(this.queue.disconnect()).catch((error: unknown) => {
      console.warn("MemoGrafter ingest queue disconnect warning:", error);
    });
    this.connection.disconnect();
  }

  private ensureWorker(): void {
    if (this.worker) return;

    this.worker = new Worker<IngestJobData>(
      this.queueName,
      async (job) => {
        try {
          await this.pipeline.run(job.data.messages, job.data.sessionId, job.data.options ?? {});
        } catch (error) {
          console.warn("MemoGrafter background ingest failed:", error);
          throw error;
        }
      },
      { connection: this.connection },
    );

    this.worker.on("failed", (_job, error) => {
      console.warn("MemoGrafter ingest queue worker warning:", error.message);
    });
    this.worker.on("error", (error) => {
      console.warn("MemoGrafter ingest queue worker warning:", error.message);
    });
  }

  private async withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
