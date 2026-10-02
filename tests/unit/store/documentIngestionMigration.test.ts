import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { documentIngestionMigrationSql } from "../../../src/schema/documentIngestionMigration.js";
import { PostgresGraphStore } from "../../../src/store/index.js";
import { structuredDocumentMigrationSql } from "../../../src/schema/structuredDocumentMigration.js";

it("packages the same durable document upgrade as the standalone migration", () => {
  expect(documentIngestionMigrationSql.replaceAll("\r\n", "\n")).toBe(readFileSync(new URL("../../../migrations/013_document_ingestion.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
});

it("packages the structured provenance migration", () => {
  expect(structuredDocumentMigrationSql.replaceAll("\r\n", "\n")).toBe(readFileSync(new URL("../../../migrations/014_structured_documents.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
});

it("creates the ingestion-run table before upgrading it on a fresh database", async () => {
  let created = false;
  const sql = Object.assign(vi.fn(async (parts: TemplateStringsArray | string) => {
    if (Array.isArray(parts) && parts.join("?").includes("CREATE TABLE IF NOT EXISTS mg_ingestion_runs")) created = true;
    return [];
  }), { unsafe: vi.fn(async (query: string) => { if (query === documentIngestionMigrationSql) expect(created).toBe(true); }) });
  const store = new PostgresGraphStore("postgres://unused");
  Object.assign(store, { sql, getExistingExtensions: async () => new Set(), getExistingTables: async () => new Set(), getExistingIndexes: async () => new Set(), migrateExistingNodeTable: async () => undefined, createIndexes: async () => undefined });
  await store.migrate();
  expect(sql.unsafe.mock.calls.filter(([query]) => query === documentIngestionMigrationSql)).toHaveLength(1);
});
