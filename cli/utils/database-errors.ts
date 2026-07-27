import { DOCS_LINKS } from "./docs.js";

export type DatabaseSetupError =
  | "missing_database_url"
  | "connection_refused"
  | "authentication_failed"
  | "database_not_found"
  | "pgvector_unavailable"
  | "pgvector_not_enabled"
  | "insufficient_permissions"
  | "migration_failed"
  | "unknown";

export interface ClassifiedDatabaseError {
  category: DatabaseSetupError;
  code?: string;
  cause: unknown;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  severity?: unknown;
  routine?: unknown;
  cause?: unknown;
}

export class MissingDatabaseConfigurationError extends Error {
  readonly code = "MEMO_GRAFTER_MISSING_DATABASE_URL";

  constructor() {
    super(
      "No database connection string found. Pass --db, set DATABASE_URL, "
      + "or configure db.connectionString in src/memo-grafter/mg.config.ts.",
    );
    this.name = "MissingDatabaseConfigurationError";
  }
}

export class HandledDatabaseSetupError extends Error {
  readonly handled = true;

  constructor(readonly classification: ClassifiedDatabaseError) {
    super(`MemoGrafter migration failed: ${classification.category}`);
    this.name = "HandledDatabaseSetupError";
  }
}

export function isHandledDatabaseSetupError(error: unknown): error is HandledDatabaseSetupError {
  return error instanceof HandledDatabaseSetupError;
}

export function classifyDatabaseError(error: unknown): ClassifiedDatabaseError {
  const errors = collectErrorChain(error);
  const codes = errors
    .flatMap((item) => [item.code, item.errno])
    .filter((value): value is string | number =>
      typeof value === "string" || typeof value === "number"
    )
    .map((value) => String(value).toUpperCase());
  const message = errors
    .map((item) => typeof item.message === "string" ? item.message : "")
    .join("\n")
    .toLowerCase();
  const code = codes[0];
  const result = (category: DatabaseSetupError): ClassifiedDatabaseError => ({
    category,
    ...(code ? { code } : {}),
    cause: error,
  });

  if (
    error instanceof MissingDatabaseConfigurationError
    || codes.includes("MEMO_GRAFTER_MISSING_DATABASE_URL")
  ) {
    return result("missing_database_url");
  }

  if (
    codes.some((value) =>
      ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET"].includes(value)
    )
    || /connect(?:ion)? (?:refused|timed out|terminated unexpectedly)/.test(message)
  ) {
    return result("connection_refused");
  }

  if (codes.includes("28P01") || /password authentication failed|authentication failed/.test(message)) {
    return result("authentication_failed");
  }

  if (codes.includes("3D000") || /database ".+" does not exist/.test(message)) {
    return result("database_not_found");
  }

  if (
    /extension "vector" is not available|could not open extension control file|vector\.control/.test(message)
  ) {
    return result("pgvector_unavailable");
  }

  if (
    (codes.includes("42704") && /\bvector\b/.test(message))
    || /type "vector" does not exist|extension "vector" does not exist/.test(message)
  ) {
    return result("pgvector_not_enabled");
  }

  if (
    codes.includes("42501")
    || /permission denied|must be superuser|not permitted to create extension/.test(message)
  ) {
    return result("insufficient_permissions");
  }

  if (errors.some(isPostgresErrorLike)) {
    return result("migration_failed");
  }

  return result("unknown");
}

export function formatDatabaseSetupError(error: ClassifiedDatabaseError): string {
  switch (error.category) {
    case "missing_database_url":
      return [
        "✗ DATABASE_URL is not configured",
        "",
        "Add your PostgreSQL connection string to the environment:",
        "",
        "  DATABASE_URL=postgresql://user:password@localhost:5432/database",
        "",
        "Don't have PostgreSQL with pgvector?",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "connection_refused":
      return [
        "✗ Could not connect to PostgreSQL",
        "",
        "Check that:",
        "",
        "- PostgreSQL is running",
        "- DATABASE_URL contains the correct host and port",
        "- The database is reachable from this environment",
        "",
        "Local Docker setup:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "authentication_failed":
      return [
        "✗ PostgreSQL authentication failed",
        "",
        "Check the username and password in DATABASE_URL.",
        "",
        "Database setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "database_not_found":
      return [
        "✗ PostgreSQL database not found",
        "",
        "Check the database name in DATABASE_URL and create it if necessary.",
        "",
        "Database setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "pgvector_unavailable":
      return [
        "✗ pgvector is not installed on this PostgreSQL server",
        "",
        "MemoGrafter requires PostgreSQL with pgvector support.",
        "",
        "Docker setup:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "pgvector_not_enabled":
      return [
        "✗ pgvector is not enabled in this database",
        "",
        "Run:",
        "",
        "  CREATE EXTENSION IF NOT EXISTS vector;",
        "",
        "You may need a PostgreSQL administrator account.",
        "",
        "Setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "insufficient_permissions":
      return [
        "✗ The database user cannot complete MemoGrafter migrations",
        "",
        "Ensure the user can create:",
        "",
        "- tables",
        "- indexes",
        "- extensions, when pgvector is not already enabled",
        "",
        "Setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "migration_failed":
      return [
        "✗ MemoGrafter migration failed",
        "",
        "PostgreSQL rejected a migration statement.",
        "Review the database logs and verify that the schema can be modified by this user.",
        "",
        "Setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
    case "unknown":
      return [
        "✗ MemoGrafter migration failed",
        "",
        "An unexpected database error occurred.",
        "Review the error details and verify your PostgreSQL configuration.",
        "",
        "Setup guide:",
        DOCS_LINKS.databaseSetup,
      ].join("\n");
  }
}

function collectErrorChain(error: unknown): ErrorLike[] {
  const result: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && (typeof current === "object" || typeof current === "function") && !seen.has(current)) {
    seen.add(current);
    const item = current as ErrorLike;
    result.push(item);
    current = item.cause;
  }

  return result;
}

function isPostgresErrorLike(error: ErrorLike): boolean {
  if (typeof error.severity === "string" || typeof error.routine === "string") return true;
  if (typeof error.code !== "string") return false;
  return /^[0-9A-Z]{5}$/.test(error.code.toUpperCase());
}
