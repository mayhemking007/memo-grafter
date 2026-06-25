import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertProjectInitialized, getProjectInitializationStatus } from "../../../cli/utils/project.js";

async function createProjectFile(cwd: string, relativePath: string): Promise<void> {
  const filePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "export default {};\n", "utf8");
}

describe("CLI project initialization", () => {
  it("reports missing MemoGrafter init files", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-project-"));

    const status = getProjectInitializationStatus(cwd);

    expect(status.initialized).toBe(false);
    expect(status.missing).toEqual([
      "src/memo-grafter/mg-schema.ts",
      "src/memo-grafter/mg.config.ts",
    ]);
    expect(() => assertProjectInitialized(cwd)).toThrow(/npx memo-grafter init/);
  });

  it("accepts initialized TypeScript projects", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-project-"));
    await createProjectFile(cwd, "src/memo-grafter/mg-schema.ts");
    await createProjectFile(cwd, "src/memo-grafter/mg.config.ts");

    expect(getProjectInitializationStatus(cwd)).toEqual({
      initialized: true,
      missing: [],
    });
    expect(() => assertProjectInitialized(cwd)).not.toThrow();
  });

  it("accepts compiled JavaScript init files", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-project-"));
    await createProjectFile(cwd, "src/memo-grafter/mg-schema.js");
    await createProjectFile(cwd, "src/memo-grafter/mg.config.js");

    expect(getProjectInitializationStatus(cwd).initialized).toBe(true);
  });
});
