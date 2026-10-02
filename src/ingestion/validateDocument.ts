import { createHash } from "node:crypto";
import type { IngestTextDetailedOptions } from "./types.js";
import { MemoGrafterError } from "../diagnostics.js";
import { prepareTextChunks } from "../utils/text/prepareTextChunks.js";

export function validateDocument(text: string, options: IngestTextDetailedOptions, timeoutMs: number) {
  const invalid = (message: string): never => { throw new MemoGrafterError(message, { code: "INPUT_INVALID", operation: "ingest" }); };
  if (typeof text !== "string" || !text.trim()) invalid("Detailed document ingestion requires nonblank text.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2_147_483_647) invalid("timeoutMs must be an integer between 0 and 2147483647.");
  const plainObject = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  if (!plainObject(options)) invalid("Document options must be an object.");
  for (const key of ["chunking", "segmentation", "qualityPolicy", "memoryBudget", "concurrency"] as const) {
    if (options[key] !== undefined && !plainObject(options[key])) invalid(`${key} must be an object.`);
  }
  for (const name of ["idempotencyKey", "label", "source"] as const) if (options[name] !== undefined && (typeof options[name] !== "string" || !options[name]!.trim())) invalid(`${name} must be a nonblank string.`);
  if (options.replace !== undefined && typeof options.replace !== "boolean") invalid("replace must be boolean.");
  if (options.tags !== undefined && (!Array.isArray(options.tags) || options.tags.some(tag => typeof tag !== "string"))) invalid("tags must contain strings.");
  const policy = options.qualityPolicy;
  if (policy?.mode !== undefined && !["observe", "enforce"].includes(policy.mode)) invalid("Unknown quality policy mode.");
  for (const value of [options.sourceReliability, policy?.minExplicitness, policy?.minSourceReliability]) if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) invalid("Quality thresholds and source reliability must be between zero and one.");
  const chunks = prepareTextChunks(text, options);
  const { idempotencyKey: _key, ...settings } = options;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  let serialized: string;
  try { serialized = JSON.stringify(canonical({ text, options: settings, timeoutMs })); }
  catch { return invalid("Document options must be JSON serializable."); }
  const requestFingerprint = createHash("sha256").update(serialized).digest("hex");
  return { chunks, requestFingerprint };
}
