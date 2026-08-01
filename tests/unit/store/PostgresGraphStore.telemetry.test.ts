import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  classifyDatabaseQuery,
  safelyReportDatabaseQuery,
} from "../../../src/store/postgres-pgvector/GraphStore.js";

describe("PostgresGraphStore query telemetry", () => {
  it.each([
    ["SELECT 1", "read"],
    [" -- comment\n SELECT * FROM mg_sessions", "read"],
    ["WITH rows AS (SELECT 1) SELECT * FROM rows", "read"],
    ["INSERT INTO mg_sessions VALUES ($1)", "write"],
    ["UPDATE mg_sessions SET updated_at = NOW()", "write"],
    ["DELETE FROM mg_sessions", "write"],
    ["WITH removed AS (DELETE FROM mg_sessions RETURNING *) SELECT * FROM removed", "write"],
    ["BEGIN", "other"],
    ["CREATE TABLE example (id text)", "other"],
  ] as const)("classifies %s as %s", (query, operation) => {
    expect(classifyDatabaseQuery(query)).toBe(operation);
  });

  it("reports only the operation classification", () => {
    const onQuery = vi.fn();
    safelyReportDatabaseQuery({ onQuery }, "read");
    expect(onQuery).toHaveBeenCalledWith({ operation: "read" });
  });

  it("does not let telemetry errors affect database behavior", () => {
    expect(() => safelyReportDatabaseQuery({
      onQuery: () => {
        throw new Error("telemetry failed");
      },
    }, "write")).not.toThrow();
  });
});
