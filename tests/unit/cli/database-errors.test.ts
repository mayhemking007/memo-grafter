import { describe, expect, it } from "vitest";
import {
  classifyDatabaseError,
  formatDatabaseSetupError,
  MissingDatabaseConfigurationError,
} from "../../../cli/utils/database-errors.js";
import { DOCS_LINKS } from "../../../cli/utils/docs.js";

describe("database error classification", () => {
  it.each([
    [{ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:5432" }, "connection_refused"],
    [{ code: "28P01", message: "password authentication failed for user" }, "authentication_failed"],
    [{ code: "3D000", message: 'database "missing" does not exist' }, "database_not_found"],
    [{
      code: "0A000",
      message: 'extension "vector" is not available: could not open extension control file "vector.control"',
    }, "pgvector_unavailable"],
    [{
      code: "42704",
      message: 'type "vector" does not exist',
    }, "pgvector_not_enabled"],
    [{
      code: "42501",
      message: 'permission denied to create extension "vector"',
    }, "insufficient_permissions"],
    [{ code: "42601", severity: "ERROR", message: "syntax error at or near SELECT" }, "migration_failed"],
    [new Error("something unexpected"), "unknown"],
  ])("maps %# to %s", (error, category) => {
    expect(classifyDatabaseError(error).category).toBe(category);
  });

  it("recognizes missing database configuration without matching its message", () => {
    expect(classifyDatabaseError(new MissingDatabaseConfigurationError()).category)
      .toBe("missing_database_url");
  });

  it("follows wrapped causes from the PostgreSQL driver", () => {
    const error = new Error("Migration failed", {
      cause: { code: "28P01", message: "password authentication failed" },
    });

    expect(classifyDatabaseError(error).category).toBe("authentication_failed");
  });

  it.each([
    ["connection_refused", "Could not connect to PostgreSQL"],
    ["authentication_failed", "PostgreSQL authentication failed"],
    ["database_not_found", "PostgreSQL database not found"],
    ["pgvector_unavailable", "pgvector is not installed"],
    ["pgvector_not_enabled", "CREATE EXTENSION IF NOT EXISTS vector;"],
    ["insufficient_permissions", "cannot complete MemoGrafter migrations"],
    ["migration_failed", "PostgreSQL rejected a migration statement"],
    ["unknown", "An unexpected database error occurred"],
  ] as const)("formats %s as actionable output", (category, expected) => {
    const output = formatDatabaseSetupError({
      category,
      cause: new Error("test"),
    });

    expect(output).toContain(`✗`);
    expect(output).toContain(expected);
    expect(output).toContain(DOCS_LINKS.databaseSetup);
  });
});
