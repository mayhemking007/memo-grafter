import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrate, runRepositoryMigration } from "../../../cli/commands/migrate.js";
import { runStudio } from "../../../cli/commands/studio.js";

describe("CLI setup gates", () => {
  it("requires init before public migrate", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-migrate-"));

    await expect(runMigrate({ cwd, db: "postgres://example" }))
      .rejects
      .toThrow(/npx memo-grafter init/);
  });

  it("allows the repository migration runner before init", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-repository-migrate-"));
    const migrate = async () => ({ extensions: [], tables: [], indexes: [] });
    const close = async () => undefined;

    await expect(runRepositoryMigration(
      { cwd, db: "postgres://example" },
      { createStore: async () => ({ migrate, close }) },
    )).resolves.toBeUndefined();
  });

  it("requires init before studio", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-studio-"));

    await expect(runStudio({ cwd, db: "postgres://example", openBrowser: false }))
      .rejects
      .toThrow(/npx memo-grafter init/);
  });
});
