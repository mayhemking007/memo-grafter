import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectInfrastructureMetrics } from "./environment.js";
import { SmokeMetricsCollector } from "./metrics.js";
import type {
  InfrastructureMetrics,
  SmokeRunOptions,
  SmokeTestDefinition,
  SmokeTestResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

function parseOptions(argv: string[]): SmokeRunOptions {
  const reportArg = argv.find((arg) => arg.startsWith("--write-doc="));
  const timeoutArg = argv.find((arg) => arg.startsWith("--timeout="));
  return {
    writeDoc: argv.includes("--write-doc") || reportArg !== undefined,
    ...(reportArg ? { reportPath: reportArg.slice("--write-doc=".length) } : {}),
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
    timeoutMs: timeoutArg ? Number(timeoutArg.slice("--timeout=".length)) : DEFAULT_TIMEOUT_MS,
  };
}

async function executeTest(
  definition: SmokeTestDefinition,
  options: SmokeRunOptions,
): Promise<SmokeTestResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const telemetry = new SmokeMetricsCollector();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      definition.run({ ...options, telemetry }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Timed out after ${options.timeoutMs} ms.`)),
          options.timeoutMs,
        );
      }),
    ]);
    const finished = Date.now();
    const queueUsage = telemetry.queueSnapshot();
    const tokenUsage = telemetry.tokenSnapshot();
    return {
      suite: definition.suite,
      name: definition.name,
      status: "passed",
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      runtime: definition.runtime,
      databaseUsage: telemetry.databaseSnapshot(),
      ...(queueUsage !== undefined ? { queueUsage } : {}),
      ...outcome,
      ...(tokenUsage !== undefined ? { tokenUsage } : {}),
    };
  } catch (error) {
    const finished = Date.now();
    const message = formatError(error);
    const isSkip = message.startsWith("SKIP:");
    const queueUsage = telemetry.queueSnapshot();
    const tokenUsage = telemetry.tokenSnapshot();
    return {
      suite: definition.suite,
      name: definition.name,
      status: isSkip ? "skipped" : "failed",
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      runtime: definition.runtime,
      databaseUsage: telemetry.databaseSnapshot(),
      ...(queueUsage !== undefined ? { queueUsage } : {}),
      ...(tokenUsage !== undefined ? { tokenUsage } : {}),
      assertions: [],
      metrics: {},
      ...(isSkip ? { reason: message.slice(5).trim() } : { error: message }),
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatError(error: unknown): string {
  if (error instanceof AggregateError) {
    const nested = error.errors.map((item: unknown) => formatError(item)).filter(Boolean);
    return [error.message, ...nested].filter(Boolean).join("; ") || "AggregateError";
  }
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return `${error.message || error.name}${code}`;
  }
  return String(error);
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

function workingTreeState(): string {
  return gitValue(["status", "--porcelain"]) === "" ? "clean" : "dirty";
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)} ms`;
}

function markdown(
  results: SmokeTestResult[],
  infrastructure: InfrastructureMetrics,
  startedAt: string,
  durationMs: number,
): string {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const totalLlmCalls = results.reduce((total, result) => total + (result.tokenUsage?.calls ?? 0), 0);
  const totalInputTokens = results.reduce((total, result) => total + (result.tokenUsage?.estimatedInputTokens ?? 0), 0);
  const totalOutputTokens = results.reduce((total, result) => total + (result.tokenUsage?.estimatedOutputTokens ?? 0), 0);
  const totalTokens = results.reduce((total, result) => total + (result.tokenUsage?.estimatedTotalTokens ?? 0), 0);
  const totalDatabaseCalls = results.reduce((total, result) => total + result.databaseUsage.total, 0);
  const totalDatabaseReads = results.reduce((total, result) => total + result.databaseUsage.reads, 0);
  const totalDatabaseWrites = results.reduce((total, result) => total + result.databaseUsage.writes, 0);
  const totalDatabaseOther = results.reduce((total, result) => total + result.databaseUsage.other, 0);
  const queueResults = results.flatMap((result) => result.queueUsage ? [result.queueUsage] : []);
  const totalQueueJobs = queueResults.reduce((total, usage) => total + usage.completedJobs, 0);
  const totalQueueFailures = queueResults.reduce((total, usage) => total + usage.failedJobs, 0);
  const totalQueueMessages = queueResults.reduce((total, usage) => total + usage.totalMessages, 0);
  const lines = [
    "# MemoGrafter Live Smoke Report",
    "",
    `- Started: ${startedAt}`,
    `- Finished: ${new Date().toISOString()}`,
    `- Duration: ${formatDuration(durationMs)}`,
    `- Result: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${skipped} skipped)`,
    `- Last commit: ${gitValue(["rev-parse", "--short", "HEAD"])}`,
    `- Git branch: ${gitValue(["branch", "--show-current"])}`,
    `- Working tree: ${workingTreeState()}`,
    `- Node: ${process.version}`,
    `- Package version: ${process.env.npm_package_version ?? "unknown"}`,
    "",
    "Token counts in this report are estimates (approximately four characters per token), not provider billing data.",
    "",
    "## Infrastructure",
    "",
    "| Service | Configured | Reachable | Connect + ping | Warm ping/query | Usage |",
    "|---|---:|---:|---:|---:|---|",
    `| PostgreSQL | ${infrastructure.postgres.configured} | ${infrastructure.postgres.reachable} | ${formatMs(infrastructure.postgres.connectAndPingMs)} | ${formatMs(infrastructure.postgres.warmPingMs)} | ${infrastructure.postgres.usage} |`,
    `| Redis | ${infrastructure.redis.configured} | ${infrastructure.redis.reachable} | ${formatMs(infrastructure.redis.connectAndPingMs)} | ${formatMs(infrastructure.redis.warmPingMs)} | ${infrastructure.redis.usage} |`,
  ];
  if (infrastructure.postgres.error) lines.push("", `PostgreSQL error: ${infrastructure.postgres.error}`);
  if (infrastructure.redis.error) lines.push("", `Redis error: ${infrastructure.redis.error}`);
  lines.push(
    "",
    "## Aggregate efficiency",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| LLM API calls | ${totalLlmCalls} |`,
    `| Estimated input tokens | ${totalInputTokens} |`,
    `| Estimated output tokens | ${totalOutputTokens} |`,
    `| Estimated total tokens | ${totalTokens} |`,
    `| Database calls | ${totalDatabaseCalls} |`,
    `| Database reads | ${totalDatabaseReads} |`,
    `| Database writes | ${totalDatabaseWrites} |`,
    `| Database other | ${totalDatabaseOther} |`,
    `| Queue jobs completed | ${totalQueueJobs} |`,
    `| Queue jobs failed | ${totalQueueFailures} |`,
    `| Queue messages processed | ${totalQueueMessages} |`,
    "",
    "## Runtime configuration",
    "",
    "| Suite | Test | LLM provider | LLM model | Embedder provider | Embedder model |",
    "|---|---|---|---|---|---|",
    ...results.map((result) =>
      `| ${result.suite} | ${result.name} | ${result.runtime.llm.provider} | ${result.runtime.llm.model} | ${result.runtime.embedder.provider} | ${result.runtime.embedder.model} |`),
    "",
    "## Summary",
    "",
    "| Suite | Test | Status | Duration | LLM calls | Est. tokens | DB calls | Reads | Writes | Queue jobs |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((result) =>
      `| ${result.suite} | ${result.name} | ${result.status.toUpperCase()} | ${formatDuration(result.durationMs)} | ${result.runtime.llm.provider === "Not Used" ? "Not Used" : result.tokenUsage?.calls ?? 0} | ${result.runtime.llm.provider === "Not Used" ? "Not Used" : result.tokenUsage?.estimatedTotalTokens ?? 0} | ${result.databaseUsage.total} | ${result.databaseUsage.reads} | ${result.databaseUsage.writes} | ${result.queueUsage?.completedJobs ?? "Not Used"} |`),
  );

  for (const result of results) {
    lines.push("", `## ${result.suite} / ${result.name}`, "");
    if (result.reason) lines.push(`Skipped: ${result.reason}`, "");
    if (result.error) lines.push(`Error: ${result.error}`, "");
    lines.push(
      "### Database",
      "",
      `- Total calls: ${result.databaseUsage.total}`,
      `- Reads: ${result.databaseUsage.reads}`,
      `- Writes: ${result.databaseUsage.writes}`,
      `- Other: ${result.databaseUsage.other}`,
      "",
      "### Queue",
      "",
    );
    if (result.queueUsage) {
      lines.push(
        `- Jobs completed: ${result.queueUsage.completedJobs}`,
        `- Jobs failed: ${result.queueUsage.failedJobs}`,
        `- Total messages: ${result.queueUsage.totalMessages}`,
        `- Total payload bytes: ${result.queueUsage.totalPayloadBytes}`,
        `- Maximum job payload bytes: ${result.queueUsage.maximumJobPayloadBytes}`,
        `- First job message count: ${result.queueUsage.firstJobMessageCount ?? "Not Used"}`,
        `- Last job message count: ${result.queueUsage.lastJobMessageCount ?? "Not Used"}`,
        `- First job payload bytes: ${result.queueUsage.firstJobPayloadBytes ?? "Not Used"}`,
        `- Last job payload bytes: ${result.queueUsage.lastJobPayloadBytes ?? "Not Used"}`,
        `- First job kind: ${result.queueUsage.firstJobKind ?? "Not Used"}`,
        `- Last job kind: ${result.queueUsage.lastJobKind ?? "Not Used"}`,
      );
    } else {
      lines.push("- Not Used");
    }
    lines.push("", "### LLM", "");
    if (result.tokenUsage) {
      lines.push(
        `- Calls: ${result.tokenUsage.calls}`,
        `- Estimated input tokens: ${result.tokenUsage.estimatedInputTokens}`,
        `- Estimated output tokens: ${result.tokenUsage.estimatedOutputTokens}`,
        `- Estimated total tokens: ${result.tokenUsage.estimatedTotalTokens}`,
      );
    } else {
      lines.push("- Not Used");
    }
    lines.push("");
    lines.push("### Metrics", "");
    const metrics = Object.entries(result.metrics);
    if (metrics.length === 0) lines.push("- None");
    for (const [key, value] of metrics) {
      lines.push(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    if (result.assertions.length > 0) {
      lines.push("", "### Assertions", "", ...result.assertions.map((item) => `- ${item}`));
    }
    if (result.conversation && result.conversation.length > 0) {
      lines.push("", "### Conversation", "");
      for (const entry of result.conversation) {
        lines.push(`**${entry.role === "user" ? "User" : "Assistant"}:** ${entry.content}`, "");
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeReport(
  results: SmokeTestResult[],
  options: SmokeRunOptions,
  infrastructure: InfrastructureMetrics,
  startedAt: string,
  durationMs: number,
): Promise<string> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = path.resolve(options.reportPath ?? path.join(root, "reports", `live-smoke-${timestamp}.md`));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, markdown(results, infrastructure, startedAt, durationMs), "utf8");
  return output;
}

export async function runSmokeTests(definitions: SmokeTestDefinition[]): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number.");
  }
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  console.log("MemoGrafter live smoke tests\n");
  const infrastructure = await collectInfrastructureMetrics(definitions);
  console.log(`PostgreSQL ${infrastructure.postgres.reachable ? "reachable" : "unavailable"} (${formatMs(infrastructure.postgres.connectAndPingMs)})`);
  if (infrastructure.redis.configured) {
    console.log(`Redis ${infrastructure.redis.reachable ? "reachable" : "unavailable"} (${formatMs(infrastructure.redis.connectAndPingMs)})`);
  }
  console.log("");
  const results: SmokeTestResult[] = [];

  for (const definition of definitions) {
    const result = await executeTest(definition, options);
    results.push(result);
    console.log(`${result.status.toUpperCase().padEnd(7)} ${result.suite}/${result.name} ${formatDuration(result.durationMs)}`);
    if (options.verbose && result.error) console.error(`  ${result.error}`);
  }

  const durationMs = Date.now() - started;
  const failures = results.filter((result) =>
    result.status === "failed" || (options.strict && result.status === "skipped"));
  console.log(`\n${results.filter((result) => result.status === "passed").length} passed, ${results.filter((result) => result.status === "failed").length} failed, ${results.filter((result) => result.status === "skipped").length} skipped in ${formatDuration(durationMs)}`);
  if (options.writeDoc) {
    console.log(`Report: ${await writeReport(results, options, infrastructure, startedAt, durationMs)}`);
  }
  if (failures.length > 0) process.exitCode = 1;
}
