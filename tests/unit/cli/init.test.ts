import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../../../cli/commands/init.js";
import { DOCS_LINKS } from "../../../cli/utils/docs.js";
import { logger } from "../../../cli/utils/logger.js";
import { getProjectInitializationStatus } from "../../../cli/utils/project.js";

describe("memo-grafter init", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates only MemoGrafter-owned project files and preserves existing schema files", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-init-"));

    const first = await runInit(cwd);

    expect(getProjectInitializationStatus(cwd).initialized).toBe(true);
    expect(first.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(first.created).toEqual(expect.arrayContaining([
      "src/memo-grafter/mg.config.ts",
      ".env.example",
    ]));

    const schemaPath = path.join(cwd, "src", "memo-grafter", "schema.ts");
    expect(existsSync(schemaPath)).toBe(false);
    writeFileSync(schemaPath, "export const userOwned = true;\n", "utf8");

    const second = await runInit(cwd);
    const schema = readFileSync(schemaPath, "utf8");
    const mgSchema = readFileSync(path.join(cwd, "src", "memo-grafter", "mg-schema.ts"), "utf8");
    const mgConfig = readFileSync(path.join(cwd, "src", "memo-grafter", "mg.config.ts"), "utf8");
    const envExample = readFileSync(path.join(cwd, ".env.example"), "utf8");

    expect(second.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(second.skipped).toEqual(expect.arrayContaining([
      "src/memo-grafter/mg.config.ts",
    ]));
    expect(second.skipped).not.toContain("src/memo-grafter/schema.ts");
    expect(schema).toBe("export const userOwned = true;\n");
    expect(mgSchema).toContain("mg_topic_nodes");
    expect(mgSchema).toContain("mg_memory_nodes");
    expect(mgSchema).toContain('session_id: {\n        name: "session_id",\n        type: "text",');
    expect(mgConfig).toContain("OPENAI_API_KEY");
    expect(mgConfig).toContain('import { defineConfig, OpenAILLMAdapter } from "memo-grafter"');
    expect(mgConfig).toContain("llm: new OpenAILLMAdapter(llmModel)");
    expect(mgConfig).toContain("export default defineConfig(() => ({");
    expect(mgConfig).toContain("REDIS_URL?: string");
    expect(mgConfig).toContain("https://api.openai.com/v1/embeddings");
    expect(mgConfig).toContain("text-embedding-3-small");
    expect(mgConfig).toContain("// cache: process.env.REDIS_URL");
    expect(mgConfig).toContain("// queue: process.env.REDIS_URL");
    expect(mgConfig).toContain(`// Optional recall cache. Falls back to PostgreSQL if Redis is unavailable.

  // cache: process.env.REDIS_URL`);
    expect(mgConfig).toContain(`// Optional Redis-backed ingestion; failed enqueues do not retry synchronously.

  // queue: process.env.REDIS_URL`);
    expect(mgConfig).not.toContain("Prompt Preview uses this embedder");
    expect(mgConfig).not.toMatch(/^\s*cache:\s*process\.env\.REDIS_URL/m);
    expect(mgConfig).not.toMatch(/^\s*queue:\s*process\.env\.REDIS_URL/m);
    expect(envExample).toContain(
      "DATABASE_URL=postgresql://memografter:memografter@localhost:5432/memografter",
    );
    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(envExample).toContain("MEMO_GRAFTER_LLM_MODEL=gpt-4o");
    expect(envExample).toContain("MEMO_GRAFTER_EMBEDDING_MODEL=text-embedding-3-small");
    expect(envExample).toContain(
      "# Optional. Set this and uncomment cache or queue in src/memo-grafter/mg.config.ts.",
    );
    expect(envExample).toContain("# Example: REDIS_URL=redis://localhost:6379");
    expect(envExample).toMatch(/^REDIS_URL=$/m);
  });

  it("prints migration and local database guidance after fresh initialization", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-init-fresh-"));
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await runInit(cwd);

    expect(info).toHaveBeenCalledWith([
      "Next step:",
      "",
      "  npx memo-grafter migrate",
      "",
      "Don't have PostgreSQL with pgvector?",
      "Set it up locally using Docker:",
      DOCS_LINKS.databaseSetup,
    ].join("\n"));
  });

  it("reports an existing initialized project as a successful no-op experience", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-init-existing-"));
    await runInit(cwd);
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const result = await runInit(cwd);

    expect(result.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(result.skipped).toContain("src/memo-grafter/mg.config.ts");
    expect(info).toHaveBeenCalledWith([
      "MemoGrafter is already initialized.",
      "",
      "Next step:",
      "",
      "  npx memo-grafter migrate",
      "",
      "Need a local PostgreSQL database with pgvector?",
      DOCS_LINKS.databaseSetup,
    ].join("\n"));
  });

  it("repairs partial configuration without reporting it as already initialized", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-init-partial-"));
    const memoGrafterDir = path.join(cwd, "src", "memo-grafter");
    mkdirSync(memoGrafterDir, { recursive: true });
    writeFileSync(path.join(memoGrafterDir, "mg.config.ts"), "export default {};\n", "utf8");
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const result = await runInit(cwd);

    expect(result.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(result.skipped).toContain("src/memo-grafter/mg.config.ts");
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("already initialized"));
    expect(error).not.toHaveBeenCalled();
    expect(getProjectInitializationStatus(cwd).initialized).toBe(true);
  });

  it("does not print completion guidance after a filesystem failure", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-init-failure-"));
    writeFileSync(path.join(cwd, "src"), "not a directory\n", "utf8");
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await expect(runInit(cwd)).rejects.toThrow();

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("Next step:"));
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining(DOCS_LINKS.databaseSetup));
  });

  it("keeps the database documentation URL in the shared link helper", () => {
    expect(DOCS_LINKS.databaseSetup).toBe(
      "https://memografter.com/docs/database-setup-with-docker",
    );
  });
});
