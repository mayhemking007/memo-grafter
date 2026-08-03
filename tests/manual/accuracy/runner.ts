import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoGrafter, type Message } from "../../../src/index.js";
import { RetrieverPipeline } from "../../../src/retrieval/RetrieverPipeline.js";
import { SmokeMetricsCollector } from "../live-smoke/helpers/metrics.js";
import {
  createOpenAITelemetry,
  openAIConfig,
  requireEnv,
  uniqueId,
} from "../live-smoke/helpers/fixtures.js";
import { accuracyCases } from "./cases.js";
import { evaluateCase } from "./evaluators.js";
import { createJudge, judgeCase } from "./judge.js";
import type { AccuracyCase, AccuracyCaseResult, AccuracyRunOptions, AccuracyScores } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const SYSTEM_MODEL = "gpt-4o-mini";
const EMBEDDER_MODEL = "text-embedding-3-small";

export async function runAccuracy(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  requireEnv("DATABASE_URL");
  requireEnv("OPENAI_API_KEY");
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const results: AccuracyCaseResult[] = [];

  console.log("MemoGrafter accuracy evaluation\n");
  for (const definition of accuracyCases) {
    const result = await withTimeout(runCase(definition, options), options.timeoutMs, definition.id);
    results.push(result);
    const failedAssertions = result.assertions.filter((assertion) => !assertion.passed).length;
    console.log(`${result.status === "evaluated" ? "EVALUATED" : "FAILED"}  ${result.caseId} ${(result.durationMs / 1000).toFixed(2)}s (${failedAssertions} deterministic misses)`);
    if (options.verbose && result.error) console.error(result.error);
  }

  const operationalFailures = results.filter((result) => result.status === "failed").length;
  const regressions = results.filter((result) => !meetsBaseline(result)).length;
  console.log(`\n${results.length - operationalFailures} evaluated, ${operationalFailures} failed, ${regressions} below baseline in ${((Date.now() - started) / 1000).toFixed(2)}s`);

  if (options.writeDoc) {
    const reportPath = await writeReport(results, options, startedAt, Date.now() - started);
    console.log(`Report: ${reportPath}`);
  }
  if (operationalFailures > 0 || (options.strict && regressions > 0)) process.exitCode = 1;
}

async function runCase(definition: AccuracyCase, options: AccuracyRunOptions): Promise<AccuracyCaseResult> {
  const started = Date.now();
  const sessionId = uniqueId(`accuracy-${definition.id}`);
  const metrics = new SmokeMetricsCollector();
  const systemLlm = createOpenAITelemetry(metrics);
  const memo = new MemoGrafter(openAIConfig(systemLlm, {
    drift: { mode: "intent", driftSensitivity: "low", minSegmentMessages: 2 },
    inject: { bufferSize: 0, tokenBudget: 1600 },
    graph: { topK: 5, hopDepth: 0 },
  }, metrics));
  const emptyScores = zeroScores();

  try {
    await memo.initialize();
    metrics.start();
    await memo.ingestNow(definition.conversation, sessionId);
    const { nodes: topics } = await memo.getTopics(sessionId);
    const memories = await memo.store.getMemoriesBySession(sessionId);
    const retriever = new RetrieverPipeline(memo.store, memo.embedder, {
      limit: 6,
      minSimilarity: 0.2,
      tokenBudget: 1600,
    });
    const recall = await retriever.run(definition.checkpoint.query, sessionId);
    const graft = await memo.graftByRelevance(sessionId, definition.checkpoint.query, {
      topK: 3,
      minSimilarity: 0.2,
      expansionStrategy: "none",
    });
    const memoryContext = [recall.systemPrompt, graft.systemPrompt].filter(Boolean).join("\n\n");
    const answerMessages: Message[] = [{ role: "user", content: definition.checkpoint.query }];
    const finalAnswer = await systemLlm.complete(
      answerMessages,
      `Answer concisely using only the memory context below. Do not invent user preferences.\n\n${memoryContext}`,
    );
    const deterministic = evaluateCase(definition, topics, memories, recall.facts, graft.systemPrompt, finalAnswer);
    let judge;
    let judgeUsage;
    if (options.judge) {
      const created = createJudge();
      judge = await judgeCase(created.adapter, definition, {
        topics: topics.map(({ embedding: _embedding, ...topic }) => topic),
        memories: memories.map(({ embedding: _embedding, ...memory }) => memory),
        recallFacts: recall.facts.map(({ embedding: _embedding, ...memory }) => memory),
        graftPrompt: graft.systemPrompt,
        finalAnswer,
      });
      judgeUsage = created.adapter.snapshot();
    }
    metrics.stop();

    return {
      caseId: definition.id,
      description: definition.description,
      status: "evaluated",
      durationMs: Date.now() - started,
      sessionId,
      conversation: definition.conversation,
      expectedTopics: definition.expectedTopics,
      expectedMemories: definition.expectedMemories,
      checkpoint: definition.checkpoint,
      topics,
      memories,
      recallFacts: recall.facts,
      recallPrompt: recall.systemPrompt,
      graftPrompt: graft.systemPrompt,
      graftTopicIds: graft.nodes.map((node) => node.id),
      finalAnswer,
      assertions: deterministic.assertions,
      scores: deterministic.scores,
      systemUsage: systemLlm.snapshot(),
      ...(judgeUsage ? { judgeUsage } : {}),
      databaseUsage: metrics.databaseSnapshot(),
      ...(judge ? { judge } : {}),
    };
  } catch (error) {
    metrics.stop();
    return {
      caseId: definition.id,
      description: definition.description,
      status: "failed",
      durationMs: Date.now() - started,
      sessionId,
      conversation: definition.conversation,
      expectedTopics: definition.expectedTopics,
      expectedMemories: definition.expectedMemories,
      checkpoint: definition.checkpoint,
      topics: [], memories: [], recallFacts: [], recallPrompt: "", graftPrompt: "", graftTopicIds: [], finalAnswer: "",
      assertions: [], scores: emptyScores, systemUsage: systemLlm.snapshot(), databaseUsage: metrics.databaseSnapshot(),
      error: formatError(error),
    };
  } finally {
    metrics.stop();
    await memo.store.clearSession(sessionId).catch(() => undefined);
    await memo.close().catch(() => undefined);
  }
}

function parseOptions(argv: string[]): AccuracyRunOptions {
  const reportArg = argv.find((arg) => arg.startsWith("--write-doc="));
  const timeoutArg = argv.find((arg) => arg.startsWith("--timeout="));
  return {
    judge: argv.includes("--judge"),
    writeDoc: argv.includes("--write-doc") || reportArg !== undefined,
    ...(reportArg ? { reportPath: reportArg.slice("--write-doc=".length) } : {}),
    strict: argv.includes("--strict"),
    verbose: argv.includes("--verbose"),
    timeoutMs: timeoutArg ? Number(timeoutArg.slice("--timeout=".length)) : DEFAULT_TIMEOUT_MS,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      handle = setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs} ms.`)), timeoutMs);
    })]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

function meetsBaseline(result: AccuracyCaseResult): boolean {
  return result.status === "evaluated"
    && result.scores.topicRecall >= 0.5
    && result.scores.memoryRecall >= 0.5
    && result.scores.recallAtK > 0
    && result.scores.graftCoverage > 0
    && result.scores.answerCoverage >= 0.5
    && !result.judge?.hallucinationDetected;
}

function zeroScores(): AccuracyScores {
  return { topicPrecision: 0, topicRecall: 0, topicF1: 0, topicRangeIoU: 0, memoryPrecision: 0, memoryRecall: 0, memoryF1: 0, recallPrecisionAtK: 0, recallAtK: 0, reciprocalRank: 0, graftCoverage: 0, graftSignalRatio: 0, answerCoverage: 0 };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function gitValue(args: string[]): string {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unavailable"; }
}

function average(results: AccuracyCaseResult[], key: keyof AccuracyScores): number {
  return results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.scores[key], 0) / results.length;
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

async function writeReport(results: AccuracyCaseResult[], options: AccuracyRunOptions, startedAt: string, durationMs: number): Promise<string> {
  const evaluated = results.filter((result) => result.status === "evaluated");
  const systemCalls = results.reduce((sum, result) => sum + result.systemUsage.calls, 0);
  const judgeCalls = results.reduce((sum, result) => sum + (result.judgeUsage?.calls ?? 0), 0);
  const lines = [
    "# MemoGrafter Accuracy Evaluation Report", "",
    `- Started: ${startedAt}`,
    `- Finished: ${new Date().toISOString()}`,
    `- Duration: ${(durationMs / 1000).toFixed(2)}s`,
    `- Last commit: ${gitValue(["rev-parse", "--short", "HEAD"])}`,
    `- Working tree: ${gitValue(["status", "--porcelain"]) === "" ? "clean" : "dirty"}`,
    `- System model: OpenAI / ${SYSTEM_MODEL}`,
    `- Embedder: OpenAI / ${EMBEDDER_MODEL}`,
    `- Judge: ${options.judge ? `OpenAI / ${process.env.ACCURACY_JUDGE_MODEL?.trim() || "gpt-4o-mini"}` : "Not Used"}`, "",
    "## Aggregate accuracy", "",
    "| Metric | Score |", "|---|---:|",
    `| Topic F1 | ${pct(average(evaluated, "topicF1"))} |`,
    `| Topic range overlap | ${pct(average(evaluated, "topicRangeIoU"))} |`,
    `| Memory precision | ${pct(average(evaluated, "memoryPrecision"))} |`,
    `| Memory recall | ${pct(average(evaluated, "memoryRecall"))} |`,
    `| Recall@K | ${pct(average(evaluated, "recallAtK"))} |`,
    `| Reciprocal rank | ${average(evaluated, "reciprocalRank").toFixed(3)} |`,
    `| Graft coverage | ${pct(average(evaluated, "graftCoverage"))} |`,
    `| Graft signal ratio | ${pct(average(evaluated, "graftSignalRatio"))} |`,
    `| Answer coverage | ${pct(average(evaluated, "answerCoverage"))} |`, "",
    "## Evaluation usage", "",
    `- System LLM calls: ${systemCalls}`,
    `- Evaluator LLM calls: ${judgeCalls}`,
    `- Total LLM calls: ${systemCalls + judgeCalls}`,
    `- Database reads: ${results.reduce((sum, result) => sum + result.databaseUsage.reads, 0)}`,
    `- Database writes: ${results.reduce((sum, result) => sum + result.databaseUsage.writes, 0)}`, "",
    "## Case summary", "",
    "| Case | Status | Topic F1 | Memory F1 | Recall@K | Graft coverage | Answer coverage |", "|---|---:|---:|---:|---:|---:|---:|",
    ...results.map((result) => `| ${result.caseId} | ${result.status.toUpperCase()} | ${pct(result.scores.topicF1)} | ${pct(result.scores.memoryF1)} | ${pct(result.scores.recallAtK)} | ${pct(result.scores.graftCoverage)} | ${pct(result.scores.answerCoverage)} |`),
  ];
  for (const result of results) appendCase(lines, result);
  const root = path.dirname(fileURLToPath(import.meta.url));
  const reportPath = path.resolve(options.reportPath ?? path.join(root, "reports", `accuracy-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

function appendCase(lines: string[], result: AccuracyCaseResult): void {
  lines.push("", `## ${result.caseId}`, "", result.description, "");
  if (result.error) lines.push(`Error: ${result.error}`, "");
  lines.push("### Source conversation", "");
  for (const message of result.conversation) lines.push(`- **${message.role}:** ${message.content}`);
  lines.push("", "### Golden expectations", "", "Topics:");
  for (const topic of result.expectedTopics) lines.push(`- ${topic.name}${topic.messageRange ? ` [${topic.messageRange.join("–")}]` : ""}: ${topic.requiredTerms.join(", ")}`);
  lines.push("", "Memories:");
  for (const memory of result.expectedMemories) lines.push(`- ${memory.name}: ${memory.requiredTerms.join(", ")}`);
  lines.push("", `Recall query: ${result.checkpoint.query}`, "");
  lines.push("### Deterministic assertions", "");
  for (const assertion of result.assertions) lines.push(`- ${assertion.passed ? "PASS" : "MISS"}: ${assertion.name} — ${assertion.detail}`);
  lines.push("", "### Formed topics", "");
  for (const topic of result.topics) lines.push(`- ${topic.label} [${topic.messageRange.join("–")}]: ${topic.summary}`);
  lines.push("", "### Formed memories", "");
  for (const memory of result.memories) lines.push(`- ${memory.subject} / ${memory.predicate}: ${memory.value}`);
  lines.push("", "### Recall ranking", "");
  result.recallFacts.forEach((fact, index) => lines.push(`${index + 1}. (${fact.similarity.toFixed(3)}) ${fact.subject} / ${fact.predicate}: ${fact.value}`));
  lines.push("", "### Recall context", "", "```text", result.recallPrompt || "Not Used", "```", "", "### Grafted context", "", "```text", result.graftPrompt || "Not Used", "```", "", "### Final answer", "", result.finalAnswer || "Not produced");
  if (result.judge) lines.push("", "### Semantic judge", "", `- Topic accuracy: ${pct(result.judge.topicAccuracy)}`, `- Memory accuracy: ${pct(result.judge.memoryAccuracy)}`, `- Retrieval relevance: ${pct(result.judge.retrievalRelevance)}`, `- Graft relevance: ${pct(result.judge.graftRelevance)}`, `- Answer faithfulness: ${pct(result.judge.answerFaithfulness)}`, `- Hallucination detected: ${result.judge.hallucinationDetected}`, `- Reason: ${result.judge.reason}`);
}
