import { Redis } from "ioredis";
import postgres from "postgres";
import type {
  InfrastructureMetrics,
  ServiceMetrics,
  SmokeTestDefinition,
} from "./types.js";

function safeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map((item: unknown) => safeError(item)).filter(Boolean).join("; ") || "AggregateError";
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return redact(`${error.message || error.name}${code}`);
  }
  return redact(String(error));
}

function redact(value: string): string {
  let redacted = value;
  for (const secret of [process.env.DATABASE_URL, process.env.REDIS_URL]) {
    if (secret) redacted = redacted.replaceAll(secret, "[redacted]");
  }
  return redacted;
}

async function measurePostgres(): Promise<ServiceMetrics> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { configured: false, reachable: false, usage: "persistence" };
  }
  const sql = postgres(databaseUrl, { connect_timeout: 3, max: 1 });
  try {
    const started = performance.now();
    await sql`SELECT 1`;
    const connectAndPingMs = performance.now() - started;
    const warmStarted = performance.now();
    await sql`SELECT 1`;
    const warmPingMs = performance.now() - warmStarted;
    return {
      configured: true,
      reachable: true,
      connectAndPingMs,
      warmPingMs,
      usage: "persistence",
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: safeError(error),
      usage: "persistence",
    };
  } finally {
    await sql.end().catch(() => undefined);
  }
}

function redisUsage(definitions: SmokeTestDefinition[]): string {
  const uses: string[] = [];
  if (definitions.some((definition) => definition.suite === "ingestion" && definition.name === "queue")) {
    uses.push("queue");
  }
  if (definitions.some((definition) => definition.suite === "cache")) {
    uses.push("recall cache");
  }
  return uses.length > 0 ? uses.join(" and ") : "configured";
}

async function measureRedis(definitions: SmokeTestDefinition[]): Promise<ServiceMetrics> {
  const redisUrl = process.env.REDIS_URL?.trim();
  const usage = redisUsage(definitions);
  if (!redisUrl) return { configured: false, reachable: false, usage };

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
  });
  redis.on("error", () => undefined);
  try {
    const started = performance.now();
    await redis.connect();
    await redis.ping();
    const connectAndPingMs = performance.now() - started;
    const warmStarted = performance.now();
    await redis.ping();
    const warmPingMs = performance.now() - warmStarted;
    return {
      configured: true,
      reachable: true,
      connectAndPingMs,
      warmPingMs,
      usage,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: safeError(error),
      usage,
    };
  } finally {
    redis.disconnect();
  }
}

export async function collectInfrastructureMetrics(
  definitions: SmokeTestDefinition[],
): Promise<InfrastructureMetrics> {
  const [postgresMetrics, redisMetrics] = await Promise.all([
    measurePostgres(),
    measureRedis(definitions),
  ]);
  return {
    postgres: postgresMetrics,
    redis: redisMetrics,
  };
}
