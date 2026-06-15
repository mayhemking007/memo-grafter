import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../../cli/commands/init.js";

describe("memo-grafter init", () => {
  it("creates project files and preserves user-owned files on rerun", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-init-"));

    const first = await runInit(cwd);

    expect(first.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(first.created).toEqual(expect.arrayContaining([
      "src/memo-grafter/schema.ts",
      "src/memo-grafter/mg.config.ts",
      ".env.example",
    ]));

    const schemaPath = path.join(cwd, "src", "memo-grafter", "schema.ts");
    await writeFile(schemaPath, "export const userOwned = true;\n", "utf8");

    const second = await runInit(cwd);
    const schema = await readFile(schemaPath, "utf8");
    const mgSchema = await readFile(path.join(cwd, "src", "memo-grafter", "mg-schema.ts"), "utf8");
    const envExample = await readFile(path.join(cwd, ".env.example"), "utf8");

    expect(second.generated).toContain("src/memo-grafter/mg-schema.ts");
    expect(second.skipped).toEqual(expect.arrayContaining([
      "src/memo-grafter/schema.ts",
      "src/memo-grafter/mg.config.ts",
    ]));
    expect(schema).toBe("export const userOwned = true;\n");
    expect(mgSchema).toContain("mg_topic_nodes");
    expect(mgSchema).toContain("mg_memory_nodes");
    expect(envExample).toContain("DATABASE_URL=");
  });
});
