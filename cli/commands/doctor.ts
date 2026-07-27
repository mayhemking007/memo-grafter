import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import {
  findConfigFiles,
  loadConfig,
  loadEnvFile,
  resolveConnectionString,
} from "../utils/config.js";
import {
  checkPgvectorAvailability,
  checkPgvectorEnabled,
  checkPostgresConnection,
  createDatabaseClient,
  getMigrationStatus,
  type DatabaseClient,
  type MigrationStatus,
} from "../utils/database.js";
import { classifyPostgresError } from "../utils/database-errors.js";
import { renderDoctor } from "../doctor/render.js";
import type { DoctorResult } from "../doctor/types.js";

interface SchemaMetadata {
  memoGrafterCurrentMigrationVersion: number;
  memoGrafterMigrationTableName: string;
  memoGrafterTableNames: readonly string[];
}

export interface DoctorOptions {
  cwd?: string;
  db?: string;
}

export interface DoctorDependencies {
  createDatabaseClient(connectionString: string): DatabaseClient;
  checkPostgresConnection(sql: DatabaseClient): Promise<{ version: string }>;
  checkPgvectorAvailability(sql: DatabaseClient): Promise<boolean>;
  checkPgvectorEnabled(sql: DatabaseClient): Promise<boolean>;
  getMigrationStatus(
    sql: DatabaseClient,
    options: {
      migrationTableName: string;
      expectedVersion: number;
      requiredTables: readonly string[];
    },
  ): Promise<MigrationStatus>;
  loadSchemaMetadata(): Promise<SchemaMetadata>;
  checkRedis(connectionString: string): Promise<void>;
  getMemoGrafterVersion(): string;
}

const defaultDependencies: DoctorDependencies = {
  createDatabaseClient,
  checkPostgresConnection,
  checkPgvectorAvailability,
  checkPgvectorEnabled,
  getMigrationStatus,
  async loadSchemaMetadata() {
    return await import("memo-grafter/schema") as unknown as SchemaMetadata;
  },
  async checkRedis(connectionString: string) {
    const redis = new Redis(connectionString, {
      connectTimeout: 3_000,
      commandTimeout: 3_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    try {
      await redis.connect();
      await redis.ping();
    } finally {
      redis.disconnect();
    }
  },
  getMemoGrafterVersion,
};

export async function runDoctor(
  options: DoctorOptions = {},
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<{ exitCode: 0 | 1; results: DoctorResult[]; output: string }> {
  const cwd = options.cwd ?? process.cwd();
  const results: DoctorResult[] = [
    passed("runtime.node", "Runtime", `Node.js ${process.versions.node}`),
    passed("runtime.memo-grafter", "Runtime", `MemoGrafter ${dependencies.getMemoGrafterVersion()}`),
  ];

  loadEnvFile(cwd);
  const configFiles = findConfigFiles(cwd);
  const envFileFound = path.join(cwd, ".env");
  const config = await loadConfig(cwd);
  const foundSources = [
    ...(configFiles.length > 0 ? configFiles.map((file) => path.relative(cwd, file)) : []),
    ...(configFiles.length === 0 && readEnvFileExists(cwd) ? [path.basename(envFileFound)] : []),
  ];
  results.push(foundSources.length > 0
    ? passed("configuration.files", "Configuration", "MemoGrafter configuration found", foundSources.join(", "))
    : failed(
      "configuration.files",
      "Configuration",
      "MemoGrafter configuration not found",
      ["Run: npx memo-grafter init"],
    ));

  let connectionString: string | undefined;
  try {
    connectionString = await resolveConnectionString({
      cwd,
      ...(options.db ? { db: options.db } : {}),
    });
    results.push(passed("configuration.database-url", "Configuration", "DATABASE_URL configured"));
  } catch {
    results.push(failed(
      "configuration.database-url",
      "Configuration",
      "DATABASE_URL is not configured",
      ["Set DATABASE_URL, configure db.connectionString, or pass --db."],
    ));
  }

  if (connectionString) {
    const sql = dependencies.createDatabaseClient(connectionString);
    let connected = false;
    try {
      const connection = await dependencies.checkPostgresConnection(sql);
      connected = true;
      results.push(passed("postgres.connection", "PostgreSQL", "PostgreSQL reachable"));
      results.push(passed("postgres.version", "PostgreSQL", `PostgreSQL ${connection.version}`));
    } catch (error) {
      const classification = classifyPostgresError(error);
      results.push(failed(
        "postgres.connection",
        "PostgreSQL",
        "PostgreSQL could not be reached",
        [`Database error: ${classification.category}`, "Check DATABASE_URL and confirm PostgreSQL is running."],
      ));
      appendSkippedDatabaseResults(results);
    }

    if (connected) {
      try {
        const available = await dependencies.checkPgvectorAvailability(sql);
        results.push(available
          ? passed("postgres.pgvector-available", "PostgreSQL", "pgvector available")
          : failed("postgres.pgvector-available", "PostgreSQL", "pgvector is not available"));

        const enabled = await dependencies.checkPgvectorEnabled(sql);
        results.push(enabled
          ? passed("postgres.pgvector-enabled", "PostgreSQL", "pgvector enabled")
          : failed(
            "postgres.pgvector-enabled",
            "PostgreSQL",
            "pgvector is not enabled",
            ["Run: CREATE EXTENSION IF NOT EXISTS vector;"],
          ));

        const metadata = await dependencies.loadSchemaMetadata();
        const migration = await dependencies.getMigrationStatus(sql, {
          migrationTableName: metadata.memoGrafterMigrationTableName,
          expectedVersion: metadata.memoGrafterCurrentMigrationVersion,
          requiredTables: metadata.memoGrafterTableNames,
        });
        appendMigrationResults(results, migration);
      } catch (error) {
        const classification = classifyPostgresError(error);
        results.push(failed(
          "database.diagnostics",
          "Database",
          "Database diagnostics could not be completed",
          [`Database error: ${classification.category}`],
        ));
        appendSkippedDatabaseResults(results);
      }
    }
    await sql.end().catch(() => undefined);
  } else {
    results.push(skipped("postgres.connection", "PostgreSQL", "PostgreSQL check skipped"));
    appendSkippedDatabaseResults(results);
  }

  const redisUrl = config?.cache?.connectionString;
  if (!redisUrl) {
    results.push({
      id: "redis.connection",
      section: "Redis",
      label: "Redis not configured — optional",
      status: "skipped",
      required: false,
    });
  } else {
    try {
      await dependencies.checkRedis(redisUrl);
      results.push({
        id: "redis.connection",
        section: "Redis",
        label: "Redis reachable",
        status: "passed",
        required: false,
      });
    } catch {
      results.push({
        id: "redis.connection",
        section: "Redis",
        label: "Redis could not be reached",
        status: "warning",
        help: ["MemoGrafter can run without caching unless Redis is required by your configuration."],
        required: false,
      });
    }
  }

  const exitCode = results.some((result) => result.required && result.status === "failed") ? 1 : 0;
  return { exitCode, results, output: renderDoctor(results) };
}

function appendMigrationResults(results: DoctorResult[], status: MigrationStatus): void {
  results.push(status.migrationTableExists
    ? passed("database.migration-table", "Database", "MemoGrafter migration table found")
    : failed(
      "database.migration-table",
      "Database",
      "MemoGrafter migration table is missing",
      ["Run: npx memo-grafter migrate"],
    ));
  results.push(status.currentVersion === status.expectedVersion
    ? passed("database.migration-version", "Database", "Migrations are up to date")
    : failed(
      "database.migration-version",
      "Database",
      "Migrations are not up to date",
      ["Run: npx memo-grafter migrate"],
    ));
  results.push(status.missingTables.length === 0
    ? passed("database.core-tables", "Database", "MemoGrafter schema found")
    : failed(
      "database.core-tables",
      "Database",
      "MemoGrafter schema is incomplete",
      [`Missing tables: ${status.missingTables.join(", ")}`, "Run: npx memo-grafter migrate"],
    ));
}

function appendSkippedDatabaseResults(results: DoctorResult[]): void {
  if (!results.some((result) => result.id === "postgres.version")) {
    results.push(skipped("postgres.version", "PostgreSQL", "PostgreSQL version check skipped"));
  }
  for (const [id, section, label] of [
    ["postgres.pgvector-available", "PostgreSQL", "pgvector availability check skipped"],
    ["postgres.pgvector-enabled", "PostgreSQL", "pgvector enabled check skipped"],
    ["database.migration-table", "Database", "Migration table check skipped"],
    ["database.migration-version", "Database", "Migration version check skipped"],
    ["database.core-tables", "Database", "Core table check skipped"],
  ]) {
    if (!results.some((result) => result.id === id)) results.push(skipped(id, section, label));
  }
}

function passed(id: string, section: string, label: string, message?: string): DoctorResult {
  return { id, section, label, status: "passed", ...(message ? { message } : {}), required: true };
}

function failed(id: string, section: string, label: string, help?: string[]): DoctorResult {
  return { id, section, label, status: "failed", ...(help ? { help } : {}), required: true };
}

function skipped(id: string, section: string, label: string): DoctorResult {
  return { id, section, label, status: "skipped", required: true };
}

function getMemoGrafterVersion(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDirectory = path.dirname(currentFile);
  const packagePath = [
    path.resolve(currentDirectory, "..", "..", "package.json"),
    path.resolve(currentDirectory, "..", "..", "..", "package.json"),
  ].find((candidate) => existsSync(candidate));
  if (!packagePath) return "unknown";
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return packageJson.version ?? "unknown";
}

function readEnvFileExists(cwd: string): boolean {
  try {
    readFileSync(path.join(cwd, ".env"));
    return true;
  } catch {
    return false;
  }
}
