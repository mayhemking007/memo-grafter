import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConnectionString, resolveStudioRuntimeConfig } from "../../../cli/utils/config.js";

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousOpenAiKey = process.env.OPENAI_API_KEY;
const previousEmbeddingModel = process.env.MEMO_GRAFTER_EMBEDDING_MODEL;

afterEach(() => {
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  if (previousEmbeddingModel === undefined) {
    delete process.env.MEMO_GRAFTER_EMBEDDING_MODEL;
  } else {
    process.env.MEMO_GRAFTER_EMBEDDING_MODEL = previousEmbeddingModel;
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

  it("detects the generated TypeScript OpenAI embedder scaffold for Studio preview", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "memo-grafter-config-"));
    await mkdir(path.join(cwd, "src", "memo-grafter"), { recursive: true });
    process.env.OPENAI_API_KEY = "test-key";
    process.env.MEMO_GRAFTER_EMBEDDING_MODEL = "text-embedding-3-small";
    await writeFile(path.join(cwd, "src", "memo-grafter", "mg.config.ts"), `export default {
  db: {
    connectionString: "postgres://config",
  },
  embedder: process.env.OPENAI_API_KEY
    ? {
      async embed(text: string): Promise<number[]> {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          body: JSON.stringify({ input: text }),
        });
        return [];
      },
    }
    : undefined,
};
`, "utf8");

    const runtime = await resolveStudioRuntimeConfig({ cwd });

    expect(runtime?.embedder).toBeDefined();
    expect(typeof runtime?.embedder?.embed).toBe("function");
  });
});
