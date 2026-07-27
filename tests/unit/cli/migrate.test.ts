import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runMigrate,
  type MigrateDependencies,
} from "../../../cli/commands/migrate.js";
import {
  HandledDatabaseSetupError,
} from "../../../cli/utils/database-errors.js";
import { DOCS_LINKS } from "../../../cli/utils/docs.js";
import { logger } from "../../../cli/utils/logger.js";

const previousDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

describe("memo-grafter migrate output", () => {
  it("prints actionable output for a classified migration failure and closes the store", async () => {
    const cwd = createInitializedProject();
    const close = vi.fn(async () => undefined);
    const dependencies = createDependencies({
      migrate: vi.fn(async () => {
        throw { code: "28P01", message: "password authentication failed" };
      }),
      close,
    });
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await expect(runMigrate({ cwd, db: "postgres://example" }, dependencies))
      .rejects.toBeInstanceOf(HandledDatabaseSetupError);

    expect(close).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("PostgreSQL authentication failed"));
    expect(info).toHaveBeenCalledWith(expect.stringContaining(DOCS_LINKS.databaseSetup));
  });

  it("prints missing DATABASE_URL guidance before creating a store", async () => {
    const cwd = createInitializedProject();
    delete process.env.DATABASE_URL;
    const createStore = vi.fn();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await expect(runMigrate({ cwd }, { createStore }))
      .rejects.toBeInstanceOf(HandledDatabaseSetupError);

    expect(createStore).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL is not configured"));
  });

  it("prints doctor guidance without the database setup link after success", async () => {
    const cwd = createInitializedProject();
    const close = vi.fn(async () => undefined);
    const dependencies = createDependencies({
      migrate: vi.fn(async () => ({
        extensions: [],
        tables: [],
        indexes: [],
      })),
      close,
    });
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const success = vi.spyOn(logger, "success").mockImplementation(() => undefined);

    await runMigrate({ cwd, db: "postgres://example" }, dependencies);

    expect(close).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledWith("MemoGrafter migrations completed");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("npx memo-grafter doctor"));
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining(DOCS_LINKS.databaseSetup));
  });
});

function createInitializedProject(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "memo-grafter-migrate-"));
  const directory = path.join(cwd, "src", "memo-grafter");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "mg-schema.ts"), "", "utf8");
  writeFileSync(path.join(directory, "mg.config.ts"), "export default {};\n", "utf8");
  return cwd;
}

function createDependencies(store: {
  migrate(): Promise<{
    extensions: Array<{ name: string; status: string }>;
    tables: Array<{ name: string; status: string }>;
    indexes: Array<{ name: string; status: string }>;
  }>;
  close(): Promise<void>;
}): MigrateDependencies {
  return {
    createStore: vi.fn(async () => store),
  };
}
