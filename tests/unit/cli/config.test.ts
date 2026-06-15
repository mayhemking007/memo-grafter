import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConnectionString } from "../../../cli/utils/config.js";

const previousDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

describe("CLI config", () => {
  it("resolves connection string by flag, environment, then mg.config.ts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-config-"));

    process.env.DATABASE_URL = "postgres://env";
    expect(await resolveConnectionString({ cwd, db: "postgres://flag" })).toBe("postgres://flag");
    expect(await resolveConnectionString({ cwd })).toBe("postgres://env");

    delete process.env.DATABASE_URL;
    await mkdir(path.join(cwd, "src", "memo-grafter"), { recursive: true });
    await writeFile(path.join(cwd, "src", "memo-grafter", "mg.config.ts"), `export default {
  db: {
    connectionString: "postgres://config",
  },
};
`, "utf8");

    expect(await resolveConnectionString({ cwd })).toBe("postgres://config");
  });
});
