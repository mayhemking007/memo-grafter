import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectInfrastructureMetrics } from "./environment.js";
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
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      definition.run(options),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Timed out after ${options.timeoutMs} ms.`)),
          options.timeoutMs,
        );
      }),
    ]);
    const finished = Date.now();
    return {
      suite: definition.suite,
      name: definition.name,
      status: "passed",
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      runtime: definition.runtime,
      ...outcome,
    };
  } catch (error) {
    const finished = Date.now();
    const message = formatError(error);
    const isSkip = message.startsWith("SKIP:");
    return {
      suite: definition.suite,
      name: definition.name,
      status: isSkip ? "skipped" : "failed",
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      runtime: definition.runtime,
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
    "## Runtime configuration",
    "",
    "| Suite | Test | LLM provider | LLM model | Embedder provider | Embedder model |",
    "|---|---|---|---|---|---|",
    ...results.map((result) =>
      `| ${result.suite} | ${result.name} | ${result.runtime.llm.provider} | ${result.runtime.llm.model} | ${result.runtime.embedder.provider} | ${result.runtime.embedder.model} |`),
    "",
    "## Summary",
    "",
    "| Suite | Test | Status | Duration | LLM calls | Estimated tokens |",
    "|---|---|---:|---:|---:|---:|",
    ...results.map((result) =>
      `| ${result.suite} | ${result.name} | ${result.status.toUpperCase()} | ${formatDuration(result.durationMs)} | ${result.runtime.llm.provider === "Not Used" ? "Not Used" : result.tokenUsage?.calls ?? 0} | ${result.runtime.llm.provider === "Not Used" ? "Not Used" : result.tokenUsage?.estimatedTotalTokens ?? 0} |`),
  );

  for (const result of results) {
    lines.push("", `## ${result.suite} / ${result.name}`, "");
    if (result.reason) lines.push(`Skipped: ${result.reason}`, "");
    if (result.error) lines.push(`Error: ${result.error}`, "");
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
