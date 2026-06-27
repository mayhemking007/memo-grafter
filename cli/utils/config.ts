import { pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface MemoGrafterCliConfig {
  db?: {
    connectionString?: string;
  };
  embedder?: {
    embed(text: string): Promise<number[]>;
  };
  graph?: {
    topK?: number;
    hopDepth?: number;
  };
  inject?: {
    bufferSize?: number;
    tokenBudget?: number;
    recentWindowSize?: number;
    recallLimit?: number;
    recallMinSimilarity?: number;
  };
  cache?: {
    connectionString: string;
    ttlSeconds?: number;
  };
}

export interface StudioRuntimeConfig {
  embedder?: MemoGrafterCliConfig["embedder"];
  graph?: MemoGrafterCliConfig["graph"];
  inject?: MemoGrafterCliConfig["inject"];
  cache?: MemoGrafterCliConfig["cache"];
}

export async function loadConfig(cwd: string): Promise<MemoGrafterCliConfig | null> {
  const configBasePaths = [
    path.join(cwd, "src", "memo-grafter", "mg.config"),
    path.join(cwd, "mg.config"),
  ];

  for (const configBasePath of configBasePaths) {
    const config = await tryLoadConfig(configBasePath);
    if (config) return config;
  }

  return null;
}

async function tryLoadConfig(configBasePath: string): Promise<MemoGrafterCliConfig | null> {
  const jsConfigPath = `${configBasePath}.js`;
  if (existsSync(jsConfigPath)) {
    try {
      const module = await import(pathToFileURL(jsConfigPath).href);
      return (module.default ?? module) as MemoGrafterCliConfig;
    } catch (error) {
      throw new Error(
        `Failed to load ${path.basename(jsConfigPath)}. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const tsConfigPath = `${configBasePath}.ts`;
  if (!existsSync(tsConfigPath)) return null;

  return parseTypeScriptConfig(readFileSync(tsConfigPath, "utf8"));
}

export async function resolveConnectionString(options: {
  cwd: string;
  db?: string;
}): Promise<string> {
  if (options.db) return options.db;
  loadEnvFile(options.cwd);
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const config = await loadConfig(options.cwd);
  const configured = config?.db?.connectionString;
  if (configured) return configured;

  throw new Error(
    "No database connection string found. Pass --db, set DATABASE_URL, or configure db.connectionString in src/memo-grafter/mg.config.ts.",
  );
}

export async function resolveStudioRuntimeConfig(options: {
  cwd: string;
}): Promise<StudioRuntimeConfig | null> {
  const config = await loadConfig(options.cwd);
  if (!config) return null;

  return {
    ...(config.embedder !== undefined ? { embedder: config.embedder } : {}),
    ...(config.graph !== undefined ? { graph: config.graph } : {}),
    ...(config.inject !== undefined ? { inject: config.inject } : {}),
    ...(config.cache !== undefined ? { cache: config.cache } : {}),
  };
}

function loadEnvFile(cwd: string): void {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseTypeScriptConfig(source: string): MemoGrafterCliConfig {
  const envMatch = source.match(/connectionString\s*:\s*process\.env\.([A-Z0-9_]+)/);
  if (envMatch?.[1]) {
    const connectionString = process.env[envMatch[1]];
    if (!connectionString) return {};

    return {
      db: {
        connectionString,
      },
    };
  }

  const literalMatch = source.match(/connectionString\s*:\s*["'`]([^"'`]+)["'`]/);
  if (literalMatch?.[1]) {
    return {
      db: {
        connectionString: literalMatch[1],
      },
    };
  }

  return {};
}
